package com.xingchen.oa.boot.ai.orchestration;

import com.xingchen.oa.boot.ai.entity.AiChatMessage;
import com.xingchen.oa.boot.ai.repository.AiChatMessageRepository;
import com.xingchen.oa.boot.ai.support.AiErrors;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.CallAdvisor;
import org.springframework.ai.chat.client.advisor.api.CallAdvisorChain;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * AI 助手 Advisor 链（ai-assistant-design-v2.md §4.2，批B）。顺序（order 越小越靠外，
 * 全部排在框架 ToolCallingAdvisor(MIN+300) 之前 → 每轮只执行一次，不随工具循环重复）：
 *
 * <pre>
 * ① RequestIdAdvisor(MIN+10)         轮次关联标识入 MDC（requestId/traceId 由批A 轮次上下文供给）
 * ② SecurityContextAdvisor(MIN+20)   Tool Calling 前身份上下文硬校验（附2 第 2 条）
 * ③ QuotaAdvisor(MIN+30)             每用户 RPM 限流（内存实现留扩展点）
 * ④ ConversationMemoryAdvisor(MIN+40) ChatMemory 自实现：读 ai_chat_message 注入近 N 条历史
 *                                     （附2 第 3 条：禁止引入 Spring AI Jdbc memory 第二套表）
 * ⑤ RagPlaceholderAdvisor(MIN+50)    RAG 占位（批D pgvector 落地）
 * ⑥ [ToolCallingAdvisor MIN+300]     框架工具循环（AiToolGateway 定制 ToolCallingManager）
 * ⑦ AuditAdvisor(MIN+60)             计时/用量审计（响应侧在整个工具循环完成后执行）
 * ⑧ OutputSanitizationAdvisor(MIN+70) 输出清洗占位（响应侧最内层→最先处理响应）
 * </pre>
 */
public final class AiAdvisors {

    private static final int BASE = Integer.MIN_VALUE;

    private AiAdvisors() {
    }

    /** ① 轮次关联标识（requestId/traceId 已由 AiExecutionContext 传播入 MDC，此处兜底补齐）。 */
    @Component
    public static class RequestIdAdvisor implements CallAdvisor {
        @Override
        public String getName() {
            return "aiRequestIdAdvisor";
        }

        @Override
        public int getOrder() {
            return BASE + 10;
        }

        @Override
        public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
            if (MDC.get("requestId") == null) {
                MDC.put("requestId", "req_" + Long.toHexString(System.nanoTime()));
            }
            return chain.nextCall(request);
        }
    }

    /** ② Tool Calling 前身份上下文硬校验（§4.2 要求；缺失=传播缺口，拒绝调用模型）。 */
    @Component
    public static class SecurityContextAdvisor implements CallAdvisor {
        @Override
        public String getName() {
            return "aiSecurityContextAdvisor";
        }

        @Override
        public int getOrder() {
            return BASE + 20;
        }

        @Override
        public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
            UserContext user = CurrentUserHolder.get();
            if (user == null || user.getUserId() == null) {
                throw AiErrors.e(401, AiErrors.CONTEXT_MISSING, "执行上下文缺失，拒绝调用模型");
            }
            return chain.nextCall(request);
        }
    }

    /** ③ 配额（§18）：每用户 RPM，内存实现留扩展点。 */
    @Slf4j
    @Component
    @RequiredArgsConstructor
    public static class QuotaAdvisor implements CallAdvisor {

        private final AiQuotaService quotaService;

        @Override
        public String getName() {
            return "aiQuotaAdvisor";
        }

        @Override
        public int getOrder() {
            return BASE + 30;
        }

        @Override
        public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
            UserContext user = CurrentUserHolder.get();
            quotaService.checkAndRecord(user != null ? user.getUserId() : null);
            return chain.nextCall(request);
        }
    }

    /**
     * ④ ChatMemory 自实现（附2 第 3 条）：从 ai_chat_message 读近 N 条（不含本轮，
     * 由参数 {@code ai.beforeMessageId} 界定），插入 system 之后。滚动摘要在 system prompt（批A 机制不变）。
     */
    @Component
    @RequiredArgsConstructor
    public static class ConversationMemoryAdvisor implements CallAdvisor {

        public static final String PARAM_SESSION_ID = "ai.sessionId";
        public static final String PARAM_BEFORE_MESSAGE_ID = "ai.beforeMessageId";
        private static final int WINDOW = 20;

        private final AiChatMessageRepository messageRepository;

        @Override
        public String getName() {
            return "aiConversationMemoryAdvisor";
        }

        @Override
        public int getOrder() {
            return BASE + 40;
        }

        @Override
        public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
            Object sid = request.context().get(PARAM_SESSION_ID);
            Object beforeId = request.context().get(PARAM_BEFORE_MESSAGE_ID);
            if (!(sid instanceof Number) || !(beforeId instanceof Number)) {
                return chain.nextCall(request); // 无会话上下文（如计划生成子调用显式关闭）→ 原样透传
            }
            List<AiChatMessage> desc = messageRepository.findBySessionIdOrderByIdDesc(
                    ((Number) sid).longValue(), PageRequest.of(0, WINDOW + 2));
            Collections.reverse(desc);
            List<Message> history = new ArrayList<>();
            long boundary = ((Number) beforeId).longValue();
            for (AiChatMessage h : desc) {
                if (h.getId() >= boundary || AiChatMessage.ROLE_TOOL.equals(h.getRole())
                        || !StringUtils.hasText(h.getContent())) {
                    continue;
                }
                history.add(AiChatMessage.ROLE_ASSISTANT.equals(h.getRole())
                        ? new AssistantMessage(h.getContent())
                        : UserMessage.builder().text(h.getContent()).build());
            }
            if (history.isEmpty()) {
                return chain.nextCall(request);
            }
            // 重排：system... + 历史 + 其余（本轮 user）
            Prompt prompt = request.prompt();
            List<Message> merged = new ArrayList<>();
            List<Message> rest = new ArrayList<>();
            for (Message m : prompt.getInstructions()) {
                if (m.getMessageType() == MessageType.SYSTEM) {
                    merged.add(m);
                } else {
                    rest.add(m);
                }
            }
            merged.addAll(history);
            merged.addAll(rest);
            return chain.nextCall(request.mutate()
                    .prompt(prompt.mutate().messages(merged).build()).build());
        }
    }

    /** ⑤ RAG 占位（批D：pgvector + 元数据过滤检索，此处仅保链位）。 */
    @Component
    public static class RagPlaceholderAdvisor implements CallAdvisor {
        @Override
        public String getName() {
            return "aiRagPlaceholderAdvisor";
        }

        @Override
        public int getOrder() {
            return BASE + 50;
        }

        @Override
        public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
            return chain.nextCall(request);
        }
    }

    /** ⑦ 审计：整轮（含工具循环）计时 + 用量日志（§19.3 最小化：不落对话正文）。 */
    @Slf4j
    @Component
    public static class AuditAdvisor implements CallAdvisor {
        @Override
        public String getName() {
            return "aiAuditAdvisor";
        }

        @Override
        public int getOrder() {
            return BASE + 60;
        }

        @Override
        public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
            long t0 = System.currentTimeMillis();
            ChatClientResponse response = chain.nextCall(request);
            long cost = System.currentTimeMillis() - t0;
            try {
                var usage = response.chatResponse() != null
                        ? response.chatResponse().getMetadata().getUsage() : null;
                log.info("AI 模型轮次完成 cost={}ms promptTokens={} completionTokens={}",
                        cost, usage != null ? usage.getPromptTokens() : null,
                        usage != null ? usage.getCompletionTokens() : null);
            } catch (Exception ignored) {
                log.info("AI 模型轮次完成 cost={}ms", cost);
            }
            return response;
        }
    }

    /** ⑧ 输出清洗（§4.2 OutputSanitization）：响应侧最内层——去首尾空白/控制字符（占位，批C 强化）。 */
    @Component
    public static class OutputSanitizationAdvisor implements CallAdvisor {
        @Override
        public String getName() {
            return "aiOutputSanitizationAdvisor";
        }

        @Override
        public int getOrder() {
            return BASE + 70;
        }

        @Override
        public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
            // 批B 占位：文本清洗在 AiChatService 收尾统一处理（此处保链位，批C 落敏感模式过滤）
            return chain.nextCall(request);
        }
    }
}

package com.xingchen.oa.boot.ai.controller;

import com.xingchen.oa.boot.ai.entity.AiChatMessage;
import com.xingchen.oa.boot.ai.entity.AiChatMessagePart;
import com.xingchen.oa.boot.ai.service.AiActionService;
import com.xingchen.oa.boot.ai.service.AiApprovalInsightService;
import com.xingchen.oa.boot.ai.service.AiChatService;
import com.xingchen.oa.boot.ai.service.AiChatService.ChatResult;
import com.xingchen.oa.boot.ai.service.AiModelService;
import com.xingchen.oa.boot.ai.support.AiExecutionContext;
import com.xingchen.oa.boot.ai.support.AiSseChannel;
import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.core.R;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;

/**
 * AI 智能助手 API（V2 批A，ai-assistant-design-v2.md §9）。登录即用（工具沿用各自模块权限）。
 * <ul>
 *   <li>POST /api/ai/chat/messages —— SSE（§9.2 事件流；异步执行，上下文经 AiExecutionContext 显式传播）；</li>
 *   <li>POST /api/ai/chat —— 旧阻塞端点保留（前端 SSE 建立失败回退，行为兼容）；</li>
 *   <li>POST /api/ai/actions/{id}/confirm|cancel —— 动作草稿状态机（Idempotency-Key 幂等）；</li>
 *   <li>POST /api/ai/confirm —— 旧确认端点兼容代理（前端随后切新端点）。</li>
 * </ul>
 */
@Slf4j
@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiChatController {

    private static final long SSE_TIMEOUT_MS = 180_000L;

    private final AiChatService chatService;
    private final AiActionService actionService;
    private final AiModelService modelService;
    private final AiApprovalInsightService insightService;
    private final ObjectMapper objectMapper;
    /** AiAsyncConfig 虚拟线程执行器（按参数名匹配 bean aiExecutor）。 */
    private final ExecutorService aiExecutor;

    /** §11：credentialId/model 覆盖默认凭据（V1 兼容并存）；批B modelProfileId（§4.3）；批C pageContext。 */
    public record ChatRequest(Long sessionId, String clientMessageId, String message, Long credentialId,
                              String modelProfileId, String model, List<AiChatService.Attachment> attachments,
                              AiChatService.PageContext pageContext) {
    }

    /** §9.1 发送消息（SSE）：modelProfileId 批B；pageContext 批C（{featureCode,entityType,entityId} 可空）。 */
    public record ChatMessageRequest(Long sessionId, String clientMessageId, String message,
                                     Long credentialId, String model, String modelProfileId,
                                     List<AiChatService.Attachment> attachments,
                                     AiChatService.PageContext pageContext) {
    }

    public record ConfirmRequest(String actionId) {
    }

    // ==================== §9.2 SSE 对话 ====================

    /**
     * 发送消息（SSE text/event-stream）：事件 message.started → tool.started/completed →
     * message.part.created → message.completed|failed，sequence 递增。
     * 幂等重放（clientMessageId 重复）与校验失败（会话忙 409 等）分别为快速事件流 / JSON 信封错误。
     */
    @PostMapping("/chat/messages")
    public SseEmitter chatMessages(@RequestBody ChatMessageRequest req) {
        // prepare 在请求线程执行：校验/幂等/模型档案解析/会话锁/消息落库（失败 → JSON 信封）
        AiChatService.Prepared prep = chatService.prepareTurn(req.sessionId(), req.clientMessageId(),
                req.message(), req.credentialId(), req.modelProfileId(), req.model(), req.attachments(),
                req.pageContext());
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);
        AiSseChannel ch = new AiSseChannel(emitter, objectMapper);

        if (prep instanceof AiChatService.Replay replay) {
            // §15.1 幂等重放：按序推原回复 part 事件，不调模型
            ch.bind(replay.userMsg().getSessionId(), replay.assistantMsg().getId());
            ch.send(AiSseChannel.EV_MESSAGE_STARTED, Map.of(
                    "userMessageId", replay.userMsg().getId(), "duplicate", true));
            for (AiChatMessagePart p : replay.parts()) {
                ch.send(AiSseChannel.EV_PART_CREATED, Map.of("part", chatService.partView(p)));
            }
            ch.send(AiSseChannel.EV_MESSAGE_COMPLETED, completedPayload(replay.assistantMsg(),
                    replay.assistantMsg().getContent(), true));
            ch.complete();
            return emitter;
        }

        AiChatService.TurnPlan plan = (AiChatService.TurnPlan) prep;
        ch.bind(plan.session().getId(), plan.assistantMsg().getId());
        // 附2 第 2 条：异步执行前快照上下文，工作线程显式装入（工具入口另有断言兜底）
        AiExecutionContext ctx = AiExecutionContext.capture(plan.requestId(), plan.traceId());
        aiExecutor.submit(ctx.wrap(() -> {
            try {
                ch.send(AiSseChannel.EV_MESSAGE_STARTED, Map.of(
                        "userMessageId", plan.userMsg().getId(), "duplicate", false));
                chatService.executeTurn(plan, new SseTurnListener(ch));
            } catch (Exception e) {
                log.warn("AI SSE 轮次执行异常: {}", e.getMessage());
                ch.send(AiSseChannel.EV_MESSAGE_FAILED, Map.of("message", String.valueOf(e.getMessage())));
            } finally {
                ch.complete();
            }
        }));
        return emitter;
    }

    /** §9.2 事件适配：轮次回调 → SSE 事件。 */
    private class SseTurnListener implements AiChatService.TurnListener {
        private final AiSseChannel ch;

        SseTurnListener(AiSseChannel ch) {
            this.ch = ch;
        }

        @Override
        public void onToolStarted(String toolCallId, String name) {
            ch.send(AiSseChannel.EV_TOOL_STARTED, Map.of("toolCallId", toolCallId, "name", name,
                    "displayName", name));
        }

        @Override
        public void onToolCompleted(String toolCallId, String name, long durationMs, boolean failed) {
            ch.send(failed ? AiSseChannel.EV_TOOL_FAILED : AiSseChannel.EV_TOOL_COMPLETED,
                    Map.of("toolCallId", toolCallId, "name", name, "durationMs", durationMs));
        }

        @Override
        public void onPart(AiChatMessagePart part) {
            ch.send(AiSseChannel.EV_PART_CREATED, Map.of("part", chatService.partView(part)));
        }

        @Override
        public void onCompleted(AiChatMessage assistantMsg, String content) {
            ch.send(AiSseChannel.EV_MESSAGE_COMPLETED, completedPayload(assistantMsg, content, false));
        }

        @Override
        public void onFailed(AiChatMessage assistantMsg, String errorMessage) {
            ch.send(AiSseChannel.EV_MESSAGE_FAILED, Map.of("message", String.valueOf(errorMessage)));
        }
    }

    private Map<String, Object> completedPayload(AiChatMessage asst, String content, boolean duplicate) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("content", content);
        payload.put("status", asst.getStatus());
        payload.put("duplicate", duplicate);
        return payload;
    }

    // ==================== 旧阻塞端点（行为兼容） ====================

    /** 对话（阻塞，前端 SSE 回退用）：sessionId 空=新会话。返回 {sessionId, messages:[{role,content,cards?,parts?}]}。 */
    @PostMapping("/chat")
    public R<ChatResult> chat(@RequestBody ChatRequest req) {
        return R.ok(chatService.chat(req.sessionId(), req.clientMessageId(), req.message(),
                req.credentialId(), req.modelProfileId(), req.model(), req.attachments(),
                req.pageContext()));
    }

    /** §11 模型切换：启用的 LLM 凭据列表 [{id,name,model,supportsVision}]（前端模型选择器）。 */
    @GetMapping("/models")
    public R<List<Map<String, Object>>> models() {
        return R.ok(chatService.models());
    }

    /** §4.3 模型档案（批B）：[{id,code,name,description,available,supportsVision}]——凭据/密钥永不出 API。 */
    @GetMapping("/model-profiles")
    public R<List<Map<String, Object>>> modelProfiles() {
        return R.ok(modelService.profiles());
    }

    // ==================== §7.3 动作草稿确认/取消 ====================

    /**
     * 确认执行动作草稿（空 body；Idempotency-Key 头幂等重放）。重新鉴权（登录态）+ 归属校验 +
     * TOCTOU 预检 + 底层 Service 权限二验；过期 410 / 状态变化 409 AI_ACTION_STALE。
     */
    @PostMapping("/actions/{actionId}/confirm")
    public R<Map<String, Object>> confirmAction(
            @PathVariable Long actionId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return R.ok(actionService.confirm(actionId, idempotencyKey));
    }

    /** 取消动作草稿（仅 PENDING_CONFIRM 可取消）。 */
    @PostMapping("/actions/{actionId}/cancel")
    public R<Map<String, Object>> cancelAction(@PathVariable Long actionId) {
        return R.ok(actionService.cancel(actionId));
    }

    /** 旧确认端点兼容代理（§0.2 二段式）：不存在/过期/已消费 → 410，他人动作 → 403。前端随后切新端点。 */
    @PostMapping("/confirm")
    public R<Map<String, Object>> confirm(@RequestBody ConfirmRequest req) {
        return R.ok(actionService.confirmLegacy(req.actionId()));
    }

    // ==================== 批E：草稿固化（EXPLICIT_UI_SUBMIT 提交，复用动作草稿二段式） ====================

    /**
     * ⑦ 建自动化编排草稿（DRAFT，不启用）。draftId=FlowDraftCard 的动作草稿 id；
     * Idempotency-Key 头幂等。返回 {@code {flowCode, flowId, designerPath, enabled:false, ...}}（前端优先取 flowCode）。
     */
    @PostMapping("/flow-drafts/{draftId}/create")
    public R<Map<String, Object>> createFlowDraft(
            @PathVariable Long draftId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        Map<String, Object> data = draftData(draftId, idempotencyKey);
        if (data != null && data.get("code") != null) {
            data.put("flowCode", data.get("code")); // 前端优先 flowCode
        }
        return R.ok(data);
    }

    /** ⑧ 建单据模板草稿（DRAFT，不发布）。返回 {@code {tplId, designerPath:"/bizdoc/tpl/t/{id}"}}。 */
    @PostMapping("/template-drafts/{draftId}/create")
    public R<Map<String, Object>> createTemplateDraft(
            @PathVariable Long draftId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return R.ok(draftData(draftId, idempotencyKey));
    }

    /** ⑧ 建表单定义草稿（DRAFT，不发布）。返回 {@code {formId, designerPath:"/workflow/form-defs"}}。 */
    @PostMapping("/form-drafts/{draftId}/create")
    public R<Map<String, Object>> createFormDraft(
            @PathVariable Long draftId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return R.ok(draftData(draftId, idempotencyKey));
    }

    /** 确认动作草稿并抽出执行器结果（复用 §7.3 二段式：归属/TTL/幂等/原子认领）。 */
    @SuppressWarnings("unchecked")
    private Map<String, Object> draftData(Long draftId, String idempotencyKey) {
        Map<String, Object> body = actionService.confirm(draftId, idempotencyKey);
        Object data = body.get("data");
        if (data instanceof Map) {
            return (Map<String, Object>) data;
        }
        // 幂等重放路径：data 为持久化结果 JsonNode（parseResult→readTree），归一为 Map
        if (data instanceof tools.jackson.databind.JsonNode node) {
            return objectMapper.convertValue(node, Map.class);
        }
        return body;
    }

    /** ⑨ 待办 AI 摘要 + 风险（按 taskId 缓存 30min，标注仅供参考）——待办详情页直取。 */
    @GetMapping("/tasks/{taskId}/summary")
    public R<Map<String, Object>> taskSummary(@PathVariable String taskId) {
        return R.ok(insightService.aiSummary(taskId));
    }

    // ==================== 会话 ====================

    @GetMapping("/sessions")
    public R<List<Map<String, Object>>> sessions() {
        return R.ok(chatService.sessions());
    }

    @GetMapping("/sessions/{id}/messages")
    public R<PageResult<Map<String, Object>>> messages(
            @PathVariable Long id,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "50") int pageSize) {
        return R.ok(chatService.messages(id, pageNum, pageSize));
    }

    @DeleteMapping("/sessions/{id}")
    public R<Void> deleteSession(@PathVariable Long id) {
        chatService.deleteSession(id);
        return R.ok();
    }
}

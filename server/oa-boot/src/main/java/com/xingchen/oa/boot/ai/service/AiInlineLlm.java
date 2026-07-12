package com.xingchen.oa.boot.ai.service;

import com.xingchen.oa.boot.ai.orchestration.AiChatClientFactory;
import com.xingchen.oa.boot.ai.support.AiSessionHolder;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.converter.BeanOutputConverter;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 工具内嵌 LLM 调用助手（批E）：结构化草稿（⑦⑧ BeanOutputConverter）与自由文本摘要（⑨）复用
 * <b>本轮同一模型</b>——凭据/模型经 {@link AiSessionHolder.Turn} 从 executeTurn 传播（Gateway 复装），
 * 无轮次上下文（如 REST 直调审批摘要）时退回系统默认凭据。
 *
 * <p>不带工具、不注入会话历史（advisor 无 sessionId 参数即跳过 memory，同 {@link AiPlanService}）；
 * 独立模型调用只做「NL→结构化/摘要」一次性转换。模型未配置或调用失败一律返回 null，由调用方走
 * 确定性兜底（不阻断对话）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiInlineLlm {

    private final AiSessionHolder sessionHolder;
    private final AiModelService modelService;
    /**
     * 懒注入避免装配环：工具 bean → AiInlineLlm → AiChatClientFactory → AuthorizedToolResolver →
     * AiToolGateway → ToolRegistry，会把工具 bean 卷进 ToolRegistry 的 @PostConstruct 扫描栈而被漏注册。
     * ObjectProvider 延迟到调用期解析，工具 bean 构造期不触发该链。
     */
    private final ObjectProvider<AiChatClientFactory> clientFactory;

    /** 解析结果：本轮（或系统默认）ChatClient + 生效模型名。 */
    private record Resolved(ChatClient client, String model) {
    }

    /** 是否有可用模型（无凭据时调用方直接走兜底，避免无谓构造）。 */
    public boolean available() {
        return resolve() != null;
    }

    /**
     * 结构化输出：NL → 目标 bean（Spring AI {@link BeanOutputConverter} 强校验）。失败/无模型返回 null。
     */
    public <T> T structured(Class<T> beanType, String system, String userPrompt) {
        Resolved r = resolve();
        if (r == null) {
            return null;
        }
        try {
            BeanOutputConverter<T> converter = new BeanOutputConverter<>(beanType);
            String content = r.client().prompt()
                    .system(StringUtils.hasText(system) ? system : "你只输出符合格式要求的 JSON，不输出多余文本。")
                    .user(userPrompt + "\n\n" + converter.getFormat())
                    .options(OpenAiChatOptions.builder().model(r.model()))
                    .call().content();
            if (!StringUtils.hasText(content)) {
                return null;
            }
            return converter.convert(content);
        } catch (Exception e) {
            log.info("内嵌结构化输出失败（走兜底，不阻断）: {}", e.getMessage());
            return null;
        }
    }

    /** 自由文本：NL → 一段文本（审批摘要）。失败/无模型返回 null。 */
    public String text(String system, String userPrompt) {
        Resolved r = resolve();
        if (r == null) {
            return null;
        }
        try {
            String content = r.client().prompt()
                    .system(StringUtils.hasText(system) ? system : "你是简洁的中文助手。")
                    .user(userPrompt)
                    .options(OpenAiChatOptions.builder().model(r.model()))
                    .call().content();
            return StringUtils.hasText(content) ? content.trim() : null;
        } catch (Exception e) {
            log.info("内嵌文本生成失败（走兜底，不阻断）: {}", e.getMessage());
            return null;
        }
    }

    /** 本轮凭据/模型 → ChatClient；无轮次上下文时退系统默认；无任何 LLM 凭据 → null。 */
    private Resolved resolve() {
        AiSessionHolder.Turn turn = sessionHolder.currentTurn();
        Long credentialId = turn == null ? null : turn.credentialId();
        String model = turn == null ? null : turn.model();
        try {
            AiModelService.ResolvedModel rm = modelService.resolve(credentialId, null, model);
            if (rm == null) {
                return null;
            }
            return new Resolved(clientFactory.getObject().client(rm.credential(), rm.apiKey()), rm.model());
        } catch (Exception e) {
            log.info("内嵌 LLM 模型解析失败（走兜底）: {}", e.getMessage());
            return null;
        }
    }
}

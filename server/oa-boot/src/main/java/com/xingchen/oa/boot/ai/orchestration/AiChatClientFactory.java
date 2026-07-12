package com.xingchen.oa.boot.ai.orchestration;

import com.xingchen.oa.boot.ai.support.AiErrors;
import com.xingchen.oa.boot.ai.tool.AuthorizedToolResolver;
import com.xingchen.oa.workflow.orch.entity.OrchCredential;
import io.micrometer.observation.ObservationRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.ToolCallingAdvisor;
import org.springframework.ai.model.tool.ToolCallingManager;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * ChatClient/ChatModel 工厂（批B，附2 第 4 条）：按凭据（orch_credential，AES-GCM 解密后的 key）
 * <b>编程式构造并缓存</b> OpenAI 兼容 ChatModel——不走 Spring AI starter 自动装配（凭据动态）。
 * baseUrl 沿用平台约定（OpenAI-compatible 根含 /v1，SDK 自行追加 /chat/completions，与 LlmToolLoop 同址）。
 *
 * <p>ChatClient 组装：默认 Advisor 链（{@link AiAdvisors} §4.2 顺序）+ 定制 ToolCallingAdvisor
 * （ToolCallingManager 挂 {@link AuthorizedToolResolver#aliasResolver()}：旧名别名兼容 +
 * 未知工具名礼貌拒绝，均经 AiToolGateway 执行）。凭据变更（updatedAt/密钥轮换）自动失效重建。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiChatClientFactory {

    private final AuthorizedToolResolver toolResolver;
    private final AiAdvisors.RequestIdAdvisor requestIdAdvisor;
    private final AiAdvisors.SecurityContextAdvisor securityContextAdvisor;
    private final AiAdvisors.QuotaAdvisor quotaAdvisor;
    private final AiAdvisors.ConversationMemoryAdvisor memoryAdvisor;
    private final AiAdvisors.RetrievalAugmentationAdvisor retrievalAugmentationAdvisor;
    private final AiAdvisors.AuditAdvisor auditAdvisor;
    private final AiAdvisors.OutputSanitizationAdvisor outputSanitizationAdvisor;

    private final Map<String, ChatClient> cache = new ConcurrentHashMap<>();
    private final Map<String, ChatClient> leanCache = new ConcurrentHashMap<>();

    /**
     * 取（或构建）该凭据的 ChatClient。apiKey 为已解密明文（解密失败在上游已转
     * AI_MODEL_UNAVAILABLE），仅存在于进程内缓存 key 的哈希中，不落日志。
     */
    public ChatClient client(OrchCredential cred, String apiKey) {
        String key = cred.getId() + "|" + cred.getBaseUrl() + "|" + cred.getModel()
                + "|" + AiErrors.sha256(apiKey);
        return cache.computeIfAbsent(key, k -> build(cred, apiKey));
    }

    /**
     * 无 Advisor / 无工具的精简 ChatClient（批3：AI 写作辅助流式生成 {@code .stream()} 用）。
     * 写作辅助不需要会话记忆 / RAG / 工具循环 / 配额审计——单次「选区 → 生成」纯文本流；
     * 避免默认 Advisor 链（含仅作用于 {@code .call()} 的 CallAdvisor）与工具管理器带来的意外行为。
     */
    public ChatClient leanClient(OrchCredential cred, String apiKey) {
        String key = cred.getId() + "|" + cred.getBaseUrl() + "|" + cred.getModel()
                + "|" + AiErrors.sha256(apiKey);
        return leanCache.computeIfAbsent(key, k -> buildLean(cred, apiKey));
    }

    private ChatClient buildLean(OrchCredential cred, String apiKey) {
        try {
            OpenAiChatOptions defaultOptions = (OpenAiChatOptions) OpenAiChatOptions.builder()
                    .baseUrl(trimTrailingSlash(cred.getBaseUrl()))
                    .apiKey(apiKey)
                    .model(cred.getModel())
                    .build();
            OpenAiChatModel model = OpenAiChatModel.builder()
                    .options(defaultOptions)
                    .build();
            return ChatClient.create(model);
        } catch (Exception e) {
            log.warn("精简 ChatModel 构建失败 credential={}: {}", cred.getId(), e.getMessage());
            throw AiErrors.e(503, AiErrors.MODEL_UNAVAILABLE, "模型客户端构建失败: " + e.getMessage());
        }
    }

    private ChatClient build(OrchCredential cred, String apiKey) {
        try {
            OpenAiChatOptions defaultOptions = (OpenAiChatOptions) OpenAiChatOptions.builder()
                    .baseUrl(trimTrailingSlash(cred.getBaseUrl()))
                    .apiKey(apiKey)
                    .model(cred.getModel())
                    .build();
            OpenAiChatModel model = OpenAiChatModel.builder()
                    .options(defaultOptions)
                    .build();
            ToolCallingManager manager = ToolCallingManager.builder()
                    .toolCallbackResolver(toolResolver.aliasResolver())
                    .build();
            return ChatClient.builder(model, ObservationRegistry.NOOP, null, null,
                            ToolCallingAdvisor.builder().toolCallingManager(manager))
                    .defaultAdvisors(List.of(requestIdAdvisor, securityContextAdvisor, quotaAdvisor,
                            memoryAdvisor, retrievalAugmentationAdvisor, auditAdvisor, outputSanitizationAdvisor))
                    .build();
        } catch (Exception e) {
            log.warn("ChatModel 构建失败 credential={}: {}", cred.getId(), e.getMessage());
            throw AiErrors.e(503, AiErrors.MODEL_UNAVAILABLE, "模型客户端构建失败: " + e.getMessage());
        }
    }

    private String trimTrailingSlash(String url) {
        return url == null ? null : url.replaceAll("/+$", "");
    }
}

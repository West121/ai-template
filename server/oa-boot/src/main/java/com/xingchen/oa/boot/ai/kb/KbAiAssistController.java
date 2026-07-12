package com.xingchen.oa.boot.ai.kb;

import com.xingchen.oa.boot.ai.kb.KbAiAssistService.AssistRequest;
import com.xingchen.oa.boot.ai.kb.KbAiAssistService.Prepared;
import com.xingchen.oa.boot.ai.service.AiActionService;
import com.xingchen.oa.boot.ai.support.AiExecutionContext;
import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.log.OperLog;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.concurrent.ExecutorService;

/**
 * 知识库 AI 写作辅助 + 对话固化草稿确认（ai-knowledge-base.md §3/§7 批3）。
 *
 * <ul>
 *   <li>POST /api/kb/ai/assist —— <b>SSE 流式</b>写作辅助（复用 AiChatController 的 SseEmitter 模式）：
 *       事件帧 {@code data: {"text":"增量"}}；出错帧 {@code data: {"error":"..."}}；流结束即完成。
 *       权限 {@code kb:doc:edit}；docId 提供时校验该文档可编辑。</li>
 *   <li>POST /api/kb/ai/knowledge-drafts/{draftId}/create —— 确认 knowledge_save 动作草稿，
 *       建 DRAFT 草稿文档（复用动作草稿二段式 §7.3）。返回 {@code {docId, spaceId, designerPath}}。</li>
 * </ul>
 */
@Slf4j
@RestController
@RequestMapping("/api/kb/ai")
@RequiredArgsConstructor
public class KbAiAssistController {

    private static final long SSE_TIMEOUT_MS = 120_000L;

    private final KbAiAssistService assistService;
    private final AiActionService actionService;
    private final ObjectMapper objectMapper;
    /** AiAsyncConfig 虚拟线程执行器（按参数名匹配 bean aiExecutor）。 */
    private final ExecutorService aiExecutor;

    /**
     * AI 写作辅助（SSE text/event-stream）。预校验（动作/docId 可编辑/模型）在请求线程执行——
     * 失败即抛 JSON 信封错误（SSE 未建立）；通过后异步流式生成，上下文经 {@link AiExecutionContext} 显式传播。
     */
    @PostMapping("/assist")
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    public SseEmitter assist(@RequestBody AssistRequest req) {
        // 请求线程：校验 + 模型解析（失败 → GlobalExceptionHandler 出 JSON 信封，前端回退）
        Prepared prep = assistService.prepare(req);
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MS);
        // 异步执行前快照上下文（SSE 异步，同批A 教训：显式传播；工具/服务入口另有断言兜底）
        AiExecutionContext ctx = AiExecutionContext.capture(null, null);
        aiExecutor.submit(ctx.wrap(() -> {
            try {
                assistService.stream(prep, text -> sendText(emitter, text));
                emitter.complete();
            } catch (Exception e) {
                log.info("知识库写作辅助流式异常: {}", e.getMessage());
                sendError(emitter, e.getMessage());
                emitter.complete();
            }
        }));
        return emitter;
    }

    /** 增量文本帧：{@code data: {"text":"增量"}}（前端对账点①：text 字段）。断连即抛，终止流。 */
    private void sendText(SseEmitter emitter, String text) {
        try {
            emitter.send(SseEmitter.event().data(objectMapper.writeValueAsString(Map.of("text", text))));
        } catch (Exception e) {
            throw new IllegalStateException("SSE 客户端已断开", e);
        }
    }

    /** 出错帧：{@code data: {"error":"消息"}}（前端可提示；不作为正文文本插入）。 */
    private void sendError(SseEmitter emitter, String message) {
        try {
            emitter.send(SseEmitter.event().data(objectMapper.writeValueAsString(
                    Map.of("error", message == null ? "生成失败" : message))));
        } catch (Exception ignored) {
            // 已断开，静默
        }
    }

    /**
     * 确认对话固化草稿（空 body；Idempotency-Key 头幂等）：复用 §7.3 动作草稿二段式（归属/TTL/原子认领），
     * 执行 knowledge_save 执行器建 DRAFT 草稿文档。返回 {@code {docId, spaceId, title, designerPath}}。
     */
    @PostMapping("/knowledge-drafts/{draftId}/create")
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "AI固化建草稿")
    public R<Map<String, Object>> createKnowledgeDraft(
            @PathVariable Long draftId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return R.ok(draftData(draftId, idempotencyKey));
    }

    /** 确认动作草稿并抽出执行器结果（复用 AiChatController 同款归一逻辑）。 */
    @SuppressWarnings("unchecked")
    private Map<String, Object> draftData(Long draftId, String idempotencyKey) {
        Map<String, Object> body = actionService.confirm(draftId, idempotencyKey);
        Object data = body.get("data");
        if (data instanceof Map) {
            return (Map<String, Object>) data;
        }
        if (data instanceof tools.jackson.databind.JsonNode node) {
            return objectMapper.convertValue(node, Map.class);
        }
        return body;
    }
}

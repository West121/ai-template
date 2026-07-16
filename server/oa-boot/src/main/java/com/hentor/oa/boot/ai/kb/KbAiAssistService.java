package com.hentor.oa.boot.ai.kb;

import com.hentor.oa.boot.ai.orchestration.AiChatClientFactory;
import com.hentor.oa.boot.ai.service.AiModelService;
import com.hentor.oa.boot.ai.service.AiModelService.ResolvedModel;
import com.hentor.oa.boot.ai.support.AiErrors;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.office.knowledge.service.KbDocService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.Set;
import java.util.function.Consumer;

/**
 * AI 写作辅助（ai-knowledge-base.md §3/§7 批3）：编辑器工具栏/选区菜单 →
 * 续写 / 润色 / 总结 / 大纲 / 纠错 / 翻译。POST /api/kb/ai/assist（SSE 流式）委托本服务。
 *
 * <h3>红线</h3>
 * <ul>
 *   <li>功能权限 {@code kb:doc:edit}（控制器 @PreAuthorize）；</li>
 *   <li>docId 提供时校验该文档所在空间可编辑（{@link KbDocService#assertDocEditable} → 非编辑者 403）；</li>
 *   <li>上下文只用请求携带的选区/正文（脱敏，不越权拉取其他文档）。</li>
 * </ul>
 *
 * <h3>流式</h3>
 * 精简 ChatClient（无 Advisor/工具，{@link AiChatClientFactory#leanClient}）{@code .stream()} 逐块回调；
 * 端点不支持流式或未产出时，退回一次阻塞 {@code .call()} 兜底整段返回。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class KbAiAssistService {

    private static final Set<String> ACTIONS =
            Set.of("continue", "polish", "summarize", "outline", "proofread", "translate");
    /** 选区/正文上下文上限（截断，控制 token）。 */
    private static final int MAX_CONTEXT = 4000;

    private final AiModelService modelService;
    private final AiChatClientFactory clientFactory;
    private final KbDocService kbDocService;

    /** 写作辅助请求（SSE body）。selectedText 选区；docContext 全文/上下文；docId 可选（提供则校验可编辑）。 */
    public record AssistRequest(String action, String selectedText, String docContext, Long docId) {
    }

    /** 请求线程内校验通过后的执行计划（模型 + 提示词），传入异步工作线程流式执行。 */
    public record Prepared(ResolvedModel model, String system, String user) {
    }

    /**
     * 请求线程内预校验：动作合法 + docId 可编辑 + 模型可解析。失败抛 {@link BusinessException}
     * （SSE 建立前 → 前端收 JSON 信封错误）。UserContext 由请求线程提供，此处即用。
     */
    public Prepared prepare(AssistRequest req) {
        String action = req == null || req.action() == null ? null : req.action().trim().toLowerCase();
        if (action == null || !ACTIONS.contains(action)) {
            throw new BusinessException(400, "不支持的写作辅助动作：" + (req == null ? null : req.action()));
        }
        // docId 提供 → 校验该文档可编辑（红线：非编辑者/非成员不可 assist）
        if (req.docId() != null) {
            kbDocService.assertDocEditable(req.docId());
        }
        String selected = trim(req.selectedText());
        String context = trim(req.docContext());
        // 续写/总结/大纲优先用全文上下文；润色/纠错/翻译优先用选区
        String primary = switch (action) {
            case "continue", "summarize", "outline" -> StringUtils.hasText(context) ? context : selected;
            default -> StringUtils.hasText(selected) ? selected : context;
        };
        if (!StringUtils.hasText(primary)) {
            throw new BusinessException(400, "缺少可处理的文本（selectedText 或 docContext）");
        }
        ResolvedModel rm = modelService.resolve(null, null, null);
        if (rm == null) {
            throw AiErrors.e(503, AiErrors.MODEL_UNAVAILABLE,
                    "AI 写作辅助不可用：系统未配置 LLM 凭据");
        }
        return new Prepared(rm, systemPrompt(action), userPrompt(action, primary, selected, context));
    }

    /**
     * 流式生成：逐增量文本回调 {@code onText}（控制器封装为 {@code data: {"text":"增量"}} 帧）。
     * 优先 {@code .stream()}；一个 token 都没吐（端点不支持流式）→ 退回阻塞 {@code .call()} 整段返回。
     * 客户端断连时 {@code onText} 抛异常 → 已产出部分则原样上抛（控制器收尾），否则不重复调模型。
     */
    public void stream(Prepared p, Consumer<String> onText) {
        ChatClient client = clientFactory.leanClient(p.model().credential(), p.model().apiKey());
        boolean[] any = {false};
        try {
            client.prompt()
                    .system(p.system())
                    .user(p.user())
                    .options(OpenAiChatOptions.builder().model(p.model().model()))
                    .stream().content()
                    .toStream()
                    .forEach(chunk -> {
                        if (StringUtils.hasText(chunk)) {
                            any[0] = true;
                            onText.accept(chunk);
                        }
                    });
        } catch (Exception streamErr) {
            if (any[0]) {
                throw streamErr; // 已流式产出部分 → 上抛，不再阻塞兜底（避免重复文本）
            }
            log.info("知识库写作辅助流式失败，退回阻塞兜底: {}", streamErr.getMessage());
        }
        if (!any[0]) {
            String full = blockingFallback(client, p);
            if (StringUtils.hasText(full)) {
                onText.accept(full);
            } else {
                throw AiErrors.e(503, AiErrors.MODEL_UNAVAILABLE, "AI 写作辅助生成失败，请稍后重试");
            }
        }
    }

    private String blockingFallback(ChatClient client, Prepared p) {
        try {
            return client.prompt()
                    .system(p.system())
                    .user(p.user())
                    .options(OpenAiChatOptions.builder().model(p.model().model()))
                    .call().content();
        } catch (Exception e) {
            log.info("知识库写作辅助阻塞兜底失败: {}", e.getMessage());
            return null;
        }
    }

    private String systemPrompt(String action) {
        return switch (action) {
            case "continue" -> "你是中文写作助手。在用户给出的文本基础上自然续写，保持语气、风格与主题连贯，"
                    + "只输出续写的新内容，不要重复已有文本，不要加解释。";
            case "polish" -> "你是中文润色编辑。改写文本使其更通顺、专业、地道，保持原意与信息不变，"
                    + "只输出润色后的文本，不要加解释。";
            case "summarize" -> "你是中文摘要助手。用简洁准确的中文总结内容要点，只输出摘要本身，不要加解释。";
            case "outline" -> "你是中文大纲助手。根据主题/内容生成条理清晰的层级大纲（用「一、1.」等编号），"
                    + "只输出大纲，不要加解释。";
            case "proofread" -> "你是中文校对助手。修正文本中的错别字、语法与标点错误，保持原意与风格，"
                    + "只输出修正后的完整文本，不要加解释。";
            case "translate" -> "你是中英互译助手。若文本主要为中文则译为英文，否则译为中文，忠实通顺，"
                    + "只输出译文，不要加解释。";
            default -> "你是中文写作助手，只输出结果本身，不要加解释。";
        };
    }

    private String userPrompt(String action, String primary, String selected, String context) {
        String head = switch (action) {
            case "continue" -> "请在下文基础上自然续写：\n\n";
            case "polish" -> "请润色以下文本：\n\n";
            case "summarize" -> "请总结以下内容：\n\n";
            case "outline" -> "请为以下主题/内容生成大纲：\n\n";
            case "proofread" -> "请校对并修正以下文本：\n\n";
            case "translate" -> "请翻译以下文本：\n\n";
            default -> "";
        };
        StringBuilder sb = new StringBuilder(head).append(primary);
        // 润色/纠错/翻译时若另有全文上下文，附作参考（不改写它，仅帮助理解选区）
        if (("polish".equals(action) || "proofread".equals(action))
                && StringUtils.hasText(selected) && StringUtils.hasText(context)
                && !context.equals(selected)) {
            sb.append("\n\n（全文上下文，仅供参考，勿改写）：\n").append(context);
        }
        return sb.toString();
    }

    private String trim(String s) {
        if (!StringUtils.hasText(s)) {
            return null;
        }
        String t = s.trim();
        return t.length() > MAX_CONTEXT ? t.substring(0, MAX_CONTEXT) : t;
    }
}

package com.xingchen.oa.boot.ai.kb;

import com.xingchen.oa.boot.ai.service.AiInlineLlm;
import com.xingchen.oa.boot.ai.support.AiExecutionContext;
import com.xingchen.oa.office.knowledge.port.KbDocAiPort;
import com.xingchen.oa.office.knowledge.service.KbDocService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.concurrent.ExecutorService;

/**
 * 文档 AI 自动处理端口的 boot 侧实现（ai-knowledge-base.md §3/§7 批3 · §8 模块边界）。
 *
 * <p>office 的 {@link KbDocAiPort} 在此适配到批D 的内嵌 LLM（{@link AiInlineLlm}）：正文保存提交后，
 * <b>异步</b>（虚拟线程 {@code aiExecutor}）生成摘要 + 关键词标签，再回写 office（{@link KbDocService#applyAiSummaryAndTags}）。
 * 方向 boot → office（实现其接口 + 反向调用其 Service 落库），office 编译期不知 boot 的存在。</p>
 *
 * <h3>上下文传播（批A 教训）</h3>
 * onContentSaved 在保存请求的 afterCommit（请求线程，UserContext 在场）被调用——此处
 * {@link AiExecutionContext#capture} 快照保存者上下文，异步工作线程经 {@code wrap} 显式装入：
 * LLM 调用链上的 SecurityContextAdvisor 断言得以通过，无 turn 上下文时模型解析退系统默认凭据。
 *
 * <h3>降级红线</h3>
 * 摘要/标签失败、模型不可用、内容过短一律静默跳过——文档已保存，自动处理是增强不是主流程。
 * 上下文只含<b>本文档正文</b>（脱敏，不越权），不注入其他空间数据。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class KbDocAiAdapter implements KbDocAiPort {

    /** 正文最短触发阈值（过短无摘要价值，省一次模型调用）。 */
    private static final int MIN_CHARS = 30;
    /** 喂给模型的正文上限（截断，控制 token）。 */
    private static final int MAX_CONTEXT = 1500;

    private final AiInlineLlm inlineLlm;
    private final KbDocService kbDocService;
    /** AiAsyncConfig 虚拟线程执行器（按参数名匹配 bean aiExecutor）。 */
    private final ExecutorService aiExecutor;

    /** 结构化自动处理结果：摘要 + 关键词标签（BeanOutputConverter 强校验）。 */
    public record AutoProcessResult(String summary, List<String> tags) {
    }

    @Override
    public void onContentSaved(Long docId, String title, String contentText) {
        if (!StringUtils.hasText(contentText) || contentText.trim().length() < MIN_CHARS) {
            return; // 内容过短：不生成摘要/标签
        }
        if (!inlineLlm.available()) {
            return; // 无 LLM 凭据：静默跳过（降级），文档已保存
        }
        // 保存请求线程（afterCommit）快照上下文；异步工作线程装入 → LLM advisor 断言通过
        AiExecutionContext ctx = AiExecutionContext.capture(null, null);
        aiExecutor.submit(ctx.wrap(() -> process(docId, title, contentText)));
    }

    private void process(Long docId, String title, String contentText) {
        try {
            String body = contentText.length() > MAX_CONTEXT ? contentText.substring(0, MAX_CONTEXT) : contentText;
            AutoProcessResult result = inlineLlm.structured(AutoProcessResult.class,
                    "你是企业知识库文档助手。请依据文档为其生成简洁中文摘要和关键词标签（自动摘要与关键词标签）。"
                            + "summary 不超过 100 字，概括核心内容；tags 为 3-5 个中文关键词（名词短语，不含标点）。只输出 JSON。",
                    "文档标题：" + (title == null ? "" : title) + "\n正文：\n" + body
                            + "\n\n请生成 summary（摘要）与 tags（关键词标签数组）。");
            if (result == null) {
                log.debug("知识库文档 {} 自动处理跳过（模型不可用/解析失败）", docId);
                return;
            }
            kbDocService.applyAiSummaryAndTags(docId, result.summary(), result.tags());
            log.debug("知识库文档 {} 自动处理完成（摘要{}字，标签{}个）", docId,
                    result.summary() == null ? 0 : result.summary().length(),
                    result.tags() == null ? 0 : result.tags().size());
        } catch (Exception e) {
            log.warn("知识库文档 {} 自动处理失败（不影响正文保存）: {}", docId, e.getMessage());
        }
    }
}

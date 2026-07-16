package com.hentor.oa.office.knowledge.port;

/**
 * 文档 AI 自动处理端口（ai-knowledge-base.md §3/§7 批3 · §8 模块边界）。
 *
 * <p>office 不可依赖 oa-boot（LLM 编排在 boot），故依赖倒置：本接口在 office 声明，boot 的
 * {@code KbDocAiAdapter} 实现——文档保存正文（PUT /docs/{id}/content）提交后异步生成
 * <b>摘要（kb_doc.summary）+ 自动标签（kb_tag/kb_doc_tag）</b>，失败静默不阻断保存。
 * 无实现（切片测试）/无 LLM 凭据 → 自动处理整体跳过（降级），文档照常保存。</p>
 */
public interface KbDocAiPort {

    /**
     * 正文保存后触发（事务已提交，实现方须自行异步/兜底，不得抛出影响调用链）。
     *
     * @param docId       文档 id
     * @param title       文档标题（喂给模型）
     * @param contentText 纯文本正文（脱敏上下文，仅本文档内容）
     */
    void onContentSaved(Long docId, String title, String contentText);
}

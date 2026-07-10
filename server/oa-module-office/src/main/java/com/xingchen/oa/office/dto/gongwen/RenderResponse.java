package com.xingchen.oa.office.dto.gongwen;

/**
 * 红头正文渲染结果：.gw-typearea 内部 HTML 片段（前端套 .gongwen-paper &gt; .gw-page 外壳）。
 */
public record RenderResponse(
        Long documentId,
        Long templateId,
        boolean upward,
        String html
) {
}

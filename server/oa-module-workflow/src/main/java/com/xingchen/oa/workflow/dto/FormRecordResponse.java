package com.xingchen.oa.workflow.dto;

/**
 * 关联表单记录：供 relation 控件（数据源 type=form）作为可选项。
 *
 * 存储与展示分离——value 存储（实例的 procInstId，唯一稳定），label 展示（实例标题或首个文本字段），
 * summary 为表单数据摘要（若干标量字段拼接）辅助识别。
 */
public record FormRecordResponse(
        Long id,
        String procInstId,
        String title,
        String label,
        String value,
        String summary) {
}

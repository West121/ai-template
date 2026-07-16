package com.hentor.oa.workflow.dto;

import java.util.List;

/**
 * 表单字段清单契约（设计文档第二部分 2.2）。所有表单（无论来源）向流程暴露机器可读字段清单，
 * 「节点字段权限编辑器」与运行时渲染消费同一份清单。范围已锁定：仅 ONLINE(在线设计器) 与
 * CODE(本仓库手写 react-hook-form 表单)。
 *
 * @param formKey  表单标识（= wf_form_def.code）
 * @param formType {@code ONLINE}（从 schemaJson 派生） | {@code CODE}（后台登记的字段清单）
 * @param fields   扁平化后的可配置字段列表（容器透明下钻，子表单列带前缀 + 分组）
 */
public record FormFieldManifest(
        String formKey,
        String formType,
        List<FieldDescriptor> fields) {

    public static final String TYPE_ONLINE = "ONLINE";
    public static final String TYPE_CODE = "CODE";
}

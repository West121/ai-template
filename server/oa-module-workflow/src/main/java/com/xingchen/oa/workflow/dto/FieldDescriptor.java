package com.xingchen.oa.workflow.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/**
 * 表单字段描述符（{@link FormFieldManifest} 的元素），与设计文档 2.2 的 TS
 * {@code FieldDescriptor} 对齐，供「节点字段权限编辑器」渲染 visible/editable/required 矩阵，
 * 以及运行时表单渲染消费同一份清单。
 *
 * @param key        字段稳定标识；子表单列字段带 {@code 子表单key.列key} 前缀区分
 * @param label      字段显示名
 * @param type       控件类型（input/textarea/number/select/date/user/subform/...，原样取自 schema）
 * @param group      分组名：来自分组容器(group) 标题或子表单标题；顶层字段无分组则为 null
 * @param options    选项（radio/checkbox/select 的静态选项，归一化为 {label,value}）；无则 null
 * @param dataSource 数据源（字典/关联表单/接口等），原样透传自 widget.dataSource；无则 null
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record FieldDescriptor(
        String key,
        String label,
        String type,
        String group,
        List<FieldOption> options,
        Object dataSource) {

    /** 归一化后的选项。 */
    public record FieldOption(String label, String value) {
    }

    public static FieldDescriptor of(String key, String label, String type, String group) {
        return new FieldDescriptor(key, label, type, group, null, null);
    }
}

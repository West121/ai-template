package com.xingchen.oa.workflow.dto;

/**
 * 已登记 CODE(代码手写)表单卡片：供流程定义绑定 UI 下拉选择。
 *
 * @param formKey    表单标识（= wf_form_def.code）
 * @param name       表单名
 * @param fieldCount 字段清单字段数
 */
public record CodeFormItem(String formKey, String name, int fieldCount) {
}

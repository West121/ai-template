package com.hentor.oa.workflow.dto;

/** 可发起流程卡片。 */
public record StartableItem(
        String defCode,
        String name,
        String category,
        String icon,
        String formCode,
        Integer formVersion,
        String formSchema,
        // P1-C 自定义表单：CUSTOM 时前端跳转 formSubmitPath 而非弹动态表单
        String formType,
        String formSubmitPath,
        String formViewPath) {
}

package com.xingchen.oa.workflow.dto;

/** 组织选人引用（前端 OrgPicker 统一 id 制）：kind=USER|DEPT|ROLE。 */
public record OrgRef(String kind, Long id, String username) {
}

package com.hentor.oa.workflow.dto;

import jakarta.validation.constraints.NotBlank;
import tools.jackson.databind.JsonNode;

/**
 * 图直译一站式部署请求（切片 2a，{@code POST /api/wf/models/graph/deploy}）。
 *
 * <p>{@code model} 为前端归一化 {@code ProcessModel} JSON（显式 nodes[]+edges[]，含坐标）。
 * 顶层 {@code key}/{@code name} 为准写回 model，保证 BPMN process id == wf_process_ext.def_code。
 *
 * <p>{@code key} 须为 BPMN 合法 id（字母数字下划线、首字符非数字）；含特殊字符会被 sanitize 成下划线，
 * 导致 startProcessInstanceByKey 找不到 key。
 */
public record GraphDeployRequest(
        @NotBlank String key,
        String name,
        String category,
        String icon,
        String formCode,
        Integer formVersion,
        JsonNode model) {
}

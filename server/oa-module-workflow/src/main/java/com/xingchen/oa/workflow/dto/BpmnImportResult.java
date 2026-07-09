package com.xingchen.oa.workflow.dto;

import com.xingchen.oa.workflow.convert.graph.ProcessModel;

import java.util.List;

/**
 * {@code .bpmn} 导入结果（{@code POST /api/wf/models/import}）。
 *
 * @param model    还原出的归一化 {@link ProcessModel}，供前端 react-flow {@code fromProcessModel} 载入
 * @param warnings 未完全还原/缺 DI 等提示（如某 BPMN 元素本切片未建模已跳过、部分节点缺 DI 用兜底坐标需自动布局）；
 *                 空表示无损还原
 */
public record BpmnImportResult(ProcessModel model, List<String> warnings) {
}

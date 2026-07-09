package com.xingchen.oa.workflow.convert.graph;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import tools.jackson.databind.JsonNode;

import java.util.List;

/**
 * 归一化流程模型（图直译真相源）。Java 侧 DTO，字段与前端 {@code src/pages/workflow/designer/flow/model.ts}
 * 的 {@code ProcessModel} 对齐；由 {@code GraphToBpmnConverter} 直译为 Flowable {@code BpmnModel}。
 *
 * <p>与旧钉钉 {@code designerJson}（嵌套线性树）的根本差异：本模型是「显式图」——
 * startEvent/endEvent/网关都是一等节点，连线是显式 {@link SequenceFlowDto}，坐标由前端产出，
 * 后端不再合成拓扑与 {@code autoLayout()}，只做「图 → BpmnModel」直译 + 据坐标补 BPMN DI。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class ProcessModel {
    /** 契约版本号（当前恒为 1） */
    public int schemaVersion = 1;
    /** 流程定义编码（作为 BPMN process id，服务端 sanitize） */
    public String key;
    /** 流程名（BPMN process name） */
    public String name;
    /** 定义版本（可空） */
    public Integer version;
    /** 绑定表单 key（formCode:version），写入各 userTask 的 formKey */
    public String formKey;
    /** 流程级配置，写入 process 扩展元素 oa:flowConfig（原始树，与旧路径一致） */
    public JsonNode flowConfig;
    /** 流程节点（扁平） */
    public List<FlowNodeDto> nodes;
    /** 连线（显式） */
    public List<SequenceFlowDto> edges;
}

package com.xingchen.oa.workflow.convert.graph;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import tools.jackson.databind.JsonNode;

import java.util.List;

/**
 * 归一化流程节点。对应前端 {@code flow/model.ts} 的 {@code FlowNode} 判别联合的公共 + 各类型专属字段。
 *
 * <p>切片 3（N-B-01）补全全部节点类型：startEvent / endEvent / userTask / serviceTask（autoApprove /
 * autoReject / trigger / delegate 四种 impl）/ 三类网关 / callActivity / 嵌入式 subProcess（递归 children）/
 * timerCatch / timerBoundary / cc / ai / webhook。专属配置保持为原始 {@link JsonNode}，
 * 逐项写入 {@code oa:} extensionElements（与旧 {@code JsonToBpmnConverter} 字节一致），
 * 供 {@code wfCcDelegate} / {@code wfAiApprovalDelegate} / {@code wfWebhookDelegate} /
 * {@code wfAutoDecide} / {@code wfTriggerDelegate} 等 delegate bean 运行时读取。
 * DTO 用 {@link JsonIgnoreProperties} 宽松吞未知字段。
 *
 * <p>{@code props}（审批域属性 {@code WfNodeProps}）保持为原始 {@link JsonNode}：其子树按名逐项写入
 * {@code oa:} extensionElements，供 {@code wfAssigneeResolver} 等 bean 运行时读取。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class FlowNodeDto {
    /** 节点 id（服务端 sanitize 为合法 BPMN id） */
    public String id;
    /** 判别键：startEvent | endEvent | userTask | serviceTask | *Gateway | callActivity | subProcess | timerCatch | timerBoundary | cc | ai | webhook */
    public String type;
    /** 节点名 */
    public String name;
    /** 画布坐标（左上角），生成 BPMNShape */
    public Point position;
    /** 尺寸；省略时按类型给默认 */
    public Size size;
    /** 审批域属性（WfNodeProps）原始树，逐项写入 oa: 扩展元素（含 cc 节点的 ccUsers） */
    public JsonNode props;

    /** endEvent 专属：terminate=true 时加 TerminateEventDefinition（整实例终止） */
    public Boolean terminate;
    /** userTask 专属：覆盖流程级 formKey（可空，缺省继承 ProcessModel.formKey） */
    public String formKey;

    /** serviceTask 专属：{@code {impl, triggerType, handler, webhookUrl, timer, config, delegateExpression}} */
    public JsonNode service;
    /** serviceTask{impl:"script"} 专属（Tier 2 脚本节点）：{@code {lang:groovy|js|python, code}} */
    public JsonNode script;
    /** ai 节点专属：{@code {model, systemPrompt, formContext[], outputMap}} */
    public JsonNode ai;
    /** webhook 节点专属：{@code {url}} */
    public JsonNode webhook;
    /** callActivity 专属：{@code {calledElement, async, inheritVariables, paramMap:[{child,parent}]}} */
    public JsonNode callActivity;
    /** timerCatch / timerBoundary 共用：{@code {mode:duration|date|cycle, value}} */
    public JsonNode timer;
    /** timerBoundary 专属：宿主活动节点 id（不走 edge） */
    public String attachedTo;
    /** timerBoundary 专属：是否中断宿主，缺省 true（中断型） */
    public Boolean cancelActivity;
    /** subProcess 专属：内联子图（递归转换为 BPMN SubProcess 内联元素） */
    public SubGraph children;

    /** 嵌入式子流程的子图：自带 nodes/edges 的一段闭合图。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SubGraph {
        public List<FlowNodeDto> nodes;
        public List<SequenceFlowDto> edges;
    }
}

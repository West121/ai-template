package com.xingchen.oa.workflow.convert.graph;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import tools.jackson.databind.JsonNode;

/**
 * 归一化流程节点。对应前端 {@code flow/model.ts} 的 {@code FlowNode} 判别联合的公共 + 切片 1 用到的字段。
 *
 * <p>切片 1（N-B-01）仅消费 startEvent / endEvent / userTask / exclusiveGateway，
 * 其余类型的专属配置（service / callActivity / timer / ai / webhook / children …）暂不建模，
 * 遇到时由转换器抛「暂不支持」异常（切片 2 补齐）。故此 DTO 用 {@link JsonIgnoreProperties} 宽松吞未知字段。
 *
 * <p>{@code props}（审批域属性 {@code WfNodeProps}）保持为原始 {@link JsonNode}：其子树按名逐项写入
 * {@code oa:} extensionElements，与旧 {@code JsonToBpmnConverter} 的审批节点写法字节一致，
 * 供 {@code wfAssigneeResolver} 等 delegate bean 运行时读取。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class FlowNodeDto {
    /** 节点 id（服务端 sanitize 为合法 BPMN id） */
    public String id;
    /** 判别键：startEvent | endEvent | userTask | exclusiveGateway | …（其余切片 2） */
    public String type;
    /** 节点名 */
    public String name;
    /** 画布坐标（左上角），生成 BPMNShape */
    public Point position;
    /** 尺寸；省略时按类型给默认 */
    public Size size;
    /** 审批域属性（WfNodeProps）原始树，逐项写入 oa: 扩展元素 */
    public JsonNode props;

    /** endEvent 专属：terminate=true 时加 TerminateEventDefinition（整实例终止） */
    public Boolean terminate;
    /** userTask 专属：覆盖流程级 formKey（可空，缺省继承 ProcessModel.formKey） */
    public String formKey;
}

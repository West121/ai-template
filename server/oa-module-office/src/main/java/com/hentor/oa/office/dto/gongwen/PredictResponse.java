package com.hentor.oa.office.dto.gongwen;

import java.util.List;

/**
 * 公文流程预测：从当前节点起的后续将经过节点 + 预计办理人。
 * 与 workflow 侧 {@code P3Requests.PredictResponse} 同构（office 侧等价 DTO，避免反向依赖 oa-module-workflow）。
 *
 * @param path 后续节点序列（不含当前活动节点、不含已完成节点）
 * @param note 提示（如「流程已结束」/「流程未启动」）；正常有后续时为 null
 */
public record PredictResponse(List<PredictNode> path, String note) {

    /**
     * @param nodeId    节点 id（= designerJson 节点 id / BPMN 元素 id 原值）
     * @param nodeName  节点名
     * @param type      节点类型（userTask 等）
     * @param assignees 预计办理人（解析不出为单个「待定」）
     */
    public record PredictNode(String nodeId, String nodeName, String type, List<AssigneeName> assignees) {
    }

    public record AssigneeName(String name) {
    }
}

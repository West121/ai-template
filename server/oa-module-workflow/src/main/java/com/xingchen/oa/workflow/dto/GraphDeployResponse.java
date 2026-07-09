package com.xingchen.oa.workflow.dto;

/**
 * 图直译部署结果（切片 2a）。返回 Flowable 部署后的流程定义标识，供前端后续发起/查询。
 *
 * @param id                   wf_process_ext 主键
 * @param processDefinitionId  Flowable 流程定义 id（{@code key:version:deployId}）
 * @param processDefinitionKey Flowable 流程定义 key（== def_code，用于 startProcessInstanceByKey）
 * @param version              引擎流程定义版本
 * @param deploymentId         Flowable 部署 id
 * @param status               档案状态（部署成功即 PUBLISHED）
 */
public record GraphDeployResponse(
        Long id,
        String processDefinitionId,
        String processDefinitionKey,
        Integer version,
        String deploymentId,
        String status) {
}

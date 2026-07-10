package com.xingchen.oa.workflow.dto;

import java.time.OffsetDateTime;

/**
 * 「已办」列表项（GET /api/wf/instances/done-by-me）：我办结过的历史任务，
 * 按 wf_instance_ext 组装；缺行（公文等直起引擎的历史实例）回退 Flowable 历史数据，
 * 绝不因单条缺行 404 整个列表。
 *
 * @param viewPath 自定义详情跳转路径（流程定义 form_view_path 模板解析，如公文 /document/send/67）；普通流程 null
 */
public record DoneByMeItem(
        String taskId,
        String procInstId,
        Long instanceId,
        String instanceTitle,
        String defName,
        String nodeName,
        String action,
        String comment,
        String bizStatus,
        OffsetDateTime createdAt,
        String viewPath) {
}

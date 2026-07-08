package com.xingchen.oa.boot.job;

import com.xxl.job.core.context.XxlJobHelper;
import com.xxl.job.core.handler.annotation.XxlJob;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 业务 JobHandler 示例：在调度中心「任务管理」新建任务时，
 * 运行模式选 BEAN，JobHandler 填下方 @XxlJob 的名称即可。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OaJobHandlers {

    private final JdbcTemplate jdbcTemplate;

    /** 示例任务：打印调度参数与执行日志 */
    @XxlJob("demoJob")
    public void demoJob() {
        String param = XxlJobHelper.getJobParam();
        XxlJobHelper.log("XXL-Job demoJob 执行成功，参数: {}", param == null || param.isEmpty() ? "(无)" : param);
        log.info("[xxl-job] demoJob executed, param={}", param);
    }

    /** 待审批统计播报：统计当前 PENDING 审批单数量（可扩展为发送提醒） */
    @XxlJob("approvalPendingReportJob")
    public void approvalPendingReportJob() {
        Long count = jdbcTemplate.queryForObject(
                "select count(*) from oa_approval where status = 'PENDING'", Long.class);
        XxlJobHelper.log("当前待审批单据 {} 件", count);
        log.info("[xxl-job] approvalPendingReportJob: pending={}", count);
    }

    /** 下班打卡提醒：演示定时提醒类任务（真实场景可推送站内信/IM） */
    @XxlJob("attendanceRemindJob")
    public void attendanceRemindJob() {
        Long absent = jdbcTemplate.queryForObject(
                "select count(*) from oa_attendance_record where date = current_date and check_out is null and check_in is not null",
                Long.class);
        XxlJobHelper.log("今日已签到未签退 {} 人，已发送打卡提醒（演示）", absent);
        log.info("[xxl-job] attendanceRemindJob: notYetCheckedOut={}", absent);
    }
}

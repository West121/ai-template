package com.xingchen.oa.workflow.service;

import com.xingchen.oa.workflow.dto.BottleneckItem;
import com.xingchen.oa.workflow.dto.MonitorOverview;
import com.xingchen.oa.workflow.dto.MonitorOverview.DefCount;
import com.xingchen.oa.workflow.entity.WfInstanceExt;
import com.xingchen.oa.workflow.entity.WfProcessExt;
import com.xingchen.oa.workflow.repository.WfInstanceExtRepository;
import com.xingchen.oa.workflow.repository.WfProcessExtRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.TaskService;
import org.flowable.task.api.Task;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 流程监控统计：总览（wf_instance_ext 聚合）+ 节点瓶颈（ACT_HI_ACTINST 聚合）。
 * 均为管理员视角，权限 wf:instance:admin 在 controller 层校验。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MonitorService {

    private final WfInstanceExtRepository instanceRepository;
    private final WfProcessExtRepository processRepository;
    private final TaskService taskService;
    private final RepositoryService repositoryService;
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    /* ---------------- 总览 ---------------- */

    public MonitorOverview overview() {
        Map<String, Long> byStatus = instanceRepository.countGroupByStatus().stream()
                .collect(Collectors.toMap(r -> (String) r[0], r -> (Long) r[1], (a, b) -> a));
        long running = byStatus.getOrDefault(WfInstanceExt.STATUS_RUNNING, 0L);
        long approved = byStatus.getOrDefault(WfInstanceExt.STATUS_APPROVED, 0L);
        long rejected = byStatus.getOrDefault(WfInstanceExt.STATUS_REJECTED, 0L);
        long canceled = byStatus.getOrDefault(WfInstanceExt.STATUS_CANCELED, 0L);
        long terminated = byStatus.getOrDefault(WfInstanceExt.STATUS_TERMINATED, 0L);
        long total = running + approved + rejected + canceled + terminated; // 排除草稿

        List<DefCount> byDef = instanceRepository.countGroupByDef().stream()
                .map(r -> new DefCount((String) r[0], (String) r[1], (Long) r[2]))
                .toList();

        return new MonitorOverview(total, running, approved, rejected, canceled, terminated,
                timeoutInstanceCount(), byDef);
    }

    /** 当前存在超时(过 deadline)活动任务的实例数（结合超时扫描器口径：读节点 oa:timeout 配置）。 */
    private long timeoutInstanceCount() {
        long now = Instant.now().toEpochMilli();
        Set<String> overdue = new HashSet<>();
        try {
            for (Task t : taskService.createTaskQuery().active().list()) {
                JsonNode cfg = timeoutConfig(t);
                if (cfg == null || t.getCreateTime() == null) {
                    continue;
                }
                long durationMs = cfg.has("seconds")
                        ? cfg.path("seconds").asLong(0) * 1000L
                        : cfg.path("hours").asLong(0) * 3600_000L;
                if (durationMs > 0 && now >= t.getCreateTime().getTime() + durationMs) {
                    overdue.add(t.getProcessInstanceId());
                }
            }
        } catch (Exception e) {
            log.warn("超时实例统计失败: {}", e.getMessage());
        }
        return overdue.size();
    }

    private JsonNode timeoutConfig(Task t) {
        try {
            FlowElement fe = repositoryService.getBpmnModel(t.getProcessDefinitionId())
                    .getMainProcess().getFlowElement(t.getTaskDefinitionKey(), true);
            if (fe == null || fe.getExtensionElements() == null) {
                return null;
            }
            List<ExtensionElement> list = fe.getExtensionElements().get("timeout");
            if (list == null || list.isEmpty()) {
                return null;
            }
            String text = list.get(0).getElementText();
            return (text == null || text.isBlank()) ? null : objectMapper.readTree(text);
        } catch (Exception e) {
            return null;
        }
    }

    /* ---------------- 节点瓶颈 ---------------- */

    public List<BottleneckItem> bottleneck() {
        Map<String, String> defNames = processRepository.findAll().stream()
                .collect(Collectors.toMap(WfProcessExt::getDefCode, WfProcessExt::getName, (a, b) -> a));
        String sql = "select proc_def_id_, act_id_, max(act_name_) as act_name, "
                + "avg(duration_) as avg_ms, count(*) as cnt "
                + "from act_hi_actinst "
                + "where act_type_ = 'userTask' and end_time_ is not null and duration_ is not null "
                + "group by proc_def_id_, act_id_ order by avg_ms desc";
        List<BottleneckItem> out = new ArrayList<>();
        try {
            jdbcTemplate.query(sql, rs -> {
                String procDefId = rs.getString("proc_def_id_");
                String defCode = procDefId != null ? procDefId.split(":")[0] : null;
                double avg = rs.getDouble("avg_ms");
                out.add(new BottleneckItem(defCode, defNames.get(defCode),
                        rs.getString("act_id_"), rs.getString("act_name"),
                        Math.round(avg), rs.getLong("cnt")));
            });
        } catch (Exception e) {
            log.warn("节点瓶颈统计失败: {}", e.getMessage());
        }
        return out;
    }
}

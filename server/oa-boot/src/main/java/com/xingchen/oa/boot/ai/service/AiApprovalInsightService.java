package com.xingchen.oa.boot.ai.service;

import com.xingchen.oa.workflow.dto.InstanceDetailResponse;
import com.xingchen.oa.workflow.dto.P3Requests.PredictResponse;
import com.xingchen.oa.workflow.dto.P3Requests.PredictResponse.AssigneeName;
import com.xingchen.oa.workflow.dto.P3Requests.PredictResponse.PredictNode;
import com.xingchen.oa.workflow.entity.WfInstanceExt;
import com.xingchen.oa.workflow.repository.WfInstanceExtRepository;
import com.xingchen.oa.workflow.service.InstanceService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.engine.TaskService;
import org.flowable.task.api.Task;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 审批 AI 洞察（批E，附3 亮点⑨⑩）：
 * <ul>
 *   <li><b>⑨ AI 摘要 + 风险提示</b>：{@link #aiSummary}——LLM 就表单数据+历史意见生成 ≤3 行摘要
 *       （{@link AiInlineLlm}，模型不可用走确定性兜底），叠加规则风险点（金额高于本部门近 30 天分位/
 *       超期未办/同申请人高频）。<b>按 taskId 缓存 30min</b>（内存，单实例）；标注「AI 生成仅供参考」。</li>
 *   <li><b>⑩ 流程预测嵌确认卡</b>：{@link #predictChain}——复用 {@link InstanceService#predict}，
 *       返回后续流转与预计办理人；预测失败返回空表（调用方省略该字段，不阻断）。</li>
 * </ul>
 *
 * <p><b>契约（给疾风）</b>：aiSummary={@code {summary, risks:[{level:HIGH|MEDIUM|LOW,text}], disclaimer, cached}}；
 * predictChain={@code [{stepName, assigneeName}]}。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiApprovalInsightService {

    private static final long CACHE_TTL_MS = 30 * 60 * 1000L;
    private static final int RISK_LOOKBACK_DAYS = 30;
    private static final int OVERDUE_MEDIUM_DAYS = 3;
    private static final int OVERDUE_HIGH_DAYS = 7;
    private static final int FREQ_THRESHOLD = 3;
    /** 金额字段名匹配（含即视为金额字段）。 */
    private static final String[] AMOUNT_KEYS = {"金额", "amount", "总额", "total", "budget", "预算",
            "cost", "费用", "money", "报销", "价格", "price"};

    public static final String DISCLAIMER = "AI 生成仅供参考";

    private final TaskService taskService;
    private final InstanceService instanceService;
    private final WfInstanceExtRepository instanceRepository;
    private final AiInlineLlm inlineLlm;
    private final tools.jackson.databind.ObjectMapper objectMapper;

    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    private record Cached(long at, Map<String, Object> payload) {
    }

    /**
     * ⑨ 审批 AI 摘要 + 风险（按 taskId 缓存 30min）。任务不存在/无实例托管 → 返回带兜底 summary、空 risks
     * 的结构（永不抛出，不阻断详情/确认卡）。
     */
    public Map<String, Object> aiSummary(String taskId) {
        if (!StringUtils.hasText(taskId)) {
            return null;
        }
        Cached hit = cache.get(taskId);
        if (hit != null && System.currentTimeMillis() - hit.at() < CACHE_TTL_MS) {
            Map<String, Object> cached = new LinkedHashMap<>(hit.payload());
            cached.put("cached", true);
            return cached;
        }
        Map<String, Object> payload = build(taskId);
        cache.put(taskId, new Cached(System.currentTimeMillis(), payload));
        Map<String, Object> out = new LinkedHashMap<>(payload);
        out.put("cached", false);
        return out;
    }

    private Map<String, Object> build(String taskId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("disclaimer", DISCLAIMER);
        InstanceDetailResponse detail = detailOf(taskId);
        if (detail == null) {
            out.put("summary", "暂无可用的表单数据摘要。");
            out.put("risks", List.of());
            return out;
        }
        Map<String, Object> form = asMap(detail.formData());
        List<Map<String, Object>> risks = new ArrayList<>();
        // 风险①：超期未办（任务创建时间）
        overdueRisk(taskId, risks);
        // 风险②：金额高于本部门近 30 天分位阈值
        amountRisk(detail, form, risks);
        // 风险③：同申请人高频
        frequencyRisk(detail, risks);

        out.put("summary", summaryText(detail, form, risks));
        out.put("risks", risks);
        return out;
    }

    // ---------- 摘要 ----------

    private String summaryText(InstanceDetailResponse detail, Map<String, Object> form,
                               List<Map<String, Object>> risks) {
        String opinions = detail.timeline() == null ? "" : detail.timeline().stream()
                .filter(t -> StringUtils.hasText(t.comment()))
                .map(t -> nz(t.actorName()) + "：" + t.comment())
                .reduce((a, b) -> a + "；" + b).orElse("");
        String llm = inlineLlm.text(
                "你是审批助手，为审批人快速摘要一条待办。用不超过 3 行中文概括：申请要点、关键数值、是否有异常。"
                        + "只输出摘要本身，不要客套。",
                "【审批摘要】流程：" + nz(detail.defName()) + "；标题：" + nz(detail.title())
                        + "；申请人：" + nz(detail.initiatorName())
                        + "；表单：" + compactForm(form)
                        + (StringUtils.hasText(opinions) ? "；历史意见：" + opinions : ""));
        if (StringUtils.hasText(llm)) {
            return llm;
        }
        // 确定性兜底
        StringBuilder sb = new StringBuilder();
        sb.append(nz(detail.initiatorName())).append(" 发起「").append(nz(detail.title())).append("」");
        String cf = compactForm(form);
        if (StringUtils.hasText(cf)) {
            sb.append("，").append(cf);
        }
        sb.append("。");
        if (!risks.isEmpty()) {
            sb.append("注意：").append(risks.get(0).get("text")).append("。");
        }
        return sb.toString();
    }

    private String compactForm(Map<String, Object> form) {
        if (form == null || form.isEmpty()) {
            return "";
        }
        List<String> parts = new ArrayList<>();
        for (Map.Entry<String, Object> e : form.entrySet()) {
            Object v = e.getValue();
            if (v == null || v instanceof Map || v instanceof List) {
                continue;
            }
            parts.add(e.getKey() + "=" + v);
            if (parts.size() >= 6) {
                break;
            }
        }
        return String.join("，", parts);
    }

    // ---------- 风险规则 ----------

    private void overdueRisk(String taskId, List<Map<String, Object>> risks) {
        try {
            Task task = taskService.createTaskQuery().taskId(taskId).singleResult();
            if (task == null || task.getCreateTime() == null) {
                return;
            }
            long days = (System.currentTimeMillis() - task.getCreateTime().getTime()) / 86_400_000L;
            if (days >= OVERDUE_HIGH_DAYS) {
                risks.add(risk("HIGH", "该任务已 " + days + " 天未办理，严重超期"));
            } else if (days >= OVERDUE_MEDIUM_DAYS) {
                risks.add(risk("MEDIUM", "该任务已 " + days + " 天未办理，注意超期"));
            }
        } catch (Exception e) {
            log.info("超期风险计算失败: {}", e.getMessage());
        }
    }

    private void amountRisk(InstanceDetailResponse detail, Map<String, Object> form,
                            List<Map<String, Object>> risks) {
        try {
            String amountKey = amountKey(form);
            if (amountKey == null) {
                return;
            }
            Double current = toDouble(form.get(amountKey));
            if (current == null || current <= 0) {
                return;
            }
            OffsetDateTime since = OffsetDateTime.now().minusDays(RISK_LOOKBACK_DAYS);
            List<Double> samples = new ArrayList<>();
            if (detail.initiatorId() != null) {
                Long deptId = deptOf(detail);
                if (deptId != null) {
                    for (WfInstanceExt inst : instanceRepository
                            .findByDefCodeAndInitiatorDeptIdAndCreatedAtAfter(detail.defCode(), deptId, since)) {
                        Double v = toDouble(asMap(parseJson(inst.getFormDataJson())).get(amountKey));
                        if (v != null && v > 0) {
                            samples.add(v);
                        }
                    }
                }
            }
            if (samples.size() < 3) {
                return; // 样本不足，不误报
            }
            double p75 = percentile(samples, 0.75);
            if (current > p75) {
                risks.add(risk("MEDIUM", "金额 " + fmt(current) + " 高于本部门近 30 天同类申请多数（P75 "
                        + fmt(p75) + "）"));
            }
        } catch (Exception e) {
            log.info("金额分位风险计算失败: {}", e.getMessage());
        }
    }

    private void frequencyRisk(InstanceDetailResponse detail, List<Map<String, Object>> risks) {
        try {
            if (detail.initiatorId() == null || !StringUtils.hasText(detail.defCode())) {
                return;
            }
            OffsetDateTime since = OffsetDateTime.now().minusDays(RISK_LOOKBACK_DAYS);
            long count = instanceRepository.countByDefCodeAndInitiatorIdAndCreatedAtAfter(
                    detail.defCode(), detail.initiatorId(), since);
            if (count >= FREQ_THRESHOLD) {
                risks.add(risk("LOW", "申请人近 30 天已发起 " + count + " 次同类申请，频次偏高"));
            }
        } catch (Exception e) {
            log.info("高频风险计算失败: {}", e.getMessage());
        }
    }

    // ---------- ⑩ 流程预测 ----------

    /**
     * ⑩ 后续流转与预计办理人（复用 InstanceService.predict）。任务无实例托管/预测失败/BPMN 专业模式 →
     * 空表（调用方省略 predictChain，不阻断）。
     */
    public List<Map<String, Object>> predictChain(String taskId) {
        List<Map<String, Object>> chain = new ArrayList<>();
        try {
            InstanceDetailResponse detail = detailOf(taskId);
            if (detail == null || detail.id() == null) {
                return chain;
            }
            PredictResponse pred = instanceService.predict(detail.id());
            if (pred == null || pred.path() == null) {
                return chain;
            }
            for (PredictNode node : pred.path()) {
                // predict 现返回完整链路（含已完成），此处仅取「后续流转」（当前+未来），排除 done 保持既有语义。
                if ("done".equals(node.status())) {
                    continue;
                }
                Map<String, Object> step = new LinkedHashMap<>();
                step.put("stepName", nz(node.nodeName()));
                step.put("assigneeName", joinAssignees(node.assignees()));
                chain.add(step);
            }
        } catch (Exception e) {
            log.info("流程预测失败 taskId={}: {}", taskId, e.getMessage());
        }
        return chain;
    }

    private String joinAssignees(List<AssigneeName> assignees) {
        if (assignees == null || assignees.isEmpty()) {
            return "";
        }
        return assignees.stream().map(a -> nz(a.name())).filter(StringUtils::hasText)
                .reduce((a, b) -> a + "、" + b).orElse("");
    }

    // ---------- 公共小工具 ----------

    /** taskId → 该任务所在实例详情（无 wf_instance_ext 托管的任务返回 null）。 */
    private InstanceDetailResponse detailOf(String taskId) {
        try {
            Task task = taskService.createTaskQuery().taskId(taskId).singleResult();
            if (task == null || !StringUtils.hasText(task.getProcessInstanceId())) {
                return null;
            }
            return instanceService.detailByProcInstId(task.getProcessInstanceId());
        } catch (Exception e) {
            log.info("取实例详情失败 taskId={}: {}", taskId, e.getMessage());
            return null;
        }
    }

    private Long deptOf(InstanceDetailResponse detail) {
        // InstanceDetailResponse 无 dept 字段 → 从实例表补取
        try {
            WfInstanceExt inst = detail.id() == null ? null
                    : instanceRepository.findById(detail.id()).orElse(null);
            return inst == null ? null : inst.getInitiatorDeptId();
        } catch (Exception e) {
            return null;
        }
    }

    private String amountKey(Map<String, Object> form) {
        if (form == null) {
            return null;
        }
        for (String k : form.keySet()) {
            String lk = k.toLowerCase();
            for (String probe : AMOUNT_KEYS) {
                if (lk.contains(probe.toLowerCase()) && toDouble(form.get(k)) != null) {
                    return k;
                }
            }
        }
        return null;
    }

    private static double percentile(List<Double> values, double p) {
        List<Double> sorted = new ArrayList<>(values);
        sorted.sort(null);
        int idx = (int) Math.ceil(p * sorted.size()) - 1;
        return sorted.get(Math.max(0, Math.min(idx, sorted.size() - 1)));
    }

    private Map<String, Object> risk(String level, String text) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("level", level);
        m.put("text", text);
        return m;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> asMap(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : Map.of();
    }

    private Object parseJson(String json) {
        if (!StringUtils.hasText(json)) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (Exception e) {
            return Map.of();
        }
    }

    private Double toDouble(Object v) {
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        if (v instanceof String s && StringUtils.hasText(s)) {
            try {
                return Double.parseDouble(s.trim().replaceAll("[,，¥$\\s]", ""));
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private String fmt(double v) {
        return v == Math.floor(v) ? String.valueOf((long) v) : String.valueOf(v);
    }

    private String nz(String s) {
        return s == null ? "" : s;
    }
}

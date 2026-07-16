package com.hentor.oa.office.service;

import com.hentor.oa.office.dto.gongwen.PredictResponse;
import com.hentor.oa.office.dto.gongwen.PredictResponse.AssigneeName;
import com.hentor.oa.office.dto.gongwen.PredictResponse.PredictNode;
import com.hentor.oa.office.entity.Document;
import com.hentor.oa.office.repository.DocumentRepository;
import com.hentor.oa.system.entity.SysDept;
import com.hentor.oa.system.repository.SysDeptRepository;
import com.hentor.oa.system.repository.SysUserAssignmentRepository;
import com.hentor.oa.system.repository.SysUserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import com.hentor.oa.workflow.engine.WfEngineFacade;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 公文流程预测：从当前活动节点起，沿 gw_send/gw_recv 的 designerJson(ProcessModel, 图) 向下走，
 * 列出后续将经过的 userTask 节点 + 预计办理人。数据源全走 Flowable（当前节点/已完成节点/流程变量），
 * 取人按节点 assigneeRules 用 system 域 org 数据仿 AssigneeResolver 解析（office 不依赖 oa-module-workflow）。
 *
 * <p>best-effort：任何异常降级为空 path + note，不影响详情主体。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GongwenPredictService {

    private final DocumentRepository documentRepository;
    private final WfEngineFacade engine;
    private final SysDeptRepository deptRepository;
    private final SysUserRepository userRepository;
    private final SysUserAssignmentRepository assignmentRepository;
    private final ObjectMapper objectMapper;

    @PersistenceContext
    private EntityManager entityManager;

    public PredictResponse predict(Long documentId) {
        Document doc = documentRepository.findById(documentId).orElse(null);
        if (doc == null || !StringUtils.hasText(doc.getProcessInstanceId())) {
            return new PredictResponse(List.of(), "流程未启动");
        }
        String pid = doc.getProcessInstanceId();
        try {
            boolean ended = engine.processEnded(pid);
            if (ended) {
                return new PredictResponse(List.of(), "流程已结束");
            }

            String designerJson = loadDesignerJson(defCodeOf(doc));
            if (!StringUtils.hasText(designerJson)) {
                return new PredictResponse(List.of(), "流程定义缺失");
            }
            JsonNode model = objectMapper.readTree(designerJson);

            Map<String, JsonNode> nodeById = new HashMap<>();
            for (JsonNode n : model.path("nodes")) {
                nodeById.put(n.path("id").asString(""), n);
            }
            Map<String, List<JsonNode>> edgesBySource = new HashMap<>();
            for (JsonNode e : model.path("edges")) {
                edgesBySource.computeIfAbsent(e.path("source").asString(""), k -> new ArrayList<>()).add(e);
            }

            Map<String, Object> vars = scalarVars(pid);
            Long initiatorId = asLong(vars.get("initiatorId"));
            Long initiatorDeptId = asLong(vars.get("initiatorDeptId"));
            if (initiatorDeptId == null) {
                initiatorDeptId = doc.getDeptId();
            }
            String initiatorName = vars.get("initiatorName") != null
                    ? String.valueOf(vars.get("initiatorName")) : doc.getDrafter();
            Set<String> completed = completedActivityIds(pid);
            Set<String> activeNodes = activeActivityIds(pid);

            // 从当前活动节点的下游开始（不含当前节点本身）
            Deque<String> queue = new ArrayDeque<>();
            for (String active : activeNodes) {
                enqueueTargets(active, edgesBySource, queue);
            }

            List<PredictNode> path = new ArrayList<>();
            Set<String> visited = new LinkedHashSet<>();
            Set<String> added = new LinkedHashSet<>();
            while (!queue.isEmpty()) {
                String nid = queue.poll();
                if (!visited.add(nid)) {
                    continue;
                }
                JsonNode node = nodeById.get(nid);
                if (node == null) {
                    continue;
                }
                String type = node.path("type").asString("");
                if ("endEvent".equals(type)) {
                    continue;
                }
                if ("userTask".equals(type)) {
                    if (!completed.contains(nid) && added.add(nid)) {
                        path.add(new PredictNode(nid, node.path("name").asString(type), type,
                                resolveAssignees(node, initiatorId, initiatorDeptId, initiatorName)));
                    }
                    enqueueTargets(nid, edgesBySource, queue);
                } else if (type.toLowerCase().endsWith("gateway")) {
                    String chosen = chooseGatewayTarget(nid, edgesBySource, vars);
                    if (chosen != null) {
                        queue.add(chosen);
                    }
                } else {
                    // startEvent/serviceTask/其它：透传下游
                    enqueueTargets(nid, edgesBySource, queue);
                }
            }
            String note = path.isEmpty() ? "无后续节点" : null;
            return new PredictResponse(path, note);
        } catch (Exception e) {
            log.warn("公文流程预测失败 docId={}: {}", documentId, e.getMessage());
            return new PredictResponse(List.of(), "预测不可用");
        }
    }

    // ==================== 图遍历 ====================

    private void enqueueTargets(String nid, Map<String, List<JsonNode>> edgesBySource, Deque<String> queue) {
        for (JsonNode e : edgesBySource.getOrDefault(nid, List.of())) {
            String tgt = e.path("target").asString("");
            if (StringUtils.hasText(tgt)) {
                queue.add(tgt);
            }
        }
    }

    /** 排它/包容网关选支：首个条件命中的出边 → 其 target；否则默认分支；再否则首条出边。 */
    private String chooseGatewayTarget(String gwId, Map<String, List<JsonNode>> edgesBySource, Map<String, Object> vars) {
        List<JsonNode> outs = edgesBySource.getOrDefault(gwId, List.of());
        String def = null;
        for (JsonNode e : outs) {
            if (e.path("isDefault").asBoolean(false)) {
                def = e.path("target").asString(null);
                continue;
            }
            String expr = e.path("expression").asString(null);
            if (StringUtils.hasText(expr) && evalExpr(expr, vars)) {
                return e.path("target").asString(null);
            }
        }
        if (def != null) {
            return def;
        }
        return outs.isEmpty() ? null : outs.get(0).path("target").asString(null);
    }

    /** 轻量条件求值：支持 {@code name == true|false} 与裸变量真值（gongwen 网关 needCountersign/needCirculate）。 */
    private boolean evalExpr(String expr, Map<String, Object> vars) {
        String s = expr.trim();
        if (s.startsWith("${") && s.endsWith("}")) {
            s = s.substring(2, s.length() - 1).trim();
        }
        if (s.contains("==")) {
            String[] parts = s.split("==", 2);
            boolean actual = truthy(vars.get(parts[0].trim()));
            boolean expected = Boolean.parseBoolean(parts[1].trim());
            return actual == expected;
        }
        return truthy(vars.get(s));
    }

    private boolean truthy(Object v) {
        if (v instanceof Boolean b) {
            return b;
        }
        return v != null && Boolean.parseBoolean(String.valueOf(v));
    }

    // ==================== 取人（仿 AssigneeResolver，覆盖 gongwen 规则集） ====================

    private List<AssigneeName> resolveAssignees(JsonNode node, Long initiatorId, Long initiatorDeptId, String initiatorName) {
        Set<String> names = new LinkedHashSet<>();
        JsonNode rules = node.path("props").path("assigneeRules");
        if (rules.isArray()) {
            for (JsonNode rule : rules) {
                String kind = rule.path("kind").asString("");
                if (kind.isBlank()) {
                    kind = rule.path("type").asString("");
                }
                switch (kind.toUpperCase()) {
                    case "LEADER", "FIND_LEADER" -> {
                        Long leader = leaderOf(initiatorDeptId, rule.path("level").asInt(1));
                        addUserName(names, leader);
                    }
                    case "INITIATOR" -> {
                        if (StringUtils.hasText(initiatorName)) {
                            names.add(initiatorName);
                        } else {
                            addUserName(names, initiatorId);
                        }
                    }
                    case "ROLE" -> {
                        for (JsonNode ref : rule.path("refs")) {
                            Long roleId = ref.has("id") && !ref.get("id").isNull() ? ref.get("id").asLong() : null;
                            if (roleId != null) {
                                assignmentRepository.findUserIdsByRoleId(roleId).forEach(uid -> addUserName(names, uid));
                            }
                        }
                    }
                    case "DEPT" -> {
                        for (JsonNode ref : rule.path("refs")) {
                            Long deptId = ref.has("id") && !ref.get("id").isNull() ? ref.get("id").asLong() : null;
                            if (deptId != null) {
                                assignmentRepository.findUserIdsByDeptId(deptId).forEach(uid -> addUserName(names, uid));
                            }
                        }
                    }
                    case "ACCOUNT", "USER" -> {
                        for (JsonNode ref : rule.path("refs")) {
                            Long uid = ref.has("id") && !ref.get("id").isNull() ? ref.get("id").asLong() : null;
                            addUserName(names, uid);
                        }
                    }
                    default -> {
                        // 复杂/未知规则（FORMULA/FORM_FIELD/POST 等）预测阶段不试算
                    }
                }
            }
        }
        if (names.isEmpty()) {
            names.add("待定");
        }
        return names.stream().map(AssigneeName::new).toList();
    }

    private void addUserName(Set<String> names, Long userId) {
        if (userId != null) {
            userRepository.findById(userId).ifPresent(u -> {
                if (StringUtils.hasText(u.getName())) {
                    names.add(u.getName());
                }
            });
        }
    }

    /** 沿发起人部门 ancestors 上溯 level-1 级，取该部门负责人 id。 */
    private Long leaderOf(Long deptId, int level) {
        if (deptId == null) {
            return null;
        }
        SysDept dept = deptRepository.findById(deptId).orElse(null);
        for (int i = 1; i < level && dept != null; i++) {
            dept = dept.getParentId() == null ? null : deptRepository.findById(dept.getParentId()).orElse(null);
        }
        return dept != null ? dept.getLeaderId() : null;
    }

    // ==================== Flowable 取数 ====================

    private String defCodeOf(Document doc) {
        return Document.DIRECTION_RECEIVE.equals(doc.getDirection()) ? "gw_recv" : "gw_send";
    }

    private String loadDesignerJson(String defCode) {
        List<?> rows = entityManager
                .createNativeQuery("SELECT designer_json FROM wf_process_ext WHERE def_code = :code")
                .setParameter("code", defCode)
                .getResultList();
        Object v = rows.isEmpty() ? null : rows.get(0);
        return v != null ? v.toString() : null;
    }

    private Map<String, Object> scalarVars(String pid) {
        Map<String, Object> out = new HashMap<>();
        try {
            engine.getVariables(pid).forEach((k, v) -> {
                if (v instanceof Number || v instanceof String || v instanceof Boolean) {
                    out.put(k, v);
                }
            });
        } catch (Exception ignored) {
            // 变量读取失败退化为空上下文
        }
        return out;
    }

    private Set<String> completedActivityIds(String pid) {
        Set<String> completed = new LinkedHashSet<>();
        try {
            for (WfEngineFacade.ActivityState a : engine.historicActivities(pid)) {
                if (a.finished()) {
                    completed.add(a.activityId());
                }
            }
        } catch (Exception ignored) {
            // 历史读取失败则不排除已完成
        }
        return completed;
    }

    private Set<String> activeActivityIds(String pid) {
        Set<String> active = new LinkedHashSet<>();
        try {
            for (WfEngineFacade.ActivityState a : engine.historicActivities(pid)) {
                if (!a.finished()) {
                    active.add(a.activityId());
                }
            }
        } catch (Exception ignored) {
            // ignore
        }
        try {
            active.addAll(engine.activeActivityIds(pid));
        } catch (Exception ignored) {
            // ignore
        }
        return active;
    }

    private Long asLong(Object v) {
        return v instanceof Number n ? n.longValue() : null;
    }
}

package com.xingchen.oa.workflow.engine;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.system.entity.SysDept;
import com.xingchen.oa.system.entity.SysPost;
import com.xingchen.oa.system.entity.SysRole;
import com.xingchen.oa.system.entity.SysUser;
import com.xingchen.oa.system.entity.SysUserAssignment;
import com.xingchen.oa.system.repository.SysDeptRepository;
import com.xingchen.oa.system.repository.SysPostRepository;
import com.xingchen.oa.system.repository.SysRoleRepository;
import com.xingchen.oa.system.repository.SysUserAssignmentRepository;
import com.xingchen.oa.system.repository.SysUserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.HistoryService;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.delegate.DelegateExecution;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;

/**
 * 审批人求值：作为多实例 collection 表达式 bean（{@code wfAssigneeResolver}）在节点进入时被调用，
 * 按 assigneeRules 顺序展开用户集合并按 emptyStrategy 兜底。返回用户 id 字符串列表，
 * 作为多实例元素赋给 userTask 的 assignee。
 */
@Slf4j
@Component("wfAssigneeResolver")
@RequiredArgsConstructor
public class AssigneeResolver {

    private final RepositoryService repositoryService;
    private final HistoryService historyService;
    private final SysUserRepository userRepository;
    private final SysDeptRepository deptRepository;
    private final SysUserAssignmentRepository assignmentRepository;
    private final SysRoleRepository roleRepository;
    private final SysPostRepository postRepository;
    private final ObjectMapper objectMapper;

    /**
     * 由 BPMN 多实例 collection 表达式调用：{@code ${wfAssigneeResolver.resolve(execution,'nodeId')}}。
     */
    public List<String> resolve(DelegateExecution execution, String nodeId) {
        FlowElement fe = flowElement(execution, nodeId);
        JsonNode rules = ext(fe, "assigneeRules");
        String emptyStrategy = extText(fe, "emptyStrategy", "AUTO_PASS");

        Long initiatorId = asLong(execution.getVariable("initiatorId"));
        Long initiatorDeptId = asLong(execution.getVariable("initiatorDeptId"));

        Set<Long> users = new LinkedHashSet<>();
        if (rules != null && rules.isArray()) {
            for (JsonNode rule : rules) {
                users.addAll(evalRule(rule, execution, initiatorId, initiatorDeptId));
            }
        }

        // P2 办理选项：历史优先 / 自动跳过（在兜底策略前生效）
        JsonNode handleOptions = ext(fe, "handleOptions");
        if (handleOptions != null) {
            String pid = execution.getProcessInstanceId();
            // 历史优先：节点再次进入时改用该节点历史办理人
            if (handleOptions.path("historyFirst").asBoolean(false)) {
                List<Long> hist = historyAssigneesOfNode(pid, nodeId);
                if (!hist.isEmpty()) {
                    users.clear();
                    users.addAll(hist);
                }
            }
            // 自动跳过：申请人本人不审自己 + 本实例已办过的人去重，符合则集合空 → 节点自动通过
            if (handleOptions.path("autoSkip").asBoolean(false)) {
                if (initiatorId != null) {
                    users.remove(initiatorId);
                }
                users.removeAll(historyCompletedAssignees(pid));
            }
        }

        if (users.isEmpty()) {
            switch (emptyStrategy) {
                case "AUTO_PASS" -> {
                    return List.of(); // 空集合 → 多实例 0 实例 → 节点自动通过
                }
                // BLOCK：真阻塞——审批人为空即抛业务异常，中断流转（不再静默转管理员）
                case "BLOCK" -> throw new BusinessException(400,
                        "节点[" + nodeId + "]无可用审批人，流程已阻塞（emptyStrategy=BLOCK）");
                // TO_ADMIN（含未知策略兜底）：静默转管理员
                default -> adminId().ifPresent(users::add);
            }
        }
        return users.stream().map(String::valueOf).toList();
    }

    /**
     * 供服务层复用：解析 OrgRef 数组（[{kind:USER|DEPT|ROLE,id}]）为去重用户 id 列表。
     * 加签/转办/协办/追加节点等中国式操作的选人入参统一走此方法。
     */
    public List<Long> resolveRefs(JsonNode refsArray) {
        Set<Long> out = new LinkedHashSet<>();
        if (refsArray != null && refsArray.isArray()) {
            for (JsonNode ref : refsArray) {
                out.addAll(expandOrgRef(ref));
            }
        }
        return new java.util.ArrayList<>(out);
    }

    /**
     * 严格解析：解析后校验所有用户 id 均存在，任一无效即抛业务错误
     * （避免转办/加签等操作静默创建 name=null 的幽灵任务）。
     */
    public List<Long> resolveRefsStrict(JsonNode refsArray) {
        List<Long> ids = resolveRefs(refsArray);
        Set<Long> existing = new LinkedHashSet<>();
        userRepository.findAllById(ids).forEach(u -> existing.add(u.getId()));
        for (Long id : ids) {
            if (!existing.contains(id)) {
                throw new BusinessException(400, "处理人不存在: id=" + id);
            }
        }
        return ids;
    }

    /**
     * 分组策略 CLAIM 节点候选人求值：{@code ${wfAssigneeResolver.resolveCsv(execution,'nodeId')}}，
     * 返回逗号分隔的用户 id 串，Flowable 据此展开为候选人（任务入公共池待认领）。
     */
    public String resolveCsv(DelegateExecution execution, String nodeId) {
        List<String> ids = resolve(execution, nodeId);
        return String.join(",", ids);
    }

    /**
     * 离线求值（P3 流程预测）：不经引擎执行上下文，用 initiator + 表单值 map 试算审批人 id。
     * FORM_FIELD 从 values 读取；LEADER/ORG/INITIATOR 同运行时逻辑。用于预测预计审批人，不落库。
     */
    public List<Long> resolveOffline(JsonNode rules, Long initiatorId, Long initiatorDeptId,
                                     java.util.Map<String, Object> values) {
        Set<Long> users = new LinkedHashSet<>();
        if (rules != null && rules.isArray()) {
            for (JsonNode rule : rules) {
                if ("RELATED_TO_APPLICANT".equalsIgnoreCase(rule.path("source").asString("SPECIFIED"))) {
                    users.addAll(resolveApplicantSource(rule.path("sourceValue").asString("APPLICANT"),
                            initiatorId, initiatorDeptId));
                    continue;
                }
                String type = rule.path("type").asString("");
                if (type.isBlank()) {
                    type = rule.path("kind").asString("");
                }
                switch (type.toUpperCase()) {
                    case "INITIATOR" -> {
                        if (initiatorId != null) {
                            users.add(initiatorId);
                        }
                    }
                    case "LEADER", "FIND_LEADER" -> {
                        Long leader = leaderOf(initiatorDeptId, rule.path("level").asInt(1));
                        if (leader != null) {
                            users.add(leader);
                        }
                    }
                    case "FORM_FIELD" -> {
                        String field = rule.path("field").asString(null);
                        if (field != null && values != null) {
                            users.addAll(parseUserRefs(values.get(field)));
                        }
                    }
                    case "FORMULA" -> users.addAll(evalFormula(rule.path("formula").asString(null),
                            values == null ? k -> null : values::get, initiatorId, initiatorDeptId));
                    case "POST", "ROLE_POST" -> users.addAll(resolvePost(rule));
                    case "ORG", "ACCOUNT", "ROLE", "DEPT",
                         "GROUP", "UNIT" -> {
                        String defaultKind = switch (type.toUpperCase()) {
                            case "DEPT" -> "DEPT";
                            case "ROLE" -> "ROLE";
                            default -> "USER";
                        };
                        for (JsonNode ref : rule.path("refs")) {
                            users.addAll(expandOrgRef(ref, defaultKind));
                        }
                    }
                    default -> {
                    }
                }
            }
        }
        return new ArrayList<>(users);
    }

    /**
     * 单条办理人规则求值。精简后的类型集：
     * {@code ACCOUNT(指定人员=USER) / ROLE(角色) / POST(岗位) / DEPT(部门) /
     * LEADER(发起人 N 级主管) / FORM_FIELD(表单人员字段) / INITIATOR(发起人本人) / FORMULA(自定义公式)}。
     * 兼容旧 {@code type}(ORG/LEADER/FORM_FIELD/INITIATOR) 与旧 kind(FIND_LEADER 并入 LEADER)；
     * 旧的 GROUP/UNIT/SERVICE_API/ROLE_POST 已下线，收到时按空/退化处理不报错。
     * 另支持 {@code source=RELATED_TO_APPLICANT} 按 sourceValue 解析与申请人相关的人。
     */
    private Set<Long> evalRule(JsonNode rule, DelegateExecution execution, Long initiatorId, Long initiatorDeptId) {
        Set<Long> out = new LinkedHashSet<>();
        // 来源：与流程申请人相关（优先于 kind/refs）
        if ("RELATED_TO_APPLICANT".equalsIgnoreCase(rule.path("source").asString("SPECIFIED"))) {
            out.addAll(resolveApplicantSource(rule.path("sourceValue").asString("APPLICANT"),
                    initiatorId, initiatorDeptId));
            return out;
        }
        String type = rule.path("type").asString("");
        if (type.isBlank()) {
            type = rule.path("kind").asString("");
        }
        switch (type.toUpperCase()) {
            case "INITIATOR" -> {
                if (initiatorId != null) {
                    out.add(initiatorId);
                }
            }
            case "LEADER", "FIND_LEADER" -> {
                int level = rule.path("level").asInt(1);
                Long leader = leaderOf(initiatorDeptId, level);
                if (leader != null) {
                    out.add(leader);
                }
            }
            case "FORM_FIELD" -> {
                String field = rule.path("field").asString(null);
                if (field != null) {
                    out.addAll(parseUserRefs(execution.getVariable(field)));
                }
            }
            case "FORMULA" -> out.addAll(evalFormula(rule.path("formula").asString(null),
                    execution::getVariable, initiatorId, initiatorDeptId));
            // 岗位：优先 postName(岗位名/编码) → 查 sys_post → 展开该岗位任职用户；兼容 refs 里的 POST
            case "POST", "ROLE_POST" -> out.addAll(resolvePost(rule));
            // 容器类：账户(指定人员)/角色/部门 —— 逐个展开 OrgRef（ref 自带 kind，缺省按规则类型推断）
            case "ORG", "ACCOUNT", "ROLE", "DEPT",
                 // 兼容下线类型：refs 自带 kind 仍可展开，无 refs 则空
                 "GROUP", "UNIT" -> {
                String defaultKind = switch (type.toUpperCase()) {
                    case "DEPT" -> "DEPT";
                    case "ROLE" -> "ROLE";
                    default -> "USER";
                };
                for (JsonNode ref : rule.path("refs")) {
                    out.addAll(expandOrgRef(ref, defaultKind));
                }
            }
            default -> log.warn("未知审批人规则类型(已下线或非法): {}", type);
        }
        return out;
    }

    /**
     * FORMULA 求值：受限公式引擎（{@link FormulaEvaluator}）→ userId 集合。
     * varLookup 提供表单字段/流程变量取值（运行时=execution 变量，离线预测=表单 values）。
     * 求值失败降级空集 + 日志。
     */
    private Set<Long> evalFormula(String formula, Function<String, Object> varLookup,
                                  Long initiatorId, Long initiatorDeptId) {
        if (formula == null || formula.isBlank()) {
            return new LinkedHashSet<>();
        }
        try {
            return FormulaEvaluator.eval(formula, new FormulaEvaluator.Context() {
                @Override
                public Object variable(String name) {
                    return varLookup.apply(name);
                }

                @Override
                public Set<Long> user(long id) {
                    Set<Long> s = new LinkedHashSet<>();
                    s.add(id);
                    return s;
                }

                @Override
                public Set<Long> usersByRoleName(String name) {
                    Set<Long> out = new LinkedHashSet<>();
                    roleIdByName(name).ifPresent(id -> out.addAll(expandOrgRef(refOf("ROLE", id), "ROLE")));
                    return out;
                }

                @Override
                public Set<Long> usersByPostName(String name) {
                    Set<Long> out = new LinkedHashSet<>();
                    postIdByName(name).ifPresent(id -> out.addAll(expandOrgRef(refOf("POST", id), "POST")));
                    return out;
                }

                @Override
                public Set<Long> membersOfDept(long deptId) {
                    Set<Long> out = new LinkedHashSet<>();
                    AssigneeResolver.this.membersOfDept(deptId, out);
                    return out;
                }

                @Override
                public Set<Long> deptLeader(int level) {
                    Set<Long> out = new LinkedHashSet<>();
                    Long leader = leaderOf(initiatorDeptId, level);
                    if (leader != null) {
                        out.add(leader);
                    }
                    return out;
                }

                @Override
                public Set<Long> initiator() {
                    Set<Long> out = new LinkedHashSet<>();
                    if (initiatorId != null) {
                        out.add(initiatorId);
                    }
                    return out;
                }
            });
        } catch (Exception e) {
            log.warn("FORMULA 办理人公式求值失败, 降级为空: formula={} err={}", formula, e.getMessage());
            return new LinkedHashSet<>();
        }
    }

    /**
     * POST（岗位）办理人解析：优先按 {@code postName}（岗位名或编码）查 sys_post 展开其任职用户，
     * 再叠加 refs 里自带的 POST/USER 引用。修复此前只遍历 refs 导致岗位规则解析 0 人的 bug。
     */
    private Set<Long> resolvePost(JsonNode rule) {
        Set<Long> out = new LinkedHashSet<>();
        String postName = rule.path("postName").asString(null);
        if (postName != null && !postName.isBlank()) {
            postIdByName(postName).ifPresent(pid -> out.addAll(expandOrgRef(refOf("POST", pid), "POST")));
        }
        for (JsonNode ref : rule.path("refs")) {
            out.addAll(expandOrgRef(ref, "POST"));
        }
        return out;
    }

    /** 角色名→id（按 name 或 code 精确匹配，小表全扫）。 */
    private Optional<Long> roleIdByName(String name) {
        if (name == null) {
            return Optional.empty();
        }
        return roleRepository.findAll().stream()
                .filter(r -> name.equals(r.getName()) || name.equals(r.getCode()))
                .map(SysRole::getId).findFirst();
    }

    /** 岗位名→id（按 name 或 code 精确匹配，小表全扫）。 */
    private Optional<Long> postIdByName(String name) {
        if (name == null) {
            return Optional.empty();
        }
        return postRepository.findAll().stream()
                .filter(p -> name.equals(p.getName()) || name.equals(p.getCode()))
                .map(SysPost::getId).findFirst();
    }

    /** 构造一个内存 OrgRef 节点 {kind,id} 供 expandOrgRef 复用。 */
    private JsonNode refOf(String kind, long id) {
        return objectMapper.createObjectNode().put("kind", kind).put("id", id);
    }

    /** source=RELATED_TO_APPLICANT 的 sourceValue 解析：申请人 / 申请人部门主管(第 N 级) / 申请人部门全员。 */
    private Set<Long> resolveApplicantSource(String sourceValue, Long initiatorId, Long initiatorDeptId) {
        Set<Long> out = new LinkedHashSet<>();
        String sv = sourceValue == null ? "APPLICANT" : sourceValue.toUpperCase();
        switch (sv) {
            case "APPLICANT" -> {
                if (initiatorId != null) {
                    out.add(initiatorId);
                }
            }
            case "APPLICANT_DEPT" -> membersOfDept(initiatorDeptId, out);
            default -> {
                // APPLICANT_LEADER / APPLICANT_DEPT_LEADER / APPLICANT_DEPT_LEADER_2 ...
                int level = 1;
                int us = sv.lastIndexOf('_');
                if (us >= 0) {
                    try {
                        level = Integer.parseInt(sv.substring(us + 1));
                    } catch (NumberFormatException ignored) {
                        level = 1;
                    }
                }
                Long leader = leaderOf(initiatorDeptId, level);
                if (leader != null) {
                    out.add(leader);
                }
            }
        }
        return out;
    }

    private Set<Long> expandOrgRef(JsonNode ref) {
        return expandOrgRef(ref, "USER");
    }

    private Set<Long> expandOrgRef(JsonNode ref, String defaultKind) {
        Set<Long> out = new LinkedHashSet<>();
        String kind = ref.path("kind").asString(defaultKind);
        Long id = ref.has("id") && !ref.get("id").isNull() ? ref.get("id").asLong() : null;
        String username = ref.path("username").asString(null);
        switch (kind.toUpperCase()) {
            case "USER", "ACCOUNT", "GROUP" -> {
                // GROUP 无独立成员表，退化为按 id/username 直取用户（群组成员由前端展开成 USER refs）
                if (id != null) {
                    out.add(id);
                } else if (username != null) {
                    userRepository.findByUsername(username).ifPresent(u -> out.add(u.getId()));
                }
            }
            case "DEPT" -> membersOfDept(id, out);
            case "ROLE" -> {
                if (id != null) {
                    assignmentRepository.findAll().stream()
                            .filter(a -> Boolean.TRUE.equals(a.getEnabled())
                                    && a.getRoles() != null
                                    && a.getRoles().stream().anyMatch(r -> id.equals(r.getId())))
                            .map(SysUserAssignment::getUserId)
                            .forEach(out::add);
                }
            }
            case "POST" -> {
                // 角色岗位-岗位维度：任职岗位命中即入选
                if (id != null) {
                    assignmentRepository.findAll().stream()
                            .filter(a -> Boolean.TRUE.equals(a.getEnabled())
                                    && a.getPost() != null && id.equals(a.getPost().getId()))
                            .map(SysUserAssignment::getUserId)
                            .forEach(out::add);
                }
            }
            default -> log.warn("未知 ORG ref kind: {}", kind);
        }
        return out;
    }

    private void membersOfDept(Long deptId, Set<Long> out) {
        if (deptId == null) {
            return;
        }
        assignmentRepository.findAll().stream()
                .filter(a -> a.getDept() != null && deptId.equals(a.getDept().getId())
                        && Boolean.TRUE.equals(a.getEnabled()))
                .map(SysUserAssignment::getUserId)
                .forEach(out::add);
    }

    /** 本节点历史办理人（历史优先用）。 */
    private List<Long> historyAssigneesOfNode(String pid, String nodeId) {
        List<Long> out = new ArrayList<>();
        try {
            historyService.createHistoricTaskInstanceQuery().processInstanceId(pid)
                    .taskDefinitionKey(nodeId).finished().list()
                    .forEach(t -> {
                        Long uid = parseLongSafe(t.getAssignee());
                        if (uid != null && !out.contains(uid)) {
                            out.add(uid);
                        }
                    });
        } catch (Exception e) {
            log.warn("查询节点历史办理人失败 pid={} node={}: {}", pid, nodeId, e.getMessage());
        }
        return out;
    }

    /** 本实例已办结任务的全部办理人（自动跳过去重用）。 */
    private Set<Long> historyCompletedAssignees(String pid) {
        Set<Long> out = new LinkedHashSet<>();
        try {
            historyService.createHistoricTaskInstanceQuery().processInstanceId(pid).finished().list()
                    .forEach(t -> {
                        Long uid = parseLongSafe(t.getAssignee());
                        if (uid != null) {
                            out.add(uid);
                        }
                    });
        } catch (Exception ignored) {
            // 历史查询失败则不去重
        }
        return out;
    }

    private Long parseLongSafe(String s) {
        if (s == null || s.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** 沿发起人部门 ancestors 上溯 level-1 级，取该部门负责人 */
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

    private List<Long> parseUserRefs(Object value) {
        List<Long> out = new ArrayList<>();
        if (value == null) {
            return out;
        }
        if (value instanceof Number n) {
            out.add(n.longValue());
        } else if (value instanceof String s && !s.isBlank()) {
            for (String part : s.split(",")) {
                try {
                    out.add(Long.parseLong(part.trim()));
                } catch (NumberFormatException ignored) {
                    userRepository.findByUsername(part.trim()).ifPresent(u -> out.add(u.getId()));
                }
            }
        } else if (value instanceof Iterable<?> it) {
            for (Object o : it) {
                out.addAll(parseUserRefs(o));
            }
        }
        return out;
    }

    private Optional<Long> adminId() {
        return userRepository.findByUsername("admin").map(SysUser::getId);
    }

    private FlowElement flowElement(DelegateExecution execution, String nodeId) {
        BpmnModel model = repositoryService.getBpmnModel(execution.getProcessDefinitionId());
        return model.getMainProcess().getFlowElement(nodeId, true);
    }

    private JsonNode ext(FlowElement fe, String name) {
        String text = extText(fe, name, null);
        if (text == null) {
            return null;
        }
        try {
            return objectMapper.readTree(text);
        } catch (Exception e) {
            log.warn("解析扩展元素 {} 失败: {}", name, e.getMessage());
            return null;
        }
    }

    private String extText(FlowElement fe, String name, String def) {
        if (fe == null || fe.getExtensionElements() == null) {
            return def;
        }
        List<ExtensionElement> list = fe.getExtensionElements().get(name);
        if (list == null || list.isEmpty()) {
            return def;
        }
        String t = list.get(0).getElementText();
        return t == null || t.isBlank() ? def : t;
    }

    private Long asLong(Object v) {
        return v instanceof Number n ? n.longValue() : null;
    }
}

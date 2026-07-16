package com.hentor.oa.workflow.engine;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.system.entity.SysDept;
import com.hentor.oa.system.entity.SysPost;
import com.hentor.oa.system.entity.SysRole;
import com.hentor.oa.system.entity.SysUser;
import com.hentor.oa.system.repository.SysDeptRepository;
import com.hentor.oa.system.repository.SysPostRepository;
import com.hentor.oa.system.repository.SysRoleRepository;
import com.hentor.oa.system.repository.SysUserAssignmentRepository;
import com.hentor.oa.system.repository.SysUserLeaderRepository;
import com.hentor.oa.system.repository.SysUserRepository;
import com.hentor.oa.workflow.engine.expression.ExpressionService;
import com.hentor.oa.workflow.engine.expression.FormulaFunctionRegistrar;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.Process;
import org.flowable.bpmn.model.UserTask;
import org.flowable.engine.HistoryService;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.delegate.DelegateExecution;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * {@link AssigneeResolver} 办理人求值单测（Mockito mock 仓储）。
 * <p>
 * 覆盖取舍（remediation-plan Q-02 允许）：本类真正的「取人 kind」求值集中在私有
 * {@code evalRule}/{@code resolveDataSource}/{@code expandOrgRef}，它们既服务运行时
 * {@link AssigneeResolver#resolve} 又服务离线预测 {@link AssigneeResolver#resolveOffline}。
 * 运行时 {@code resolve} 依赖 Flowable {@code DelegateExecution + BpmnModel}，而 {@code resolveOffline}
 * 用普通 {@code values} map 走同一套 kind 分支——因此本测试以 {@code resolveOffline} 为主入口逐个覆盖
 * <b>ROLE / POST / DEPT / LEADER / INITIATOR / FORMULA / ACCOUNT(USER) + 数据类来源(VARIABLE/FORM_FIELD/FORMULA)</b>，
 * 用 {@code resolveRefs} 覆盖 OrgRef 展开，另用一段内存 {@code BpmnModel} 驱动 {@code resolve} 覆盖
 * <b>emptyStrategy(AUTO_PASS/BLOCK/TO_ADMIN)</b> 三分支。
 * <p>
 * 未覆盖：multiMode(ANY/ALL/SEQUENCE/VOTE) 不由本类处理——它在 {@code JsonToBpmnConverter} 阶段
 * 编译为多实例特性（已有 {@code JsonToBpmnConverterTest} + smoke 覆盖），本类只产出用户集合；
 * 以及 PREV_HANDLER/NODE_HANDLER 等需历史/流程变量的跨节点来源（由 smoke 端到端覆盖）。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AssigneeResolverTest {

    @Mock RepositoryService repositoryService;
    @Mock HistoryService historyService;
    @Mock SysUserRepository userRepository;
    @Mock SysDeptRepository deptRepository;
    @Mock SysUserAssignmentRepository assignmentRepository;
    @Mock SysUserLeaderRepository userLeaderRepository;
    @Mock SysRoleRepository roleRepository;
    @Mock SysPostRepository postRepository;
    @Mock FormulaFunctionRegistrar formulaFunctionRegistrar;

    private final ObjectMapper realMapper = new ObjectMapper();
    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    // 真实 Aviator 引擎（沙箱）；本测试的 FORMULA 用例仅用内置取人函数（ROLE 等），
    // 不触发自定义函数委托，故引擎无需注册扩展函数（扩展函数路径由 ExpressionServiceTest/
    // FormulaEvaluatorTest 覆盖）。
    private final ExpressionService expressionService = new ExpressionService();

    private AssigneeResolver resolver;

    @BeforeEach
    void setUp() {
        resolver = new AssigneeResolver(repositoryService, historyService, userRepository,
                deptRepository, assignmentRepository, userLeaderRepository, roleRepository, postRepository,
                realMapper, formulaFunctionRegistrar, expressionService);
    }

    private JsonNode json(String s) {
        return jsonMapper.readTree(s);
    }

    private static SysUser user(long id) {
        SysUser u = new SysUser();
        u.setId(id);
        return u;
    }

    /* ======================= resolveOffline: kind 逐个覆盖 ======================= */

    @Test
    void kindInitiator() {
        JsonNode rules = json("[{\"type\":\"INITIATOR\"}]");
        assertEquals(List.of(7L), resolver.resolveOffline(rules, 7L, 10L, Map.of()));
    }

    @Test
    void kindLeaderUsesDeptLeaderAtLevel() {
        SysDept dept = new SysDept();
        dept.setLeaderId(50L);
        when(deptRepository.findById(10L)).thenReturn(Optional.of(dept));
        JsonNode rules = json("[{\"type\":\"LEADER\",\"level\":1}]");
        assertEquals(List.of(50L), resolver.resolveOffline(rules, 7L, 10L, Map.of()));
    }

    @Test
    void kindLeaderUsesDesignatedLeadersWhenConfigured() {
        // 发起人 7 配了指定直属上级 [2,4] → LEADER(level 1) 用指定的，忽略部门负责人（deptRepository 不应被查）
        when(userLeaderRepository.findLeaderIdsByUserId(7L)).thenReturn(List.of(2L, 4L));
        JsonNode rules = json("[{\"kind\":\"LEADER\",\"level\":1}]");
        assertEquals(List.of(2L, 4L), resolver.resolveOffline(rules, 7L, 10L, Map.of()));
    }

    @Test
    void kindLeaderFallsBackToDeptWhenNoDesignated() {
        // 未配指定上级（仓库返回空）→ 回退部门负责人，保持向后兼容
        when(userLeaderRepository.findLeaderIdsByUserId(7L)).thenReturn(List.of());
        SysDept dept = new SysDept();
        dept.setLeaderId(50L);
        when(deptRepository.findById(10L)).thenReturn(Optional.of(dept));
        JsonNode rules = json("[{\"kind\":\"LEADER\",\"level\":1}]");
        assertEquals(List.of(50L), resolver.resolveOffline(rules, 7L, 10L, Map.of()));
    }

    @Test
    void kindLeaderClimbsAncestorsForHigherLevel() {
        SysDept child = new SysDept();
        child.setParentId(1L);
        child.setLeaderId(50L);
        SysDept parent = new SysDept();
        parent.setLeaderId(99L);
        when(deptRepository.findById(10L)).thenReturn(Optional.of(child));
        when(deptRepository.findById(1L)).thenReturn(Optional.of(parent));
        JsonNode rules = json("[{\"type\":\"LEADER\",\"level\":2}]");
        assertEquals(List.of(99L), resolver.resolveOffline(rules, 7L, 10L, Map.of()));
    }

    @Test
    void kindRoleExpandsRoleMembers() {
        when(assignmentRepository.findUserIdsByRoleId(7L)).thenReturn(List.of(70L, 71L));
        JsonNode rules = json("[{\"type\":\"ROLE\",\"refs\":[{\"kind\":\"ROLE\",\"id\":7}]}]");
        assertEquals(List.of(70L, 71L), resolver.resolveOffline(rules, 1L, 1L, Map.of()));
    }

    @Test
    void kindDeptExpandsDeptMembers() {
        when(assignmentRepository.findUserIdsByDeptId(10L)).thenReturn(List.of(11L, 12L));
        // refs 缺 kind → defaultKind=DEPT
        JsonNode rules = json("[{\"type\":\"DEPT\",\"refs\":[{\"id\":10}]}]");
        assertEquals(List.of(11L, 12L), resolver.resolveOffline(rules, 1L, 1L, Map.of()));
    }

    @Test
    void kindPostByNameThenExpands() {
        SysPost post = new SysPost();
        post.setId(9L);
        when(postRepository.findFirstByNameOrCode("财务", "财务")).thenReturn(Optional.of(post));
        when(assignmentRepository.findUserIdsByPostId(9L)).thenReturn(List.of(90L));
        JsonNode rules = json("[{\"type\":\"POST\",\"postName\":\"财务\"}]");
        assertEquals(List.of(90L), resolver.resolveOffline(rules, 1L, 1L, Map.of()));
    }

    @Test
    void kindAccountResolvesFixedUser() {
        JsonNode rules = json("[{\"type\":\"ACCOUNT\",\"refs\":[{\"kind\":\"USER\",\"id\":5}]}]");
        assertEquals(List.of(5L), resolver.resolveOffline(rules, 1L, 1L, Map.of()));
    }

    @Test
    void kindFormulaOldShapeEvaluatesFormula() {
        // FORMULA 走 FormulaEvaluator：ROLE("总经理") → roleRepository → assignmentRepository
        SysRole role = new SysRole();
        role.setId(7L);
        when(roleRepository.findFirstByNameOrCode("总经理", "总经理")).thenReturn(Optional.of(role));
        when(assignmentRepository.findUserIdsByRoleId(7L)).thenReturn(List.of(100L));
        JsonNode rules = json("[{\"type\":\"FORMULA\",\"formula\":\"ROLE(\\\"总经理\\\")\"}]");
        assertEquals(List.of(100L), resolver.resolveOffline(rules, 1L, 1L, Map.of()));
    }

    @Test
    void kindFormulaWithIfBranch() {
        // IF(days>3, INITIATOR(), DEPT(10))：days=5 → INITIATOR()={1}
        JsonNode rules = json("[{\"type\":\"FORMULA\",\"formula\":\"IF(days>3, INITIATOR(), DEPT(10))\"}]");
        assertEquals(List.of(1L), resolver.resolveOffline(rules, 1L, 10L, Map.of("days", 5)));
    }

    /* ======================= resolveOffline: 数据类来源 (二维模型 source) ======================= */

    @Test
    void sourceVariableReadsFromValues() {
        JsonNode rules = json("[{\"source\":\"VARIABLE\",\"varName\":\"approver\"}]");
        assertEquals(List.of(42L), resolver.resolveOffline(rules, 1L, 1L, Map.of("approver", 42L)));
    }

    @Test
    void sourceFormFieldReadsFromValues() {
        JsonNode rules = json("[{\"source\":\"FORM_FIELD\",\"field\":\"approver\"}]");
        // 逗号分隔字符串也可解析
        assertEquals(List.of(8L, 9L), resolver.resolveOffline(rules, 1L, 1L, Map.of("approver", "8,9")));
    }

    @Test
    void sourceFormulaEvaluated() {
        JsonNode rules = json("[{\"source\":\"FORMULA\",\"formula\":\"INITIATOR()\"}]");
        assertEquals(List.of(3L), resolver.resolveOffline(rules, 3L, 1L, Map.of()));
    }

    @Test
    void sourceRelatedToApplicantLeader() {
        SysDept dept = new SysDept();
        dept.setLeaderId(50L);
        when(deptRepository.findById(10L)).thenReturn(Optional.of(dept));
        JsonNode rules = json("[{\"source\":\"RELATED_TO_APPLICANT\",\"sourceValue\":\"APPLICANT_DEPT_LEADER\"}]");
        assertEquals(List.of(50L), resolver.resolveOffline(rules, 7L, 10L, Map.of()));
    }

    @Test
    void multipleRulesUnionedAndDeduped() {
        when(assignmentRepository.findUserIdsByDeptId(10L)).thenReturn(List.of(11L, 12L));
        JsonNode rules = json("[{\"type\":\"INITIATOR\"},{\"type\":\"DEPT\",\"refs\":[{\"id\":10}]},{\"type\":\"INITIATOR\"}]");
        // 11 是 initiator 同时也是部门成员？此处 initiator=99 独立，验证并集去重顺序
        assertEquals(List.of(99L, 11L, 12L), resolver.resolveOffline(rules, 99L, 10L, Map.of()));
    }

    /* ======================= resolveRefs / resolveRefsStrict：OrgRef 展开 ======================= */

    @Test
    void resolveRefsExpandsEachKind() {
        when(assignmentRepository.findUserIdsByRoleId(7L)).thenReturn(List.of(70L));
        when(assignmentRepository.findUserIdsByPostId(9L)).thenReturn(List.of(90L));
        when(assignmentRepository.findUserIdsByDeptId(10L)).thenReturn(List.of(11L, 12L));
        JsonNode refs = json("[{\"kind\":\"USER\",\"id\":5},{\"kind\":\"ROLE\",\"id\":7},"
                + "{\"kind\":\"POST\",\"id\":9},{\"kind\":\"DEPT\",\"id\":10}]");
        assertEquals(List.of(5L, 70L, 90L, 11L, 12L), resolver.resolveRefs(refs));
    }

    @Test
    void resolveRefsByUsername() {
        when(userRepository.findByUsername("zhangsan")).thenReturn(Optional.of(user(33L)));
        JsonNode refs = json("[{\"kind\":\"USER\",\"username\":\"zhangsan\"}]");
        assertEquals(List.of(33L), resolver.resolveRefs(refs));
    }

    @Test
    void resolveRefsStrictThrowsOnMissingUser() {
        // 解析出 [5,6]，但仓储只认得 5 → 6 不存在 → 业务异常（不静默创建幽灵任务）
        when(userRepository.findAllById(any())).thenReturn(List.of(user(5L)));
        JsonNode refs = json("[{\"kind\":\"USER\",\"id\":5},{\"kind\":\"USER\",\"id\":6}]");
        assertThrows(BusinessException.class, () -> resolver.resolveRefsStrict(refs));
    }

    @Test
    void resolveRefsStrictPassesWhenAllExist() {
        when(userRepository.findAllById(any())).thenReturn(List.of(user(5L), user(6L)));
        JsonNode refs = json("[{\"kind\":\"USER\",\"id\":5},{\"kind\":\"USER\",\"id\":6}]");
        assertEquals(List.of(5L, 6L), resolver.resolveRefsStrict(refs));
    }

    /* ======================= resolve(): emptyStrategy 三分支 ======================= */

    private DelegateExecution executionWith(String defId, String pid, BpmnModel model) {
        DelegateExecution exec = org.mockito.Mockito.mock(DelegateExecution.class);
        lenient().when(exec.getProcessDefinitionId()).thenReturn(defId);
        lenient().when(exec.getProcessInstanceId()).thenReturn(pid);
        lenient().when(exec.getVariable(anyString())).thenReturn(null);
        when(repositoryService.getBpmnModel(defId)).thenReturn(model);
        return exec;
    }

    /** 构造一个含单个 UserTask 的内存 BpmnModel，注入 assigneeRules/emptyStrategy 扩展元素。 */
    private BpmnModel modelWith(String nodeId, String assigneeRulesJson, String emptyStrategy) {
        BpmnModel model = new BpmnModel();
        Process process = new Process();
        process.setId("p");
        UserTask task = new UserTask();
        task.setId(nodeId);
        addExt(task, "assigneeRules", assigneeRulesJson);
        addExt(task, "emptyStrategy", emptyStrategy);
        process.addFlowElement(task);
        model.addProcess(process);
        return model;
    }

    private void addExt(UserTask task, String name, String text) {
        if (text == null) {
            return;
        }
        ExtensionElement ee = new ExtensionElement();
        ee.setName(name);
        ee.setElementText(text);
        task.addExtensionElement(ee);
    }

    @Test
    void resolveInitiatorFromExecutionVariable() {
        BpmnModel model = modelWith("n1", "[{\"type\":\"INITIATOR\"}]", "AUTO_PASS");
        DelegateExecution exec = executionWith("def:1", "pid1", model);
        when(exec.getVariable("initiatorId")).thenReturn(2L);
        assertEquals(List.of("2"), resolver.resolve(exec, "n1"));
    }

    @Test
    void emptyStrategyAutoPassReturnsEmptyList() {
        BpmnModel model = modelWith("n1", "[]", "AUTO_PASS");
        DelegateExecution exec = executionWith("def:1", "pid1", model);
        assertTrue(resolver.resolve(exec, "n1").isEmpty());
    }

    @Test
    void emptyStrategyBlockThrows() {
        BpmnModel model = modelWith("n1", "[]", "BLOCK");
        DelegateExecution exec = executionWith("def:1", "pid1", model);
        assertThrows(BusinessException.class, () -> resolver.resolve(exec, "n1"));
    }

    @Test
    void emptyStrategyToAdminFallsBackToAdmin() {
        when(userRepository.findByUsername("admin")).thenReturn(Optional.of(user(1L)));
        BpmnModel model = modelWith("n1", "[]", "TO_ADMIN");
        DelegateExecution exec = executionWith("def:1", "pid1", model);
        assertEquals(List.of("1"), resolver.resolve(exec, "n1"));
    }
}

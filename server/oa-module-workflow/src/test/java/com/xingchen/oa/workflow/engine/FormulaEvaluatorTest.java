package com.xingchen.oa.workflow.engine;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link FormulaEvaluator} 办理人自定义公式受限求值单测。
 * <p>
 * 重点验证 B-16 的 IF 择一逻辑：{@code IF(cond, a, b)} 依 cond 真假返回对应分支集合。
 * 由于该求值器「解析与求值合一」（IF 两分支在求值时均被计算、再择一返回），且取人函数
 * 无副作用、失败降级空集，本测试同时验证「全量求值与只算命中分支结果一致」这一 B-16 结论。
 */
class FormulaEvaluatorTest {

    /** 确定性桩：角色/岗位/部门/主管/发起人取数固定，供公式求值断言。 */
    private static final class StubContext implements FormulaEvaluator.Context {
        final Map<String, Object> vars = new HashMap<>();
        boolean roleCalled = false;
        boolean deptLeaderCalled = false;

        @Override
        public Object variable(String name) {
            return vars.get(name);
        }

        @Override
        public Set<Long> user(long id) {
            return set(id);
        }

        @Override
        public Set<Long> usersByRoleName(String name) {
            roleCalled = true;
            return "总经理".equals(name) ? set(100L) : new LinkedHashSet<>();
        }

        @Override
        public Set<Long> usersByPostName(String name) {
            return "财务".equals(name) ? set(200L, 201L) : new LinkedHashSet<>();
        }

        @Override
        public Set<Long> membersOfDept(long deptId) {
            return deptId == 10L ? set(11L, 12L) : new LinkedHashSet<>();
        }

        @Override
        public Set<Long> deptLeader(int level) {
            deptLeaderCalled = true;
            return switch (level) {
                case 1 -> set(50L);
                case 2 -> set(60L);
                default -> new LinkedHashSet<>();
            };
        }

        @Override
        public Set<Long> initiator() {
            return set(1L);
        }
    }

    private static Set<Long> set(Long... ids) {
        return new LinkedHashSet<>(java.util.Arrays.asList(ids));
    }

    private StubContext ctx() {
        return new StubContext();
    }

    /* ---------- B-16 核心：IF 择一 ---------- */

    @Test
    void ifSelectsTrueBranchWhenConditionHolds() {
        StubContext c = ctx();
        c.vars.put("days", 5);
        Set<Long> r = FormulaEvaluator.eval("IF(days>3, ROLE(\"总经理\"), DEPT_LEADER(1))", c);
        assertEquals(set(100L), r);
    }

    @Test
    void ifSelectsFalseBranchWhenConditionFails() {
        StubContext c = ctx();
        c.vars.put("days", 1);
        Set<Long> r = FormulaEvaluator.eval("IF(days>3, ROLE(\"总经理\"), DEPT_LEADER(1))", c);
        assertEquals(set(50L), r);
    }

    @Test
    void ifWithoutElseReturnsEmptyOnFalse() {
        StubContext c = ctx();
        c.vars.put("days", 1);
        assertTrue(FormulaEvaluator.eval("IF(days>3, ROLE(\"总经理\"))", c).isEmpty());
    }

    @Test
    void ifBothBranchesEvaluatedButOnlyOneReturned_B16() {
        // B-16：两分支均被求值（roleCalled 与 deptLeaderCalled 都为真），但仅命中分支的集合返回。
        // 取人函数无副作用，故全量求值不影响正确性。
        StubContext c = ctx();
        c.vars.put("days", 5);
        Set<Long> r = FormulaEvaluator.eval("IF(days>3, ROLE(\"总经理\"), DEPT_LEADER(1))", c);
        assertEquals(set(100L), r);
        assertTrue(c.roleCalled, "true 分支被求值");
        assertTrue(c.deptLeaderCalled, "false 分支也被求值（先算两分支再择一）");
    }

    @Test
    void nestedIf() {
        StubContext c = ctx();
        c.vars.put("days", 10);
        c.vars.put("vip", true);
        // days>7 → 内层 IF(vip, INITIATOR(), POST("财务"))；vip=true → INITIATOR()={1}
        Set<Long> r = FormulaEvaluator.eval(
                "IF(days>7, IF(vip, INITIATOR(), POST(\"财务\")), ROLE(\"总经理\"))", c);
        assertEquals(set(1L), r);
    }

    /* ---------- 取人函数逐个覆盖 ---------- */

    @Test
    void userFunctionUnionsIds() {
        assertEquals(set(2L, 3L), FormulaEvaluator.eval("USER(2, 3)", ctx()));
    }

    @Test
    void roleFunction() {
        assertEquals(set(100L), FormulaEvaluator.eval("ROLE(\"总经理\")", ctx()));
    }

    @Test
    void postFunction() {
        assertEquals(set(200L, 201L), FormulaEvaluator.eval("POST(\"财务\")", ctx()));
    }

    @Test
    void deptFunction() {
        assertEquals(set(11L, 12L), FormulaEvaluator.eval("DEPT(10)", ctx()));
    }

    @Test
    void deptLeaderFunctionRespectsLevel() {
        assertEquals(set(50L), FormulaEvaluator.eval("DEPT_LEADER(1)", ctx()));
        assertEquals(set(60L), FormulaEvaluator.eval("DEPT_LEADER(2)", ctx()));
        // 缺省参数 level=1
        assertEquals(set(50L), FormulaEvaluator.eval("DEPT_LEADER()", ctx()));
    }

    @Test
    void initiatorFunction() {
        assertEquals(set(1L), FormulaEvaluator.eval("INITIATOR()", ctx()));
    }

    /* ---------- 降级：非用户集合 / 空 / 未知取人 → 空集 ---------- */

    @Test
    void blankFormulaReturnsEmpty() {
        assertTrue(FormulaEvaluator.eval(null, ctx()).isEmpty());
        assertTrue(FormulaEvaluator.eval("   ", ctx()).isEmpty());
        assertTrue(FormulaEvaluator.eval("", ctx()).isEmpty());
    }

    @Test
    void nonUserSetResultDegradesToEmpty() {
        // 最终值是布尔（比较结果），非用户集合 → toUserSet 返回空集
        StubContext c = ctx();
        c.vars.put("days", 5);
        assertTrue(FormulaEvaluator.eval("days > 3", c).isEmpty());
        assertTrue(FormulaEvaluator.eval("AND(true, false)", c).isEmpty());
    }

    @Test
    void unknownLookupReturnsEmptySet() {
        // 取人函数「失败」= 名称查不到 → 该函数返回空集，公式整体空集（AssigneeResolver 再降级）
        assertTrue(FormulaEvaluator.eval("ROLE(\"查无此角色\")", ctx()).isEmpty());
        assertTrue(FormulaEvaluator.eval("DEPT(99999)", ctx()).isEmpty());
    }

    /* ---------- 逻辑与比较运算 ---------- */

    @Test
    void logicalKeywordsAndInfixOperators() {
        StubContext c = ctx();
        c.vars.put("days", 5);
        c.vars.put("vip", true);
        // AND 关键字 + 中缀 &&
        assertEquals(set(100L), FormulaEvaluator.eval("IF(days>3 AND vip, ROLE(\"总经理\"), INITIATOR())", c));
        assertEquals(set(100L), FormulaEvaluator.eval("IF(days>3 && vip, ROLE(\"总经理\"), INITIATOR())", c));
        // OR：days<3 为假但 vip 为真 → 命中 true 分支
        assertEquals(set(100L), FormulaEvaluator.eval("IF(days<3 OR vip, ROLE(\"总经理\"), INITIATOR())", c));
        // NOT
        assertEquals(set(1L), FormulaEvaluator.eval("IF(NOT vip, ROLE(\"总经理\"), INITIATOR())", c));
    }

    @Test
    void comparisonOperators() {
        StubContext c = ctx();
        c.vars.put("n", 5);
        assertEquals(set(1L), FormulaEvaluator.eval("IF(n >= 5, INITIATOR(), ROLE(\"总经理\"))", c));
        assertEquals(set(1L), FormulaEvaluator.eval("IF(n <= 5, INITIATOR(), ROLE(\"总经理\"))", c));
        assertEquals(set(1L), FormulaEvaluator.eval("IF(n == 5, INITIATOR(), ROLE(\"总经理\"))", c));
        assertEquals(set(100L), FormulaEvaluator.eval("IF(n != 5, INITIATOR(), ROLE(\"总经理\"))", c));
    }

    @Test
    void stringEqualityComparison() {
        StubContext c = ctx();
        c.vars.put("dept", "财务部");
        assertEquals(set(1L),
                FormulaEvaluator.eval("IF(dept == \"财务部\", INITIATOR(), ROLE(\"总经理\"))", c));
        assertEquals(set(100L),
                FormulaEvaluator.eval("IF(dept == \"人事部\", INITIATOR(), ROLE(\"总经理\"))", c));
    }

    @Test
    void andOrNotAsFunctions() {
        StubContext c = ctx();
        assertEquals(set(1L), FormulaEvaluator.eval("IF(AND(true, true), INITIATOR(), ROLE(\"总经理\"))", c));
        assertEquals(set(100L), FormulaEvaluator.eval("IF(OR(false, false), INITIATOR(), ROLE(\"总经理\"))", c));
        assertEquals(set(1L), FormulaEvaluator.eval("IF(NOT(false), INITIATOR(), ROLE(\"总经理\"))", c));
    }

    /* ---------- 解析错误抛异常（由调用方 try/catch 降级） ---------- */

    @Test
    void parseErrorsThrow() {
        // 尾部无法解析
        assertThrows(RuntimeException.class, () -> FormulaEvaluator.eval("INITIATOR() garbage", ctx()));
        // 未知函数
        assertThrows(RuntimeException.class, () -> FormulaEvaluator.eval("FOO(1)", ctx()));
        // 括号不匹配
        assertThrows(RuntimeException.class, () -> FormulaEvaluator.eval("IF(days>3, INITIATOR()", ctx()));
    }
}

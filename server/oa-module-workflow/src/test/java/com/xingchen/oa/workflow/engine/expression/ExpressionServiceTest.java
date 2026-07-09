package com.xingchen.oa.workflow.engine.expression;

import com.googlecode.aviator.runtime.function.AbstractFunction;
import com.googlecode.aviator.runtime.function.FunctionUtils;
import com.googlecode.aviator.runtime.type.AviatorObject;
import com.googlecode.aviator.runtime.type.AviatorRuntimeJavaType;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.engine.expression.functions.WorkDaysFunction;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link ExpressionService} Tier 1 公式引擎单测：内置运算/比较/逻辑、context 变量取值、
 * 注册的自定义函数（{@link WorkDaysFunction} + lambda 包装），evalBoolean 真值语义，
 * 以及沙箱——含 {@code new}/反射的表达式被拒。
 *
 * <p>纯 POJO 构造 {@code ExpressionService}（引擎沙箱在构造器就绪），
 * 直接调 package-private {@code registerFunction} 注入自定义函数（本测试与被测类同包）。
 */
class ExpressionServiceTest {

    private ExpressionService svc;

    @BeforeEach
    void setUp() {
        svc = new ExpressionService();
        // 注册真实示例函数（纯计算、无依赖）
        svc.registerFunction(new WorkDaysFunction());
        // lambda 包装的自定义纯函数：triple(x) = x * 3，证明「后端可自定义公式代码」
        svc.registerFunction(new AbstractFunction() {
            @Override
            public String getName() {
                return "triple";
            }

            @Override
            public AviatorObject call(Map<String, Object> env, AviatorObject arg1) {
                Number n = FunctionUtils.getNumberValue(arg1, env);
                return AviatorRuntimeJavaType.valueOf(n == null ? 0L : n.longValue() * 3);
            }
        });
    }

    /* ---------- 内置运算 / 比较 / 逻辑 ---------- */

    @Test
    void arithmetic() {
        assertEquals(7L, svc.eval("1 + 2 * 3", Map.of()));
        assertEquals(2L, svc.eval("10 % 4", Map.of()));
    }

    @Test
    void comparisonAndLogic() {
        assertTrue(svc.evalBoolean("amount > 1000 && urgent",
                Map.of("amount", 2000, "urgent", true)));
        assertFalse(svc.evalBoolean("amount > 1000 && urgent",
                Map.of("amount", 500, "urgent", true)));
        // 三元 + 逻辑或
        assertEquals("high", svc.eval("amount >= 1000 || vip ? 'high' : 'low'",
                Map.of("amount", 1500, "vip", false)));
    }

    /* ---------- context 变量取值 ---------- */

    @Test
    void contextVariables() {
        assertEquals(10L, svc.eval("days * 2", Map.of("days", 5)));
        assertEquals("财务部", svc.eval("deptName", Map.of("deptName", "财务部")));
    }

    /* ---------- 注册的自定义函数 ---------- */

    @Test
    void registeredWorkDaysFunction() {
        // 2026-07-06(周一) ~ 2026-07-10(周五) = 5 个工作日
        assertEquals(5L, svc.eval("workDays('2026-07-06', '2026-07-10')", Map.of()));
        // 跨周末：2026-07-10(周五) ~ 2026-07-13(周一) = 周五 + 周一 = 2
        assertEquals(2L, svc.eval("workDays('2026-07-10', '2026-07-13')", Map.of()));
        // 用作高级条件（注意：Aviator 部分标识符如 end 为保留字，不可作裸变量名，故用 startDate/endDate）
        assertTrue(svc.evalBoolean("workDays(startDate, endDate) > 3",
                Map.of("startDate", "2026-07-06", "endDate", "2026-07-10")));
    }

    @Test
    void registeredLambdaFunction() {
        assertEquals(15L, svc.eval("triple(5)", Map.of()));
        // 自定义函数可与内置运算/context 组合
        assertEquals(21L, svc.eval("triple(days) + 6", Map.of("days", 5)));
    }

    /* ---------- 沙箱：new / 反射被拒 ---------- */

    @Test
    void sandboxRejectsNewInstance() {
        // Feature.NewInstance 已禁 → 编译期即拒
        assertThrows(BusinessException.class,
                () -> svc.eval("new java.util.HashMap()", Map.of()));
        assertThrows(BusinessException.class,
                () -> svc.eval("new java.lang.StringBuilder('x')", Map.of()));
    }

    @Test
    void sandboxRejectsReflectionMethodCall() {
        // ALLOWED_CLASS_SET=空集 → 对任意 Java 对象反射调用方法被拒（getClass 等反射面关闭）
        assertThrows(BusinessException.class,
                () -> svc.eval("'x'.getClass()", Map.of("x", "y")));
    }

    /* ---------- evalBoolean 真值语义 ---------- */

    @Test
    void evalBooleanCoercion() {
        assertTrue(svc.evalBoolean("1", Map.of()));
        assertFalse(svc.evalBoolean("0", Map.of()));
        assertTrue(svc.evalBoolean("'x'", Map.of()));
        assertFalse(svc.evalBoolean("nil", Map.of()));
    }

    /* ---------- 空表达式 ---------- */

    @Test
    void blankExpressionRejected() {
        assertThrows(BusinessException.class, () -> svc.eval(null, Map.of()));
        assertThrows(BusinessException.class, () -> svc.eval("   ", Map.of()));
    }
}

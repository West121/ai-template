package com.hentor.oa.workflow.engine.expression;

import com.googlecode.aviator.AviatorEvaluator;
import com.googlecode.aviator.AviatorEvaluatorInstance;
import com.googlecode.aviator.EvalMode;
import com.googlecode.aviator.Expression;
import com.googlecode.aviator.Feature;
import com.googlecode.aviator.Options;
import com.googlecode.aviator.runtime.type.AviatorFunction;
import com.hentor.oa.common.exception.BusinessException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.Map;

/**
 * Tier 1 公式（安全表达式）统一求值引擎，包裹 Aviator {@link AviatorEvaluatorInstance}。
 * 同时供「表单计算字段」与「工作流高级网关条件」求值——一个引擎、一套函数库。
 *
 * <h3>安全沙箱</h3>
 * 只允许「纯表达式 + 注册的白名单函数」，禁止任意 Java 对象/类访问与反射逃逸：
 * <ul>
 *   <li>{@link EvalMode#INTERPRETER} 解释执行——不走 ASM 动态字节码生成；</li>
 *   <li>禁 {@link Feature#NewInstance}（{@code new java.lang.X()}）；</li>
 *   <li>禁 {@link Feature#Module} / {@link Feature#Use}（模块导入）；</li>
 *   <li>禁 {@link Feature#StaticMethods} / {@link Feature#StaticFields}（静态方法/字段直取）；</li>
 *   <li>禁 {@link Feature#ForLoop} / {@link Feature#WhileLoop}（防高频路径死循环 DoS）；</li>
 *   <li>{@link Options#ALLOWED_CLASS_SET} = 空集——<b>禁止对任意 Java 对象反射调用方法</b>
 *       （如 {@code x.getClass()}、{@code ''.getClass().forName(..)} 一类反射面全部关闭）；</li>
 *   <li>算术/比较/逻辑/三元等核心运算符与已注册函数不受影响，正常表达式照常求值。</li>
 * </ul>
 *
 * <h3>编译缓存</h3>
 * {@link #eval} 走 {@code compile(expr, true)}——Aviator 按表达式串缓存编译产物，
 * 相同表达式（如同一网关条件被反复求值）复用已编译 {@link Expression}，不重复解析。
 *
 * @see FormulaFunction 自定义函数注解
 * @see FormulaFunctionRegistrar 注册器
 * @see ExprEval 工作流网关运行时门面（bean {@code exprEval}）
 */
@Slf4j
@Service
public class ExpressionService {

    private final AviatorEvaluatorInstance engine;

    public ExpressionService() {
        this.engine = AviatorEvaluator.newInstance(EvalMode.INTERPRETER);
        // 逐项关停危险语言特性（保留算术/比较/逻辑/三元/函数调用等纯表达式能力）
        engine.disableFeature(Feature.NewInstance);
        engine.disableFeature(Feature.Module);
        engine.disableFeature(Feature.Use);
        engine.disableFeature(Feature.StaticMethods);
        engine.disableFeature(Feature.StaticFields);
        engine.disableFeature(Feature.ForLoop);
        engine.disableFeature(Feature.WhileLoop);
        // 禁止对任意 Java 类/对象做方法反射调用（空白名单 = 全禁），彻底关闭反射逃逸面
        engine.setOption(Options.ALLOWED_CLASS_SET, Collections.<Class<?>>emptySet());
    }

    /**
     * 注册一个自定义函数到引擎（由 {@link FormulaFunctionRegistrar} 在启动时批量调用）。
     * 白名单纯函数：只读数据 + 纯计算，不暴露 Spring 上下文。
     */
    void registerFunction(AviatorFunction function) {
        engine.addFunction(function);
        log.info("已注册 Tier1 公式函数: {}", function.getName());
    }

    /**
     * 求值任意表达式，返回原始结果对象（Long/Double/Boolean/String/…）。
     *
     * @param expr    表达式串（不含 UEL 的 {@code ${}} 包裹，纯表达式）
     * @param context 变量上下文（表单字段/流程变量等）；null 视为空上下文
     * @throws BusinessException 表达式为空、编译失败或求值异常
     */
    public Object eval(String expr, Map<String, Object> context) {
        if (expr == null || expr.isBlank()) {
            throw new BusinessException(400, "表达式为空");
        }
        try {
            Expression compiled = engine.compile(expr, true); // true=编译缓存
            return compiled.execute(context == null ? Collections.emptyMap() : context);
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(400, "表达式求值失败: " + e.getMessage());
        }
    }

    /**
     * 按名调用一个已注册函数（含所有 {@code @FormulaFunction} 扩展函数），实参为已求值的 Java 值。
     * 用于「取人公式」把它不认识的函数名委托到本引擎求值——两套公式（取人 / 计算·条件）由此
     * 共享同一批可扩展函数：业务新增一个 {@code @FormulaFunction} Bean，两处皆可用。
     *
     * <p>实现：把实参放入上下文变量（{@code __arg0..__argN}），拼成 {@code fn(__arg0,...)} 交
     * {@link #eval} 求值——表达式串稳定，复用编译缓存；实参作为变量传入，绝无表达式注入面。
     *
     * @param functionName 函数名（大小写敏感，与 {@code AbstractFunction#getName()} 一致）
     * @param args         已求值实参（Long/Double/Boolean/String/LocalDate/…）
     * @return 函数返回值（原始 Java 对象）
     * @throws BusinessException 函数名为空、函数未注册或求值异常
     */
    public Object callFunction(String functionName, java.util.List<Object> args) {
        if (functionName == null || functionName.isBlank()) {
            throw new BusinessException(400, "函数名为空");
        }
        StringBuilder expr = new StringBuilder(functionName).append('(');
        Map<String, Object> ctx = new java.util.HashMap<>();
        if (args != null) {
            for (int i = 0; i < args.size(); i++) {
                if (i > 0) {
                    expr.append(',');
                }
                String key = "__arg" + i;
                expr.append(key);
                ctx.put(key, args.get(i));
            }
        }
        expr.append(')');
        return eval(expr.toString(), ctx);
    }

    /**
     * 求值并按「真值」语义归约为 boolean（供高级网关条件判定）：
     * Boolean 直用；Number 非 0 为真；String 非空白为真；null 为假；其余非 null 为真。
     */
    public boolean evalBoolean(String expr, Map<String, Object> context) {
        Object v = eval(expr, context);
        if (v instanceof Boolean b) {
            return b;
        }
        if (v instanceof Number n) {
            return n.doubleValue() != 0;
        }
        if (v == null) {
            return false;
        }
        if (v instanceof String s) {
            return !s.isBlank();
        }
        return true;
    }
}

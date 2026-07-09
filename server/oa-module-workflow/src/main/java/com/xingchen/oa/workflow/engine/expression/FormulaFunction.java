package com.xingchen.oa.workflow.engine.expression;

import org.springframework.stereotype.Component;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 标注一个 Tier 1「公式自定义函数」：实现方为 Aviator {@code AbstractFunction}（或 {@code AviatorFunction}）的
 * Spring Bean，由 {@link FormulaFunctionRegistrar} 收集后注册进 {@link ExpressionService} 的求值引擎，
 * 供「表单计算字段」与「工作流高级条件」调用。
 *
 * <p><b>白名单纯函数约束（Tier 1 红线）</b>：被标注的函数应为<b>无副作用的纯函数</b>——
 * 只读组织/字典等数据、做纯计算，<b>不得</b>暴露 {@code ApplicationContext}、不得写库/发消息/改流程变量。
 * 需要调用 Bean、有副作用的复杂逻辑属于 Tier 2 脚本（{@code ScriptService}），不走这里。
 *
 * <p>本注解本身带 {@link Component} 元注解，标注即成为 Spring 组件，无需再叠加 {@code @Component}。
 *
 * @see ExpressionService
 * @see FormulaFunctionRegistrar
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Component
public @interface FormulaFunction {

    /**
     * 可选：函数用途/说明（仅文档用途，实际函数名以 {@code AbstractFunction#getName()} 为准）。
     */
    String value() default "";
}

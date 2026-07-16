package com.hentor.oa.workflow.engine.expression;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.engine.delegate.DelegateExecution;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * 高级网关条件运行时门面，Spring bean 名 {@code exprEval}。
 * {@link GraphToBpmnConverter} 把边上的高级公式 {@code expression} 写成
 * {@code ${exprEval.evalBoolean(execution, '<转义后的expr>')}} 作为 conditionExpression，
 * Flowable 在排它/包容网关求值出边时回调本 bean：取 execution 全部流程变量作上下文，
 * 交 {@link ExpressionService}（Aviator 沙箱 + 注册函数）求值。
 *
 * <p><b>红线</b>：结构化 {@code condition} 仍走 {@code ConditionCompiler}→UEL 原生路径，不经此 bean；
 * 只有「高级公式」边条件走这里（附录 C.4：二源互斥）。
 */
@Slf4j
@Component("exprEval")
@RequiredArgsConstructor
public class ExprEval {

    private final ExpressionService expressionService;

    /** 取 execution 变量作上下文，求值表达式（原始结果对象）。 */
    public Object eval(DelegateExecution execution, String expr) {
        return expressionService.eval(expr, contextOf(execution));
    }

    /** 取 execution 变量作上下文，求值为 boolean——网关出边条件判定入口。 */
    public boolean evalBoolean(DelegateExecution execution, String expr) {
        return expressionService.evalBoolean(expr, contextOf(execution));
    }

    private Map<String, Object> contextOf(DelegateExecution execution) {
        if (execution == null) {
            return new HashMap<>();
        }
        // 复制一份可变 map（Aviator 求值需要 Map<String,Object>，避免直接改动引擎变量视图）
        Map<String, Object> vars = execution.getVariables();
        return vars == null ? new HashMap<>() : new HashMap<>(vars);
    }
}

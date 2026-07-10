package com.xingchen.oa.workflow.engine;

import com.xingchen.oa.common.exception.BusinessException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 内置示例自定义监听器（{@link WfEventHandler}）：<b>预算超限拦截</b>——证明自定义监听器 + 阻断办理可用。
 *
 * <p>用法：审批节点配置事件 {@code {trigger:"TASK_BEFORE_COMPLETE", action:"DELEGATE", blocking:true,
 * delegate:{bean:"demoBudgetGuard"}}}。办理（approve）时读流程变量/表单字段 {@code budget}（预算金额），
 * 超过上限（默认 10000，可由事件配置 {@code delegate.limit} 覆盖）即抛 {@link BusinessException} →
 * 阻断场景异常原样上抛 → completeTask 事务回滚 → approve 端点返回 400「预算超限…」、任务仍在。
 *
 * <p>非阻断（{@code blocking=false}）配置下同样抛异常，但被 {@code wfEventDelegate.safeDispatch} 兜底吞掉，
 * 仅记日志，不打断办理——演示两种语义差异。生产自定义监听器同样以 bean 名注册即可被引用。
 */
@Slf4j
@Component("demoBudgetGuard")
public class DemoBudgetGuard implements WfEventHandler {

    private static final double DEFAULT_LIMIT = 10000d;

    @Override
    public void handle(WfEventContext ctx) {
        double limit = ctx.getConfig() != null && ctx.getConfig().path("delegate").has("limit")
                ? ctx.getConfig().path("delegate").path("limit").asDouble(DEFAULT_LIMIT)
                : DEFAULT_LIMIT;
        Object raw = ctx.getVars().containsKey("budget") ? ctx.getVars().get("budget") : ctx.getForm().get("budget");
        double budget = toDouble(raw);
        log.info("demoBudgetGuard 校验预算 pid={} budget={} limit={} blocking={}",
                ctx.getProcInstId(), budget, limit, ctx.isBlocking());
        if (budget > limit) {
            throw new BusinessException(400, "预算超限：申请金额 " + budget + " 元 超过上限 " + limit + " 元");
        }
    }

    private double toDouble(Object v) {
        if (v == null) {
            return 0d;
        }
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        try {
            return Double.parseDouble(v.toString().trim());
        } catch (NumberFormatException e) {
            return 0d;
        }
    }
}

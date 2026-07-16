package com.hentor.oa.workflow.engine.ai;

import java.util.Map;

/**
 * AI 审批 SPI（P3）：给定模型/系统提示词/表单上下文，产出审批决策。
 * 默认实现走 OpenAI 兼容 / Claude API（读 {@code oa.ai.*}）；无 key 时降级规则模拟。
 * 替换实现只需注册一个更高优先级的同类型 bean。
 */
public interface AiApprovalProvider {

    /**
     * @param model        节点指定模型（可空，回退全局配置）
     * @param systemPrompt 系统提示词（可空）
     * @param context      表单上下文字段值（formContext 指定的字段）
     * @return 审批决策
     */
    AiDecision decide(String model, String systemPrompt, Map<String, Object> context);

    /** AI 决策结果。decision=APPROVE|REJECT|ROUTE；simulated=true 表示规则模拟（非真实模型）。 */
    record AiDecision(String decision, String comment, boolean simulated) {
    }
}

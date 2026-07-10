package com.xingchen.oa.workflow.engine.expression;

/**
 * 公式函数元数据，供前端两个编辑器（取人公式设计器 / 计算公式设计器）动态渲染函数面板。
 *
 * @param name        函数名（如 {@code workDays}、{@code ROLE}）
 * @param signature   调用签名（如 {@code workDays(start, end)}、{@code ROLE("角色名")}）
 * @param category    分类：{@code ASSIGNEE}(取人) / {@code LOGIC}(逻辑) / {@code COMPARE}(比较) /
 *                    {@code VALUE}(操作数) / {@code CUSTOM}(后端 {@code @FormulaFunction} 扩展)
 * @param description 用途说明
 */
public record FnMeta(String name, String signature, String category, String description) {
}

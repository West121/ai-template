package com.xingchen.oa.common.ai;

/**
 * 受控管理操作的种类（AI 助手·受控管理操作框架，docs/design/ai-managed-actions.md §1）。
 * 批 M1 仅放开常用增改，不含删除/改权限等高危动作。
 *
 * <ul>
 *   <li>{@link #CREATE} —— 新增：handler 方法签名 {@code Result method(RequestDTO)}；</li>
 *   <li>{@link #UPDATE} —— 编辑：handler 方法签名 {@code Result method(Long id, RequestDTO)}，
 *       并可提供 updateLoader 按 id 载入现值预填表单。</li>
 * </ul>
 */
public enum ManagedActionKind {
    CREATE,
    UPDATE
}

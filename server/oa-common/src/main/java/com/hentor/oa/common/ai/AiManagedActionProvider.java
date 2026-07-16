package com.hentor.oa.common.ai;

import java.util.List;

/**
 * 受控管理操作提供方（AI 助手·受控管理操作框架，docs/design/ai-managed-actions.md §1）。
 *
 * <p>任何业务模块只要注册一个实现本接口的 Spring bean，返回其 {@link AiManagedAction} 描述符列表，
 * AI 侧就会在启动时自动收集 → 三个通用管理工具立即对有权用户可用，<b>不需改 AI 核心</b>。
 *
 * <p>依赖方向：本接口在 oa-common，业务模块实现它只依赖 common，不反向依赖 boot。批 M1 的组织人事
 * 操作由 boot 侧 provider 集中声明（保持 system 模块零 AI 依赖）；后续模块可自带 provider 自注册。
 */
public interface AiManagedActionProvider {

    /** 本模块对外开放给 AI 助手的受控管理操作描述符（可空列表）。 */
    List<AiManagedAction> managedActions();
}

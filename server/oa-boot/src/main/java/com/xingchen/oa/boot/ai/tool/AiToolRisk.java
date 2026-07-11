package com.xingchen.oa.boot.ai.tool;

/**
 * 工具风险等级（ai-assistant-design-v2.md §6.2/§7.1）。
 * <ul>
 *   <li>READ_ONLY — 查询/介绍/报表：Agent 可自动调用；</li>
 *   <li>EXPLICIT_UI_SUBMIT — 产表单卡，用户在 UI 填写提交即视为明确授权（提交走既有 API 不经 LLM）；</li>
 *   <li>CONFIRM_REQUIRED — 产确认卡 + ai_action_draft 状态机，确认后才执行；</li>
 *   <li>PROHIBITED — 不向 AI 开放（Resolver 不暴露、Gateway 拒执行）。</li>
 * </ul>
 */
public enum AiToolRisk {
    READ_ONLY,
    EXPLICIT_UI_SUBMIT,
    CONFIRM_REQUIRED,
    PROHIBITED
}

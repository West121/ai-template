/**
 * AI 写作辅助 动作定义 + 演示文本生成（纯函数，可单测）。对齐 §3.2。
 * 六动作：续写/润色/总结/生成大纲/纠错/翻译。needsSelection=需选中文本；replace=接受时替换选区（否则插入）。
 * buildAssistText 仅供 mock 流式；真实由后端 LLM 生成。
 */
export type AssistAction = "continue" | "polish" | "summarize" | "outline" | "proofread" | "translate"

export interface AssistActionMeta {
  key: AssistAction
  label: string
  /** 需先选中文本 */
  needsSelection: boolean
  /** 接受时替换选区（false=插入光标/文末） */
  replace: boolean
}

export const ASSIST_ACTIONS: AssistActionMeta[] = [
  { key: "continue", label: "续写", needsSelection: false, replace: false },
  { key: "polish", label: "润色", needsSelection: true, replace: true },
  { key: "proofread", label: "纠错", needsSelection: true, replace: true },
  { key: "translate", label: "翻译", needsSelection: true, replace: true },
  { key: "summarize", label: "总结", needsSelection: false, replace: false },
  { key: "outline", label: "生成大纲", needsSelection: false, replace: false },
]

export function assistLabel(action: AssistAction): string {
  return ASSIST_ACTIONS.find((a) => a.key === action)?.label ?? action
}
export function isReplaceAction(action: AssistAction): boolean {
  return ASSIST_ACTIONS.find((a) => a.key === action)?.replace ?? false
}

/** 演示生成文本（mock 流式用）。真实端点由后端 LLM 产出。 */
export function buildAssistText(action: AssistAction, selected = "", context = ""): string {
  const base = (selected || context || "").trim()
  switch (action) {
    case "continue":
      return "在此基础上，还应明确落地节奏与责任分工：先定验收标准，再排里程碑，并为每一步预留回滚预案，确保推进过程可控、可度量。"
    case "polish":
      return base ? `为使表述更严谨流畅，建议调整为：「${base}」——已优化用词与语序，逻辑更清晰。` : "（请先选中需要润色的文字）"
    case "summarize":
      return "本段要点：\n1. 核心结论先行，突出关键信息；\n2. 以论据与数据支撑结论；\n3. 给出可执行的下一步建议。"
    case "outline":
      return "一、背景与目标\n二、现状与问题\n三、方案要点\n四、实施步骤\n五、风险与对策"
    case "proofread":
      return base ? `校对结果：「${base}」——已修正错别字、标点与病句，语义保持不变。` : "（请先选中需要纠错的文字）"
    case "translate":
      return base ? `Translation:\n${base}\n\n(译文由 AI 生成，供参考)` : "（请先选中需要翻译的文字）"
    default:
      return ""
  }
}

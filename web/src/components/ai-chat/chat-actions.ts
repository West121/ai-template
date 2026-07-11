/**
 * 消息流动作上下文（V2 批C）：深层卡片（图表下钻等）向消息流追加助手消息。
 * assistant.tsx 提供实现；面板外/未提供时为 null（调用方降级提示）。
 */
import { createContext, useContext } from "react"
import type { AiMessagePart } from "./protocol"

export interface AiChatActions {
  /** 追加一条助手消息（content 可空 + parts） */
  appendAssistantParts: (content: string, parts: AiMessagePart[]) => void
}

export const AiChatActionsContext = createContext<AiChatActions | null>(null)

export function useAiChatActions(): AiChatActions | null {
  return useContext(AiChatActionsContext)
}

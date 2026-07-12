/**
 * 知识库实时协同（批4b，§10）：Yjs + y-websocket + TipTap Collaboration/CollaborationCaret。
 * 连 `ws(s)://<host>/ws/kb/doc/{docId}?token=<JWT>`（后端纯 relay）。握手非 101（401/403/404）或连不上
 * → 降级单人编辑（红线：CRDT 是增强不是唯一路径，连不上不白屏、仍可编辑）。
 * 依赖（yjs/y-websocket/collab 扩展）只在本文件静态引入 → 随知识库懒加载分片，不进主包。
 */
import { useEffect, useState } from "react"
import type { AnyExtension } from "@tiptap/core"
import * as Y from "yjs"
import { WebsocketProvider } from "y-websocket"
import { Collaboration } from "@tiptap/extension-collaboration"
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret"
import { useAuthStore } from "@/stores/auth-store"

export type KbCollabStatus = "connecting" | "connected" | "degraded"
export interface KbOnlineUser {
  clientId: number
  name: string
  color: string
}

const COLORS = ["#f97316", "#0ea5e9", "#8b5cf6", "#10b981", "#ef4444", "#eab308", "#ec4899", "#14b8a6"]
/** 稳定取色（同一 seed 恒定颜色） */
export function pickCollabColor(seed: number): string {
  return COLORS[Math.abs(Math.trunc(seed)) % COLORS.length]
}
/** 协同 WS 基址（provider 追加 /{docId}）：同源 + ws/wss */
export function kbWsBase(loc: { protocol: string; host: string } = window.location): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${loc.host}/ws/kb/doc`
}

export interface UseKbCollab {
  status: KbCollabStatus
  users: KbOnlineUser[]
  /** 协同扩展（connected 时非空），注入 RichTextEditor 的 collaboration.extensions */
  extensions: AnyExtension[] | null
}

/**
 * @param docId 目标文档（null / 非 DOC → 不连）
 * @param enabled 仅 EDITOR/ADMIN 且要协同时 true；false → 直接 degraded（单人）
 */
export function useKbCollab(docId: number | null, enabled: boolean, timeoutMs = 3500): UseKbCollab {
  const [status, setStatus] = useState<KbCollabStatus>("connecting")
  const [users, setUsers] = useState<KbOnlineUser[]>([])
  const [extensions, setExtensions] = useState<AnyExtension[] | null>(null)

  useEffect(() => {
    setExtensions(null)
    setUsers([])
    const { token, user, userId } = useAuthStore.getState()

    // 不具备协同条件（禁用 / 无文档 / 无 token / 环境无 WebSocket）→ 直接降级单人
    if (!enabled || docId == null || !token || typeof WebSocket === "undefined") {
      setStatus("degraded")
      return
    }

    setStatus("connecting")
    const name = user?.name ?? "我"
    const color = pickCollabColor(userId ?? name.length)

    const ydoc = new Y.Doc()
    let provider: WebsocketProvider
    try {
      provider = new WebsocketProvider(kbWsBase(), String(docId), ydoc, { params: { token } })
    } catch {
      setStatus("degraded")
      ydoc.destroy()
      return
    }

    let cancelled = false // 本轮 effect 失效标志（cleanup 置真，闭包回调据此忽略）
    let settled = false
    const degrade = () => {
      if (cancelled || settled) return
      settled = true
      window.clearTimeout(timer)
      setStatus("degraded")
      provider.disconnect() // 停止无限重连打扰
    }
    const timer = window.setTimeout(degrade, timeoutMs)

    // awareness：本地用户 + 在线名单
    provider.awareness.setLocalStateField("user", { name, color })
    const onAwareness = () => {
      if (cancelled) return
      const list: KbOnlineUser[] = []
      provider.awareness.getStates().forEach((s, clientId) => {
        const u = (s as { user?: { name?: string; color?: string } }).user
        list.push({ clientId, name: u?.name ?? "匿名", color: u?.color ?? "#888" })
      })
      setUsers(list)
    }
    provider.awareness.on("change", onAwareness)

    const onSync = (isSynced: boolean) => {
      if (!isSynced || cancelled || settled) return
      settled = true
      window.clearTimeout(timer)
      setExtensions([
        Collaboration.configure({ document: ydoc }),
        CollaborationCaret.configure({ provider, user: { name, color } }),
      ])
      setStatus("connected")
      onAwareness()
    }
    provider.on("sync", onSync)
    provider.on("connection-close", degrade)
    provider.on("connection-error", degrade)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      provider.awareness.off("change", onAwareness)
      provider.off("sync", onSync)
      provider.off("connection-close", degrade)
      provider.off("connection-error", degrade)
      provider.destroy()
      ydoc.destroy()
    }
  }, [docId, enabled, timeoutMs])

  return { status, users, extensions }
}

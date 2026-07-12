/**
 * list 卡（§3.4 结构化列表：待办/公文等）。
 * 窄面板用「堆叠行」：首列作主标题（可带行级 link），其余列 label·value 次级信息。
 * V2 批C：datasetId + page → **卡内分页**（GET /api/ai/datasets/{id}?pageNum=）；
 * moreFeatureCode 经 Registry 受控导航（旧 moreLink 兼容）。
 */
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, ChevronLeft, ChevronRight, ListChecks, Loader2, Pencil, Plus, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { fetchDataset } from "../api"
import { useAiChatActions } from "../chat-actions"
import { parseAiSummary, resolveFeaturePath, ulid, type AiMessagePart } from "../protocol"
import type { AiListCard, AiListRow, AiManageActionItem } from "../types"
import { AiSummaryBlock } from "./ai-summary"

/**
 * 管理操作快捷入口（管理框架M1）：manage_list_actions 卡 → 一排可点 chip；
 * 点击 → POST /api/ai/manage/prepare {actionCode} → 拿回 manage_form 卡 → appendAssistantParts 挂进对话
 * （与 LLM 驱动出的 manage_form 卡走同一 ManageFormPart 渲染）。权限后端已按 requiredAuthority 过滤，
 * 前端只渲染返回的（不造白名单）。空/非数组不渲染；prepare 失败 toast，不白屏。
 */
function ManageActionsCard({ title, actions }: { title: string; actions: AiManageActionItem[] }) {
  const chatActions = useAiChatActions()
  const [busy, setBusy] = useState<string | null>(null)
  const list = Array.isArray(actions) ? actions.filter((a) => a && typeof a.actionCode === "string" && a.actionCode) : []
  if (list.length === 0) return null

  const run = (a: AiManageActionItem) => {
    void (async () => {
      setBusy(a.actionCode)
      try {
        const cardPayload = await api<Record<string, unknown>>("/api/ai/manage/prepare", { method: "POST", body: JSON.stringify({ actionCode: a.actionCode }) })
        const part: AiMessagePart = { partId: `pt_${ulid()}`, partType: "manage_form", schemaVersion: 1, sequenceNo: 1, payload: cardPayload }
        if (chatActions) chatActions.appendAssistantParts(`已为你准备「${a.label}」表单，请填写后提交：`, [part])
        else toast.info("请在对话面板内使用该操作")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "准备表单失败")
      } finally {
        setBusy(null)
      }
    })()
  }

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <Sparkles className="size-4 text-primary" />
        <p className="text-sm font-semibold">{title || "我可以帮你做的管理操作"}</p>
      </div>
      <div className="flex flex-wrap gap-1.5 p-3">
        {list.map((a) => {
          const Icon = a.action === "UPDATE" ? Pencil : Plus
          return (
            <button
              key={a.actionCode}
              type="button"
              disabled={busy !== null}
              onClick={() => run(a)}
              title={a.actionCode}
              className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs transition-colors hover:border-primary/40 hover:bg-accent disabled:opacity-50"
            >
              {busy === a.actionCode ? <Loader2 className="size-3 animate-spin" /> : <Icon className="size-3 text-primary" />}
              {a.label}
            </button>
          )
        })}
      </div>
      <p className="px-3.5 pb-2.5 text-[11px] text-muted-foreground">点选直接开始填写，提交后需二次确认才会执行。</p>
    </div>
  )
}

export function ListCard({ card }: { card: AiListCard }) {
  const navigate = useNavigate()
  const primaryKey = card.columns[0]?.key
  // 卡内分页态（数据集）；初始用卡自带 rows/page
  const [rows, setRows] = useState<AiListRow[]>(card.rows)
  const [page, setPage] = useState(card.page ?? null)
  const [loading, setLoading] = useState(false)

  const totalPages = page ? Math.max(1, Math.ceil(page.total / Math.max(1, page.size))) : 1
  const pageable = !!card.datasetId && !!page && page.total > page.size
  // 批E⑨：任一待办项含 AI 摘要 → 顶部标注"AI 生成仅供参考"
  const hasSummary = rows.some((r) => parseAiSummary(r.aiSummary))

  const goPage = async (pageNum: number) => {
    if (!card.datasetId || loading) return
    setLoading(true)
    try {
      const res = await fetchDataset(card.datasetId, pageNum, page?.size ?? 20)
      setRows(res.data.rows as AiListRow[])
      setPage(res.data.page)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }

  const morePath = card.moreLink ?? (card.moreFeatureCode ? resolveFeaturePath(card.moreFeatureCode) : null)

  // 管理框架M1：带 manageActions 的 list 卡 → 专渲染成可点快捷入口 chips（hooks 已全部调用，可安全早返回）
  if (Array.isArray(card.manageActions) && card.manageActions.length > 0) {
    return <ManageActionsCard title={card.title} actions={card.manageActions} />
  }

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <ListChecks className="size-4 text-primary" />
        <p className="text-sm font-semibold">{card.title}</p>
        {hasSummary && <span className="text-[10px] text-muted-foreground">AI 生成仅供参考</span>}
        <span className="ml-auto text-xs text-muted-foreground">{page ? `${page.total} 项` : `${rows.length} 项`}</span>
      </div>

      {rows.length === 0 && !loading ? (
        <div className="px-3.5 py-6 text-center text-xs text-muted-foreground">暂无数据</div>
      ) : (
        <ul className={cn("divide-y", loading && "opacity-50")}>
          {rows.map((row, i) => {
            const summary = parseAiSummary(row.aiSummary)
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={!row.link}
                  onClick={() => row.link && navigate(String(row.link))}
                  className="flex w-full items-start gap-2 px-3.5 py-2.5 text-left enabled:hover:bg-accent/50 disabled:cursor-default"
                >
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", row.link && "text-primary")}>
                      {String(row[primaryKey] ?? "—")}
                    </p>
                    {card.columns.length > 1 && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {card.columns
                          .slice(1)
                          .map((c) => `${c.label} ${String(row[c.key] ?? "—")}`)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  {row.link && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                </button>
                {/* 批E⑨ 该待办项 AI 摘要（行下方，不触发导航） */}
                {summary && (
                  <div className="px-3.5 pb-2.5">
                    <AiSummaryBlock data={summary} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* 卡内分页（数据集） */}
      {pageable && page && (
        <div className="flex items-center justify-between border-t px-3.5 py-1.5">
          <button
            type="button"
            disabled={loading || page.current <= 1}
            onClick={() => void goPage(page.current - 1)}
            className="flex items-center gap-0.5 rounded px-1.5 py-1 text-xs text-primary hover:bg-accent/50 disabled:cursor-default disabled:text-muted-foreground/50"
          >
            <ChevronLeft className="size-3.5" /> 上一页
          </button>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {loading && <Loader2 className="size-3 animate-spin" />}
            {page.current}/{totalPages} 页
          </span>
          <button
            type="button"
            disabled={loading || page.current >= totalPages}
            onClick={() => void goPage(page.current + 1)}
            className="flex items-center gap-0.5 rounded px-1.5 py-1 text-xs text-primary hover:bg-accent/50 disabled:cursor-default disabled:text-muted-foreground/50"
          >
            下一页 <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}

      {morePath && (
        <button
          type="button"
          onClick={() => navigate(morePath)}
          className="flex w-full items-center justify-center gap-1 border-t px-3.5 py-2 text-xs text-primary hover:bg-accent/50"
        >
          查看全部 <ArrowRight className="size-3.5" />
        </button>
      )}
    </div>
  )
}

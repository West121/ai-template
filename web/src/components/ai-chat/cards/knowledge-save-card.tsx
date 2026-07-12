/**
 * 对话固化确认卡（§3.5，批3）：AI 助手 knowledge_save 工具产出——"把这段存进知识库/总结成文档"。
 * 用户选目标空间（下拉可见且可编空间）+ 标题 → 「确认（建草稿）」→ POST /api/ai/actions/{id}/confirm
 * （动作草稿二段式，参数 {spaceId,title} 随体提交）→ 在该空间建一篇 DRAFT 文档。绝不直接发布（草稿+人工确认）。
 * 演示（offline/后端未就绪）：确认成功后本地真的建一篇草稿，跳转可见。防白屏：payload 兜底、空间空态。
 */
import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CheckCircle2, ExternalLink, Library, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cancelActionV2, confirmActionV2 } from "../api"
import { friendlyAiError, ulid, type AiMessagePart } from "../protocol"
import { createDoc, fetchSpaces, saveDocContent } from "@/pages/knowledge/mock"
import { canEdit } from "@/pages/knowledge/permissions"
import { htmlToJson } from "@/pages/knowledge/content-codec"
import type { KbSpace } from "@/pages/knowledge/types"

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function KnowledgeSavePart({ part }: { part: AiMessagePart }) {
  const navigate = useNavigate()
  const p = part.payload
  const actionId = String(p.actionId ?? "")
  const contentPreview = typeof p.contentPreview === "string" ? p.contentPreview : ""
  const [title, setTitle] = useState(typeof p.title === "string" && p.title ? p.title : "未命名知识")
  const [spaces, setSpaces] = useState<KbSpace[]>([])
  const [spaceId, setSpaceId] = useState<number | null>(typeof p.defaultSpaceId === "number" ? p.defaultSpaceId : null)
  const [state, setState] = useState<"idle" | "saving" | "done" | "cancelled" | "error">("idle")
  const [resultLink, setResultLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const idemRef = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchSpaces()
      .then((r) => {
        if (!alive) return
        // 仅能保存到可编辑（EDITOR+）空间
        const editable = (Array.isArray(r.data) ? r.data : []).filter((s) => canEdit(s.myRole ?? null))
        setSpaces(editable)
        setSpaceId((id) => id ?? editable[0]?.id ?? null)
      })
      .catch(() => alive && setSpaces([]))
    return () => {
      alive = false
    }
  }, [])

  const confirm = async () => {
    if (spaceId == null || !title.trim()) return
    if (!idemRef.current) idemRef.current = ulid()
    setState("saving")
    setError(null)
    try {
      const res = await confirmActionV2(actionId, idemRef.current, { spaceId, title: title.trim() })
      const r = res.data
      if (!r.ok) {
        setState("error")
        setError(r.message ?? "保存失败")
        return
      }
      let link = r.resultLink ?? null
      if (res.demo) {
        // 演示：真的在该空间建一篇草稿，跳转可见
        const doc = await createDoc(spaceId, { parentId: null, type: "DOC", title: title.trim() })
        if (doc.data) {
          if (contentPreview) await saveDocContent(doc.data.id, { contentJson: htmlToJson(`<p>${esc(contentPreview)}</p>`), contentText: contentPreview })
          link = `/knowledge/${spaceId}?doc=${doc.data.id}`
        }
      }
      setResultLink(link ?? `/knowledge/${spaceId}`)
      setState("done")
    } catch (err) {
      const text = friendlyAiError(err, "保存失败")
      toast.error(text)
      setState("error")
      setError(text)
    }
  }

  const cancel = () => {
    setState("cancelled")
    void cancelActionV2(actionId).catch(() => undefined)
  }

  const spaceName = spaces.find((s) => s.id === spaceId)?.name

  return (
    <div className="w-full min-w-0 rounded-xl border bg-card p-3.5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Library className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold">存入知识库</p>
        <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">需确认</span>
      </div>

      {contentPreview && (
        <div className="mb-3 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">{contentPreview}</div>
      )}

      {state === "done" ? (
        <div aria-live="polite" className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> 已存为草稿{spaceName ? `到「${spaceName}」` : ""}
          </span>
          {resultLink && (
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => navigate(resultLink)}>
              查看文档 <ExternalLink className="size-3" />
            </Button>
          )}
        </div>
      ) : state === "cancelled" ? (
        <p className="text-xs text-muted-foreground">已取消</p>
      ) : (
        <div className="space-y-2.5">
          <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">目标空间</label>
              <Select value={spaceId != null ? String(spaceId) : ""} onValueChange={(v) => setSpaceId(Number(v))}>
                <SelectTrigger size="sm" className="w-full" aria-label="目标空间">
                  <SelectValue placeholder={spaces.length ? "选择空间" : "无可写空间"} />
                </SelectTrigger>
                <SelectContent>
                  {spaces.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.icon ? `${s.icon} ` : ""}
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">文档标题</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8" aria-label="文档标题" />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" className="h-8" disabled={state === "saving"} onClick={cancel}>
              取消
            </Button>
            <Button size="sm" className="h-8 gap-1.5" disabled={state === "saving" || spaceId == null || !title.trim()} onClick={() => void confirm()}>
              {state === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              确认（建草稿）
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

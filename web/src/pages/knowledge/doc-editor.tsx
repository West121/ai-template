/**
 * 知识库文档编辑区（右）：复用 rich-text（TipTap）—— canEdit 用 RichTextEditor，VIEWER 用 RichTextViewer（只读）。
 * 正文经 content-codec 在 HTML↔TipTap JSON 间互转（后端 contentJson 原样存）。保存自增版本；发布/归档。
 * 协同（CRDT）批4，本批单人编辑。
 */
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Archive, FileText, FolderOpen, Loader2, Save, Send, ShieldAlert } from "lucide-react"
import { ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { RichTextEditor, RichTextViewer, stripHtml } from "@/components/rich-text"
import { fetchDoc, saveDocContent, setDocStatus, updateDoc } from "./mock"
import { jsonToHtml, htmlToJson } from "./content-codec"
import { DOC_STATUS_META, type KbDocDetail } from "./types"

export function DocEditor({ docId, canEdit, onDocChanged }: { docId: number | null; canEdit: boolean; onDocChanged?: () => void }) {
  const [detail, setDetail] = useState<KbDocDetail | null>(null)
  const [html, setHtml] = useState("")
  const [title, setTitle] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<"forbidden" | "notfound" | string | null>(null)

  useEffect(() => {
    if (docId == null) {
      setDetail(null)
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    fetchDoc(docId)
      .then((r) => {
        if (!alive) return
        if (!r.data) {
          setError("notfound")
          setDetail(null)
          return
        }
        setDetail(r.data)
        setTitle(r.data.title)
        setHtml(jsonToHtml(r.data.contentJson))
        setDirty(false)
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (e instanceof ApiError && (e.code === 403 || String(e.message).includes("403"))) setError("forbidden")
        else setError(e instanceof Error ? e.message : "加载失败")
        setDetail(null)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [docId])

  const save = async () => {
    if (!detail) return
    setSaving(true)
    try {
      const r = await saveDocContent(detail.id, { contentJson: htmlToJson(html), contentText: stripHtml(html) })
      if (r.data) setDetail((d) => (d ? { ...d, version: r.data!.version, updatedAt: r.data!.updatedAt, updaterName: r.data!.updaterName } : d))
      setDirty(false)
      toast.success("已保存")
      onDocChanged?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const saveTitle = async () => {
    if (!detail) return
    const t = title.trim()
    if (!t || t === detail.title) {
      setTitle(detail.title)
      return
    }
    try {
      await updateDoc(detail.id, { title: t })
      setDetail((d) => (d ? { ...d, title: t } : d))
      onDocChanged?.()
    } catch {
      toast.error("重命名失败")
      setTitle(detail.title)
    }
  }

  const changeStatus = async (action: "publish" | "archive") => {
    if (!detail) return
    try {
      const r = await setDocStatus(detail.id, action)
      if (r.data) setDetail((d) => (d ? { ...d, status: r.data!.status } : d))
      toast.success(action === "publish" ? "已发布" : "已归档")
      onDocChanged?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败")
    }
  }

  if (docId == null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <FileText className="size-8 opacity-40" />
        选择左侧文档开始阅读或编辑
      </div>
    )
  }
  if (loading) {
    return (
      <div className="space-y-4 p-1">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <ShieldAlert className="size-8 text-rose-500/60" />
        {error === "forbidden" ? "无权访问此文档（不在可见空间或非成员）" : error === "notfound" ? "文档不存在或已删除" : error}
      </div>
    )
  }
  if (!detail) return null

  if (detail.type === "FOLDER") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <FolderOpen className="size-8 text-amber-500/60" />
        「{detail.title}」是一个目录
      </div>
    )
  }

  const statusMeta = DOC_STATUS_META[detail.status]

  return (
    <div className="flex h-full flex-col">
      {/* 文档头：标题 + 状态 + 版本 + 动作 */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
        {canEdit ? (
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur()
            }}
            className="h-9 min-w-0 flex-1 border-transparent px-1 text-lg font-semibold shadow-none hover:border-input focus-visible:border-input"
            aria-label="文档标题"
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate px-1 text-lg font-semibold">{detail.title}</h1>
        )}
        <Badge variant="outline" className={cn("shrink-0", statusMeta?.className)}>
          {statusMeta?.label}
        </Badge>
        <span className="shrink-0 text-xs text-muted-foreground">v{detail.version}</span>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1.5">
            {detail.status !== "PUBLISHED" && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void changeStatus("publish")}>
                <Send className="size-3.5" /> 发布
              </Button>
            )}
            {detail.status !== "ARCHIVED" && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void changeStatus("archive")}>
                <Archive className="size-3.5" /> 归档
              </Button>
            )}
            <Button size="sm" className="gap-1.5" disabled={saving || !dirty} onClick={() => void save()}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {dirty ? "保存" : "已保存"}
            </Button>
          </div>
        )}
      </div>

      {/* 正文 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {canEdit ? (
          <RichTextEditor
            value={html}
            onChange={(next) => {
              setHtml(next)
              setDirty(true)
            }}
            preset="full"
            placeholder="开始编写文档内容…"
            minHeight={360}
          />
        ) : (
          <RichTextViewer html={html} />
        )}
      </div>

      {detail.updaterName && (
        <div className="pt-2 text-xs text-muted-foreground">
          最近编辑 {detail.updaterName}
          {detail.updatedAt ? ` · ${detail.updatedAt.slice(0, 16).replace("T", " ")}` : ""}
        </div>
      )}
    </div>
  )
}

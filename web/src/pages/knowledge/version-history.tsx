/**
 * 版本历史（§2 kb_doc_version，批4a）：右抽屉 → 版本列表 → 查看某版（只读渲染）/ 与当前 diff（行级）/ 回滚。
 * 回滚以该版本正文另存为新版本（不销毁历史），确认后 POST。EDITOR+ 才可回滚，VIEWER 只读看。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Eye, GitCompare, History, Loader2, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { RichTextViewer } from "@/components/rich-text"
import { fetchVersionContent, fetchVersions, rollbackDoc } from "./mock"
import { jsonToHtml } from "./content-codec"
import { buildLineDiff } from "./diff-util"
import type { KbDocVersion, KbVersionContent } from "./types"

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const ops = useMemo(() => buildLineDiff(oldText, newText), [oldText, newText])
  return (
    <div className="space-y-0.5 font-mono text-xs">
      {ops.map((op, i) => (
        <div
          key={i}
          className={cn(
            "whitespace-pre-wrap rounded px-1.5 py-0.5",
            op.type === "add" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
            op.type === "del" && "bg-rose-500/10 text-rose-700 line-through dark:text-rose-400",
            op.type === "same" && "text-muted-foreground",
          )}
        >
          <span className="mr-1.5 select-none opacity-60">{op.type === "add" ? "+" : op.type === "del" ? "−" : " "}</span>
          {op.text || " "}
        </div>
      ))}
    </div>
  )
}

export function VersionHistory({
  docId,
  currentVersion,
  currentText,
  canEdit,
  onRolledBack,
}: {
  docId: number
  currentVersion: number
  currentText: string
  canEdit: boolean
  onRolledBack: () => void
}) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<KbDocVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [content, setContent] = useState<KbVersionContent | null>(null)
  const [mode, setMode] = useState<"view" | "diff">("diff")
  const [rollbackTarget, setRollbackTarget] = useState<number | null>(null)
  const [rolling, setRolling] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetchVersions(docId)
      .then((r) => {
        const v = Array.isArray(r.data) ? r.data : []
        setVersions(v)
        setSelected((s) => s ?? v[0]?.version ?? null)
      })
      .catch(() => setVersions([]))
      .finally(() => setLoading(false))
  }, [docId])
  useEffect(() => {
    if (open) load()
  }, [open, load])

  useEffect(() => {
    if (!open || selected == null) {
      setContent(null)
      return
    }
    let alive = true
    fetchVersionContent(docId, selected)
      .then((r) => alive && setContent(r.data))
      .catch(() => alive && setContent(null))
    return () => {
      alive = false
    }
  }, [open, selected, docId])

  const doRollback = async () => {
    if (rollbackTarget == null) return
    setRolling(true)
    try {
      await rollbackDoc(docId, rollbackTarget)
      toast.success(`已回滚到 v${rollbackTarget}（生成新版本）`)
      setRollbackTarget(null)
      setOpen(false)
      onRolledBack()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "回滚失败")
    } finally {
      setRolling(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <History className="size-3.5" /> 历史版本
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
          <SheetHeader className="border-b">
            <SheetTitle>历史版本</SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* 版本列表 */}
            <div className="w-56 shrink-0 overflow-y-auto border-r p-2">
              {loading ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-4 animate-spin" />
                </div>
              ) : versions.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">暂无历史版本</div>
              ) : (
                versions.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelected(v.version)}
                    className={cn("block w-full rounded-md px-2 py-1.5 text-left hover:bg-accent", selected === v.version && "bg-accent")}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">v{v.version}</span>
                      {v.version === currentVersion && (
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">
                          当前
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {v.editorName ?? "系统"} · {v.createdAt.slice(0, 16).replace("T", " ")}
                    </div>
                    {v.note && <div className="truncate text-[11px] text-muted-foreground">{v.note}</div>}
                  </button>
                ))
              )}
            </div>
            {/* 详情：查看 / 对比 */}
            <div className="flex min-w-0 flex-1 flex-col p-3">
              <div className="mb-2 flex items-center gap-1.5">
                <Button variant={mode === "view" ? "secondary" : "ghost"} size="sm" className="h-7 gap-1.5" onClick={() => setMode("view")}>
                  <Eye className="size-3.5" /> 查看
                </Button>
                <Button variant={mode === "diff" ? "secondary" : "ghost"} size="sm" className="h-7 gap-1.5" onClick={() => setMode("diff")}>
                  <GitCompare className="size-3.5" /> 对比当前
                </Button>
                {canEdit && selected != null && selected !== currentVersion && (
                  <Button variant="outline" size="sm" className="ml-auto h-7 gap-1.5" onClick={() => setRollbackTarget(selected)}>
                    <RotateCcw className="size-3.5" /> 回滚到此版本
                  </Button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-3">
                {!content ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">选择左侧版本查看</div>
                ) : mode === "view" ? (
                  <RichTextViewer html={jsonToHtml(content.contentJson)} />
                ) : (
                  <DiffView oldText={content.contentText} newText={currentText} />
                )}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={rollbackTarget != null} onOpenChange={(o) => !o && setRollbackTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>回滚到 v{rollbackTarget}？</AlertDialogTitle>
            <AlertDialogDescription>将以该版本的正文生成一个新版本（当前内容仍保留在历史中，可再次回滚）。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction disabled={rolling} onClick={() => void doRollback()}>
              {rolling ? "回滚中…" : "确认回滚"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

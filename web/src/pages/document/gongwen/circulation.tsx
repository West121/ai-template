/**
 * 传阅单：发起传阅（勾选传阅人）+ 已阅状态回执 + 催办。
 *
 * 传阅人选择在真实后端应接用户选择器（/api/system/users）；后端未就绪时用内置演示花名册。
 * 已阅回执 markRead、催办 urge 走 gongwen/mock.ts API 层。
 */
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { BellRing, Check, CircleDashed, Send, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { circulate, markRead, urge } from "./mock"
import { gwFormatTime, type GwCirculation, type GwDoc } from "./types"

/** 演示花名册（真实环境应替换为用户选择器） */
const DEMO_ROSTER = [
  { id: 11, name: "张伟" },
  { id: 12, name: "刘洋" },
  { id: 13, name: "孙丽" },
  { id: 14, name: "陈晨" },
  { id: 15, name: "赵强" },
  { id: 16, name: "周敏" },
]

export function CirculationPanel({
  doc,
  onUpdated,
}: {
  doc: GwDoc
  onUpdated: (doc: GwDoc) => void
}) {
  const circulations = useMemo(() => doc.circulations ?? [], [doc.circulations])
  const pendingCount = circulations.filter((c) => c.status === "PENDING").length
  const readCount = circulations.length - pendingCount

  const [addOpen, setAddOpen] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [readTarget, setReadTarget] = useState<GwCirculation | null>(null)
  const [readOpinion, setReadOpinion] = useState("")
  const [busy, setBusy] = useState(false)

  const existingIds = new Set(circulations.map((c) => c.readerId))
  const roster = DEMO_ROSTER.filter((r) => !existingIds.has(r.id))

  const doCirculate = async () => {
    if (picked.length === 0) {
      toast.warning("请勾选传阅人")
      return
    }
    setBusy(true)
    try {
      const readers = DEMO_ROSTER.filter((r) => picked.includes(r.id))
      const res = await circulate(doc, readers)
      onUpdated(res.data)
      toast.success(`已发起传阅，${readers.length} 人`)
      setAddOpen(false)
      setPicked([])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发起传阅失败")
    } finally {
      setBusy(false)
    }
  }

  const doRead = async () => {
    if (!readTarget) return
    setBusy(true)
    try {
      const res = await markRead(doc, readTarget.id, readOpinion.trim() || undefined)
      onUpdated(res.data)
      toast.success("已回执")
      setReadTarget(null)
      setReadOpinion("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "回执失败")
    } finally {
      setBusy(false)
    }
  }

  const doUrge = async () => {
    setBusy(true)
    try {
      const res = await urge(doc)
      toast.success(res.data.notified > 0 ? `已向 ${res.data.notified} 位未阅传阅人发送催办` : "暂无未阅传阅人")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "催办失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          传阅 {circulations.length} 人 · 已阅 <span className="text-emerald-600">{readCount}</span> · 未阅{" "}
          <span className="text-amber-600">{pendingCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {pendingCount > 0 && (
            <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => void doUrge()} disabled={busy}>
              <BellRing className="size-3.5" /> 催办
            </Button>
          )}
          <Button size="sm" className="h-7 gap-1.5" onClick={() => setAddOpen(true)}>
            <UserPlus className="size-3.5" /> 发起传阅
          </Button>
        </div>
      </div>

      {circulations.length === 0 ? (
        <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
          暂无传阅记录，点击「发起传阅」勾选传阅人
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {circulations.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
              {c.status === "READ" ? (
                <Check className="size-4 shrink-0 text-emerald-600" />
              ) : (
                <CircleDashed className="size-4 shrink-0 text-amber-500" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.readerName}</span>
                  {c.status === "READ" ? (
                    <Badge variant="outline" className="h-5 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[11px] text-emerald-600">
                      已阅
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="h-5 border-amber-500/30 bg-amber-500/10 px-1.5 text-[11px] text-amber-600">
                      未阅
                    </Badge>
                  )}
                  {c.readAt && <span className="text-[11px] text-muted-foreground">{gwFormatTime(c.readAt)}</span>}
                </div>
                {c.opinion && <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.opinion}</div>}
              </div>
              {c.status === "PENDING" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-primary"
                  onClick={() => {
                    setReadTarget(c)
                    setReadOpinion("")
                  }}
                >
                  标记已阅
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 发起传阅：勾选传阅人 */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && !busy && setAddOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>发起传阅</DialogTitle>
            <DialogDescription>勾选传阅人，被选人将收到传阅待办并回执已阅状态</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-1 overflow-y-auto py-1">
            {roster.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">花名册中的同事均已在传阅列表</div>
            ) : (
              roster.map((r) => {
                const checked = picked.includes(r.id)
                return (
                  <label
                    key={r.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-accent",
                      checked && "bg-accent",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setPicked((prev) => (v ? [...prev, r.id] : prev.filter((x) => x !== r.id)))
                      }
                    />
                    <span className="text-sm">{r.name}</span>
                  </label>
                )
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button className="gap-1.5" onClick={() => void doCirculate()} disabled={busy || picked.length === 0}>
              <Send className="size-3.5" /> 发起（{picked.length}）
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 已阅回执 */}
      <Dialog open={readTarget !== null} onOpenChange={(o) => !o && !busy && setReadTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>已阅回执</DialogTitle>
            <DialogDescription>{readTarget?.readerName} · 可填写传阅意见（选填）</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="read-opinion">传阅意见</Label>
            <Textarea
              id="read-opinion"
              value={readOpinion}
              onChange={(e) => setReadOpinion(e.target.value)}
              rows={3}
              placeholder="选填，如：已阅悉。"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReadTarget(null)} disabled={busy}>
              取消
            </Button>
            <Button className="gap-1.5" onClick={() => void doRead()} disabled={busy}>
              <Check className="size-3.5" /> 确认已阅
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

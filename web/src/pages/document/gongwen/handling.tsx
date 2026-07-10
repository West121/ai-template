/**
 * 办理时间线 + 办文动作条（复用审批交互：同意 / 退回 / 转办 / 签发 / 用印 / 归档）。
 *
 * 动作按当前环节 currentTask + 方向 + 状态派生，并用 hasPerm 门控（离线 permissions=null 视为全部允许）。
 * 所有动作走 gongwen/mock.ts 的 API 层（后端就绪走真实 /api/office/doc，未就绪落 mock）。
 */
import { useState } from "react"
import { toast } from "sonner"
import { Check, RotateCcw, Send, Share2, Stamp, Archive, FileSignature } from "lucide-react"
import { cn } from "@/lib/utils"
import { useHasPerm } from "@/stores/auth-store"
import { Button } from "@/components/ui/button"
import { RichTextEditor, RichTextViewer } from "@/components/rich-text"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { archiveDoc, sealDoc, signIssue, submitOpinion } from "./mock"
import { DECISION_META, gwFormatTime, type GwDoc, type GwOpinion } from "./types"

/* ============================ 办理时间线 ============================ */

export function OpinionTimeline({
  items,
  current,
}: {
  items: GwOpinion[]
  /** 正在办理的环节（未终态时传入）：时间线末尾追加「办理中」条目 */
  current?: { node: string; assignee?: string }
}) {
  if ((!items || items.length === 0) && !current) {
    return <div className="py-6 text-center text-sm text-muted-foreground">暂无办理记录</div>
  }
  return (
    <div className="space-y-0 py-1">
      {items.map((item, index) => {
        const meta = DECISION_META[item.decision] ?? { label: item.decision, dot: "bg-muted-foreground/30" }
        return (
          <div
            key={item.id ?? index}
            className={cn("relative flex gap-3", index === items.length - 1 && !current ? "pb-0" : "pb-6")}
          >
            {(index < items.length - 1 || current) && (
              <div className="absolute left-[5px] top-4 h-full w-px bg-border" />
            )}
            <div className={cn("mt-1 size-[11px] shrink-0 rounded-full", meta.dot)} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{meta.label}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {item.taskKey}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {item.userName} · {gwFormatTime(item.createdAt)}
              </div>
              {item.opinion && (
                <div className="mt-1 rounded bg-muted/60 px-2 py-1">
                  {/* 意见可能是富文本 HTML（升级后）或存量纯文本，统一走 Viewer（内部 sanitize） */}
                  <RichTextViewer html={item.opinion} className="text-xs leading-relaxed" />
                </div>
              )}
            </div>
          </div>
        )
      })}
      {/* 正在办理的环节（脉冲蓝点 + 环节名 + 当前办理人） */}
      {current && (
        <div className="relative flex gap-3">
          <span className="relative mt-1 flex size-[11px] shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50" />
            <span className="relative inline-flex size-[11px] rounded-full bg-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-primary">办理中</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{current.node}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              当前办理人：{current.assignee ?? "按规则运行时确定"}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ============================ 办文动作条 ============================ */

type DecisionMode = "AGREE" | "REJECT" | "TRANSFER" | "SUBMIT" | "SIGN" | "SEAL"

interface DialogState {
  mode: DecisionMode
  title: string
}

export function OpinionActionBar({
  doc,
  onUpdated,
  onArchived,
}: {
  doc: GwDoc
  onUpdated: (doc: GwDoc) => void
  /** 归档后回调（列表页可据此移除/刷新） */
  onArchived?: (doc: GwDoc) => void
}) {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [opinion, setOpinion] = useState("")
  const [transferTo, setTransferTo] = useState("")
  const [busy, setBusy] = useState(false)

  const isSend = doc.direction === "SEND"
  const task = doc.currentTask ?? ""

  const canSend = useHasPerm("office:doc:send")
  const canReview = useHasPerm("office:doc:review")
  const canIssue = useHasPerm("office:doc:issue")
  const canSeal = useHasPerm("office:doc:seal")
  const canAssign = useHasPerm("office:doc:assign")
  const canArchive = useHasPerm("office:doc:archive")

  const open = (mode: DecisionMode, title: string) => {
    setOpinion("")
    setTransferTo("")
    setDialog({ mode, title })
  }

  const submit = async () => {
    if (!dialog) return
    if (dialog.mode === "TRANSFER" && !transferTo.trim()) {
      toast.warning("请填写转办对象")
      return
    }
    setBusy(true)
    try {
      let res
      if (dialog.mode === "SIGN") res = await signIssue(doc, opinion)
      else if (dialog.mode === "SEAL") res = await sealDoc(doc, opinion)
      else
        res = await submitOpinion(doc, {
          decision: dialog.mode === "SUBMIT" ? "AGREE" : dialog.mode,
          opinion,
          transferTo: transferTo.trim() || undefined,
        })
      onUpdated(res.data)
      toast.success(
        dialog.mode === "SIGN"
          ? `已签发，文号 ${res.data.code}`
          : dialog.mode === "SEAL"
            ? "已用印"
            : dialog.mode === "REJECT"
              ? "已退回"
              : dialog.mode === "TRANSFER"
                ? "已转办"
                : "已提交",
      )
      setDialog(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }

  const doArchive = async () => {
    setBusy(true)
    try {
      const res = await archiveDoc(doc)
      onUpdated(res.data)
      onArchived?.(res.data)
      toast.success(`已归档，卷宗号 ${res.data.archiveNo}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "归档失败")
    } finally {
      setBusy(false)
    }
  }

  /* ---- 按环节派生按钮 ---- */
  const buttons: React.ReactNode[] = []
  const agreeReject = (perm: boolean, agreeLabel: string) => {
    if (!perm) return
    buttons.push(
      <Button key="agree" size="sm" className="gap-1.5" onClick={() => open("AGREE", agreeLabel)}>
        <Check className="size-3.5" /> {agreeLabel}
      </Button>,
      <Button key="reject" size="sm" variant="outline" className="gap-1.5" onClick={() => open("REJECT", "退回")}>
        <RotateCcw className="size-3.5" /> 退回
      </Button>,
      <Button key="transfer" size="sm" variant="outline" className="gap-1.5" onClick={() => open("TRANSFER", "转办")}>
        <Share2 className="size-3.5" /> 转办
      </Button>,
    )
  }

  if (doc.archived || doc.status === "ARCHIVED") {
    // 已归档：无动作
  } else if (isSend) {
    if (task === "拟稿" || doc.status === "DRAFT") {
      if (canSend)
        buttons.push(
          <Button key="submit" size="sm" className="gap-1.5" onClick={() => open("SUBMIT", "提交核稿")}>
            <Send className="size-3.5" /> 提交核稿
          </Button>,
        )
    } else if (task === "核稿" || task === "会签") {
      agreeReject(canReview, "同意")
    } else if (task === "签发") {
      if (canIssue)
        buttons.push(
          <Button key="sign" size="sm" className="gap-1.5" onClick={() => open("SIGN", "签发")}>
            <FileSignature className="size-3.5" /> 签发
          </Button>,
          <Button key="reject" size="sm" variant="outline" className="gap-1.5" onClick={() => open("REJECT", "退回")}>
            <RotateCcw className="size-3.5" /> 退回
          </Button>,
        )
    } else if (task === "用印") {
      if (canSeal)
        buttons.push(
          <Button key="seal" size="sm" className="gap-1.5" onClick={() => open("SEAL", "用印")}>
            <Stamp className="size-3.5" /> 用印
          </Button>,
        )
    } else if (task === "分发") {
      if (canIssue)
        buttons.push(
          <Button key="publish" size="sm" className="gap-1.5" onClick={() => open("SUBMIT", "成文分发")}>
            <Send className="size-3.5" /> 成文分发
          </Button>,
        )
    }
    if ((doc.status === "PUBLISHED" || task === "办结") && !doc.archived && canArchive) {
      buttons.push(
        <Button key="archive" size="sm" variant="outline" className="gap-1.5" onClick={() => void doArchive()} disabled={busy}>
          <Archive className="size-3.5" /> 归档
        </Button>,
      )
    }
  } else {
    // 收文
    if (task === "拟办") {
      if (canAssign)
        buttons.push(
          <Button key="submit" size="sm" className="gap-1.5" onClick={() => open("SUBMIT", "提交拟办意见")}>
            <Send className="size-3.5" /> 提交拟办
          </Button>,
        )
    } else if (task === "批办") {
      agreeReject(canAssign, "同意")
    } else if (task === "承办") {
      if (canAssign)
        buttons.push(
          <Button key="submit" size="sm" className="gap-1.5" onClick={() => open("SUBMIT", "提交承办")}>
            <Send className="size-3.5" /> 提交承办
          </Button>,
        )
    } else if (task === "传阅") {
      if (canAssign)
        buttons.push(
          <Button key="finish" size="sm" className="gap-1.5" onClick={() => open("SUBMIT", "办结")}>
            <Check className="size-3.5" /> 办结
          </Button>,
        )
    }
    if ((doc.status === "FINISHED" || task === "归档") && !doc.archived && canArchive) {
      buttons.push(
        <Button key="archive" size="sm" variant="outline" className="gap-1.5" onClick={() => void doArchive()} disabled={busy}>
          <Archive className="size-3.5" /> 归档
        </Button>,
      )
    }
  }

  if (buttons.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">{buttons}</div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && !busy && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog?.title}</DialogTitle>
            <DialogDescription className="truncate">{doc.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {dialog?.mode === "TRANSFER" && (
              <div className="space-y-1.5">
                <Label htmlFor="transfer-to">转办对象</Label>
                <Input
                  id="transfer-to"
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  placeholder="输入转办的承办人姓名"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>办理意见</Label>
              {/* 富文本意见（契约 §4）：minimal 档 + 2000 字上限；空文档由编辑器归一为 "" */}
              <RichTextEditor
                preset="minimal"
                maxLength={2000}
                minHeight={96}
                maxHeight={240}
                value={opinion}
                onChange={setOpinion}
                placeholder={
                  dialog?.mode === "REJECT"
                    ? "请填写退回理由…"
                    : dialog?.mode === "SIGN"
                      ? "签发意见（如：同意发文）…"
                      : "请输入办理意见…"
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              取消
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? "提交中…" : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

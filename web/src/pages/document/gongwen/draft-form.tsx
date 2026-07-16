/**
 * 拟稿单（发文）/ 登记单（收文）—— 起草并提交起流程（gw_send / gw_recv）。
 *
 * 发文：文种/密级/紧急/发文机关/主送/抄送/正文富文本/附件/附注/份号。
 * 收文：来文单位/来文字号/文种/密级/紧急/标题/正文/附件。
 * 提交走 createDoc()（后端就绪 → /send/draft | /recv/register，未就绪 → mock）。
 */
import { useState } from "react"
import { toast } from "sonner"
import { Paperclip, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Drawer } from "@/components/drawer"
import { cn } from "@/lib/utils"
import { RichTextEditor } from "@/components/rich-text"
import { createDoc, type GwDraftPayload } from "./mock"
import { DOC_TYPES, type GwAttachment, type GwDirection, type GwDoc } from "./types"

export function DraftFormDialog({
  direction,
  open,
  onOpenChange,
  onCreated,
}: {
  direction: GwDirection
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (doc: GwDoc) => void
}) {
  const isSend = direction === "SEND"
  const [title, setTitle] = useState("")
  const [docType, setDocType] = useState("通知")
  const [headerType, setHeaderType] = useState<"RED" | "PLAIN">("RED")
  const [secret, setSecret] = useState("PUBLIC")
  const [urgency, setUrgency] = useState("NORMAL")
  const [issuingOrg, setIssuingOrg] = useState("涵韬科技有限公司文件")
  const [mainRecipients, setMainRecipients] = useState("")
  const [ccRecipients, setCcRecipients] = useState("")
  const [content, setContent] = useState("")
  const [annotation, setAnnotation] = useState("")
  const [copyNo, setCopyNo] = useState("")
  const [sourceUnit, setSourceUnit] = useState("")
  const [sourceCode, setSourceCode] = useState("")
  const [attachments, setAttachments] = useState<GwAttachment[]>([])
  const [attachName, setAttachName] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setTitle("")
    setDocType("通知")
    setHeaderType("RED")
    setSecret("PUBLIC")
    setUrgency("NORMAL")
    setIssuingOrg("涵韬科技有限公司文件")
    setMainRecipients("")
    setCcRecipients("")
    setContent("")
    setAnnotation("")
    setCopyNo("")
    setSourceUnit("")
    setSourceCode("")
    setAttachments([])
    setAttachName("")
  }

  const addAttachment = () => {
    const name = attachName.trim()
    if (!name) return
    setAttachments((prev) => [...prev, { name }])
    setAttachName("")
  }

  const submit = async () => {
    if (!title.trim()) {
      toast.warning("请填写标题")
      return
    }
    if (!isSend && !sourceUnit.trim()) {
      toast.warning("请填写来文单位")
      return
    }
    setSubmitting(true)
    try {
      const payload: GwDraftPayload = {
        direction,
        title: title.trim(),
        docType,
        headerType,
        secret,
        urgency,
        content: content.trim() || undefined,
        attachments: attachments.length ? attachments : undefined,
        ...(isSend
          ? {
              // 白头文件通常无红色发文机关标志，机关名仍作版记印发机关用
              issuingOrg: issuingOrg.trim() || undefined,
              mainRecipients: mainRecipients.trim() || undefined,
              ccRecipients: ccRecipients.trim() || undefined,
              annotation: annotation.trim() || undefined,
              copyNo: copyNo.trim() || undefined,
              templateId: 1,
            }
          : {
              sourceUnit: sourceUnit.trim(),
              sourceCode: sourceCode.trim() || undefined,
              mainRecipients: mainRecipients.trim() || undefined,
            }),
      }
      const res = await createDoc(payload)
      toast.success(isSend ? "发文拟稿已创建，进入拟稿环节" : "收文已登记，进入拟办环节")
      onCreated(res.data)
      onOpenChange(false)
      reset()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={isSend ? "发文拟稿单" : "收文登记单"}
      description={isSend ? "填写公文版式与正文，提交后起 gw_send 办文流程" : "登记来文信息，提交后起 gw_recv 办理流程"}
      width={640}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? "提交中…" : isSend ? "提交起草" : "登记"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!isSend && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="source-unit">来文单位 *</Label>
              <Input id="source-unit" value={sourceUnit} onChange={(e) => setSourceUnit(e.target.value)} placeholder="如：市工业和信息化局" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source-code">来文字号</Label>
              <Input id="source-code" value={sourceCode} onChange={(e) => setSourceCode(e.target.value)} placeholder="如：市工信〔2026〕89号" />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="gw-title">标题 *</Label>
          <Input
            id="gw-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如：关于开展×××工作的通知"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>文种</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>密级</Label>
            <Select value={secret} onValueChange={setSecret}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PUBLIC">公开</SelectItem>
                <SelectItem value="INTERNAL">内部</SelectItem>
                <SelectItem value="SECRET">秘密</SelectItem>
                <SelectItem value="CONFIDENTIAL">机密</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>紧急程度</Label>
            <Select value={urgency} onValueChange={setUrgency}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NORMAL">普通</SelectItem>
                <SelectItem value="URGENT">加急</SelectItem>
                <SelectItem value="EXTRA">特急</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isSend && (
          <>
            <div className="space-y-1.5">
              <Label>文头类型</Label>
              <div className="grid grid-cols-2 gap-2.5">
                {(
                  [
                    { type: "RED", label: "红头正式公文", desc: "发文机关标志 + 红反线 + 发文字号（GB/T 9704）" },
                    { type: "PLAIN", label: "白头普通文件", desc: "无红头，标题 + 主送 + 正文 + 日期" },
                  ] as const
                ).map((opt) => {
                  const active = headerType === opt.type
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => setHeaderType(opt.type)}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                        active ? "border-primary/50 bg-primary/5" : "hover:bg-accent",
                      )}
                    >
                      <span className="text-sm font-medium">{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="issuing-org">
                  {headerType === "RED" ? "发文机关标志（红头）" : "印发机关"}
                </Label>
                <Input id="issuing-org" value={issuingOrg} onChange={(e) => setIssuingOrg(e.target.value)} placeholder="如：涵韬科技有限公司文件" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="copy-no">份号（涉密公文）</Label>
                <Input id="copy-no" value={copyNo} onChange={(e) => setCopyNo(e.target.value)} placeholder="如：000123" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="main-recipients">主送机关</Label>
              <Input id="main-recipients" value={mainRecipients} onChange={(e) => setMainRecipients(e.target.value)} placeholder="如：各分公司、各部门（多个用；分隔）" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-recipients">抄送机关</Label>
              <Input id="cc-recipients" value={ccRecipients} onChange={(e) => setCcRecipients(e.target.value)} placeholder="如：董事会办公室、审计部" />
            </div>
          </>
        )}

        {!isSend && (
          <div className="space-y-1.5">
            <Label htmlFor="recv-main">承办范围 / 主送</Label>
            <Input id="recv-main" value={mainRecipients} onChange={(e) => setMainRecipients(e.target.value)} placeholder="如：各相关企业" />
          </div>
        )}

        <div className="space-y-1.5">
          <Label>正文</Label>
          <RichTextEditor preset="standard" value={content} onChange={setContent} minHeight={220} placeholder="请输入公文正文…" />
        </div>

        {isSend && (
          <div className="space-y-1.5">
            <Label htmlFor="annotation">附注</Label>
            <Input id="annotation" value={annotation} onChange={(e) => setAnnotation(e.target.value)} placeholder="如：此件公开发布" />
          </div>
        )}

        {/* 附件 */}
        <div className="space-y-1.5">
          <Label>附件</Label>
          <div className="flex items-center gap-2">
            <Input
              value={attachName}
              onChange={(e) => setAttachName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addAttachment()
                }
              }}
              placeholder="输入附件名称后回车 / 点添加"
            />
            <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1" onClick={addAttachment}>
              <Plus className="size-3.5" /> 添加
            </Button>
          </div>
          {attachments.length > 0 && (
            <div className="space-y-1 pt-1">
              {attachments.map((a, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                  <Paperclip className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-rose-600"
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  )
}

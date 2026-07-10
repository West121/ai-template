import { useMemo, useRef, useState, type ReactNode } from "react"
import {
  Ban,
  BellRing,
  ChevronDown,
  CircleCheck,
  CircleX,
  Forward,
  Hand,
  ListPlus,
  MessageSquare,
  MoveRight,
  MoreHorizontal,
  ShieldEllipsis,
  Undo2,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"
import { Modal } from "@/components/modal"
import { OrgPicker, OrgPickerField, type OrgRef } from "@/components/org-picker"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { HostedForm } from "@/components/hosted-form"
import { buildFieldPolicyMap } from "@/components/field-perms-editor"
import { getForm, isCodeForm, type HostedFormHandle } from "@/lib/form-registry"
import { missingRequiredFields, type FieldPolicyMap } from "@/lib/form-manifest"
import { parseFormData, type WfNodeRef, type WfOrgRef } from "@/types/workflow"
import type { WfInstanceDetailP3 } from "@/types/workflow-p3"
import "@/pages/workflow/forms" // 触发 CODE 表单登记（registerForm 副作用），确保办理页命中

/* ================= 转换工具 ================= */

/** org-picker 的 OrgRef（type）→ 后端契约 WfOrgRef（kind） */
export function toOrgRef(refs: OrgRef[]): WfOrgRef[] {
  return refs.map((r) => ({ kind: r.type, id: r.id, name: r.name }))
}

/** 从混合选择中取用户 id 列表（沟通收件人 / 减签） */
function userIdsOf(refs: OrgRef[]): number[] {
  return refs.filter((r) => r.type === "USER").map((r) => r.id)
}

/* ================= 通用小部件 ================= */

/** 字段样式的组织选择入口 + 弹窗（自管开合） */
function OrgField({
  value,
  onChange,
  multiple = true,
  placeholder,
  title,
}: {
  value: OrgRef[]
  onChange: (refs: OrgRef[]) => void
  multiple?: boolean
  placeholder?: string
  title?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <OrgPickerField
        value={value}
        multiple={multiple}
        placeholder={placeholder}
        onOpen={() => setOpen(true)}
        onRemove={(ref) => onChange(value.filter((v) => !(v.type === ref.type && v.id === ref.id)))}
      />
      <OrgPicker
        open={open}
        onOpenChange={setOpen}
        multiple={multiple}
        title={title}
        value={value}
        onConfirm={onChange}
      />
    </>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {required && <span className="text-destructive">*</span>} {label}
      </Label>
      {children}
    </div>
  )
}

/** 统一提交封装：忙碌态 + toast + 完成回调 */
function useOpSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(okMsg)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

interface DialogProps {
  detail: WfInstanceDetailP3
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 操作成功：刷新详情 + 关闭 */
  onDone: () => void
}

const post = (path: string, body: unknown) =>
  api(path, { method: "POST", body: JSON.stringify(body) })

/* ================= 各操作弹窗 ================= */

/** 加签 PRE/POST */
function AddSignDialog({ detail, open, onOpenChange, onDone }: DialogProps) {
  const [mode, setMode] = useState<"PRE" | "POST">("PRE")
  const [refs, setRefs] = useState<OrgRef[]>([])
  const [comment, setComment] = useState("")
  const { busy, run } = useOpSubmit(onDone)
  const submit = () =>
    run(
      () =>
        post(`/api/wf/tasks/${detail.myTaskId}/add-sign`, {
          mode,
          users: toOrgRef(refs),
          comment: comment.trim() || undefined,
        }),
      "已加签",
    )
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title="加签"
      description={detail.title}
      width={480}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy || refs.length === 0}>
            {busy ? "提交中…" : "确认加签"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="加签方式">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "PRE" | "POST")} className="flex gap-5 pt-1">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <RadioGroupItem value="PRE" /> 前加签（先审完再回到我）
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <RadioGroupItem value="POST" /> 后加签（我通过后再审）
            </label>
          </RadioGroup>
        </Field>
        <Field label="加签人" required>
          <OrgField value={refs} onChange={setRefs} title="选择加签人" placeholder="选择成员 / 部门 / 角色" />
        </Field>
        <Field label="意见">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="选填" />
        </Field>
      </div>
    </Modal>
  )
}

/** 并签（当前多实例节点追加平行审批人） */
function CounterSignDialog({ detail, open, onOpenChange, onDone }: DialogProps) {
  const [refs, setRefs] = useState<OrgRef[]>([])
  const [comment, setComment] = useState("")
  const { busy, run } = useOpSubmit(onDone)
  const submit = () =>
    run(
      () =>
        post(`/api/wf/tasks/${detail.myTaskId}/counter-sign`, {
          users: toOrgRef(refs),
          comment: comment.trim() || undefined,
        }),
      "已并签",
    )
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title="并签"
      description={detail.title}
      width={480}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy || refs.length === 0}>
            {busy ? "提交中…" : "确认并签"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="并签人（与我同时审批）" required>
          <OrgField value={refs} onChange={setRefs} title="选择并签人" />
        </Field>
        <Field label="意见">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="选填" />
        </Field>
      </div>
    </Modal>
  )
}

/** 减签：勾选本节点其他待办人；无候选数据时回退组织选择器 */
function ReduceSignDialog({ detail, open, onOpenChange, onDone }: DialogProps) {
  const handlers = detail.currentHandlers ?? []
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [refs, setRefs] = useState<OrgRef[]>([])
  const { busy, run } = useOpSubmit(onDone)
  const removeUserIds = handlers.length > 0 ? [...checked] : userIdsOf(refs)
  const submit = () =>
    run(() => post(`/api/wf/tasks/${detail.myTaskId}/reduce-sign`, { removeUserIds }), "已减签")
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title="减签"
      description={detail.title}
      width={460}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy || removeUserIds.length === 0}>
            {busy ? "提交中…" : "确认减签"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">移除本节点尚未办理的其他审批人（至少保留 1 人）。</p>
        {handlers.length > 0 ? (
          <div className="space-y-1">
            {handlers.map((h) => (
              <label
                key={h.userId}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
              >
                <Checkbox
                  checked={checked.has(h.userId)}
                  onCheckedChange={(v) =>
                    setChecked((prev) => {
                      const next = new Set(prev)
                      if (v) next.add(h.userId)
                      else next.delete(h.userId)
                      return next
                    })
                  }
                />
                <span className="text-sm">{h.name}</span>
              </label>
            ))}
          </div>
        ) : (
          <Field label="选择要移除的审批人" required>
            <OrgField value={refs} onChange={setRefs} title="选择减签人（仅成员生效）" />
          </Field>
        )}
      </div>
    </Modal>
  )
}

/** 转办 / 委派：单选一人 + 意见 */
function AssigneeDialog({
  detail,
  open,
  onOpenChange,
  onDone,
  kind,
}: DialogProps & { kind: "transfer" | "delegate" }) {
  const [refs, setRefs] = useState<OrgRef[]>([])
  const [comment, setComment] = useState("")
  const { busy, run } = useOpSubmit(onDone)
  const meta =
    kind === "transfer"
      ? { title: "转办", tip: "责任转移，对方审批后进入下一节点", ok: "已转办" }
      : { title: "委派", tip: "对方审批后退回给我，由我再提交", ok: "已委派" }
  const submit = () =>
    run(
      () =>
        post(`/api/wf/tasks/${detail.myTaskId}/${kind}`, {
          user: toOrgRef(refs)[0],
          comment: comment.trim() || undefined,
        }),
      meta.ok,
    )
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title={meta.title}
      description={detail.title}
      width={460}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy || refs.length === 0}>
            {busy ? "提交中…" : `确认${meta.title}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">{meta.tip}</p>
        <Field label={`${meta.title}给`} required>
          <OrgField value={refs} onChange={setRefs} multiple={false} title={`选择${meta.title}对象`} />
        </Field>
        <Field label="意见">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="选填" />
        </Field>
      </div>
    </Modal>
  )
}

/** 协办 / 征求意见：多选 + 意见（必填） */
function AssistDialog({ detail, open, onOpenChange, onDone }: DialogProps) {
  const [refs, setRefs] = useState<OrgRef[]>([])
  const [comment, setComment] = useState("")
  const { busy, run } = useOpSubmit(onDone)
  const submit = () =>
    run(
      () => post(`/api/wf/tasks/${detail.myTaskId}/assist`, { users: toOrgRef(refs), comment: comment.trim() }),
      "已发起协办",
    )
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title="协办 / 征求意见"
      description={detail.title}
      width={480}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy || refs.length === 0 || !comment.trim()}>
            {busy ? "提交中…" : "发起协办"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">建独立意见任务，不参与本节点完成条件，意见汇入主任务。</p>
        <Field label="协办人" required>
          <OrgField value={refs} onChange={setRefs} title="选择协办人" />
        </Field>
        <Field label="征求内容" required>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="请填写需要征求意见的内容"
          />
        </Field>
      </div>
    </Modal>
  )
}

/** 驳回增强：目标 + 重审策略 + 意见 */
function RejectDialog({ detail, open, onOpenChange, onDone }: DialogProps) {
  const targets = detail.jumpTargets ?? []
  const [comment, setComment] = useState("")
  const [target, setTarget] = useState<"PREV" | "START" | "NODE">("PREV")
  const [nodeId, setNodeId] = useState("")
  const [strategy, setStrategy] = useState<"CONTINUE" | "BACK">("CONTINUE")
  const { busy, run } = useOpSubmit(onDone)
  const submit = () =>
    run(
      () =>
        post(`/api/wf/tasks/${detail.myTaskId}/reject`, {
          target,
          targetNodeId: target === "NODE" ? nodeId : undefined,
          comment: comment.trim(),
          resumeStrategy: strategy,
        }),
      "已驳回",
    )
  const disabled = busy || !comment.trim() || (target === "NODE" && !nodeId)
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title="驳回"
      description={detail.title}
      width={480}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button variant="destructive" onClick={submit} disabled={disabled}>
            {busy ? "提交中…" : "确认驳回"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="驳回意见" required>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="请填写驳回原因"
          />
        </Field>
        <Field label="退回到">
          <RadioGroup
            value={target}
            onValueChange={(v) => setTarget(v as typeof target)}
            className="flex flex-wrap gap-5 pt-1"
          >
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <RadioGroupItem value="PREV" /> 上一步
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <RadioGroupItem value="START" /> 发起人
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <RadioGroupItem value="NODE" disabled={targets.length === 0} /> 指定节点
            </label>
          </RadioGroup>
        </Field>
        {target === "NODE" && (
          <Field label="目标节点" required>
            <Select value={nodeId} onValueChange={setNodeId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={targets.length ? "选择驳回到的节点" : "暂无可选节点"} />
              </SelectTrigger>
              <SelectContent>
                {targets.map((n) => (
                  <SelectItem key={n.nodeId} value={n.nodeId}>
                    {n.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label="重审策略">
          <RadioGroup
            value={strategy}
            onValueChange={(v) => setStrategy(v as typeof strategy)}
            className="flex flex-col gap-2 pt-1"
          >
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <RadioGroupItem value="CONTINUE" /> 继续执行（重审后回驳回点续走）
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <RadioGroupItem value="BACK" /> 退回驳回节点（重走中间路径）
            </label>
          </RadioGroup>
        </Field>
      </div>
    </Modal>
  )
}

/** 沟通留言：收件人 + 内容 */
function CommunicateDialog({ detail, open, onOpenChange, onDone }: DialogProps) {
  const [refs, setRefs] = useState<OrgRef[]>([])
  const [content, setContent] = useState("")
  const { busy, run } = useOpSubmit(onDone)
  const submit = () =>
    run(
      () =>
        post(`/api/wf/tasks/${detail.myTaskId}/communicate`, {
          toUserIds: userIdsOf(refs),
          content: content.trim(),
        }),
      "留言已发送",
    )
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title="沟通"
      description={detail.title}
      width={480}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy || refs.length === 0 || !content.trim()}>
            {busy ? "发送中…" : "发送留言"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">留言不影响流转，将通知收件人并在沟通线程中展示。</p>
        <Field label="收件人（仅成员）" required>
          <OrgField value={refs} onChange={setRefs} title="选择收件人" />
        </Field>
        <Field label="留言内容" required>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="请输入留言" />
        </Field>
      </div>
    </Modal>
  )
}

/** 拿回 */
function RetrieveDialog({ detail, open, onOpenChange, onDone }: DialogProps) {
  const [comment, setComment] = useState("")
  const { busy, run } = useOpSubmit(onDone)
  const submit = () =>
    run(
      () =>
        post(`/api/wf/tasks/${detail.myTaskId}/retrieve`, { comment: comment.trim() || undefined }),
      "已拿回",
    )
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title="拿回"
      description={detail.title}
      width={440}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "提交中…" : "确认拿回"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">在下一节点无人处理前取回重办。</p>
        <Field label="说明">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="选填" />
        </Field>
      </div>
    </Modal>
  )
}

/** 催办 */
function UrgeDialog({ detail, open, onOpenChange, onDone }: DialogProps) {
  const [comment, setComment] = useState("")
  const { busy, run } = useOpSubmit(onDone)
  const submit = () =>
    run(
      () => post(`/api/wf/instances/${detail.id}/urge`, { comment: comment.trim() || undefined }),
      "已催办",
    )
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title="催办"
      description={detail.title}
      width={440}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "提交中…" : "确认催办"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">通知当前处理人尽快办理（可重复催办）。</p>
        <Field label="催办留言">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="选填" />
        </Field>
      </div>
    </Modal>
  )
}

/** 管理员跳转 */
function JumpDialog({ detail, open, onOpenChange, onDone }: DialogProps) {
  const targets = detail.jumpTargets ?? []
  const [nodeId, setNodeId] = useState("")
  const [comment, setComment] = useState("")
  const { busy, run } = useOpSubmit(onDone)
  const submit = () =>
    run(
      () =>
        post(`/api/wf/instances/${detail.id}/jump`, {
          targetNodeId: nodeId,
          comment: comment.trim() || undefined,
        }),
      "已跳转",
    )
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title="跳转（管理员）"
      description={detail.title}
      width={460}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy || !nodeId}>
            {busy ? "提交中…" : "确认跳转"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="跳转到节点" required>
          <Select value={nodeId} onValueChange={setNodeId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={targets.length ? "选择目标节点" : "暂无可选节点"} />
            </SelectTrigger>
            <SelectContent>
              {targets.map((n) => (
                <SelectItem key={n.nodeId} value={n.nodeId}>
                  {n.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="说明">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="选填" />
        </Field>
      </div>
    </Modal>
  )
}

/** 管理员终止 */
function TerminateDialog({ detail, open, onOpenChange, onDone }: DialogProps) {
  const [comment, setComment] = useState("")
  const { busy, run } = useOpSubmit(onDone)
  const submit = () =>
    run(
      () => post(`/api/wf/instances/${detail.id}/terminate`, { comment: comment.trim() || undefined }),
      "实例已终止",
    )
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title="终止实例（管理员）"
      description={detail.title}
      width={440}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? "终止中…" : "确认终止"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">强制终止后流程立即结束，状态记为「已终止」，不可恢复。</p>
        <Field label="终止原因">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="选填" />
        </Field>
      </div>
    </Modal>
  )
}

/** 管理员追加节点 */
function AppendNodeDialog({ detail, open, onOpenChange, onDone }: DialogProps) {
  const nodeOptions: WfNodeRef[] = useMemo(() => {
    if (detail.jumpTargets?.length) return detail.jumpTargets
    return (detail.currentNodes ?? [])
      .filter((n) => n.nodeId)
      .map((n) => ({ nodeId: n.nodeId!, name: n.nodeName ?? n.nodeId! }))
  }, [detail.jumpTargets, detail.currentNodes])
  const [afterNodeId, setAfterNodeId] = useState("")
  const [name, setName] = useState("")
  const [refs, setRefs] = useState<OrgRef[]>([])
  const [multiMode, setMultiMode] = useState<"ANY" | "ALL" | "SEQUENCE">("ANY")
  const { busy, run } = useOpSubmit(onDone)
  const submit = () =>
    run(
      () =>
        post(`/api/wf/instances/${detail.id}/append-node`, {
          afterNodeId,
          name: name.trim(),
          assignees: toOrgRef(refs),
          multiMode,
        }),
      "已追加节点",
    )
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title="追加节点（管理员）"
      description={detail.title}
      width={480}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy || !afterNodeId || !name.trim() || refs.length === 0}>
            {busy ? "提交中…" : "确认追加"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">在指定节点后动态插入处理人，仅作用于本实例，不改流程定义。</p>
        <Field label="追加到该节点之后" required>
          <Select value={afterNodeId} onValueChange={setAfterNodeId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={nodeOptions.length ? "选择前置节点" : "暂无可选节点"} />
            </SelectTrigger>
            <SelectContent>
              {nodeOptions.map((n) => (
                <SelectItem key={n.nodeId} value={n.nodeId}>
                  {n.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="节点名称" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：补充审批" />
        </Field>
        <Field label="处理人" required>
          <OrgField value={refs} onChange={setRefs} title="选择处理人" />
        </Field>
        <Field label="多人模式">
          <RadioGroup
            value={multiMode}
            onValueChange={(v) => setMultiMode(v as typeof multiMode)}
            className="flex flex-wrap gap-5 pt-1"
          >
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <RadioGroupItem value="ANY" /> 或签
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <RadioGroupItem value="ALL" /> 会签
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <RadioGroupItem value="SEQUENCE" /> 顺序
            </label>
          </RadioGroup>
        </Field>
      </div>
    </Modal>
  )
}

/* ================= 同意 / 认领（无额外表单） ================= */

function ApproveDialog({ detail, open, onOpenChange, onDone }: DialogProps) {
  const [comment, setComment] = useState("")
  const { busy, run } = useOpSubmit(onDone)
  const formHandle = useRef<HostedFormHandle>(null)

  // CODE 表单（本仓库手写 react-hook-form 表单）：节点绑定命中 registry 时，办理页渲染**可编辑**
  // HostedForm（fieldPolicy 由 nodeFormPerms 合成，editable 按节点策略），提交随 approve 带 formData。
  const codeFormKey = detail.formKey && isCodeForm(detail.formKey) ? detail.formKey : undefined
  const codeManifest = codeFormKey ? getForm(codeFormKey)?.manifest : undefined
  const codeFieldPolicy = useMemo<FieldPolicyMap | undefined>(
    () => (codeManifest ? buildFieldPolicyMap(codeManifest.fields, detail.nodeFormPerms) : undefined),
    [codeManifest, detail.nodeFormPerms],
  )
  const codeFormData = useMemo(() => parseFormData(detail.formData), [detail.formData])
  const labelOf = (key: string) => codeManifest?.fields.find((f) => f.key === key)?.label ?? key

  const submit = async () => {
    let formData: Record<string, unknown> | undefined
    if (codeFormKey) {
      // 触发 react-hook-form 校验以在字段上浮现错误提示（含按策略注入的必填）
      await formHandle.current?.validate()
      const values = formHandle.current?.getValues() ?? {}
      // 权威门禁：清单必填（来自 manifest → fieldPolicy.required）未填则拦截
      const missing = missingRequiredFields(codeFieldPolicy, values)
      if (missing.length > 0) {
        toast.error(`请完善必填项：${missing.map(labelOf).join("、")}`)
        return
      }
      formData = values
    }
    await run(
      () =>
        post(`/api/wf/tasks/${detail.myTaskId}/approve`, {
          comment: comment.trim() || undefined,
          ...(formData ? { formData } : {}),
        }),
      "已同意",
    )
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && onOpenChange(false)}
      title="同意"
      description={detail.title}
      width={codeFormKey ? 520 : 440}
      resizable={false}
      fullscreenable={false}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-600/90"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? "提交中…" : "确认同意"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {codeFormKey && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">表单填写</div>
            <HostedForm
              formKey={codeFormKey}
              formData={codeFormData}
              fieldPolicy={codeFieldPolicy}
              formRef={formHandle}
            />
          </div>
        )}
        <Field label="审批意见">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="选填，默认为「同意」"
          />
        </Field>
      </div>
    </Modal>
  )
}

/* ================= 操作栏 ================= */

type DialogKey =
  | "approve"
  | "reject"
  | "addSign"
  | "counterSign"
  | "reduceSign"
  | "transfer"
  | "delegate"
  | "assist"
  | "communicate"
  | "retrieve"
  | "urge"
  | "jump"
  | "terminate"
  | "append"

const OP_META: Record<
  DialogKey,
  { label: string; icon: typeof UserPlus; variant?: "outline" | "destructive"; className?: string }
> = {
  approve: {
    label: "同意",
    icon: CircleCheck,
    className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
  },
  reject: { label: "驳回", icon: CircleX, variant: "destructive" },
  addSign: { label: "加签", icon: UserPlus, variant: "outline" },
  counterSign: { label: "并签", icon: Users, variant: "outline" },
  reduceSign: { label: "减签", icon: UserMinus, variant: "outline" },
  transfer: { label: "转办", icon: Forward, variant: "outline" },
  delegate: { label: "委派", icon: UserCog, variant: "outline" },
  assist: { label: "协办", icon: Users, variant: "outline" },
  communicate: { label: "沟通", icon: MessageSquare, variant: "outline" },
  retrieve: { label: "拿回", icon: Undo2, variant: "outline" },
  urge: { label: "催办", icon: BellRing, variant: "outline" },
  jump: { label: "跳转", icon: MoveRight, variant: "outline" },
  terminate: { label: "终止", icon: Ban, variant: "outline" },
  append: { label: "追加节点", icon: ListPlus, variant: "outline" },
}

/**
 * 实例详情操作栏：按 detail.allowedOps / isAdmin 动态渲染操作按钮 + 弹窗。
 * allowedOps 缺省（后端 P2 未就绪）时回退 P1 行为：有待办即显示同意/驳回。
 */
export function WfOpBar({ detail, onReload }: { detail: WfInstanceDetailP3; onReload: () => void }) {
  const [dlg, setDlg] = useState<DialogKey | null>(null)
  const [claiming, setClaiming] = useState(false)
  const userId = useAuthStore((s) => s.userId)
  const adminPerm = useHasPerm("wf:instance:admin")

  const running = detail.bizStatus === "RUNNING"
  const hasTask = !!detail.myTaskId
  const isInitiator = userId != null && detail.initiatorId === userId
  const isAdmin = detail.isAdmin ?? adminPerm
  const ops = detail.allowedOps

  /** 任务级操作：有 allowedOps 按白名单，缺省回退同意/驳回 */
  const canTask = (op: string) => {
    if (!hasTask || !running) return false
    if (ops == null) return op === "approve" || op === "reject"
    return ops.includes(op)
  }
  const canRetrieve = running && (ops?.includes("retrieve") ?? false)
  const canClaim = hasTask && running && (ops?.includes("claim") ?? false)
  const canUnclaim = hasTask && running && (ops?.includes("unclaim") ?? false)
  const canCommunicate = running && hasTask && (ops == null || ops.includes("communicate"))
  const canUrge = running && (isInitiator || isAdmin)

  const onDone = () => {
    setDlg(null)
    onReload()
  }

  const doClaim = async (kind: "claim" | "unclaim") => {
    setClaiming(true)
    try {
      await api(`/api/wf/tasks/${detail.myTaskId}/${kind}`, { method: "POST" })
      toast.success(kind === "claim" ? "已认领" : "已退回任务池")
      onReload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    } finally {
      setClaiming(false)
    }
  }

  const btn = (key: DialogKey) => {
    const m = OP_META[key]
    return (
      <Button
        key={key}
        size="sm"
        variant={m.variant}
        className={m.className ? `gap-1.5 ${m.className}` : "gap-1.5"}
        onClick={() => setDlg(key)}
      >
        <m.icon className="size-3.5" /> {m.label}
      </Button>
    )
  }

  // 主决策直出、其余按性质收纳：协作类进「更多操作」，管理员操作进「管理」
  const taskButtons: DialogKey[] = ["approve", "reject", "addSign", "counterSign", "reduceSign", "transfer", "delegate", "assist"]
  const shown = taskButtons.filter((op) => canTask(op))
  const collabOps = shown.filter((op) => op !== "approve" && op !== "reject")
  const moreOps: DialogKey[] = [
    ...collabOps,
    ...(canCommunicate ? (["communicate"] as DialogKey[]) : []),
    ...(canRetrieve ? (["retrieve"] as DialogKey[]) : []),
    ...(canUrge ? (["urge"] as DialogKey[]) : []),
  ]
  const adminOps: DialogKey[] = ["jump", "append", "terminate"]

  const anyButton =
    shown.length > 0 || moreOps.length > 0 || canClaim || canUnclaim || isAdmin

  if (!anyButton) return null

  const menuItem = (op: DialogKey) => {
    const m = OP_META[op]
    const danger = op === "terminate"
    return (
      <DropdownMenuItem
        key={op}
        onClick={() => setDlg(op)}
        className={danger ? "text-destructive focus:text-destructive" : ""}
      >
        <m.icon className="size-4 opacity-70" />
        {m.label}
      </DropdownMenuItem>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canClaim && (
        <Button size="sm" className="gap-1.5" onClick={() => void doClaim("claim")} disabled={claiming}>
          <Hand className="size-3.5" /> 认领
        </Button>
      )}
      {canUnclaim && (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void doClaim("unclaim")} disabled={claiming}>
          <Hand className="size-3.5" /> 退回池
        </Button>
      )}

      {/* 主决策：同意 / 驳回 */}
      {canTask("approve") && btn("approve")}
      {canTask("reject") && btn("reject")}

      {/* 更多操作（协作类）*/}
      {moreOps.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <MoreHorizontal className="size-3.5" /> 更多操作
              <ChevronDown className="size-3.5 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">协作操作</DropdownMenuLabel>
            {moreOps.map(menuItem)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* 管理员操作（隔离）*/}
      {isAdmin && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-amber-500/40 text-amber-600 hover:text-amber-600 dark:text-amber-500"
            >
              <ShieldEllipsis className="size-3.5" /> 管理
              <ChevronDown className="size-3.5 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">管理员操作</DropdownMenuLabel>
            {adminOps.map(menuItem)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* 弹窗 */}
      {dlg === "approve" && (
        <ApproveDialog detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "reject" && (
        <RejectDialog detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "addSign" && (
        <AddSignDialog detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "counterSign" && (
        <CounterSignDialog detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "reduceSign" && (
        <ReduceSignDialog detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "transfer" && (
        <AssigneeDialog kind="transfer" detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "delegate" && (
        <AssigneeDialog kind="delegate" detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "assist" && (
        <AssistDialog detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "communicate" && (
        <CommunicateDialog detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "retrieve" && (
        <RetrieveDialog detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "urge" && (
        <UrgeDialog detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "jump" && (
        <JumpDialog detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "terminate" && (
        <TerminateDialog detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
      {dlg === "append" && (
        <AppendNodeDialog detail={detail} open onOpenChange={() => setDlg(null)} onDone={onDone} />
      )}
    </div>
  )
}

/**
 * 离职交接向导（DP2）：3 步 Dialog——① 选继任者/原因/日期 → resign（400 部门负责人阻断则停步高亮）
 * ② 交接清单（逐项改继任者 / 跳过；DONE 只读）③ 执行（成功/失败明细，失败可重试，幂等）。
 * mock 先行 + 响应归一 + 未知 itemType 兜底；调用方再包 ErrorBoundary（防白屏）。
 */
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, ArrowRight, CheckCircle2, CloudOff, Loader2, SkipForward, UserRound, XCircle } from "lucide-react"
import { ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RecordPicker, RecordPickerField, type RecordPickerColumn } from "@/components/record-picker"
import {
  ITEM_STATUS_META,
  executeHandover,
  fetchHandover,
  itemTypeLabel,
  resignUser,
  updateHandoverItem,
  type ExecuteResult,
  type Handover,
} from "./resign-api"

interface UserLite extends Record<string, unknown> {
  id: number
  name: string
  empNo?: string
  primaryDeptName?: string
}

const successorColumns: RecordPickerColumn<UserLite>[] = [
  { key: "name", title: "姓名", width: 110 },
  { key: "empNo", title: "工号", width: 100, render: (r) => <span className="font-mono text-xs">{r.empNo ?? "—"}</span> },
  { key: "primaryDeptName", title: "部门", render: (r) => r.primaryDeptName ?? "—" },
]

export function ResignWizard({
  open,
  onOpenChange,
  user,
  users,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  user: { id: number; name: string }
  /** 继任者候选（用户列表，排除本人由组件处理） */
  users: UserLite[]
  onDone: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [successor, setSuccessor] = useState<{ id: number; name: string } | null>(null)
  const [reason, setReason] = useState("")
  const [resignDate, setResignDate] = useState("")
  const [resignError, setResignError] = useState<string | null>(null)
  const [resigning, setResigning] = useState(false)
  const [demo, setDemo] = useState(false)

  const [handoverId, setHandoverId] = useState<number | null>(null)
  const [handover, setHandover] = useState<Handover | null>(null)
  const [loadingHandover, setLoadingHandover] = useState(false)
  const [pickerMode, setPickerMode] = useState<"resign" | number | null>(null) // number = itemId

  const [executing, setExecuting] = useState(false)
  const [execResult, setExecResult] = useState<ExecuteResult | null>(null)

  const candidates = Array.isArray(users) ? users.filter((u) => u.id !== user.id) : []

  // 打开重置
  useEffect(() => {
    if (open) {
      setStep(1)
      setSuccessor(null)
      setReason("")
      setResignDate("")
      setResignError(null)
      setHandoverId(null)
      setHandover(null)
      setExecResult(null)
    }
  }, [open])

  const loadHandover = useCallback((hid: number) => {
    setLoadingHandover(true)
    fetchHandover(hid)
      .then((r) => {
        setHandover({ ...r.data, items: Array.isArray(r.data?.items) ? r.data.items : [] })
        setDemo((d) => d || r.demo)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "交接单加载失败"))
      .finally(() => setLoadingHandover(false))
  }, [])

  const doResign = async () => {
    setResigning(true)
    setResignError(null)
    try {
      const r = await resignUser(user.id, { successorId: successor?.id, reason: reason.trim() || undefined, resignDate: resignDate || undefined })
      setDemo((d) => d || r.demo)
      setHandoverId(r.data.handoverId)
      loadHandover(r.data.handoverId)
      setStep(2)
    } catch (e) {
      // 400 部门负责人阻断 → 停在步1，高亮提示"请先指定继任者"
      if (e instanceof ApiError && (e.code === 400 || String(e.message).includes("请先指定继任者"))) {
        setResignError(e.message || "请先指定继任者")
      } else {
        toast.error(e instanceof Error ? e.message : "发起离职失败")
      }
    } finally {
      setResigning(false)
    }
  }

  const patchItem = (itemId: number, patch: { successorId?: number; status?: "SKIPPED" | "PENDING" }) => {
    if (handoverId == null) return
    void updateHandoverItem(handoverId, itemId, patch)
      .then(() => loadHandover(handoverId))
      .catch((e) => toast.error(e instanceof Error ? e.message : "调整失败"))
  }

  const doExecute = async () => {
    if (handoverId == null) return
    setExecuting(true)
    try {
      const r = await executeHandover(handoverId)
      setExecResult(r.data)
      loadHandover(handoverId)
      if (r.data.failed.length === 0) toast.success(`交接执行完成（${r.data.doneIds.length} 项）`)
      else toast.warning(`执行完成：成功 ${r.data.doneIds.length}，失败 ${r.data.failed.length}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "执行失败")
    } finally {
      setExecuting(false)
    }
  }

  const goExecute = () => {
    setStep(3)
    setExecResult(null)
    void doExecute()
  }

  const finish = () => {
    onOpenChange(false)
    onDone()
  }

  const pickerCandidates = candidates
  const pickerValue = pickerMode === "resign" ? (successor ? [String(successor.id)] : []) : []

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>离职交接 · {user.name}</DialogTitle>
            <DialogDescription>
              <span className="flex items-center gap-2 text-xs">
                {[1, 2, 3].map((s) => (
                  <span key={s} className={cn("flex items-center gap-1", step === s ? "font-medium text-primary" : "text-muted-foreground")}>
                    <span className={cn("grid size-4 place-items-center rounded-full text-[10px]", step >= s ? "bg-primary text-primary-foreground" : "bg-muted")}>{s}</span>
                    {s === 1 ? "继任者" : s === 2 ? "交接清单" : "执行"}
                    {s < 3 && <ArrowRight className="size-3 text-muted-foreground/50" />}
                  </span>
                ))}
              </span>
            </DialogDescription>
          </DialogHeader>

          {demo && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              <CloudOff className="size-3.5 shrink-0" /> 后端未接入，交接为<strong>演示数据</strong>。
            </div>
          )}

          {/* 步1：继任者 + 原因 + 日期 */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>继任者</Label>
                <RecordPickerField
                  labels={successor ? [{ id: String(successor.id), label: successor.name }] : []}
                  placeholder="选择继任者（接手其待办 / 负责部门等）"
                  onOpen={() => setPickerMode("resign")}
                  onRemove={() => setSuccessor(null)}
                />
                {resignError && (
                  <p className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                    <AlertTriangle className="size-3.5 shrink-0" /> {resignError}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="resign-reason">离职原因</Label>
                  <Input id="resign-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="选填" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="resign-date">离职日期</Label>
                  <Input id="resign-date" type="date" value={resignDate} onChange={(e) => setResignDate(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* 步2：交接清单 */}
          {step === 2 && (
            <div className="max-h-[55vh] space-y-2 overflow-y-auto">
              {loadingHandover && !handover ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-4 animate-spin" />
                </div>
              ) : !handover || handover.items.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">无需交接的事项</div>
              ) : (
                handover.items.map((it) => {
                  const meta = ITEM_STATUS_META[it.status] ?? ITEM_STATUS_META.PENDING
                  const locked = it.status === "DONE"
                  return (
                    <div key={it.id} className="rounded-md border p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{itemTypeLabel(it.itemType)}</span>
                        <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", meta.className)}>{meta.label}</Badge>
                        <div className="ml-auto flex items-center gap-1">
                          {!locked && it.status !== "SKIPPED" && (
                            <>
                              <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => setPickerMode(it.id)}>
                                <UserRound className="size-3.5" /> 改继任者
                              </Button>
                              <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs text-muted-foreground" onClick={() => patchItem(it.id, { status: "SKIPPED" })}>
                                <SkipForward className="size-3.5" /> 跳过
                              </Button>
                            </>
                          )}
                          {it.status === "SKIPPED" && (
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => patchItem(it.id, { status: "PENDING" })}>
                              恢复
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {it.oldValue ?? "—"} <ArrowRight className="inline size-3" /> {it.newValue ?? "（待指定）"}
                        {it.refType && <span className="ml-2 text-[10px]">（{it.refType}{it.refId != null ? ` #${it.refId}` : ""}）</span>}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* 步3：执行结果 */}
          {step === 3 && (
            <div className="space-y-2">
              {executing ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <Loader2 className="mx-auto mb-1.5 size-4 animate-spin" /> 正在执行交接…
                </div>
              ) : execResult ? (
                <>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-4" /> 成功 {execResult.doneIds.length}
                    </span>
                    {execResult.failed.length > 0 && (
                      <span className="flex items-center gap-1.5 text-destructive">
                        <XCircle className="size-4" /> 失败 {execResult.failed.length}
                      </span>
                    )}
                  </div>
                  {execResult.failed.length > 0 && (
                    <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                      {execResult.failed.map((f) => (
                        <li key={f.itemId}>项 #{f.itemId}：{f.reason}</li>
                      ))}
                    </ul>
                  )}
                  {handover?.status === "DONE" ? (
                    <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-4" /> 交接单已完成，离职流程结束。
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">仍有未完成项，可重试执行（幂等，仅重跑失败/未完成项）。</p>
                  )}
                </>
              ) : null}
            </div>
          )}

          <DialogFooter>
            {step === 1 && (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                <Button disabled={resigning} className="gap-1.5" onClick={() => void doResign()}>
                  {resigning && <Loader2 className="size-4 animate-spin" />} 下一步：生成交接单
                </Button>
              </>
            )}
            {step === 2 && (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>稍后处理</Button>
                <Button className="gap-1.5" onClick={goExecute}>执行交接 <ArrowRight className="size-3.5" /></Button>
              </>
            )}
            {step === 3 && (
              <>
                {execResult && (handover?.status !== "DONE" || execResult.failed.length > 0) && (
                  <Button variant="outline" disabled={executing} onClick={() => void doExecute()}>重试执行</Button>
                )}
                <Button disabled={executing} onClick={finish}>{handover?.status === "DONE" ? "完成" : "关闭"}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 继任者选择（步1 + 逐项复用） */}
      <RecordPicker<UserLite>
        open={pickerMode !== null}
        onOpenChange={(o) => !o && setPickerMode(null)}
        title="选择继任者"
        description="从用户列表单选（已排除本人）"
        data={pickerCandidates}
        columns={successorColumns}
        idField="id"
        labelField="name"
        value={pickerValue}
        onConfirm={(_ids, rows) => {
          const row = rows[0]
          if (!row) return
          if (pickerMode === "resign") {
            setSuccessor({ id: row.id, name: row.name })
          } else if (typeof pickerMode === "number") {
            patchItem(pickerMode, { successorId: row.id })
          }
        }}
        searchKeys={["name", "empNo"]}
      />
    </>
  )
}

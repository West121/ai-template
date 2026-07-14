/**
 * 自动化编排 · 列表页（/automation）。
 *
 * 名称/触发器/启用开关/最近执行/操作（设计/执行记录/运行）+ 新建；
 * 执行记录 = 右侧抽屉（状态筛选 → 点开节点时间线 + 失败重跑）；凭据管理 = 弹窗表格（key 只写不回显）。
 * offline / 后端未就绪 → mock 演示（含一条 webhook→http→condition→llm→notify 流与执行记录）。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { History, KeyRound, Play, Plus, RotateCcw, Trash2, Workflow } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Drawer } from "@/components/drawer"
import { Modal } from "@/components/modal"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { DemoBanner } from "@/pages/document/gongwen/shared"
import {
  deleteCredential,
  deleteFlow,
  fetchCredentials,
  fetchExecDetail,
  fetchExecs,
  fetchFlows,
  rerunExec,
  resumeFromFailure,
  runFlow,
  saveCredential,
  toggleFlow,
  type CredentialType,
  type OrchCredential,
  type OrchExec,
  type OrchExecStatus,
  type OrchFlow,
} from "./mock"
import { ExecNodeTimeline, ExecStatusBadge, WaitingResumeBar } from "./exec-view"

const TRIGGER_LABEL: Record<string, string> = { MANUAL: "手动", CRON: "定时", EVENT: "事件", WEBHOOK: "Webhook" }
const CRED_TYPE_LABEL: Record<CredentialType, string> = {
  LLM: "LLM（AI 端点）",
  HTTP_BEARER: "HTTP Bearer",
  HTTP_BASIC: "HTTP Basic",
  HTTP_HEADER: "HTTP 自定义头",
  JDBC: "JDBC 数据源（只读）",
}

function fmtTime(iso?: string) {
  return iso ? iso.slice(5, 16).replace("T", " ") : "—"
}

/* ============================ 执行记录抽屉 ============================ */

function ExecsDrawer({ flow, open, onClose }: { flow: OrchFlow | null; open: boolean; onClose: () => void }) {
  const [execs, setExecs] = useState<OrchExec[]>([])
  const [status, setStatus] = useState<string>("all")
  const [detail, setDetail] = useState<OrchExec | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!flow) return
    setLoading(true)
    try {
      const res = await fetchExecs({ flowId: flow.id, status: status === "all" ? undefined : (status as OrchExecStatus) })
      setExecs(res.data)
    } finally {
      setLoading(false)
    }
  }, [flow, status])

  useEffect(() => {
    if (open) {
      setDetail(null)
      void load()
    }
  }, [open, load])

  const openDetail = async (exec: OrchExec) => {
    const res = await fetchExecDetail(exec.id)
    setDetail(res.data)
  }

  const rerun = async (exec: OrchExec) => {
    try {
      await rerunExec(exec.id)
      toast.success("已按原 payload 重跑（新流水）")
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重跑失败")
    }
  }

  // §9.3 失败续跑：复用父 exec 已成功节点快照，从失败节点继续
  const resumeFailure = async (exec: OrchExec) => {
    try {
      const res = await resumeFromFailure(exec.id)
      toast.success(`已从失败节点续跑（新流水 #${res.data.execId}）`)
      setDetail(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "续跑失败（接口可能未就绪）")
    }
  }

  const openDetailById = async (id: number) => {
    const res = await fetchExecDetail(id)
    if (res.data) setDetail(res.data)
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} title={`执行记录 · ${flow?.name ?? ""}`} width={560}>
      {detail ? (
        <div className="space-y-3">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setDetail(null)}>
            ← 返回列表
          </Button>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">#{detail.id}</span>
            <ExecStatusBadge status={detail.status} />
            <span>{fmtTime(detail.startedAt)}</span>
            <span>触发：{detail.triggerKind}</span>
            {detail.parentExecId != null && (
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => void openDetailById(detail.parentExecId!)}
              >
                续跑自 #{detail.parentExecId}
              </button>
            )}
          </div>
          {/* WAITING 挂起：恢复回调地址可复制（§9.2） */}
          {detail.status === "WAITING" && <WaitingResumeBar resumeToken={detail.resumeToken} />}
          {detail.error && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-2.5 py-1.5 text-xs text-rose-600 dark:text-rose-400">{detail.error}</div>
          )}
          {/* FAILED：整流重跑 与 失败节点续跑 并列（§9.3） */}
          {detail.status === "FAILED" && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => void rerun(detail)}>
                <RotateCcw className="size-3" /> 整流重跑
              </Button>
              <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => void resumeFailure(detail)}>
                <Play className="size-3" /> 从失败节点续跑
              </Button>
            </div>
          )}
          {detail.payload && (
            <div>
              <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">payload</div>
              <pre className="max-h-28 overflow-auto rounded border bg-muted/40 p-1.5 font-mono text-[10px] whitespace-pre-wrap break-all">{detail.payload}</pre>
            </div>
          )}
          <ExecNodeTimeline nodes={detail.nodes ?? []} />
        </div>
      ) : (
        <div className="space-y-3">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger size="sm" className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="SUCCESS">成功</SelectItem>
              <SelectItem value="FAILED">失败</SelectItem>
              <SelectItem value="RUNNING">执行中</SelectItem>
              <SelectItem value="WAITING">挂起等待</SelectItem>
              <SelectItem value="CANCELED">已取消</SelectItem>
            </SelectContent>
          </Select>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>
          ) : execs.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">暂无执行记录</div>
          ) : (
            <div className="space-y-1.5">
              {execs.map((e) => (
                <div key={e.id} className="flex items-center gap-2 rounded-md border px-2.5 py-2">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void openDetail(e)}>
                    <span className="font-mono text-xs text-muted-foreground">#{e.id}</span>
                    <ExecStatusBadge status={e.status} />
                    <span className="text-xs text-muted-foreground">{fmtTime(e.startedAt)}</span>
                    <span className="truncate text-xs text-muted-foreground">{e.triggerKind}</span>
                  </button>
                  {e.status === "FAILED" && (
                    <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void rerun(e)}>
                      <RotateCcw className="size-3" /> 重跑
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

/* ============================ 凭据管理 ============================ */

function CredentialsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [creds, setCreds] = useState<OrchCredential[]>([])
  const [editing, setEditing] = useState<Partial<OrchCredential> & { apiKey?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetchCredentials()
    setCreds(res.data)
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const save = async () => {
    if (!editing?.name?.trim()) {
      toast.warning("请填写凭据名称")
      return
    }
    setBusy(true)
    try {
      await saveCredential({
        id: editing.id ?? null,
        name: editing.name.trim(),
        type: (editing.type ?? "LLM") as CredentialType,
        baseUrl: editing.baseUrl?.trim() || undefined,
        model: editing.model?.trim() || undefined,
        supportsVision: (editing.type ?? "LLM") === "LLM" ? !!editing.supportsVision : undefined,
        apiKey: editing.apiKey?.trim() || undefined,
      })
      toast.success("凭据已保存")
      setEditing(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="凭据管理" description="LLM / HTTP 认证凭据；密钥加密存服务端，只写不回显" width={640}>
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button size="sm" className="h-8 gap-1" onClick={() => setEditing({ type: "LLM" })}>
            <Plus className="size-3.5" /> 新增凭据
          </Button>
        </div>
        <div className="divide-y rounded-md border">
          {creds.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">暂无凭据</div>}
          {creds.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {c.name}
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">{CRED_TYPE_LABEL[c.type]}</Badge>
                  {c.type === "LLM" && c.supportsVision && (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600">
                      👁 视觉
                    </Badge>
                  )}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {c.baseUrl ?? "—"}
                  {c.model ? ` · ${c.model}` : ""}
                  {c.hasKey ? " · 密钥已配置" : " · 未配置密钥"}
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditing({ ...c })}>
                编辑
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-rose-600 hover:text-rose-600"
                onClick={() => {
                  void deleteCredential(c.id).then(() => {
                    toast.success("已删除")
                    void load()
                  })
                }}
              >
                删除
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* 编辑弹窗 */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && !busy && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "编辑凭据" : "新增凭据"}</DialogTitle>
            <DialogDescription>密钥加密存储、不回显；留空表示不修改。</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 py-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">名称</Label>
                  <Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">类型</Label>
                  <Select value={editing.type ?? "LLM"} onValueChange={(v) => setEditing({ ...editing, type: v as CredentialType })}>
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CRED_TYPE_LABEL) as CredentialType[]).map((t) => (
                        <SelectItem key={t} value={t}>
                          {CRED_TYPE_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Base URL</Label>
                <Input value={editing.baseUrl ?? ""} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} className="h-8 font-mono text-xs" placeholder="https://api.deepseek.com/v1" />
              </div>
              {editing.type === "LLM" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">默认模型</Label>
                    <Input value={editing.model ?? ""} onChange={(e) => setEditing({ ...editing, model: e.target.value })} className="h-8 font-mono text-xs" placeholder="deepseek-chat" />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <Checkbox checked={!!editing.supportsVision} onCheckedChange={(v) => setEditing({ ...editing, supportsVision: v === true })} />
                    支持视觉（图片理解）—— AI 助手附图按此判定，模型选择器带 👁 徽标
                  </label>
                </>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">密钥（只写不回显）</Label>
                <Input type="password" value={editing.apiKey ?? ""} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })} className="h-8 font-mono text-xs" placeholder={editing.id ? "留空 = 不修改" : "sk-…"} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
              取消
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Modal>
  )
}

/* ============================ 列表页 ============================ */

export default function AutomationPage() {
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const canWrite = useHasPerm("orch:flow:write")
  const canRun = useHasPerm("orch:flow:run")

  const [rows, setRows] = useState<OrchFlow[]>([])
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)
  const [execsFor, setExecsFor] = useState<OrchFlow | null>(null)
  const [credsOpen, setCredsOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<OrchFlow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchFlows()
      setRows(res.data)
      setDemo(res.demo)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, offline])

  const toggle = useCallback(
    async (flow: OrchFlow, enabled: boolean) => {
      try {
        await toggleFlow(flow.id, enabled)
        setRows((prev) => prev.map((f) => (f.id === flow.id ? { ...f, enabled } : f)))
        toast.success(enabled ? `「${flow.name}」已启用` : `「${flow.name}」已停用`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "操作失败")
      }
    },
    [],
  )

  const run = useCallback(
    async (flow: OrchFlow) => {
      try {
        const res = await runFlow(flow.id, {})
        toast.success(`已触发执行（流水 #${res.data.execId}）`)
        void load()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "运行失败")
      }
    },
    [load],
  )

  const columns = useMemo<ColumnDef<OrchFlow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        meta: { title: "名称" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="名称" />,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.name}</div>
            <div className="font-mono text-[11px] text-muted-foreground">{row.original.code}</div>
          </div>
        ),
      },
      {
        accessorKey: "triggerType",
        meta: { title: "触发器" },
        header: () => <span>触发器</span>,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-muted-foreground">
            {TRIGGER_LABEL[row.original.triggerType] ?? row.original.triggerType}
          </Badge>
        ),
      },
      {
        accessorKey: "enabled",
        meta: { title: "启用" },
        header: () => <span>启用</span>,
        cell: ({ row }) => (
          <Switch checked={row.original.enabled} disabled={!canWrite} onCheckedChange={(v) => void toggle(row.original, v)} onClick={(e) => e.stopPropagation()} />
        ),
      },
      {
        id: "lastExec",
        meta: { title: "最近执行" },
        header: () => <span>最近执行</span>,
        cell: ({ row }) => {
          const le = row.original.lastExec
          if (!le) return <span className="text-xs text-muted-foreground">—</span>
          return (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ExecStatusBadge status={le.status} />
              {fmtTime(le.startedAt)}
            </span>
          )
        },
      },
      {
        accessorKey: "version",
        meta: { title: "版本" },
        header: () => <span>版本</span>,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">v{row.original.version ?? 0}</span>,
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <div className="flex items-center gap-0.5">
            {canWrite && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary" onClick={(e) => { e.stopPropagation(); navigate(`/automation/${row.original.code}/design`) }}>
                <Workflow className="size-3.5" /> 设计
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setExecsFor(row.original) }}>
              <History className="size-3.5" /> 记录
            </Button>
            {canRun && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-emerald-600 hover:text-emerald-600" onClick={(e) => { e.stopPropagation(); void run(row.original) }}>
                <Play className="size-3.5" /> 运行
              </Button>
            )}
            {canWrite && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-600" onClick={(e) => { e.stopPropagation(); setDeleteTarget(row.original) }}>
                <Trash2 className="size-3.5" /> 删除
              </Button>
            )}
          </div>
        ),
      },
    ],
    [canWrite, canRun, navigate, toggle, run],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="自动化编排"
        description="无人值守的逻辑编排（类 n8n）：定时 / 事件 / Webhook 触发，HTTP·脚本·AI·通知等节点串联执行，全程留痕可重跑"
      />

      {demo && <DemoBanner />}

      <DataTable
        columns={columns}
        data={rows}
        searchKeys={["name", "code"]}
        searchPlaceholder="搜索名称 / 编码"
        loading={loading}
        onRefresh={() => void load()}
        onRowClick={(row) => (canWrite ? navigate(`/automation/${row.code}/design`) : setExecsFor(row))}
        actionSlot={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setCredsOpen(true)}>
              <KeyRound className="size-3.5" /> 凭据
            </Button>
            {canWrite && (
              <Button size="sm" className="h-8 gap-1" onClick={() => navigate("/automation/new/design")}>
                <Plus className="size-4" /> 新建编排
              </Button>
            )}
          </div>
        }
      />

      <ExecsDrawer flow={execsFor} open={execsFor !== null} onClose={() => setExecsFor(null)} />

      {/* 删除编排流程确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除编排「{deleteTarget?.name}」?</AlertDialogTitle>
            <AlertDialogDescription>
              将删除该自动化编排及其执行记录,不可恢复。若有触发器(定时/事件/Webhook)将一并失效。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={async () => {
                if (!deleteTarget) return
                setDeleting(true)
                try {
                  await deleteFlow(deleteTarget.id)
                  toast.success(`已删除「${deleteTarget.name}」`)
                  setDeleteTarget(null)
                  void load()
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "删除失败")
                } finally {
                  setDeleting(false)
                }
              }}
            >
              {deleting ? "删除中…" : "删除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CredentialsDialog open={credsOpen} onClose={() => setCredsOpen(false)} />
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Plus, ShieldAlert, Trash2, UserRoundCog } from "lucide-react"
import { toast } from "sonner"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { Modal } from "@/components/modal"
import { OrgPicker, OrgPickerField, type OrgRef } from "@/components/org-picker"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { BackendDownCard } from "@/pages/approval/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuthStore } from "@/stores/auth-store"
import { wfFormatTime, type WfDelegateRule, type WfStartableDef } from "@/types/workflow"

const ALL_DEFS = "__ALL__"

/** 委托规则面板（我的审批「我的委托」Tab 内容） */
export function DelegatePanel() {
  const offline = useAuthStore((s) => s.offline)
  const [rows, setRows] = useState<WfDelegateRule[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [defs, setDefs] = useState<WfStartableDef[]>([])

  // 新建弹窗
  const [creating, setCreating] = useState(false)
  const [delegateTo, setDelegateTo] = useState<OrgRef[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [defCode, setDefCode] = useState<string>(ALL_DEFS)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // 删除确认
  const [deleting, setDeleting] = useState<WfDelegateRule | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await api<WfDelegateRule[] | PageResult<WfDelegateRule>>("/api/wf/delegate-rules")
      setRows(Array.isArray(data) ? data : data.list)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
    api<WfStartableDef[]>("/api/wf/startable")
      .then((d) => setDefs(Array.isArray(d) ? d : []))
      .catch(() => setDefs([]))
  }, [load, offline])

  const openCreate = () => {
    setDelegateTo([])
    setDefCode(ALL_DEFS)
    setStartDate("")
    setEndDate("")
    setEnabled(true)
    setCreating(true)
  }

  const submit = useCallback(async () => {
    const to = delegateTo[0]
    if (!to) return
    setSubmitting(true)
    try {
      await api("/api/wf/delegate-rules", {
        method: "POST",
        body: JSON.stringify({
          delegateToId: to.id,
          defCode: defCode === ALL_DEFS ? null : defCode,
          startDate,
          endDate,
          enabled,
        }),
      })
      toast.success("委托规则已创建")
      setCreating(false)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败")
    } finally {
      setSubmitting(false)
    }
  }, [delegateTo, defCode, startDate, endDate, enabled, load])

  const remove = useCallback(async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api(`/api/wf/delegate-rules/${deleting.id}`, { method: "DELETE" })
      toast.success("委托规则已删除")
      setDeleting(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteBusy(false)
    }
  }, [deleting, load])

  const columns = useMemo<ColumnDef<WfDelegateRule, unknown>[]>(
    () => [
      {
        accessorKey: "delegateToName",
        meta: { title: "受托人" },
        header: () => <span>受托人</span>,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.delegateToName ?? `用户#${row.original.delegateToId}`}</span>
        ),
      },
      {
        accessorKey: "defName",
        meta: { title: "适用流程" },
        header: () => <span>适用流程</span>,
        cell: ({ row }) =>
          row.original.defCode ? (
            <Badge variant="outline">{row.original.defName ?? row.original.defCode}</Badge>
          ) : (
            <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
              全部流程
            </Badge>
          ),
      },
      {
        id: "period",
        meta: { title: "生效期间" },
        header: () => <span>生效期间</span>,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {(row.original.startDate ?? "—").slice(0, 10)} ~ {(row.original.endDate ?? "—").slice(0, 10)}
          </span>
        ),
      },
      {
        accessorKey: "enabled",
        meta: { title: "状态" },
        header: () => <span>状态</span>,
        cell: ({ row }) =>
          row.original.enabled ? (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
              启用
            </Badge>
          ) : (
            <Badge variant="outline" className="border-gray-500/30 bg-gray-500/10 text-gray-500">
              停用
            </Badge>
          ),
      },
      {
        accessorKey: "createdAt",
        meta: { title: "创建时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="创建时间" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{wfFormatTime(row.original.createdAt)}</span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-600"
            onClick={(e) => {
              e.stopPropagation()
              setDeleting(row.original)
            }}
          >
            <Trash2 className="size-3.5" /> 删除
          </Button>
        ),
      },
    ],
    [],
  )

  const canSubmit = delegateTo.length > 0 && !!startDate && !!endDate && startDate <= endDate

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          预设代理人：命中期间内的新任务自动挂给受托人，双方均可办理与查看
        </p>
        <Button size="sm" className="gap-1.5" onClick={openCreate} disabled={offline}>
          <Plus className="size-3.5" /> 新建委托
        </Button>
      </div>

      {loadError === "network" ? (
        <BackendDownCard onRetry={() => void load()} />
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          searchKeys={["delegateToName", "defName"]}
          searchPlaceholder="搜索受托人 / 流程"
          onRefresh={() => void load()}
          exportFileName="我的代理"
        />
      )}

      {/* 新建委托 */}
      <Modal
        open={creating}
        onOpenChange={(open) => !open && !submitting && setCreating(false)}
        title="新建委托规则"
        description="设定受托人、适用流程与生效期间"
        width={480}
        resizable={false}
        fullscreenable={false}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={() => void submit()} disabled={submitting || !canSubmit}>
              {submitting ? "提交中…" : "确认创建"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">
              <span className="text-destructive">*</span> 受托人
            </Label>
            <OrgPickerField
              value={delegateTo}
              multiple={false}
              placeholder="选择一位受托人"
              onOpen={() => setPickerOpen(true)}
              onRemove={() => setDelegateTo([])}
            />
            <OrgPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              multiple={false}
              title="选择受托人"
              value={delegateTo}
              onConfirm={setDelegateTo}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">适用流程</Label>
            <Select value={defCode} onValueChange={setDefCode}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_DEFS}>全部流程</SelectItem>
                {defs.map((d) => (
                  <SelectItem key={d.defCode} value={d.defCode}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">
                <span className="text-destructive">*</span> 开始日期
              </Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                <span className="text-destructive">*</span> 结束日期
              </Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <UserRoundCog className="size-4 text-muted-foreground" /> 立即启用
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={!!deleting}
        onOpenChange={(open) => !open && !deleteBusy && setDeleting(null)}
        title="删除委托规则"
        description={deleting?.delegateToName}
        width={420}
        resizable={false}
        fullscreenable={false}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={deleteBusy}>
              {deleteBusy ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">删除后该委托规则立即失效，确定要删除吗？</p>
      </Modal>
    </div>
  )
}

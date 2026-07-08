import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Activity,
  ArrowRightLeft,
  CheckCircle2,
  CircleSlash,
  Clock,
  Loader2,
  ShieldAlert,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { PageHeader } from "@/components/page-header"
import { PermissionBanner } from "@/components/permission-banner"
import { Modal } from "@/components/modal"
import { OrgPicker, OrgPickerField, type OrgRef } from "@/components/org-picker"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { BackendDownCard } from "@/pages/approval/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"
import {
  WF_STATUS_META,
  wfFormatTime,
  wfInstancePath,
  type WfAdminInstance,
} from "@/types/workflow"

const ADMIN_PERM = "wf:instance:admin"

/* ================= 监控接口契约（后端并行开发中） ================= */

/** GET /api/wf/monitor/overview */
interface WfMonitorOverview {
  running: number
  approved: number
  rejected: number
  terminated: number
  timeout: number
  byDef: { defCode: string; defName: string; count: number }[]
}

/** GET /api/wf/monitor/bottleneck */
interface WfMonitorBottleneck {
  defCode: string
  defName: string
  nodeId: string
  nodeName: string
  avgDurationMs: number
  count: number
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "—"
  const h = ms / 3_600_000
  if (h >= 24) return `${(h / 24).toFixed(1)} 天`
  if (h >= 1) return `${h.toFixed(1)} 小时`
  const m = ms / 60_000
  if (m >= 1) return `${m.toFixed(0)} 分钟`
  return `${(ms / 1000).toFixed(0)} 秒`
}

/* ================= 运行总览 Tab ================= */

const STATUS_CARDS: {
  key: keyof Pick<WfMonitorOverview, "running" | "approved" | "rejected" | "terminated" | "timeout">
  label: string
  icon: typeof Activity
  className: string
}[] = [
  { key: "running", label: "运行中", icon: Loader2, className: "text-blue-600 bg-blue-500/10" },
  { key: "approved", label: "已通过", icon: CheckCircle2, className: "text-emerald-600 bg-emerald-500/10" },
  { key: "rejected", label: "已驳回", icon: XCircle, className: "text-rose-600 bg-rose-500/10" },
  { key: "terminated", label: "已终止", icon: CircleSlash, className: "text-orange-600 bg-orange-500/10" },
  { key: "timeout", label: "超时", icon: Clock, className: "text-amber-600 bg-amber-500/10" },
]

function OverviewTab() {
  const offline = useAuthStore((s) => s.offline)
  const [overview, setOverview] = useState<WfMonitorOverview | null>(null)
  const [bottleneck, setBottleneck] = useState<WfMonitorBottleneck[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ov, bn] = await Promise.all([
        api<WfMonitorOverview>("/api/wf/monitor/overview"),
        api<WfMonitorBottleneck[]>("/api/wf/monitor/bottleneck").catch(() => [] as WfMonitorBottleneck[]),
      ])
      setOverview(ov)
      setBottleneck(Array.isArray(bn) ? bn : [])
    } catch (err) {
      if (err instanceof NetworkError) setError("network")
      else setError(err instanceof Error ? err.message : "监控数据加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setError("network")
      return
    }
    void load()
  }, [load, offline])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {STATUS_CARDS.map((c) => (
            <Skeleton key={c.key} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-52 w-full" />
      </div>
    )
  }

  if (error === "network") {
    return <BackendDownCard onRetry={() => void load()} />
  }
  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <ShieldAlert className="size-8 text-rose-500/60" />
          <div className="text-sm">监控接口尚未就绪：{error}</div>
          <p className="max-w-md text-xs text-muted-foreground">
            运行总览依赖 <code>GET /api/wf/monitor/overview</code> 与{" "}
            <code>GET /api/wf/monitor/bottleneck</code>，后端接口就绪后此处自动展示真实统计。
          </p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            重试
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (!overview) return null

  const maxByDef = Math.max(1, ...overview.byDef.map((d) => d.count))
  const maxBn = Math.max(1, ...bottleneck.map((b) => b.avgDurationMs))

  return (
    <div className="space-y-4">
      {/* 状态计数卡片 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {STATUS_CARDS.map((c) => (
          <Card key={c.key} className="py-4">
            <CardContent className="flex items-center gap-3.5 px-4">
              <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg", c.className)}>
                <c.icon className="size-5.5" />
              </div>
              <div>
                <div className="text-2xl font-semibold leading-tight">{overview[c.key]}</div>
                <div className="text-xs text-muted-foreground">{c.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* 按流程维度分布 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">按流程分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview.byDef.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无流程实例</div>
            ) : (
              overview.byDef.map((d) => (
                <div key={d.defCode} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate">{d.defName}</span>
                    <span className="shrink-0 text-muted-foreground">{d.count}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/75"
                      style={{ width: `${(d.count / maxByDef) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* 节点瓶颈：各节点平均停留 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">节点瓶颈 · 平均停留时长</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {bottleneck.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无节点停留数据</div>
            ) : (
              bottleneck.map((b, i) => (
                <div key={`${b.defCode}-${b.nodeId}-${i}`} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="text-muted-foreground">{b.defName} · </span>
                      {b.nodeName}
                    </span>
                    <span className="shrink-0 font-medium">{formatDuration(b.avgDurationMs)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-amber-500/70"
                      style={{ width: `${(b.avgDurationMs / maxBn) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/* ================= 实例管理 Tab（治理 + 离职交接） ================= */

function InstancesTab() {
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const [rows, setRows] = useState<WfAdminInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 离职交接
  const [handover, setHandover] = useState(false)
  const [fromUser, setFromUser] = useState<OrgRef[]>([])
  const [toUser, setToUser] = useState<OrgRef[]>([])
  const [fromOpen, setFromOpen] = useState(false)
  const [toOpen, setToOpen] = useState(false)
  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<WfAdminInstance>>(
        "/api/wf/instances/admin?pageNum=1&pageSize=100",
      )
      setRows(page.list)
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
  }, [load, offline])

  const openHandover = () => {
    setFromUser([])
    setToUser([])
    setComment("")
    setHandover(true)
  }

  const submitHandover = useCallback(async () => {
    const from = fromUser[0]
    const to = toUser[0]
    if (!from || !to) return
    setSubmitting(true)
    try {
      await api("/api/wf/handover", {
        method: "POST",
        body: JSON.stringify({ fromUserId: from.id, toUserId: to.id, comment: comment.trim() || undefined }),
      })
      toast.success(`已将 ${from.name} 的在途任务交接给 ${to.name}`)
      setHandover(false)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "交接失败")
    } finally {
      setSubmitting(false)
    }
  }, [fromUser, toUser, comment, load])

  const columns = useMemo<ColumnDef<WfAdminInstance, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        meta: { title: "标题" },
        header: () => <span>标题</span>,
        cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
      },
      {
        accessorKey: "defName",
        meta: { title: "流程" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="流程" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.defName ?? "—"}</Badge>,
      },
      {
        accessorKey: "initiatorName",
        meta: { title: "发起人" },
        header: () => <span>发起人</span>,
        cell: ({ row }) => row.original.initiatorName ?? "—",
      },
      {
        accessorKey: "bizStatus",
        meta: { title: "状态" },
        header: () => <span>状态</span>,
        filterFn: "arrIncludesSome",
        cell: ({ row }) => {
          const meta = WF_STATUS_META[row.original.bizStatus]
          return (
            <Badge variant="outline" className={meta?.className}>
              {meta?.label ?? row.original.bizStatus}
            </Badge>
          )
        },
      },
      {
        id: "currentNodes",
        meta: { title: "当前节点" },
        header: () => <span>当前节点</span>,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.currentNodeNames?.length ? row.original.currentNodeNames.join("、") : "—"}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        meta: { title: "发起时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="发起时间" />,
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
            className="h-7 px-2 text-xs text-primary hover:text-primary"
            onClick={(e) => {
              e.stopPropagation()
              navigate(wfInstancePath(row.original))
            }}
          >
            查看
          </Button>
        ),
      },
    ],
    [navigate],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          全流程实例：跳转 / 终止 / 追加节点等治理操作在实例详情内进行
        </p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={openHandover} disabled={offline}>
          <ArrowRightLeft className="size-3.5" /> 离职交接
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
          searchKeys={["title", "defName", "initiatorName"]}
          searchPlaceholder="搜索标题 / 流程 / 发起人"
          facetedFilters={[{ columnId: "bizStatus", title: "状态" }]}
          onRowClick={(row) => navigate(wfInstancePath(row))}
          onRefresh={() => void load()}
          exportFileName="流程实例"
        />
      )}

      {/* 离职交接 */}
      <Modal
        open={handover}
        onOpenChange={(open) => !open && !submitting && setHandover(false)}
        title="离职交接"
        description="将某人全部在途任务批量转办给接收人"
        width={480}
        resizable={false}
        fullscreenable={false}
        footer={
          <>
            <Button variant="outline" onClick={() => setHandover(false)} disabled={submitting}>
              取消
            </Button>
            <Button
              onClick={() => void submitHandover()}
              disabled={submitting || fromUser.length === 0 || toUser.length === 0}
            >
              {submitting ? "交接中…" : "确认交接"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">
              <span className="text-destructive">*</span> 离职人（交出任务）
            </Label>
            <OrgPickerField
              value={fromUser}
              multiple={false}
              placeholder="选择离职人"
              onOpen={() => setFromOpen(true)}
              onRemove={() => setFromUser([])}
            />
            <OrgPicker
              open={fromOpen}
              onOpenChange={setFromOpen}
              multiple={false}
              title="选择离职人"
              value={fromUser}
              onConfirm={setFromUser}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              <span className="text-destructive">*</span> 接收人（承接任务）
            </Label>
            <OrgPickerField
              value={toUser}
              multiple={false}
              placeholder="选择接收人"
              onOpen={() => setToOpen(true)}
              onRemove={() => setToUser([])}
            />
            <OrgPicker
              open={toOpen}
              onOpenChange={setToOpen}
              multiple={false}
              title="选择接收人"
              value={toUser}
              onConfirm={setToUser}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">交接说明</Label>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="选填" />
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ================= 流程监控主页 ================= */

const MONITOR_TABS = ["overview", "instances"] as const
type MonitorTab = (typeof MONITOR_TABS)[number]

function isMonitorTab(v: string | null): v is MonitorTab {
  return v != null && (MONITOR_TABS as readonly string[]).includes(v)
}

export default function WorkflowMonitorPage() {
  const allowed = useHasPerm(ADMIN_PERM)
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get("tab")
  const tab: MonitorTab = isMonitorTab(tabParam) ? tabParam : "overview"

  const onTabChange = useCallback(
    (value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set("tab", value)
        return next
      })
    },
    [setSearchParams],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="流程监控"
        description={allowed ? "运行总览统计与全实例治理、离职交接" : "流程监控需要管理员权限"}
      />

      {!allowed ? (
        <PermissionBanner perm={ADMIN_PERM} action="流程监控" />
      ) : (
        <Tabs value={tab} onValueChange={onTabChange}>
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="overview" className="flex-none gap-1.5">
              <Activity className="size-4" /> 运行总览
            </TabsTrigger>
            <TabsTrigger value="instances" className="flex-none gap-1.5">
              <ArrowRightLeft className="size-4" /> 实例管理
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="instances" className="mt-4">
            <InstancesTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

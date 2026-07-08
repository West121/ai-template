import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { CloudOff, RotateCw, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import { useAuthStore } from "@/stores/auth-store"

/** 后端 Document 响应（direction=RECEIVE） */
interface DocumentRow {
  id: number
  direction: string
  code: string
  title: string
  /** 来文单位 */
  unit: string
  secret: string
  urgency: string
  status: string
  drafter?: string
  signer?: string
  docDate?: string
  deptId?: number
  deptName?: string
  createdAt?: string
}

function formatTime(iso?: string) {
  if (!iso) return "—"
  return iso.slice(0, 16).replace("T", " ")
}

function StatusBadge({ status }: { status: string }) {
  if (status === "TO_SIGN") {
    return (
      <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
        待签收
      </Badge>
    )
  }
  if (status === "PROCESSING") {
    return (
      <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600">
        办理中
      </Badge>
    )
  }
  if (status === "FINISHED") {
    return (
      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
        已办结
      </Badge>
    )
  }
  return <Badge variant="outline">{status}</Badge>
}

function SecretBadge({ secret }: { secret: string }) {
  if (secret === "SECRET") {
    return (
      <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-600">
        秘密
      </Badge>
    )
  }
  if (secret === "INTERNAL") {
    return (
      <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
        内部
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
      公开
    </Badge>
  )
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  if (urgency === "EXTRA") {
    return (
      <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-600">
        特急
      </Badge>
    )
  }
  if (urgency === "URGENT") {
    return (
      <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
        加急
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      普通
    </Badge>
  )
}

export default function ReceivePage() {
  const [rows, setRows] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState("all")

  // 详情对话框
  const [detailDoc, setDetailDoc] = useState<DocumentRow | null>(null)

  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<DocumentRow>>(
        "/api/office/documents?direction=RECEIVE&pageNum=1&pageSize=100",
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
    // 切换身份后数据权限变化，重新拉取
    void load()
  }, [load, offline, activeAssignmentId])

  const filteredRows = useMemo(
    () => (statusFilter === "all" ? rows : rows.filter((d) => d.status === statusFilter)),
    [rows, statusFilter],
  )

  const act = useCallback(async (doc: DocumentRow, action: "sign" | "finish") => {
    try {
      await api(`/api/office/documents/${doc.id}/${action}`, { method: "POST" })
      const nextStatus = action === "sign" ? "PROCESSING" : "FINISHED"
      setRows((prev) => prev.map((d) => (d.id === doc.id ? { ...d, status: nextStatus } : d)))
      toast.success(
        action === "sign" ? `已签收《${doc.title}》，进入办理流程` : `《${doc.title}》已办结`,
      )
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
      return false
    }
  }, [])

  const handleBatchSign = useCallback(
    async (selected: DocumentRow[], clear: () => void) => {
      const pending = selected.filter((r) => r.status === "TO_SIGN")
      if (pending.length === 0) {
        toast.warning("所选公文中没有待签收的公文")
        return
      }
      let ok = 0
      for (const doc of pending) {
        if (await act(doc, "sign")) ok += 1
      }
      clear()
      if (ok > 0) toast.success(`已批量签收 ${ok} 份公文`)
    },
    [act],
  )

  const columns = useMemo<ColumnDef<DocumentRow, unknown>[]>(
    () => [
      {
        accessorKey: "code",
        meta: { title: "文号" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="文号" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.code}</span>
        ),
      },
      {
        accessorKey: "title",
        meta: { title: "标题" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="标题" />,
        cell: ({ row }) => (
          <span className="block max-w-72 truncate font-medium" title={row.original.title}>
            {row.original.title}
          </span>
        ),
      },
      {
        accessorKey: "unit",
        meta: { title: "来文单位" },
        header: () => <span>来文单位</span>,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.unit}</span>,
      },
      {
        accessorKey: "secret",
        meta: { title: "密级" },
        header: () => <span>密级</span>,
        cell: ({ row }) => <SecretBadge secret={row.original.secret} />,
      },
      {
        accessorKey: "urgency",
        meta: { title: "紧急程度" },
        header: () => <span>紧急程度</span>,
        cell: ({ row }) => <UrgencyBadge urgency={row.original.urgency} />,
      },
      {
        accessorKey: "docDate",
        meta: { title: "收文日期" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="收文日期" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.docDate ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        meta: { title: "状态" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {row.original.status === "TO_SIGN" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-primary"
                onClick={() => void act(row.original, "sign")}
              >
                签收
              </Button>
            )}
            {row.original.status === "PROCESSING" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-emerald-600 hover:text-emerald-600"
                onClick={() => void act(row.original, "finish")}
              >
                办结
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setDetailDoc(row.original)}
            >
              详情
            </Button>
          </div>
        ),
      },
    ],
    [act],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="收文管理"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为真实数据（随身份/数据权限变化）"
            : "统一登记、签收与办理来文，跟踪公文办理进度"
        }
      />

      {loadError === "network" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot
              spring-boot:run，然后重新登录，即可查看按数据权限过滤的真实收文台账。
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => void load()}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
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
          data={filteredRows}
          searchKeys={["code", "title"]}
          searchPlaceholder="搜索文号 / 标题"
          loading={loading}
          onRefresh={() => void load()}
          exportFileName="收文台账"
          enableSelection
          filterSlot={
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger size="sm" className="h-8 w-32 text-sm">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="TO_SIGN">待签收</SelectItem>
                <SelectItem value="PROCESSING">办理中</SelectItem>
                <SelectItem value="FINISHED">已办结</SelectItem>
              </SelectContent>
            </Select>
          }
          batchSlot={(selected, clear) => (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => void handleBatchSign(selected, clear)}
            >
              批量签收
            </Button>
          )}
        />
      )}

      {/* 详情对话框 */}
      <Dialog open={detailDoc !== null} onOpenChange={(open) => !open && setDetailDoc(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>公文详情</DialogTitle>
            <DialogDescription>{detailDoc?.title}</DialogDescription>
          </DialogHeader>
          {detailDoc && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              <div>
                <span className="text-muted-foreground">文号：</span>
                <span className="font-mono text-xs">{detailDoc.code}</span>
              </div>
              <div>
                <span className="text-muted-foreground">来文单位：</span>
                {detailDoc.unit}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">密级：</span>
                <SecretBadge secret={detailDoc.secret} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">紧急程度：</span>
                <UrgencyBadge urgency={detailDoc.urgency} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">状态：</span>
                <StatusBadge status={detailDoc.status} />
              </div>
              <div>
                <span className="text-muted-foreground">收文日期：</span>
                <span className="font-mono text-xs">{detailDoc.docDate ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">所属部门：</span>
                {detailDoc.deptName ?? "—"}
              </div>
              <div>
                <span className="text-muted-foreground">登记时间：</span>
                <span className="font-mono text-xs">{formatTime(detailDoc.createdAt)}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            {detailDoc?.status === "TO_SIGN" && (
              <Button
                onClick={() => {
                  if (detailDoc) void act(detailDoc, "sign")
                  setDetailDoc(null)
                }}
              >
                签收
              </Button>
            )}
            {detailDoc?.status === "PROCESSING" && (
              <Button
                onClick={() => {
                  if (detailDoc) void act(detailDoc, "finish")
                  setDetailDoc(null)
                }}
              >
                办结
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailDoc(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

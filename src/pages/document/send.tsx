import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"
import { CloudOff, Plus, RotateCw, ShieldAlert } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"

/** 后端 Document 响应（direction=SEND） */
interface DocumentRow {
  id: number
  direction: string
  code: string
  title: string
  /** 主送单位 */
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

function StatusBadge({ status }: { status: string }) {
  if (status === "DRAFT") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        拟稿
      </Badge>
    )
  }
  if (status === "REVIEWING") {
    return (
      <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
        核稿中
      </Badge>
    )
  }
  if (status === "ISSUED") {
    return (
      <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600">
        已签发
      </Badge>
    )
  }
  if (status === "PUBLISHED") {
    return (
      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
        已发布
      </Badge>
    )
  }
  return <Badge variant="outline">{status}</Badge>
}

export default function SendPage() {
  const [rows, setRows] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 新建发文对话框
  const [createOpen, setCreateOpen] = useState(false)
  const [formTitle, setFormTitle] = useState("")
  const [formUnit, setFormUnit] = useState("")
  const [formSecret, setFormSecret] = useState("PUBLIC")
  const [formUrgency, setFormUrgency] = useState("NORMAL")
  const [formContent, setFormContent] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // 删除确认对话框
  const [deleteDoc, setDeleteDoc] = useState<DocumentRow | null>(null)

  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)
  const canEdit = useHasPerm("office:document:edit")

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<DocumentRow>>(
        "/api/office/documents?direction=SEND&pageNum=1&pageSize=100",
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

  const openCreate = () => {
    setFormTitle("")
    setFormUnit("")
    setFormSecret("PUBLIC")
    setFormUrgency("NORMAL")
    setFormContent("")
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    if (!formTitle.trim() || !formUnit.trim()) {
      toast.warning("请填写标题和主送单位")
      return
    }
    setSubmitting(true)
    try {
      await api("/api/office/documents", {
        method: "POST",
        body: JSON.stringify({
          direction: "SEND",
          title: formTitle.trim(),
          unit: formUnit.trim(),
          secret: formSecret,
          urgency: formUrgency,
          content: formContent.trim() || undefined,
        }),
      })
      setCreateOpen(false)
      toast.success("发文已创建，文号自动生成，当前状态为拟稿")
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败")
    } finally {
      setSubmitting(false)
    }
  }

  const act = useCallback(
    async (doc: DocumentRow, action: "review" | "issue") => {
      try {
        await api(`/api/office/documents/${doc.id}/${action}`, { method: "POST" })
        toast.success(
          action === "review"
            ? `《${doc.title}》已送核，等待核稿人审核`
            : `《${doc.title}》已签发`,
        )
        void load()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "操作失败")
      }
    },
    [load],
  )

  const confirmDelete = async () => {
    if (!deleteDoc) return
    try {
      await api(`/api/office/documents/${deleteDoc.id}`, { method: "DELETE" })
      toast.success(`已删除发文《${deleteDoc.title}》`)
      setRows((prev) => prev.filter((d) => d.id !== deleteDoc.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteDoc(null)
    }
  }

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
        meta: { title: "主送单位" },
        header: () => <span>主送单位</span>,
        cell: ({ row }) => (
          <span className="block max-w-44 truncate text-muted-foreground" title={row.original.unit}>
            {row.original.unit}
          </span>
        ),
      },
      {
        accessorKey: "drafter",
        meta: { title: "拟稿人" },
        header: () => <span>拟稿人</span>,
        cell: ({ row }) => <span>{row.original.drafter ?? "—"}</span>,
      },
      {
        accessorKey: "status",
        meta: { title: "核稿状态" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="核稿状态" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "signer",
        meta: { title: "签发人" },
        header: () => <span>签发人</span>,
        cell: ({ row }) =>
          row.original.signer ? (
            <span>{row.original.signer}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "docDate",
        meta: { title: "发文日期" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="发文日期" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.docDate ?? "—"}
          </span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {row.original.status === "DRAFT" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-primary"
                onClick={() => void act(row.original, "review")}
              >
                送核
              </Button>
            )}
            {row.original.status === "REVIEWING" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-blue-600 hover:text-blue-600"
                onClick={() => void act(row.original, "issue")}
              >
                签发
              </Button>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-rose-600 hover:text-rose-600"
                onClick={() => setDeleteDoc(row.original)}
              >
                删除
              </Button>
            )}
          </div>
        ),
      },
    ],
    [act, canEdit],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="发文管理"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为真实数据（随身份/数据权限变化）"
            : "发文拟稿、核稿、签发与发布全流程管理"
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
              spring-boot:run，然后重新登录，即可体验真实的发文拟稿、送核与签发流程。
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
          data={rows}
          searchKeys={["code", "title"]}
          searchPlaceholder="搜索文号 / 标题"
          loading={loading}
          onRefresh={() => void load()}
          exportFileName="发文台账"
          actionSlot={
            <Button size="sm" className="h-8" onClick={openCreate}>
              <Plus className="size-4" />
              新建发文
            </Button>
          }
        />
      )}

      {/* 新建发文对话框 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建发文</DialogTitle>
            <DialogDescription>填写发文基本信息，创建后文号自动生成，初始状态为拟稿。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="doc-title">标题</Label>
              <Input
                id="doc-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="如：关于开展×××工作的通知"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-unit">主送单位</Label>
              <Input
                id="doc-unit"
                value={formUnit}
                onChange={(e) => setFormUnit(e.target.value)}
                placeholder="如：各分公司、各部门"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>密级</Label>
                <Select value={formSecret} onValueChange={setFormSecret}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择密级" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PUBLIC">公开</SelectItem>
                    <SelectItem value="INTERNAL">内部</SelectItem>
                    <SelectItem value="SECRET">秘密</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>紧急程度</Label>
                <Select value={formUrgency} onValueChange={setFormUrgency}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择紧急程度" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NORMAL">普通</SelectItem>
                    <SelectItem value="URGENT">加急</SelectItem>
                    <SelectItem value="EXTRA">特急</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-content">正文</Label>
              <Textarea
                id="doc-content"
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="请输入公文正文内容…"
                rows={5}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button disabled={submitting} onClick={() => void handleCreate()}>
              {submitting ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDoc !== null} onOpenChange={(open) => !open && setDeleteDoc(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除发文</DialogTitle>
            <DialogDescription>
              确定要删除《{deleteDoc?.title}》（{deleteDoc?.code}）吗？删除后不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDoc(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

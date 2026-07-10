import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { CloudOff, Download, RotateCw, ShieldAlert, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { PermissionBanner } from "@/components/permission-banner"
import { Modal } from "@/components/modal"
import { FileUploader, formatFileSize, getFileIcon } from "@/components/file-uploader"
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
import { useAuthStore, useHasPerm } from "@/stores/auth-store"

/** 后端 FileRecord（见 docs/api-contract.md 基础设施域） */
interface FileRecord {
  id: number
  originalName: string
  ext?: string | null
  size: number
  contentType?: string | null
  storageType: "LOCAL" | "MINIO" | "S3"
  objectKey?: string
  uploaderId?: number
  uploaderName?: string | null
  createdAt?: string | null
}

const STORAGE_BADGE: Record<FileRecord["storageType"], string> = {
  LOCAL: "border-transparent bg-muted text-muted-foreground",
  MINIO: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  S3: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
}

function formatTime(iso?: string | null) {
  if (!iso) return "—"
  return iso.slice(0, 16).replace("T", " ")
}

/** 直接 window.open 不带 Authorization 会 401，这里 fetch blob 后用 a[download] 触发保存 */
async function downloadFile(row: FileRecord) {
  const { token } = useAuthStore.getState()
  try {
    const res = await fetch(`/api/infra/files/${row.id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = row.originalName
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "下载失败")
  }
}

export default function FilePage() {
  const [rows, setRows] = useState<FileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FileRecord | null>(null)

  const offline = useAuthStore((s) => s.offline)
  const canEdit = useHasPerm("system:file:edit")

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<FileRecord>>("/api/infra/files?pageNum=1&pageSize=100")
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

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await api(`/api/infra/files/${deleteTarget.id}`, { method: "DELETE" })
      toast.success(`文件「${deleteTarget.originalName}」已删除`)
      setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteTarget(null)
    }
  }

  const columns = useMemo<ColumnDef<FileRecord, unknown>[]>(
    () => [
      {
        accessorKey: "originalName",
        meta: { title: "文件名" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="文件名" />,
        cell: ({ row }) => {
          const Icon = getFileIcon(row.original.originalName)
          return (
            <span className="flex items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="max-w-[280px] truncate font-medium">{row.original.originalName}</span>
            </span>
          )
        },
      },
      {
        accessorKey: "ext",
        meta: { title: "扩展名" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="扩展名" />,
        cell: ({ row }) =>
          row.original.ext ? (
            <Badge variant="outline" className="font-mono text-xs uppercase">
              {row.original.ext}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "size",
        meta: { title: "大小", filterType: "number" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="大小" />,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">{formatFileSize(row.original.size)}</span>
        ),
      },
      {
        accessorKey: "storageType",
        meta: { title: "存储", filterType: "select", options: ["LOCAL", "MINIO", "S3"] },
        header: ({ column }) => <DataTableColumnHeader column={column} title="存储" />,
        cell: ({ row }) => (
          <Badge variant="outline" className={cn("text-xs", STORAGE_BADGE[row.original.storageType])}>
            {row.original.storageType}
          </Badge>
        ),
      },
      {
        accessorKey: "uploaderName",
        meta: { title: "上传人" },
        header: () => <span>上传人</span>,
        cell: ({ row }) => row.original.uploaderName ?? "—",
      },
      {
        accessorKey: "createdAt",
        meta: { title: "上传时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="上传时间" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatTime(row.original.createdAt)}</span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => void downloadFile(row.original)}
            >
              <Download className="size-3.5" /> 下载
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canEdit}
              className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-600"
              onClick={() => setDeleteTarget(row.original)}
            >
              <Trash2 className="size-3.5" /> 删除
            </Button>
          </div>
        ),
      },
    ],
    [canEdit],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="文件管理"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为真实数据"
            : "统一文件中心：存储后端支持 本地磁盘 / MinIO / S3 一键切换（oa.storage.type），大文件分片上传、秒传与断点续传"
        }
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setUploadOpen(true)}>
            <Upload className="size-4" />
            上传文件
          </Button>
        }
      />

      <PermissionBanner perm="system:file:edit" action="文件删除" />

      {loadError === "network" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，
              然后用 admin（密码 admin123）重新登录，即可体验本地 / MinIO / S3 可切换的文件上传、下载与分片续传。
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
          loading={loading}
          searchKeys={["originalName", "ext", "uploaderName"]}
          searchPlaceholder="搜索文件名 / 扩展名 / 上传人"
          advancedFilter
          onRefresh={() => void load()}
          exportFileName="文件列表"
        />
      )}

      {/* 上传弹窗 */}
      <Modal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title="上传文件"
        description="小文件直传；超过 5MB 自动分片，支持秒传、断点续传与暂停继续"
        width={640}
      >
        <FileUploader
          onUploaded={(file) => {
            toast.success(`「${file.originalName}」上传成功`)
            void load()
          }}
        />
      </Modal>

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除文件</DialogTitle>
            <DialogDescription>
              确定删除文件「{deleteTarget?.originalName}」吗？将同时删除存储中的对象，此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
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

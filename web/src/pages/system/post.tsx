import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { CloudOff, Pencil, Plus, RotateCw, ShieldAlert, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { PermissionBanner } from "@/components/permission-banner"
import { DataTable, indexColumn } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { runBatch, toastBatch } from "@/lib/batch"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { useAuthStore, useHasPerm } from "@/stores/auth-store"

interface PostRow {
  id: number
  code: string
  name: string
  sort: number
  userCount: number
}

interface PostForm {
  name: string
  code: string
  sort: string
}

const emptyForm: PostForm = { name: "", code: "", sort: "10" }

export default function PostPage() {
  const [rows, setRows] = useState<PostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const offline = useAuthStore((s) => s.offline)
  const canEdit = useHasPerm("system:post:edit")

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PostRow | null>(null)
  const [form, setForm] = useState<PostForm>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PostRow | null>(null)
  const [batchDel, setBatchDel] = useState<{ rows: PostRow[]; clear: () => void } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<PostRow>>("/api/system/posts?pageNum=1&pageSize=100")
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

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (row: PostRow) => {
    setEditing(row)
    setForm({ name: row.name, code: row.code, sort: String(row.sort) })
    setFormOpen(true)
  }

  const submitForm = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error("请填写岗位名称和岗位编码")
      return
    }
    setSubmitting(true)
    const body = JSON.stringify({
      code: form.code.trim(),
      name: form.name.trim(),
      sort: Number(form.sort) || 0,
    })
    try {
      if (editing) {
        await api(`/api/system/posts/${editing.id}`, { method: "PUT", body })
        toast.success(`岗位「${form.name.trim()}」已更新`)
      } else {
        await api("/api/system/posts", { method: "POST", body })
        toast.success(`岗位「${form.name.trim()}」已创建`)
      }
      setFormOpen(false)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await api(`/api/system/posts/${deleteTarget.id}`, { method: "DELETE" })
      toast.success(`岗位「${deleteTarget.name}」已删除`)
      setRows((prev) => prev.filter((p) => p.id !== deleteTarget.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteTarget(null)
    }
  }

  const confirmBatchDelete = async () => {
    if (!batchDel) return
    const ids = batchDel.rows.map((r) => r.id)
    const result = await runBatch({
      ids,
      batchPath: "/api/system/posts/batch-delete",
      single: (id) => api(`/api/system/posts/${id}`, { method: "DELETE" }),
    })
    toastBatch(result, "删除")
    batchDel.clear()
    setBatchDel(null)
    void load()
  }

  const columns: ColumnDef<PostRow, unknown>[] = useMemo(
    () => [
      indexColumn<PostRow>(),
      {
        accessorKey: "code",
        meta: { title: "岗位编码", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="岗位编码" />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        accessorKey: "name",
        meta: { title: "岗位名称", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="岗位名称" />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "sort",
        meta: { title: "排序", filterType: "number" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="排序" />,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">{row.original.sort}</span>
        ),
      },
      {
        accessorKey: "userCount",
        meta: { title: "在岗人数", filterType: "number" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="在岗人数" />,
        cell: ({ row }) => <span className="tabular-nums">{row.original.userCount} 人</span>,
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
              disabled={!canEdit}
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => openEdit(row.original)}
            >
              <Pencil className="size-3.5" />
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canEdit}
              className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-600"
              onClick={() => setDeleteTarget(row.original)}
            >
              <Trash2 className="size-3.5" />
              删除
            </Button>
          </div>
        ),
      },
    ],
    // 列定义只需随 canEdit 重建；单元格引用的 openEdit/setDeleteTarget 每次渲染稳定，
    // 无需纳入依赖，故冻结依赖避免整表无谓重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="岗位管理"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为真实数据"
            : "维护公司岗位设置、排序与在岗人数"
        }
      />

      <PermissionBanner perm="system:post:edit" action="岗位管理" />

      {loadError === "network" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，
              然后用 admin（密码 admin123）重新登录，即可维护真实岗位数据。
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
          searchKeys={["name", "code"]}
          searchPlaceholder="搜索岗位名称 / 编码"
          advancedFilter
          onRefresh={() => void load()}
          exportFileName="岗位列表"
          enableSelection={canEdit}
          batchSlot={(rows, clear) => (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 rounded-full px-2.5 text-xs text-destructive hover:text-destructive"
              onClick={() => setBatchDel({ rows, clear })}
            >
              <Trash2 className="size-3.5" /> 删除
            </Button>
          )}
          actionSlot={
            <Button size="sm" className="h-8 gap-1" disabled={!canEdit} onClick={openCreate}>
              <Plus className="size-4" />
              新增岗位
            </Button>
          }
        />
      )}

      {/* 新增 / 编辑岗位 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑岗位" : "新增岗位"}</DialogTitle>
            <DialogDescription>
              {editing ? `修改岗位「${editing.name}」的基本信息` : "创建新的岗位设置"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="post-name">岗位名称</Label>
                <Input
                  id="post-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="如：前端工程师"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="post-code">岗位编码</Label>
                <Input
                  id="post-code"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="如：FE_DEV"
                  className="font-mono"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="post-sort">排序</Label>
              <Input
                id="post-sort"
                type="number"
                value={form.sort}
                onChange={(e) => setForm((f) => ({ ...f, sort: e.target.value }))}
                placeholder="数字越小越靠前"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button disabled={submitting} onClick={() => void submitForm()}>
              {submitting ? "保存中…" : editing ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除岗位</DialogTitle>
            <DialogDescription>
              确定删除岗位「{deleteTarget?.name}」吗？
              {deleteTarget && deleteTarget.userCount > 0
                ? `该岗位下仍有 ${deleteTarget.userCount} 名在岗人员，删除前请先调整人员岗位。`
                : "该操作不可恢复。"}
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

      {/* 批量删除确认（带选中数） */}
      <AlertDialog open={!!batchDel} onOpenChange={(o) => !o && setBatchDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除选中的 {batchDel?.rows.length ?? 0} 个岗位？</AlertDialogTitle>
            <AlertDialogDescription>此操作不可恢复。仍有在岗人员的岗位将删除失败并逐条反馈。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void confirmBatchDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

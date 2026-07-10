import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { CloudOff, Pencil, Plus, RotateCw, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { PermissionBanner } from "@/components/permission-banner"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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

interface RoleRow {
  id: number
  code: string
  name: string
  dataScope: string
  enabled: boolean
  userCount: number
  remark?: string
}

interface PermNode {
  id: number
  code: string
  name: string
  type: "MENU" | "BUTTON"
  children?: PermNode[]
}

const SCOPE_LABELS: Record<string, string> = {
  ALL: "全部数据",
  DEPT_AND_CHILD: "本部门及以下",
  DEPT: "本部门",
  SELF: "仅本人",
  CUSTOM: "自定义",
}

const SCOPE_OPTIONS = Object.entries(SCOPE_LABELS).map(([value, label]) => ({ value, label }))

/** 收集节点及所有子孙节点的 id */
function collectIds(nodes: PermNode[]): number[] {
  return nodes.flatMap((node) => [node.id, ...(node.children ? collectIds(node.children) : [])])
}

interface PermTreeProps {
  items: PermNode[]
  depth: number
  checked: Set<number>
  onToggle: (item: PermNode) => void
}

function PermTree({ items, depth, checked, onToggle }: PermTreeProps) {
  return (
    <>
      {items.map((item) => (
        <div key={item.id}>
          <div
            className="flex items-center gap-2 rounded-md py-1.5 pr-2 text-sm hover:bg-muted"
            style={{ paddingLeft: depth * 24 + 8 }}
          >
            <Checkbox
              id={`perm-${item.id}`}
              checked={checked.has(item.id)}
              onCheckedChange={() => onToggle(item)}
            />
            <Label htmlFor={`perm-${item.id}`} className="cursor-pointer font-normal">
              {item.name}
            </Label>
            {item.type === "BUTTON" && (
              <span className="font-mono text-[10px] text-muted-foreground">{item.code}</span>
            )}
          </div>
          {item.children && (
            <PermTree items={item.children} depth={depth + 1} checked={checked} onToggle={onToggle} />
          )}
        </div>
      ))}
    </>
  )
}

interface RoleForm {
  name: string
  code: string
  dataScope: string
  remark: string
}

const emptyForm: RoleForm = { name: "", code: "", dataScope: "SELF", remark: "" }

export default function RolePage() {
  const [rows, setRows] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const offline = useAuthStore((s) => s.offline)
  const canEdit = useHasPerm("system:role:edit")

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<RoleRow | null>(null)
  const [form, setForm] = useState<RoleForm>(emptyForm)
  const [submitting, setSubmitting] = useState(false)

  // 权限配置
  const [permTarget, setPermTarget] = useState<RoleRow | null>(null)
  const [permTree, setPermTree] = useState<PermNode[]>([])
  const [permLoading, setPermLoading] = useState(false)
  const [permSaving, setPermSaving] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())

  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<RoleRow>>("/api/system/roles?pageNum=1&pageSize=100")
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

  const openEdit = (row: RoleRow) => {
    setEditing(row)
    setForm({ name: row.name, code: row.code, dataScope: row.dataScope, remark: row.remark ?? "" })
    setFormOpen(true)
  }

  const submitForm = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error("请填写角色名称和角色编码")
      return
    }
    setSubmitting(true)
    const body = JSON.stringify({
      code: form.code.trim(),
      name: form.name.trim(),
      dataScope: form.dataScope,
      remark: form.remark.trim() || undefined,
    })
    try {
      if (editing) {
        await api(`/api/system/roles/${editing.id}`, { method: "PUT", body })
        toast.success(`角色「${form.name}」已更新`)
      } else {
        await api("/api/system/roles", { method: "POST", body })
        toast.success(`角色「${form.name}」已创建`)
      }
      setFormOpen(false)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSubmitting(false)
    }
  }

  const openPerm = async (row: RoleRow) => {
    setPermTarget(row)
    setPermLoading(true)
    setCheckedIds(new Set())
    try {
      const [tree, ids] = await Promise.all([
        api<PermNode[]>("/api/system/permissions/tree"),
        api<number[]>(`/api/system/roles/${row.id}/permissions`),
      ])
      setPermTree(tree)
      setCheckedIds(new Set(ids))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "权限数据加载失败")
      setPermTarget(null)
    } finally {
      setPermLoading(false)
    }
  }

  /** 父子级联：勾选/取消一个节点时，联动其全部子孙节点 */
  const togglePerm = (item: PermNode) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      const ids = collectIds([item])
      const isChecked = next.has(item.id)
      ids.forEach((id) => (isChecked ? next.delete(id) : next.add(id)))
      return next
    })
  }

  const savePerm = async () => {
    if (!permTarget) return
    setPermSaving(true)
    try {
      await api(`/api/system/roles/${permTarget.id}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ permissionIds: Array.from(checkedIds) }),
      })
      toast.success(`已保存角色「${permTarget.name}」的权限配置（共 ${checkedIds.size} 项）`)
      setPermTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setPermSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await api(`/api/system/roles/${deleteTarget.id}`, { method: "DELETE" })
      toast.success(`角色「${deleteTarget.name}」已删除`)
      setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteTarget(null)
    }
  }

  const columns: ColumnDef<RoleRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        meta: { title: "角色名称", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="角色名称" />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "code",
        meta: { title: "角色编码", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="角色编码" />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        accessorKey: "dataScope",
        // 条件筛选按原始行字段求值，故 options 用英文枚举值（列展示为中文 Badge）
        meta: {
          title: "数据权限",
          filterType: "select",
          options: ["ALL", "DEPT_AND_CHILD", "DEPT", "SELF", "CUSTOM"],
        },
        header: () => <span>数据权限</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600">
            {SCOPE_LABELS[row.original.dataScope] ?? row.original.dataScope}
          </Badge>
        ),
      },
      {
        accessorKey: "userCount",
        meta: { title: "关联用户数", filterType: "number" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="关联用户数" />,
        cell: ({ row }) => <span className="tabular-nums">{row.original.userCount} 人</span>,
      },
      {
        accessorKey: "enabled",
        meta: { title: "状态" },
        header: () => <span>状态</span>,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.enabled ? (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
              启用
            </Badge>
          ) : (
            <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-600">
              停用
            </Badge>
          ),
      },
      {
        accessorKey: "remark",
        meta: { title: "备注" },
        header: () => <span>备注</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-52 truncate text-muted-foreground" title={row.original.remark}>
            {row.original.remark || "-"}
          </span>
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
              disabled={!canEdit}
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => void openPerm(row.original)}
            >
              <ShieldCheck className="size-3.5" />
              权限配置
            </Button>
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
    // 列定义只需随 canEdit 重建；单元格引用的操作函数每次渲染稳定，无需纳入依赖，
    // 故冻结依赖避免整表无谓重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="角色管理"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为真实数据"
            : "维护系统角色、数据权限范围与功能权限配置"
        }
      />

      <PermissionBanner perm="system:role:edit" action="角色管理" />

      {loadError === "network" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，
              然后用 admin（密码 admin123）重新登录，即可管理真实角色、数据权限范围与功能权限。
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
          searchPlaceholder="搜索角色名称 / 编码"
          advancedFilter
          onRefresh={() => void load()}
          exportFileName="角色列表"
          actionSlot={
            <Button size="sm" className="h-8 gap-1" disabled={!canEdit} onClick={openCreate}>
              <Plus className="size-4" />
              新增角色
            </Button>
          }
        />
      )}

      {/* 新增 / 编辑角色 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑角色" : "新增角色"}</DialogTitle>
            <DialogDescription>
              {editing ? `修改角色「${editing.name}」的基本信息` : "创建新的系统角色"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="role-name">角色名称</Label>
                <Input
                  id="role-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="如：部门经理"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role-code">角色编码</Label>
                <Input
                  id="role-code"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="如：MANAGER"
                  className="font-mono"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>数据权限范围</Label>
              <Select
                value={form.dataScope}
                onValueChange={(v) => setForm((f) => ({ ...f, dataScope: v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((scope) => (
                    <SelectItem key={scope.value} value={scope.value}>
                      {scope.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-remark">备注</Label>
              <Textarea
                id="role-remark"
                value={form.remark}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
                placeholder="角色说明（选填）"
                rows={3}
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

      {/* 权限配置 */}
      <Dialog open={!!permTarget} onOpenChange={(open) => !open && setPermTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>权限配置</DialogTitle>
            <DialogDescription>
              为角色「{permTarget?.name}」分配功能权限，勾选父级将自动勾选全部子级，保存后全量替换
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto rounded-md border p-2">
            {permLoading ? (
              <div className="py-10 text-center text-xs text-muted-foreground">权限数据加载中…</div>
            ) : (
              <PermTree items={permTree} depth={0} checked={checkedIds} onToggle={togglePerm} />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermTarget(null)}>
              取消
            </Button>
            <Button disabled={permLoading || permSaving} onClick={() => void savePerm()}>
              {permSaving ? "保存中…" : "保存配置"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除角色</DialogTitle>
            <DialogDescription>
              确定删除角色「{deleteTarget?.name}」吗？
              {deleteTarget && deleteTarget.userCount > 0
                ? `该角色下仍有 ${deleteTarget.userCount} 个用户，删除后需重新分配角色。`
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
    </div>
  )
}

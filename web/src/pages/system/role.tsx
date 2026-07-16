import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Building2, CircleCheck, CircleSlash, CloudOff, Pencil, Plus, RotateCw, ShieldAlert, ShieldCheck, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { PermissionBanner } from "@/components/permission-banner"
import { OrgPicker } from "@/components/org-picker"
import { ErrorBoundary } from "@/components/error-boundary"
import { DataDimensionAuthz } from "@/components/system/data-dimension-authz"
import { DataTable, indexColumn } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { runBatch, toastBatch } from "@/lib/batch"
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"
import { RoleFieldPermsTab } from "./role-field-perms"

interface RoleRow {
  id: number
  code: string
  name: string
  dataScope: string
  enabled: boolean
  userCount: number
  remark?: string
  /** CUSTOM 数据权限的自定义可见部门（磐石 RoleResponse 补） */
  customDeptIds?: number[]
}

interface DeptNode {
  id: number
  name: string
  children?: DeptNode[]
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

type RoleTab = "basic" | "perms" | "data" | "fields"

interface RoleForm {
  name: string
  code: string
  dataScope: string
  /** dataScope=CUSTOM 时的自定义可见部门 id */
  customDeptIds: number[]
  remark: string
}

const emptyForm: RoleForm = { name: "", code: "", dataScope: "SELF", customDeptIds: [], remark: "" }

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
  // CUSTOM 自定义部门：id→名称（回填/展示用）+ 部门选择器开关
  const [deptNameMap, setDeptNameMap] = useState<Record<number, string>>({})
  const [deptPickerOpen, setDeptPickerOpen] = useState(false)
  const deptLoadedRef = useRef(false)

  // 表单打开时懒拉部门树（一次），解析自定义部门名称回填
  useEffect(() => {
    if (!formOpen || deptLoadedRef.current || offline) return
    deptLoadedRef.current = true
    api<DeptNode[]>("/api/system/depts/tree")
      .then((tree) => {
        const map: Record<number, string> = {}
        const walk = (nodes: DeptNode[]) =>
          nodes.forEach((n) => {
            map[n.id] = n.name
            if (n.children) walk(n.children)
          })
        walk(Array.isArray(tree) ? tree : [])
        setDeptNameMap(map)
      })
      .catch(() => {
        /* 部门树拉取失败 → chips 退回「部门#id」，不阻断 */
      })
  }, [formOpen, offline])

  // 角色详情抽屉（权限中心 P1：弹窗 → Sheet + 四 Tab）
  const [activeTab, setActiveTab] = useState<RoleTab>("basic")
  /** 打开时的表单快照（未保存拦截判据） */
  const [formSnapshot, setFormSnapshot] = useState<RoleForm>(emptyForm)
  /** 切 Tab / 关抽屉的未保存拦截 */
  const [pendingTab, setPendingTab] = useState<RoleTab | null>(null)
  const [closeConfirm, setCloseConfirm] = useState(false)

  // 功能权限 Tab（原「权限配置」弹窗整块搬入）
  const [permTree, setPermTree] = useState<PermNode[]>([])
  const [permLoading, setPermLoading] = useState(false)
  const [permSaving, setPermSaving] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [permSnapshot, setPermSnapshot] = useState<Set<number>>(new Set())
  // 字段权限 Tab（P3）：dirty 由子组件汇报；resetSignal 触发其回滚
  const [fieldsDirty, setFieldsDirty] = useState(false)
  const [fieldsResetSignal, setFieldsResetSignal] = useState(0)

  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null)
  const [batchDel, setBatchDel] = useState<{ rows: RoleRow[]; clear: () => void } | null>(null)

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
    setFormSnapshot(emptyForm)
    setActiveTab("basic")
    setFormOpen(true)
  }

  const openEdit = (row: RoleRow, tab: RoleTab = "basic") => {
    setEditing(row)
    const f: RoleForm = {
      name: row.name,
      code: row.code,
      dataScope: row.dataScope,
      customDeptIds: Array.isArray(row.customDeptIds) ? row.customDeptIds : [],
      remark: row.remark ?? "",
    }
    setForm(f)
    setFormSnapshot(f)
    setActiveTab(tab)
    setFormOpen(true)
  }

  const submitForm = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error("请填写角色名称和角色编码")
      return
    }
    if (form.dataScope === "CUSTOM" && form.customDeptIds.length === 0) {
      toast.error("已选择「自定义」数据权限，请至少选择一个可见部门")
      return
    }
    setSubmitting(true)
    const body = JSON.stringify({
      code: form.code.trim(),
      name: form.name.trim(),
      dataScope: form.dataScope,
      // 仅 CUSTOM 携带自定义部门；切走时后端也应清空
      customDeptIds: form.dataScope === "CUSTOM" ? form.customDeptIds : undefined,
      remark: form.remark.trim() || undefined,
    })
    try {
      if (editing) {
        await api(`/api/system/roles/${editing.id}`, { method: "PUT", body })
        toast.success(`角色「${form.name}」已更新`)
        setFormSnapshot(form) // 保存成功 → 快照对齐，抽屉留驻可继续配其它 Tab
      } else {
        await api("/api/system/roles", { method: "POST", body })
        toast.success(`角色「${form.name}」已创建`)
        setFormOpen(false)
      }
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSubmitting(false)
    }
  }

  // 抽屉打开（编辑态）→ 懒拉权限树 + 该角色已勾权限（功能权限 Tab 数据）
  useEffect(() => {
    if (!formOpen || !editing) {
      setPermTree([])
      setCheckedIds(new Set())
      setPermSnapshot(new Set())
      return
    }
    let cancelled = false
    setPermLoading(true)
    void Promise.all([
      api<PermNode[]>("/api/system/permissions/tree"),
      api<number[]>(`/api/system/roles/${editing.id}/permissions`),
    ])
      .then(([tree, ids]) => {
        if (cancelled) return
        setPermTree(Array.isArray(tree) ? tree : [])
        setCheckedIds(new Set(Array.isArray(ids) ? ids : []))
        setPermSnapshot(new Set(Array.isArray(ids) ? ids : []))
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "权限数据加载失败")
      })
      .finally(() => {
        if (!cancelled) setPermLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [formOpen, editing])

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
    if (!editing) return
    setPermSaving(true)
    try {
      await api(`/api/system/roles/${editing.id}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ permissionIds: Array.from(checkedIds) }),
      })
      toast.success(`已保存角色「${editing.name}」的权限配置（共 ${checkedIds.size} 项）`)
      setPermSnapshot(new Set(checkedIds))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setPermSaving(false)
    }
  }

  /* ---- 未保存拦截（每 Tab 独立保存；切 Tab / 关抽屉时拦） ---- */
  const basicDirty = form.name !== formSnapshot.name || form.code !== formSnapshot.code || form.remark !== formSnapshot.remark
  const dataDirty =
    form.dataScope !== formSnapshot.dataScope ||
    form.customDeptIds.length !== formSnapshot.customDeptIds.length ||
    form.customDeptIds.some((id, i) => id !== formSnapshot.customDeptIds[i])
  const permsDirty = checkedIds.size !== permSnapshot.size || Array.from(checkedIds).some((id) => !permSnapshot.has(id))
  const tabDirty = (tab: RoleTab) =>
    tab === "basic" ? basicDirty : tab === "data" ? dataDirty : tab === "perms" ? permsDirty : fieldsDirty

  const requestTab = (tab: RoleTab) => {
    if (tab === activeTab) return
    if (tabDirty(activeTab)) setPendingTab(tab)
    else setActiveTab(tab)
  }

  const requestClose = (open: boolean) => {
    if (open) return
    if (basicDirty || dataDirty || permsDirty || fieldsDirty) setCloseConfirm(true)
    else setFormOpen(false)
  }

  /** 丢弃当前改动（拦截确认后）：回滚到快照 */
  const discardDirty = () => {
    setForm(formSnapshot)
    setCheckedIds(new Set(permSnapshot))
    setFieldsResetSignal((n) => n + 1) // 字段权限 Tab 回滚到快照
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

  // 批量启用/停用：优先 batch-status，未实现则逐条 PUT 整行（后端 RoleRequest 要求 code/name/dataScope 非空）
  const batchToggleStatus = async (rows: RoleRow[], enabled: boolean, clear: () => void) => {
    const ids = rows.map((r) => r.id)
    const byId = new Map(rows.map((r) => [r.id, r]))
    const result = await runBatch({
      ids,
      batchPath: "/api/system/roles/batch-status",
      batchBody: (list) => ({ ids: list, enabled }),
      single: (id) => {
        const r = byId.get(id)
        return api(`/api/system/roles/${id}`, {
          method: "PUT",
          body: JSON.stringify({
            code: r?.code,
            name: r?.name,
            dataScope: r?.dataScope,
            remark: r?.remark || undefined,
            enabled,
            customDeptIds: r?.dataScope === "CUSTOM" ? r?.customDeptIds : undefined,
          }),
        })
      },
    })
    toastBatch(result, enabled ? "启用" : "停用")
    clear()
    void load()
  }

  const confirmBatchDelete = async () => {
    if (!batchDel) return
    const ids = batchDel.rows.map((r) => r.id)
    const result = await runBatch({
      ids,
      batchPath: "/api/system/roles/batch-delete",
      single: (id) => api(`/api/system/roles/${id}`, { method: "DELETE" }),
    })
    toastBatch(result, "删除")
    batchDel.clear()
    setBatchDel(null)
    void load()
  }

  const columns: ColumnDef<RoleRow, unknown>[] = useMemo(
    () => [
      indexColumn<RoleRow>(),
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
              onClick={() => openEdit(row.original, "perms")}
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
          enableSelection={canEdit}
          batchSlot={(rows, clear) => (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 rounded-full px-2.5 text-xs"
                onClick={() => void batchToggleStatus(rows, true, clear)}
              >
                <CircleCheck className="size-3.5" /> 启用
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 rounded-full px-2.5 text-xs"
                onClick={() => void batchToggleStatus(rows, false, clear)}
              >
                <CircleSlash className="size-3.5" /> 停用
              </Button>
              <span className="h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 rounded-full px-2.5 text-xs text-destructive hover:text-destructive"
                onClick={() => setBatchDel({ rows, clear })}
              >
                <Trash2 className="size-3.5" /> 删除
              </Button>
            </>
          )}
          actionSlot={
            <Button size="sm" className="h-8 gap-1" disabled={!canEdit} onClick={openCreate}>
              <Plus className="size-4" />
              新增角色
            </Button>
          }
        />
      )}

      {/* 角色详情抽屉（权限中心 P1）：Sheet + 四 Tab（基本信息/功能权限/数据权限/字段权限），
          每 Tab 独立保存 + 未保存拦截；Tab 内容 forceMount（隐藏不卸载，保住编辑中状态） */}
      <Sheet open={formOpen} onOpenChange={requestClose}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-3xl">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2 text-base">
              {editing ? (
                <>
                  角色「{editing.name}」
                  <span className="font-mono text-xs font-normal text-muted-foreground">{editing.code}</span>
                </>
              ) : (
                "新增角色"
              )}
            </SheetTitle>
          </SheetHeader>

          <Tabs value={activeTab} onValueChange={(v) => requestTab(v as RoleTab)} className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="mx-4 mt-3 shrink-0 self-start">
              <TabsTrigger value="basic">基本信息</TabsTrigger>
              <TabsTrigger value="perms" disabled={!editing} title={!editing ? "保存角色后可配置" : undefined}>
                功能权限
              </TabsTrigger>
              <TabsTrigger value="data">数据权限</TabsTrigger>
              <TabsTrigger value="fields" disabled={!editing} title={!editing ? "保存角色后可配置" : undefined}>
                字段权限
              </TabsTrigger>
            </TabsList>

            {/* 基本信息（原弹窗字段原语义搬入：名称/编码/备注） */}
            <TabsContent value="basic" forceMount className="min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden">
              <ErrorBoundary label="role-tab-basic">
                <div className="grid gap-4">
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
              </ErrorBoundary>
            </TabsContent>

            {/* 功能权限（原「权限配置」弹窗整块搬入，契约/级联勾选零改） */}
            <TabsContent value="perms" forceMount className="min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden">
              <ErrorBoundary label="role-tab-perms">
                {!editing ? (
                  <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">保存角色后可配置功能权限</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">勾选父级将自动勾选全部子级，保存后全量替换。</p>
                    <div className="rounded-md border p-2">
                      {permLoading ? (
                        <div className="py-10 text-center text-xs text-muted-foreground">权限数据加载中…</div>
                      ) : (
                        <PermTree items={permTree} depth={0} checked={checkedIds} onToggle={togglePerm} />
                      )}
                    </div>
                  </div>
                )}
              </ErrorBoundary>
            </TabsContent>

            {/* 数据权限（原语义零变：部门 5 档 + CUSTOM 自定义部门 + DP1 维度授权） */}
            <TabsContent value="data" forceMount className="min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden">
              <ErrorBoundary label="role-tab-data">
                <div className="grid gap-4">
                  <div className="space-y-1.5">
                    <Label>数据权限范围</Label>
                    <Select
                      value={form.dataScope}
                      onValueChange={(v) =>
                        // 从 CUSTOM 切走 → 清空自定义部门
                        setForm((f) => ({ ...f, dataScope: v, customDeptIds: v === "CUSTOM" ? f.customDeptIds : [] }))
                      }
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

                  {/* CUSTOM → 自定义可见部门多选（非 CUSTOM 隐藏） */}
                  {form.dataScope === "CUSTOM" && (
                    <div className="space-y-1.5">
                      <Label>自定义可见部门</Label>
                      <div className="rounded-md border p-2">
                        {form.customDeptIds.length === 0 ? (
                          <p className="px-1 py-1 text-xs text-muted-foreground">未选择部门——请选择该角色可见的部门</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {form.customDeptIds.map((id) => (
                              <Badge key={id} variant="outline" className="gap-1 pr-1 font-normal">
                                {deptNameMap[id] ?? `部门#${id}`}
                                <button
                                  type="button"
                                  aria-label={`移除 ${deptNameMap[id] ?? id}`}
                                  className="rounded hover:bg-muted"
                                  onClick={() => setForm((f) => ({ ...f, customDeptIds: f.customDeptIds.filter((x) => x !== id) }))}
                                >
                                  <X className="size-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}
                        <Button type="button" variant="outline" size="sm" className="mt-2 gap-1.5" onClick={() => setDeptPickerOpen(true)}>
                          <Building2 className="size-3.5" /> 选择部门
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* 业务维度授权（DP1，编辑态；独立保存按钮维持原样） */}
                  {editing && (
                    <div className="space-y-1.5 border-t pt-3">
                      <Label>业务维度授权</Label>
                      <p className="text-[11px] text-muted-foreground">与上方「部门数据权限（5 档）」并行——在成本中心 / 项目等业务维度上限定该角色可见范围。</p>
                      <ErrorBoundary label="dp-authz-role">
                        <DataDimensionAuthz principalType="role" id={editing.id} canEdit={canEdit} />
                      </ErrorBoundary>
                    </div>
                  )}
                </div>
              </ErrorBoundary>
            </TabsContent>

            {/* 字段权限（P3）：功能选择 → 字段矩阵，Tab 内独立保存（照维度授权模式） */}
            <TabsContent value="fields" forceMount className="min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden">
              <ErrorBoundary label="role-tab-fields">
                {editing ? (
                  <RoleFieldPermsTab roleId={editing.id} canEdit={canEdit} onDirtyChange={setFieldsDirty} resetSignal={fieldsResetSignal} />
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">保存角色后可配置字段权限</p>
                )}
              </ErrorBoundary>
            </TabsContent>
          </Tabs>

          {/* 底部：每 Tab 独立保存 */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t p-3">
            <Button variant="outline" onClick={() => requestClose(false)}>
              取消
            </Button>
            {activeTab === "perms" ? (
              <Button disabled={!editing || permLoading || permSaving} onClick={() => void savePerm()}>
                {permSaving ? "保存中…" : "保存权限配置"}
              </Button>
            ) : activeTab === "fields" ? null : (
              <Button disabled={submitting} onClick={() => void submitForm()}>
                {submitting ? "保存中…" : editing ? "保存" : "创建"}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* 切 Tab 未保存拦截 */}
      <AlertDialog open={pendingTab != null} onOpenChange={(o) => !o && setPendingTab(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>有未保存修改</AlertDialogTitle>
            <AlertDialogDescription>当前 Tab 有未保存的修改，离开将丢弃。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const next = pendingTab
                setPendingTab(null)
                if (next) {
                  discardDirty()
                  setActiveTab(next)
                }
              }}
            >
              丢弃并切换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 关抽屉未保存拦截 */}
      <AlertDialog open={closeConfirm} onOpenChange={setCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>有未保存修改</AlertDialogTitle>
            <AlertDialogDescription>关闭抽屉将丢弃未保存的修改。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setCloseConfirm(false)
                discardDirty()
                setFormOpen(false)
              }}
            >
              丢弃并关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* CUSTOM 自定义可见部门选择器（复用 OrgPicker，仅部门） */}
      <OrgPicker
        open={deptPickerOpen}
        onOpenChange={setDeptPickerOpen}
        title="选择自定义可见部门"
        types={["DEPT"]}
        value={form.customDeptIds.map((id) => ({ type: "DEPT" as const, id, name: deptNameMap[id] ?? `部门#${id}` }))}
        onConfirm={(refs) => {
          setDeptPickerOpen(false)
          setForm((f) => ({ ...f, customDeptIds: refs.map((r) => r.id) }))
          setDeptNameMap((m) => {
            const next = { ...m }
            refs.forEach((r) => {
              next[r.id] = r.name
            })
            return next
          })
        }}
      />

      {/* 批量删除确认（带选中数） */}
      <AlertDialog open={!!batchDel} onOpenChange={(o) => !o && setBatchDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除选中的 {batchDel?.rows.length ?? 0} 个角色？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可恢复。仍有关联用户的角色将删除失败并逐条反馈。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmBatchDelete()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

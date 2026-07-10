import { useCallback, useEffect, useMemo, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import type { ColumnDef } from "@tanstack/react-table"
import {
  BriefcaseBusiness,
  Copy,
  Ellipsis,
  IdCard,
  KeyRound,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { PageHeader } from "@/components/page-header"
import { PermissionBanner } from "@/components/permission-banner"
import { Modal } from "@/components/modal"
import { Drawer } from "@/components/drawer"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { RecordPicker, RecordPickerField, type RecordPickerColumn } from "@/components/record-picker"
import { OfflineFallback } from "@/components/offline-fallback"
import { ErrorState } from "@/components/error-state"
import { useApiData } from "@/hooks/use-api-data"
import { api, type PageResult } from "@/lib/api"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useHasPerm } from "@/stores/auth-store"

interface UserRow extends Record<string, unknown> {
  id: number
  username: string
  name: string
  empNo?: string
  phone?: string
  email?: string
  gender?: string
  birthday?: string
  hireDate?: string
  officeLocation?: string
  leaderId?: number
  leaderName?: string
  avatar?: string
  remark?: string
  enabled: boolean
  createdAt?: string
  primaryDeptName?: string
  primaryPostName?: string
  roleNames: string[]
}

/** 表格行：补状态派生字段——条件筛选按「启用/停用」中文值求值，单元格仍渲染 Switch */
type UserTableRow = UserRow & { enabledText: string }

/** 性别中文映射 */
const genderLabels: Record<string, string> = {
  MALE: "男",
  FEMALE: "女",
  UNKNOWN: "保密",
}

interface DeptNode {
  id: number
  name: string
  parentId?: number | null
  sort?: number
  userCount?: number
  children?: DeptNode[]
}

interface DeptOption {
  id: number
  name: string
  depth: number
}

interface PostOption {
  id: number
  code: string
  name: string
}

interface RoleOption {
  id: number
  code: string
  name: string
}

interface AssignmentRow {
  id: number
  deptId: number
  deptName: string
  postName: string
  roleNames: string[]
  primary: boolean
}

/** 部门树拍平为带层级缩进的下拉选项 */
function flattenDepts(nodes: DeptNode[], depth = 0, out: DeptOption[] = []): DeptOption[] {
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name, depth })
    if (node.children?.length) flattenDepts(node.children, depth + 1, out)
  }
  return out
}

function formatTime(iso?: string) {
  if (!iso) return "—"
  return iso.slice(0, 16).replace("T", " ")
}

/** 直属上级选择弹窗的表格列 */
const leaderColumns: RecordPickerColumn<UserRow>[] = [
  { key: "name", title: "姓名", width: 110 },
  {
    key: "empNo",
    title: "工号",
    width: 100,
    render: (row) => <span className="font-mono text-xs">{row.empNo ?? "—"}</span>,
  },
  { key: "primaryDeptName", title: "部门", width: 120, render: (row) => row.primaryDeptName ?? "—" },
  { key: "primaryPostName", title: "岗位", render: (row) => row.primaryPostName ?? "—" },
]

/** 档案抽屉中的信息项：无值统一显示 "—" */
function ProfileItem({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-xs leading-5" : "text-sm"}>{value || "—"}</div>
    </div>
  )
}

/** 档案公共字段（新增 / 编辑共用，均可空） */
const profileFields = {
  email: z.union([z.literal(""), z.string().trim().email("邮箱格式不正确")]),
  gender: z.enum(["MALE", "FEMALE", "UNKNOWN"]),
  birthday: z.string(),
  hireDate: z.string(),
  officeLocation: z.string().trim().max(64, "办公地点最长 64 字"),
  remark: z.string().trim().max(255, "备注最长 255 字"),
}

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "请输入登录账号")
    .regex(/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/, "字母开头，3~20 位字母 / 数字 / 下划线"),
  name: z.string().trim().min(1, "请输入姓名").min(2, "姓名至少 2 个字符"),
  empNo: z.union([z.literal(""), z.string().trim().regex(/^[A-Za-z0-9-]{2,32}$/, "工号为 2~32 位字母 / 数字 / 连字符")]),
  phone: z.string().trim().min(1, "请输入手机号").regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
  password: z.string().min(6, "初始密码至少 6 位"),
  deptId: z.string().min(1, "请选择部门"),
  postId: z.string().min(1, "请选择岗位"),
  roleIds: z.array(z.number()).min(1, "请至少选择一个角色"),
  ...profileFields,
})

type CreateFormValues = z.infer<typeof createSchema>

const createDefaults: CreateFormValues = {
  username: "",
  name: "",
  empNo: "",
  phone: "",
  password: "admin123",
  deptId: "",
  postId: "",
  roleIds: [],
  email: "",
  gender: "UNKNOWN",
  birthday: "",
  hireDate: "",
  officeLocation: "",
  remark: "",
}

const editSchema = z.object({
  name: z.string().trim().min(1, "请输入姓名").min(2, "姓名至少 2 个字符"),
  phone: z.string().trim().min(1, "请输入手机号").regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
  avatar: z.union([z.literal(""), z.string().trim().url("请输入合法的 URL")]),
  ...profileFields,
})

type EditFormValues = z.infer<typeof editSchema>

const editDefaults: EditFormValues = {
  name: "",
  phone: "",
  email: "",
  gender: "UNKNOWN",
  birthday: "",
  hireDate: "",
  officeLocation: "",
  avatar: "",
  remark: "",
}

export default function UserPage() {
  const [deptFilter, setDeptFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")

  // 下拉选项数据
  const [deptOptions, setDeptOptions] = useState<DeptOption[]>([])
  const [postOptions, setPostOptions] = useState<PostOption[]>([])
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([])

  const canEdit = useHasPerm("system:user:edit")

  // 新增用户
  const [createOpen, setCreateOpen] = useState(false)
  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: createDefaults,
  })

  // 编辑基本信息
  const [editing, setEditing] = useState<UserRow | null>(null)
  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: editDefaults,
  })

  // 直属上级：RecordPicker 存 id、展示姓名（存储与展示分离）
  const [createLeader, setCreateLeader] = useState<{ id: number; name: string } | null>(null)
  const [editLeader, setEditLeader] = useState<{ id: number; name: string } | null>(null)
  const [leaderPickerFor, setLeaderPickerFor] = useState<"create" | "edit" | null>(null)

  // 查看档案 Drawer
  const [profileTarget, setProfileTarget] = useState<UserRow | null>(null)
  const [profileAssignments, setProfileAssignments] = useState<AssignmentRow[]>([])
  const [profileLoading, setProfileLoading] = useState(false)

  // 确认类弹窗
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null)
  // 重置成功后展示后端返回的一次性随机新密码（供管理员转交用户）
  const [resetResult, setResetResult] = useState<{ name: string; password: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)

  // 任职管理 Drawer
  const [assignTarget, setAssignTarget] = useState<UserRow | null>(null)
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [assignmentsLoading, setAssignmentsLoading] = useState(false)
  const [addDeptId, setAddDeptId] = useState("")
  const [addPostId, setAddPostId] = useState("")
  const [addRoleIds, setAddRoleIds] = useState<number[]>([])
  const [addSubmitting, setAddSubmitting] = useState(false)

  const { data, loading, error, offline, reload, setData } = useApiData<PageResult<UserRow>>(() => {
    const params = new URLSearchParams({ pageNum: "1", pageSize: "100" })
    if (deptFilter !== "all") params.set("deptId", deptFilter)
    if (statusFilter !== "all") params.set("enabled", statusFilter === "enabled" ? "true" : "false")
    return api<PageResult<UserRow>>(`/api/system/users?${params.toString()}`)
  }, [deptFilter, statusFilter])
  const rows = data?.list ?? []

  const loadOptions = useCallback(async () => {
    try {
      const [tree, posts, roles] = await Promise.all([
        api<DeptNode[]>("/api/system/depts/tree"),
        api<PageResult<PostOption>>("/api/system/posts?pageNum=1&pageSize=100"),
        api<PageResult<RoleOption>>("/api/system/roles?pageNum=1&pageSize=100"),
      ])
      setDeptOptions(flattenDepts(tree))
      setPostOptions(posts.list)
      setRoleOptions(roles.list)
    } catch {
      // 选项加载失败不阻塞列表；后端未启动由列表的 NetworkError 卡片兜底
    }
  }, [])

  useEffect(() => {
    if (!offline) void loadOptions()
  }, [loadOptions, offline])

  /* ---------- 新增 / 编辑 ---------- */

  const openCreate = () => {
    createForm.reset(createDefaults)
    setCreateLeader(null)
    setCreateOpen(true)
  }

  const submitCreate = async (values: CreateFormValues) => {
    try {
      await api("/api/system/users", {
        method: "POST",
        body: JSON.stringify({
          username: values.username,
          name: values.name,
          empNo: values.empNo || null,
          phone: values.phone,
          password: values.password,
          deptId: Number(values.deptId),
          postId: Number(values.postId),
          roleIds: values.roleIds,
          email: values.email || null,
          gender: values.gender,
          birthday: values.birthday || null,
          hireDate: values.hireDate || null,
          officeLocation: values.officeLocation || null,
          leaderId: createLeader?.id ?? null,
          remark: values.remark || null,
        }),
      })
      toast.success(`用户「${values.name}」已创建`)
      setCreateOpen(false)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败")
    }
  }

  const openEdit = (row: UserRow) => {
    setEditing(row)
    setEditLeader(row.leaderId != null ? { id: row.leaderId, name: row.leaderName ?? `#${row.leaderId}` } : null)
    editForm.reset({
      name: row.name,
      phone: row.phone ?? "",
      email: row.email ?? "",
      gender: row.gender === "MALE" || row.gender === "FEMALE" ? row.gender : "UNKNOWN",
      birthday: row.birthday ?? "",
      hireDate: row.hireDate ?? "",
      officeLocation: row.officeLocation ?? "",
      avatar: row.avatar ?? "",
      remark: row.remark ?? "",
    })
  }

  const submitEdit = async (values: EditFormValues) => {
    if (!editing) return
    try {
      await api(`/api/system/users/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: values.name,
          phone: values.phone,
          email: values.email || null,
          gender: values.gender,
          birthday: values.birthday || null,
          hireDate: values.hireDate || null,
          officeLocation: values.officeLocation || null,
          leaderId: editLeader?.id ?? null,
          avatar: values.avatar || null,
          remark: values.remark || null,
        }),
      })
      toast.success(`用户「${values.name}」已更新`)
      setEditing(null)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败")
    }
  }

  /* ---------- 查看档案 ---------- */

  const openProfile = (row: UserRow) => {
    setProfileTarget(row)
    setProfileAssignments([])
    setProfileLoading(true)
    api<AssignmentRow[]>(`/api/system/users/${row.id}/assignments`)
      .then(setProfileAssignments)
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "任职信息加载失败"))
      .finally(() => setProfileLoading(false))
  }

  /* ---------- 行操作 ---------- */

  const toggleEnabled = async (row: UserRow, checked: boolean) => {
    try {
      await api(`/api/system/users/${row.id}/enabled`, {
        method: "PUT",
        body: JSON.stringify({ enabled: checked }),
      })
      setData((prev) =>
        prev
          ? { ...prev, list: prev.list.map((u) => (u.id === row.id ? { ...u, enabled: checked } : u)) }
          : prev,
      )
      toast.success(`已${checked ? "启用" : "停用"}用户「${row.name}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    }
  }

  const confirmReset = async () => {
    if (!resetTarget) return
    const name = resetTarget.name
    try {
      // 后端 B-12：返回一次性随机新密码（不再是固定 admin123）
      const password = await api<string>(`/api/system/users/${resetTarget.id}/reset-password`, {
        method: "POST",
      })
      setResetResult({ name, password })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重置失败")
    } finally {
      setResetTarget(null)
    }
  }

  const copyNewPassword = async () => {
    if (!resetResult) return
    try {
      await navigator.clipboard.writeText(resetResult.password)
      toast.success("新密码已复制到剪贴板")
    } catch {
      toast.error("复制失败，请手动选择密码复制")
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await api(`/api/system/users/${deleteTarget.id}`, { method: "DELETE" })
      toast.success(`用户「${deleteTarget.name}」已删除`)
      setData((prev) =>
        prev ? { ...prev, list: prev.list.filter((u) => u.id !== deleteTarget.id) } : prev,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteTarget(null)
    }
  }

  /* ---------- 任职管理 ---------- */

  const loadAssignments = useCallback(async (userId: number) => {
    setAssignmentsLoading(true)
    try {
      const list = await api<AssignmentRow[]>(`/api/system/users/${userId}/assignments`)
      setAssignments(list)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "任职信息加载失败")
    } finally {
      setAssignmentsLoading(false)
    }
  }, [])

  const openAssignments = (row: UserRow) => {
    setAssignTarget(row)
    setAssignments([])
    setAddDeptId("")
    setAddPostId("")
    setAddRoleIds([])
    void loadAssignments(row.id)
  }

  const submitAddAssignment = async () => {
    if (!assignTarget) return
    if (!addDeptId || !addPostId) {
      toast.error("请选择兼任的部门和岗位")
      return
    }
    if (addRoleIds.length === 0) {
      toast.error("请至少选择一个角色")
      return
    }
    setAddSubmitting(true)
    try {
      await api(`/api/system/users/${assignTarget.id}/assignments`, {
        method: "POST",
        body: JSON.stringify({
          deptId: Number(addDeptId),
          postId: Number(addPostId),
          roleIds: addRoleIds,
          primary: false,
        }),
      })
      toast.success(`已为「${assignTarget.name}」添加兼任`)
      setAddDeptId("")
      setAddPostId("")
      setAddRoleIds([])
      await loadAssignments(assignTarget.id)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加兼任失败")
    } finally {
      setAddSubmitting(false)
    }
  }

  const deleteAssignment = async (assignment: AssignmentRow) => {
    if (!assignTarget) return
    try {
      await api(`/api/system/assignments/${assignment.id}`, { method: "DELETE" })
      toast.success(`已删除「${assignment.deptName} · ${assignment.postName}」兼任`)
      await loadAssignments(assignTarget.id)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  const toggleAddRole = (roleId: number) => {
    setAddRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    )
  }

  // 状态派生字段：advancedFilter 的 select 条件按中文值求值
  const tableRows = useMemo<UserTableRow[]>(
    () => (data?.list ?? []).map((row) => ({ ...row, enabledText: row.enabled ? "启用" : "停用" })),
    [data],
  )

  // 条件筛选 select 字段的可选值：部门树拍平名称 / 岗位名称
  const deptNameOptions = useMemo(() => deptOptions.map((dept) => dept.name), [deptOptions])
  const postNameOptions = useMemo(() => postOptions.map((post) => post.name), [postOptions])

  const columns: ColumnDef<UserTableRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "username",
        meta: { title: "用户名", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="用户名" />,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.username}</span>,
      },
      {
        accessorKey: "name",
        meta: { title: "姓名", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="姓名" />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "empNo",
        meta: { title: "工号", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="工号" />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.empNo ?? "—"}</span>,
      },
      {
        accessorKey: "primaryDeptName",
        meta: { title: "部门", filterType: "select", options: deptNameOptions },
        header: ({ column }) => <DataTableColumnHeader column={column} title="部门" />,
        cell: ({ row }) => row.original.primaryDeptName ?? "—",
      },
      {
        accessorKey: "primaryPostName",
        meta: { title: "岗位", filterType: "select", options: postNameOptions },
        header: () => <span>岗位</span>,
        enableSorting: false,
        cell: ({ row }) => row.original.primaryPostName ?? "—",
      },
      {
        id: "roles",
        accessorFn: (row) => row.roleNames.join("、"),
        meta: { title: "角色" },
        header: () => <span>角色</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.roleNames.map((role) => (
              <Badge key={role} variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600">
                {role}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        accessorKey: "phone",
        meta: { title: "手机号", filterType: "text" },
        header: () => <span>手机号</span>,
        enableSorting: false,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.phone ?? "—"}</span>,
      },
      {
        accessorKey: "enabledText",
        meta: { title: "状态", filterType: "select", options: ["启用", "停用"] },
        header: () => <span>状态</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            disabled={!canEdit}
            onCheckedChange={(checked) => void toggleEnabled(row.original, checked)}
            aria-label="切换用户状态"
          />
        ),
      },
      {
        accessorKey: "hireDate",
        meta: { title: "入职日期", filterType: "date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="入职日期" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.hireDate ?? "—"}</span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem onClick={() => openProfile(row.original)}>
                <IdCard className="size-3.5" /> 查看档案
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canEdit} onClick={() => openEdit(row.original)}>
                <Pencil className="size-3.5" /> 编辑
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canEdit} onClick={() => openAssignments(row.original)}>
                <BriefcaseBusiness className="size-3.5" /> 任职管理
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canEdit} onClick={() => setResetTarget(row.original)}>
                <KeyRound className="size-3.5" /> 重置密码
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={!canEdit}
                onClick={() => setDeleteTarget(row.original)}
              >
                <Trash2 className="size-3.5" /> 删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    // 列定义只需随 canEdit 与筛选选项重建；单元格引用的 openEdit/openProfile/toggleEnabled
    // 等每次渲染稳定，无需纳入依赖，故冻结依赖避免整表无谓重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, deptNameOptions, postNameOptions],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="用户管理"
        description={
          offline
            ? "后端未连接——启动 server/ 后此页为真实数据"
            : "维护系统登录账号、角色分配、任职（含兼任）与启用状态"
        }
      />

      <PermissionBanner perm="system:user:edit" action="用户管理" />

      {offline ? (
        <OfflineFallback
          description="此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，然后用 admin（密码 admin123）重新登录，即可管理真实用户、角色分配与兼任任职。"
          onRetry={() => {
            reload()
            void loadOptions()
          }}
        />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <DataTable
          columns={columns}
          data={tableRows}
          searchKeys={["username", "name", "empNo", "phone"]}
          searchPlaceholder="搜索姓名 / 账号 / 工号 / 手机号"
          loading={loading}
          onRefresh={() => reload()}
          exportFileName="用户列表"
          advancedFilter
          groupOptions={[
            { id: "primaryDeptName", label: "部门" },
            { id: "primaryPostName", label: "岗位" },
          ]}
          filterSlot={
            <>
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger size="sm" className="h-8 w-36 text-sm">
                  <SelectValue placeholder="部门" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部部门</SelectItem>
                  {deptOptions.map((dept) => (
                    <SelectItem key={dept.id} value={String(dept.id)}>
                      {"　".repeat(dept.depth)}
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger size="sm" className="h-8 w-28 text-sm">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="enabled">启用</SelectItem>
                  <SelectItem value="disabled">停用</SelectItem>
                </SelectContent>
              </Select>
            </>
          }
          actionSlot={
            <Button size="sm" className="h-8 gap-1" disabled={!canEdit} onClick={openCreate}>
              <Plus className="size-4" />
              新增用户
            </Button>
          }
        />
      )}

      {/* 新增用户：Modal + react-hook-form + zod，两列完整档案表单 */}
      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新增用户"
        description="创建新的系统登录账号与员工档案（同时建立主任职）"
        width={680}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={createForm.handleSubmit(submitCreate)}>创建</Button>
          </>
        }
      >
        <Form {...createForm}>
          <form onSubmit={createForm.handleSubmit(submitCreate)} className="grid gap-4 @md:grid-cols-2">
            <FormField
              control={createForm.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>账号</FormLabel>
                  <FormControl>
                    <Input placeholder="登录账号" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>姓名</FormLabel>
                  <FormControl>
                    <Input placeholder="请输入姓名" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="empNo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>工号</FormLabel>
                  <FormControl>
                    <Input placeholder="留空自动生成" className="font-mono" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>手机号</FormLabel>
                  <FormControl>
                    <Input placeholder="11 位手机号" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>邮箱</FormLabel>
                  <FormControl>
                    <Input placeholder="name@xingchen.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="gender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>性别</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="请选择性别" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="MALE">男</SelectItem>
                      <SelectItem value="FEMALE">女</SelectItem>
                      <SelectItem value="UNKNOWN">保密</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="birthday"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>生日</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="hireDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>入职日期</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="officeLocation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>办公地点</FormLabel>
                  <FormControl>
                    <Input placeholder="如 A 座 12F-08" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormItem>
              <FormLabel>直属上级</FormLabel>
              <RecordPickerField
                labels={createLeader ? [{ id: String(createLeader.id), label: createLeader.name }] : []}
                placeholder="点击选择直属上级"
                onOpen={() => setLeaderPickerFor("create")}
                onRemove={() => setCreateLeader(null)}
              />
            </FormItem>
            <FormField
              control={createForm.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>初始密码</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="deptId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>部门</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="请选择部门" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {deptOptions.map((dept) => (
                        <SelectItem key={dept.id} value={String(dept.id)}>
                          {"　".repeat(dept.depth)}
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="postId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>岗位</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="请选择岗位" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {postOptions.map((post) => (
                        <SelectItem key={post.id} value={String(post.id)}>
                          {post.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="roleIds"
              render={({ field }) => (
                <FormItem className="@md:col-span-2">
                  <FormLabel required>角色</FormLabel>
                  <div className="grid grid-cols-2 gap-2 rounded-md border p-3 @md:grid-cols-3">
                    {roleOptions.map((role) => (
                      <div key={role.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`create-role-${role.id}`}
                          checked={field.value.includes(role.id)}
                          onCheckedChange={(checked) => {
                            field.onChange(
                              checked
                                ? [...field.value, role.id]
                                : field.value.filter((id) => id !== role.id),
                            )
                          }}
                        />
                        <Label htmlFor={`create-role-${role.id}`} className="cursor-pointer text-sm font-normal">
                          {role.name}
                        </Label>
                      </div>
                    ))}
                    {roleOptions.length === 0 && (
                      <span className="col-span-full text-xs text-muted-foreground">角色数据加载中…</span>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="remark"
              render={({ field }) => (
                <FormItem className="@md:col-span-2">
                  <FormLabel>备注</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="选填，如岗位职责、特殊说明等" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </Modal>

      {/* 编辑用户档案 */}
      <Modal
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        title="编辑用户"
        description={editing ? `修改用户「${editing.name}」的档案信息（部门 / 岗位 / 角色请在任职管理中调整）` : undefined}
        width={680}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={editForm.handleSubmit(submitEdit)}>保存</Button>
          </>
        }
      >
        <Form {...editForm}>
          <form onSubmit={editForm.handleSubmit(submitEdit)} className="grid gap-4 @md:grid-cols-2">
            <FormField
              control={editForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>姓名</FormLabel>
                  <FormControl>
                    <Input placeholder="请输入姓名" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>手机号</FormLabel>
                  <FormControl>
                    <Input placeholder="11 位手机号" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>邮箱</FormLabel>
                  <FormControl>
                    <Input placeholder="name@xingchen.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="gender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>性别</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="请选择性别" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="MALE">男</SelectItem>
                      <SelectItem value="FEMALE">女</SelectItem>
                      <SelectItem value="UNKNOWN">保密</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="birthday"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>生日</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="hireDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>入职日期</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="officeLocation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>办公地点</FormLabel>
                  <FormControl>
                    <Input placeholder="如 A 座 12F-08" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormItem>
              <FormLabel>直属上级</FormLabel>
              <RecordPickerField
                labels={editLeader ? [{ id: String(editLeader.id), label: editLeader.name }] : []}
                placeholder="点击选择直属上级"
                onOpen={() => setLeaderPickerFor("edit")}
                onRemove={() => setEditLeader(null)}
              />
            </FormItem>
            <FormField
              control={editForm.control}
              name="avatar"
              render={({ field }) => (
                <FormItem className="@md:col-span-2">
                  <FormLabel>头像 URL</FormLabel>
                  <FormControl>
                    <Input placeholder="选填，https:// 开头的图片地址；留空显示姓名首字头像" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="remark"
              render={({ field }) => (
                <FormItem className="@md:col-span-2">
                  <FormLabel>备注</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="选填，如岗位职责、特殊说明等" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </Modal>

      {/* 直属上级选择：RecordPicker 复用（存 id、展示姓名） */}
      <RecordPicker<UserRow>
        open={leaderPickerFor !== null}
        onOpenChange={(open) => !open && setLeaderPickerFor(null)}
        title="选择直属上级"
        description="从用户列表单选：存储用户 id，表单展示姓名"
        data={leaderPickerFor === "edit" && editing ? rows.filter((r) => r.id !== editing.id) : rows}
        columns={leaderColumns}
        idField="id"
        labelField="name"
        value={
          leaderPickerFor === "edit"
            ? editLeader
              ? [String(editLeader.id)]
              : []
            : createLeader
              ? [String(createLeader.id)]
              : []
        }
        onConfirm={(_ids, selectedRows) => {
          const row = selectedRows[0]
          const leader = row ? { id: row.id, name: row.name } : null
          if (leaderPickerFor === "edit") setEditLeader(leader)
          else setCreateLeader(leader)
        }}
        searchKeys={["name", "username", "empNo"]}
      />

      {/* 查看档案 Drawer：完整档案 + 只读任职记录 */}
      <Drawer
        open={!!profileTarget}
        onOpenChange={(open) => !open && setProfileTarget(null)}
        title={profileTarget ? `员工档案 · ${profileTarget.name}` : "员工档案"}
        description="完整档案信息与任职记录（只读）"
        width={520}
      >
        {profileTarget && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <Avatar className="size-16">
                {profileTarget.avatar ? (
                  <AvatarImage src={profileTarget.avatar} alt={profileTarget.name} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-xl text-primary">
                  {profileTarget.name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">{profileTarget.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{profileTarget.empNo ?? "—"}</span>
                  {profileTarget.enabled ? (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                      在职
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-600">
                      停用
                    </Badge>
                  )}
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  {profileTarget.primaryDeptName ?? "—"} · {profileTarget.primaryPostName ?? "—"}
                </div>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <ProfileItem label="账号" value={profileTarget.username} mono />
              <ProfileItem label="手机号" value={profileTarget.phone} mono />
              <ProfileItem label="邮箱" value={profileTarget.email} />
              <ProfileItem label="性别" value={genderLabels[profileTarget.gender ?? ""] ?? "—"} />
              <ProfileItem label="生日" value={profileTarget.birthday} />
              <ProfileItem label="入职日期" value={profileTarget.hireDate} />
              <ProfileItem label="办公地点" value={profileTarget.officeLocation} />
              <ProfileItem label="直属上级" value={profileTarget.leaderName} />
              <ProfileItem label="角色" value={profileTarget.roleNames.join("、")} />
              <ProfileItem label="创建时间" value={formatTime(profileTarget.createdAt)} />
              <div className="col-span-2 space-y-0.5">
                <div className="text-xs text-muted-foreground">备注</div>
                <div className="text-sm leading-relaxed">{profileTarget.remark || "—"}</div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="text-sm font-medium">任职记录</div>
              {profileLoading ? (
                <div className="rounded-md border py-8 text-center text-xs text-muted-foreground">加载中…</div>
              ) : profileAssignments.length === 0 ? (
                <div className="rounded-md border py-8 text-center text-xs text-muted-foreground">暂无任职记录</div>
              ) : (
                profileAssignments.map((assignment) => (
                  <div key={assignment.id} className="space-y-1.5 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      {assignment.primary ? (
                        <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600">
                          主任职
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
                          兼任
                        </Badge>
                      )}
                      <span className="truncate text-sm font-medium">
                        {assignment.deptName} · {assignment.postName}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {assignment.roleNames.map((role) => (
                        <Badge key={role} variant="outline" className="text-xs text-muted-foreground">
                          {role}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* 任职管理 Drawer：主任职 + 兼任 */}
      <Drawer
        open={!!assignTarget}
        onOpenChange={(open) => !open && setAssignTarget(null)}
        title={assignTarget ? `任职管理 · ${assignTarget.name}` : "任职管理"}
        description="一人可在多个部门任职：主任职唯一，兼任可增删"
        width={520}
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="text-sm font-medium">当前任职</div>
            {assignmentsLoading ? (
              <div className="rounded-md border py-8 text-center text-xs text-muted-foreground">加载中…</div>
            ) : assignments.length === 0 ? (
              <div className="rounded-md border py-8 text-center text-xs text-muted-foreground">暂无任职记录</div>
            ) : (
              assignments.map((assignment) => (
                <div key={assignment.id} className="flex items-start gap-3 rounded-md border p-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      {assignment.primary ? (
                        <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600">
                          主任职
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
                          兼任
                        </Badge>
                      )}
                      <span className="truncate text-sm font-medium">
                        {assignment.deptName} · {assignment.postName}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {assignment.roleNames.map((role) => (
                        <Badge key={role} variant="outline" className="text-xs text-muted-foreground">
                          {role}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {!assignment.primary && (
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!canEdit}
                      className="size-7 shrink-0 text-rose-600 hover:text-rose-600"
                      aria-label="删除兼任"
                      onClick={() => void deleteAssignment(assignment)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <div className="text-sm font-medium">添加兼任</div>
            <div className="grid gap-3 @sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  <span className="text-destructive">*</span> 部门
                </Label>
                <Select value={addDeptId} onValueChange={setAddDeptId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择部门" />
                  </SelectTrigger>
                  <SelectContent>
                    {deptOptions.map((dept) => (
                      <SelectItem key={dept.id} value={String(dept.id)}>
                        {"　".repeat(dept.depth)}
                        {dept.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  <span className="text-destructive">*</span> 岗位
                </Label>
                <Select value={addPostId} onValueChange={setAddPostId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择岗位" />
                  </SelectTrigger>
                  <SelectContent>
                    {postOptions.map((post) => (
                      <SelectItem key={post.id} value={String(post.id)}>
                        {post.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                <span className="text-destructive">*</span> 角色
              </Label>
              <div className="grid grid-cols-2 gap-2 rounded-md border p-2.5 @sm:grid-cols-3">
                {roleOptions.map((role) => (
                  <div key={role.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`assign-role-${role.id}`}
                      checked={addRoleIds.includes(role.id)}
                      onCheckedChange={() => toggleAddRole(role.id)}
                    />
                    <Label htmlFor={`assign-role-${role.id}`} className="cursor-pointer text-sm font-normal">
                      {role.name}
                    </Label>
                  </div>
                ))}
                {roleOptions.length === 0 && (
                  <span className="col-span-full text-xs text-muted-foreground">角色数据加载中…</span>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                className="gap-1"
                disabled={!canEdit || addSubmitting}
                onClick={() => void submitAddAssignment()}
              >
                <Plus className="size-3.5" />
                {addSubmitting ? "提交中…" : "添加兼任"}
              </Button>
            </div>
          </div>
        </div>
      </Drawer>

      {/* 重置密码确认 */}
      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
            <DialogDescription>
              确定将用户「{resetTarget?.name}」的密码重置为一次性随机密码吗？重置后将显示新密码，请及时转交本人。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>
              取消
            </Button>
            <Button onClick={() => void confirmReset()}>确认重置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置成功：展示一次性新密码 */}
      <Dialog open={!!resetResult} onOpenChange={(open) => !open && setResetResult(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>新密码已生成</DialogTitle>
            <DialogDescription>
              用户「{resetResult?.name}」的密码已重置。请复制下方新密码并转交本人，此密码仅显示一次。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3">
            <code className="flex-1 font-mono text-sm break-all select-all">
              {resetResult?.password}
            </code>
            <Button
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              onClick={() => void copyNewPassword()}
              aria-label="复制新密码"
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setResetResult(null)}>我已记录</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除用户</DialogTitle>
            <DialogDescription>
              确定删除用户「{deleteTarget?.name}」吗？删除后该账号将无法登录系统。
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

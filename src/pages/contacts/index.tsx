import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Building2, ChevronRight, CloudOff, IdCard, MessageSquareText, RotateCw, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

interface DeptNode {
  id: number
  name: string
  parentId?: number
  sort?: number
  userCount: number
  children?: DeptNode[]
}

interface Employee {
  id: number
  username: string
  name: string
  empNo?: string
  phone?: string
  email?: string
  gender?: string
  hireDate?: string
  officeLocation?: string
  leaderName?: string
  avatar?: string
  enabled: boolean
  createdAt?: string
  primaryDeptName?: string
  primaryPostName?: string
  roleNames?: string[]
}

interface DeptTreeNodeProps {
  node: DeptNode
  depth: number
  selectedId: number | null
  expanded: Set<number>
  onSelect: (id: number) => void
  onToggle: (id: number) => void
}

function DeptTreeNode({ node, depth, selectedId, expanded, onSelect, onToggle }: DeptTreeNodeProps) {
  const hasChildren = !!node.children?.length
  const isOpen = expanded.has(node.id)
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={cn(
          "flex w-full items-center gap-1 rounded-md py-1.5 pr-2 text-sm transition-colors hover:bg-muted",
          selectedId === node.id && "bg-primary/10 font-medium text-primary hover:bg-primary/10",
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        {hasChildren ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(node.id)
            }}
            className="flex size-4 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/10"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
          </span>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
        <span className="ml-auto text-xs text-muted-foreground">{node.userCount}</span>
      </button>
      {hasChildren && isOpen && (
        <div>
          {node.children!.map((child) => (
            <DeptTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ContactsPage() {
  const [tree, setTree] = useState<DeptNode[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [viewing, setViewing] = useState<Employee | null>(null)

  const offline = useAuthStore((s) => s.offline)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [treeData, page] = await Promise.all([
        api<DeptNode[]>("/api/system/depts/tree"),
        api<PageResult<Employee>>(
          `/api/system/users?pageNum=1&pageSize=100${selectedDeptId != null ? `&deptId=${selectedDeptId}` : ""}`,
        ),
      ])
      setTree(treeData)
      setEmployees(page.list)
      // 首次加载默认展开顶层部门
      setExpanded((prev) => (prev.size > 0 ? prev : new Set(treeData.map((d) => d.id))))
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [selectedDeptId])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
  }, [load, offline])

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalCount = useMemo(() => tree.reduce((sum, d) => sum + d.userCount, 0), [tree])

  const columns: ColumnDef<Employee, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        meta: { title: "姓名" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="姓名" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Avatar className="size-7">
              {row.original.avatar ? <AvatarImage src={row.original.avatar} alt={row.original.name} /> : null}
              <AvatarFallback className="bg-primary/10 text-xs text-primary">
                {row.original.name.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <span className="font-medium">{row.original.name}</span>
          </div>
        ),
      },
      {
        accessorKey: "username",
        meta: { title: "账号" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="账号" />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.username}</span>,
      },
      {
        accessorKey: "primaryDeptName",
        meta: { title: "部门" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="部门" />,
        cell: ({ row }) => row.original.primaryDeptName ?? "—",
      },
      {
        accessorKey: "primaryPostName",
        meta: { title: "岗位" },
        header: () => <span>岗位</span>,
        enableSorting: false,
        cell: ({ row }) => row.original.primaryPostName ?? "—",
      },
      {
        accessorKey: "phone",
        meta: { title: "手机号" },
        header: () => <span>手机号</span>,
        enableSorting: false,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.phone ?? "—"}</span>,
      },
      {
        id: "roleNames",
        meta: { title: "角色" },
        header: () => <span>角色</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.roleNames?.length ? (
              row.original.roleNames.map((r) => (
                <Badge key={r} variant="secondary" className="text-xs font-normal">
                  {r}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "enabled",
        meta: { title: "状态" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) =>
          row.original.enabled ? (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
              在职
            </Badge>
          ) : (
            <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-600">
              离职
            </Badge>
          ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setViewing(row.original)}>
            <IdCard className="size-3.5" />
            查看名片
          </Button>
        ),
      },
    ],
    [],
  )

  if (loadError === "network") {
    return (
      <div className="space-y-4">
        <PageHeader title="通讯录" description="后端未连接——启动 server/ 后此页为真实数据" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot
              spring-boot:run，然后重新登录即可按真实组织架构查找同事。
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => void load()}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <PageHeader title="通讯录" description="全员通讯录，按组织架构快速查找同事" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title="通讯录" description="全员通讯录，按组织架构快速查找同事" />

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* 左侧部门树 */}
        <Card className="h-fit gap-2 py-3">
          <CardHeader className="px-3">
            <CardTitle className="text-sm">组织架构</CardTitle>
          </CardHeader>
          <CardContent className="px-2">
            <button
              type="button"
              onClick={() => setSelectedDeptId(null)}
              className={cn(
                "flex w-full items-center gap-1 rounded-md py-1.5 pl-2 pr-2 text-sm transition-colors hover:bg-muted",
                selectedDeptId === null && "bg-primary/10 font-medium text-primary hover:bg-primary/10",
              )}
            >
              <Building2 className="size-4 shrink-0" />
              <span className="truncate">全公司</span>
              <span className="ml-auto text-xs text-muted-foreground">{totalCount}</span>
            </button>
            {tree.map((node) => (
              <DeptTreeNode
                key={node.id}
                node={node}
                depth={0}
                selectedId={selectedDeptId}
                expanded={expanded}
                onSelect={setSelectedDeptId}
                onToggle={toggleExpand}
              />
            ))}
          </CardContent>
        </Card>

        {/* 右侧员工列表 */}
        <DataTable
          columns={columns}
          data={employees}
          loading={loading}
          searchKeys={["name", "username", "phone"]}
          searchPlaceholder="搜索姓名 / 账号 / 手机号"
          exportFileName="通讯录"
          onRefresh={() => void load()}
        />
      </div>

      {/* 员工名片 Dialog */}
      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="sm:max-w-sm">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle>员工名片</DialogTitle>
                <DialogDescription>{viewing.primaryDeptName ?? "未分配部门"}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-2 py-2">
                <Avatar className="size-20">
                  {viewing.avatar ? <AvatarImage src={viewing.avatar} alt={viewing.name} /> : null}
                  <AvatarFallback className="bg-primary/10 text-2xl text-primary">
                    {viewing.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="text-lg font-semibold">{viewing.name}</div>
                <div className="text-sm text-muted-foreground">{viewing.primaryPostName ?? "—"}</div>
              </div>
              <Separator />
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">部门</span>
                  <span>{viewing.primaryDeptName ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">工号</span>
                  <span className="font-mono">{viewing.empNo ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">账号</span>
                  <span className="font-mono">{viewing.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">手机</span>
                  <span className="font-mono">{viewing.phone ?? "—"}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="shrink-0 text-muted-foreground">邮箱</span>
                  <span className="truncate text-right">{viewing.email ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">办公地点</span>
                  <span>{viewing.officeLocation ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">入职日期</span>
                  <span>{viewing.hireDate ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">直属上级</span>
                  <span>{viewing.leaderName ?? "—"}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="shrink-0 text-muted-foreground">角色</span>
                  <span className="text-right">
                    {viewing.roleNames?.length ? viewing.roleNames.join("、") : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">状态</span>
                  <span>{viewing.enabled ? "在职" : "离职"}</span>
                </div>
              </div>
              <DialogFooter>
                <Button
                  className="w-full gap-1.5"
                  onClick={() => toast.success(`已向 ${viewing.name} 发起会话`)}
                >
                  <MessageSquareText className="size-4" />
                  发消息
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

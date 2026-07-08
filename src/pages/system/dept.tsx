import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CloudOff,
  FolderPlus,
  Pencil,
  Plus,
  RotateCw,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { PermissionBanner } from "@/components/permission-banner"
import { Modal } from "@/components/modal"
import { RecordPicker, RecordPickerField, type RecordPickerColumn } from "@/components/record-picker"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"

interface DeptNode {
  id: number
  name: string
  parentId?: number | null
  sort: number | null
  code?: string | null
  leaderId?: number | null
  leaderName?: string | null
  enabled: boolean
  createdAt?: string | null
  userCount: number
  children?: DeptNode[]
}

/** 负责人选择弹窗的数据行（GET /api/system/users） */
interface UserOption extends Record<string, unknown> {
  id: number
  name: string
  empNo?: string
  primaryDeptName?: string
  primaryPostName?: string
}

interface FlatRow {
  node: DeptNode
  depth: number
}

interface DeptFormState {
  name: string
  code: string
  sort: string
  enabled: boolean
}

const emptyForm: DeptFormState = { name: "", code: "", sort: "10", enabled: true }

/** 收集所有含子节点的部门 id（用于展开全部） */
function collectParentIds(nodes: DeptNode[]): number[] {
  return nodes.flatMap((node) =>
    node.children?.length ? [node.id, ...collectParentIds(node.children)] : [],
  )
}

/** 按 id 在树中查找节点 */
function findNode(nodes: DeptNode[], id: number): DeptNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const hit = node.children?.length ? findNode(node.children, id) : null
    if (hit) return hit
  }
  return null
}

/** 名称/编码模糊匹配：命中节点及其祖先链保留（父节点因子孙命中而保留） */
function filterTree(nodes: DeptNode[], kw: string): DeptNode[] {
  return nodes.flatMap((node) => {
    const children = filterTree(node.children ?? [], kw)
    const selfHit =
      node.name.toLowerCase().includes(kw) || (node.code ?? "").toLowerCase().includes(kw)
    if (selfHit || children.length > 0) return [{ ...node, children }]
    return []
  })
}

/** 命中文字高亮 */
function Highlight({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword) return <>{text}</>
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase())
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/20 text-primary rounded px-0.5">
        {text.slice(idx, idx + keyword.length)}
      </mark>
      {text.slice(idx + keyword.length)}
    </>
  )
}

/** 负责人选择弹窗的表格列 */
const leaderColumns: RecordPickerColumn<UserOption>[] = [
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

export default function DeptPage() {
  const [tree, setTree] = useState<DeptNode[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [keyword, setKeyword] = useState("")

  const offline = useAuthStore((s) => s.offline)
  const canEdit = useHasPerm("system:dept:edit")

  // 新增/编辑（Modal 共用一份表单）：editTarget 有值=编辑；否则新增（parentNode 为空=根部门）
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<DeptNode | null>(null)
  const [parentNode, setParentNode] = useState<DeptNode | null>(null)
  const [form, setForm] = useState<DeptFormState>(emptyForm)
  const [leader, setLeader] = useState<{ id: number; name: string } | null>(null)
  const [leaderPickerOpen, setLeaderPickerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DeptNode | null>(null)

  // 负责人候选（RecordPicker 数据源）
  const [userOptions, setUserOptions] = useState<UserOption[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await api<DeptNode[]>("/api/system/depts/tree")
      setTree(data)
      setExpanded(new Set(collectParentIds(data)))
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadUsers = useCallback(async () => {
    try {
      const page = await api<PageResult<UserOption>>("/api/system/users?pageNum=1&pageSize=100")
      setUserOptions(page.list)
    } catch {
      // 候选加载失败不阻塞树；后端未启动由列表的 NetworkError 卡片兜底
    }
  }, [])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
    void loadUsers()
  }, [load, loadUsers, offline])

  /* ---------- 搜索 / 展开 ---------- */

  const kw = keyword.trim().toLowerCase()

  const displayTree = useMemo(() => (kw ? filterTree(tree, kw) : tree), [tree, kw])

  // 搜索时命中链路强制展开；平时按 expanded 集合
  const rows = useMemo(() => {
    const out: FlatRow[] = []
    const walk = (nodes: DeptNode[], depth: number) => {
      for (const node of nodes) {
        out.push({ node, depth })
        if (node.children?.length && (kw !== "" || expanded.has(node.id))) {
          walk(node.children, depth + 1)
        }
      }
    }
    walk(displayTree, 0)
    return out
  }, [displayTree, expanded, kw])

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const expandAll = () => setExpanded(new Set(collectParentIds(tree)))
  const collapseAll = () => setExpanded(new Set())

  /* ---------- 同级排序 ---------- */

  /** 同级节点列表与自身位置（始终基于原始树，避免搜索过滤影响换位目标） */
  const siblingInfo = useCallback(
    (node: DeptNode) => {
      const parentId = node.parentId ?? 0
      const siblings = parentId === 0 ? tree : (findNode(tree, parentId)?.children ?? [])
      return { siblings, index: siblings.findIndex((d) => d.id === node.id) }
    },
    [tree],
  )

  /** 上移/下移：交换与相邻兄弟节点的 sort 值（两次 PUT）后刷新 */
  const move = async (node: DeptNode, dir: -1 | 1) => {
    const { siblings, index } = siblingInfo(node)
    const target = siblings[index + dir]
    if (!target) return
    try {
      await api(`/api/system/depts/${node.id}`, {
        method: "PUT",
        body: JSON.stringify({ sort: target.sort ?? 0 }),
      })
      await api(`/api/system/depts/${target.id}`, {
        method: "PUT",
        body: JSON.stringify({ sort: node.sort ?? 0 }),
      })
      toast.success(`部门「${node.name}」已${dir < 0 ? "上移" : "下移"}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "排序调整失败")
    } finally {
      void load()
    }
  }

  /* ---------- 状态切换 ---------- */

  const toggleEnabled = async (node: DeptNode, checked: boolean) => {
    try {
      await api(`/api/system/depts/${node.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: checked }),
      })
      const patch = (nodes: DeptNode[]): DeptNode[] =>
        nodes.map((n) =>
          n.id === node.id
            ? { ...n, enabled: checked }
            : n.children?.length
              ? { ...n, children: patch(n.children) }
              : n,
        )
      setTree((prev) => patch(prev))
      toast.success(`已${checked ? "启用" : "停用"}部门「${node.name}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    }
  }

  /* ---------- 新增 / 编辑 ---------- */

  const openCreate = (parent: DeptNode | null) => {
    setEditTarget(null)
    setParentNode(parent)
    setForm(emptyForm)
    setLeader(null)
    setFormOpen(true)
  }

  const openEdit = (node: DeptNode) => {
    setEditTarget(node)
    setParentNode(null)
    setForm({
      name: node.name,
      code: node.code ?? "",
      sort: String(node.sort ?? 0),
      enabled: node.enabled,
    })
    setLeader(node.leaderId != null ? { id: node.leaderId, name: node.leaderName ?? `#${node.leaderId}` } : null)
    setFormOpen(true)
  }

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("请填写部门名称")
      return
    }
    setSubmitting(true)
    try {
      if (editTarget) {
        await api(`/api/system/depts/${editTarget.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: form.name.trim(),
            code: form.code.trim(), // 空串 = 清空编码
            sort: Number(form.sort) || 0,
            leaderId: leader?.id ?? 0, // 0 = 清空负责人
            enabled: form.enabled,
          }),
        })
        toast.success(`部门「${form.name.trim()}」已更新`)
      } else {
        await api("/api/system/depts", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            code: form.code.trim() || null,
            parentId: parentNode?.id ?? 0,
            sort: Number(form.sort) || 0,
            leaderId: leader?.id ?? null,
            enabled: form.enabled,
          }),
        })
        toast.success(
          parentNode
            ? `已在「${parentNode.name}」下新增部门「${form.name.trim()}」`
            : `根部门「${form.name.trim()}」已创建`,
        )
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
      await api(`/api/system/depts/${deleteTarget.id}`, { method: "DELETE" })
      toast.success(`部门「${deleteTarget.name}」已删除`)
      void load()
    } catch (err) {
      // 有子部门或仍有人员任职时，后端返回业务错误信息
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="部门管理"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为真实数据"
            : "维护组织架构：编码 / 负责人 / 同级排序 / 启用状态"
        }
      />

      <PermissionBanner perm="system:dept:edit" action="部门管理" />

      {loadError === "network" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，
              然后用 admin（密码 admin123）重新登录，即可维护真实的组织架构树。
            </p>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                void load()
                void loadUsers()
              }}
            >
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
        <div className="rounded-lg border bg-card">
          {/* 工具栏 */}
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索部门名称 / 编码"
                className="h-8 w-56 pl-8 text-sm"
              />
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={expandAll}>
              <ChevronsUpDown className="size-3.5" />
              展开全部
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={collapseAll}>
              <ChevronsDownUp className="size-3.5" />
              折叠全部
            </Button>
            <div className="ml-auto flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => void load()}>
                    <RotateCw className={cn("size-4", loading && "animate-spin")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>刷新</TooltipContent>
              </Tooltip>
              <Button
                size="sm"
                className="h-8 gap-1"
                disabled={!canEdit}
                onClick={() => openCreate(null)}
              >
                <Plus className="size-4" />
                新增根部门
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">部门名称</TableHead>
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">编码</TableHead>
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">负责人</TableHead>
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">人数</TableHead>
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">排序</TableHead>
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">状态</TableHead>
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">创建时间</TableHead>
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-xs text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-xs text-muted-foreground">
                    {kw ? "没有匹配的部门" : "暂无部门数据"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(({ node, depth }) => {
                  const hasChildren = !!node.children?.length
                  const isOpen = kw !== "" || expanded.has(node.id)
                  const { siblings, index } = siblingInfo(node)
                  return (
                    <TableRow key={node.id} className={cn(!node.enabled && "opacity-60")}>
                      {/* 部门名称：层级缩进 + 连接线 + 展开箭头 */}
                      <TableCell>
                        <div className="flex items-center">
                          {Array.from({ length: depth }).map((_, i) => (
                            <span
                              key={i}
                              className="ml-2 h-7 w-4 shrink-0 self-stretch border-l border-dashed border-border"
                            />
                          ))}
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggle(node.id)}
                              className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted"
                              aria-label={isOpen ? "折叠" : "展开"}
                            >
                              <ChevronRight
                                className={cn(
                                  "size-3.5 text-muted-foreground transition-transform",
                                  isOpen && "rotate-90",
                                )}
                              />
                            </button>
                          ) : (
                            <span className="size-5 shrink-0" />
                          )}
                          <span className="ml-1 text-sm font-medium">
                            <Highlight text={node.name} keyword={kw} />
                          </span>
                        </div>
                      </TableCell>
                      {/* 编码 */}
                      <TableCell>
                        {node.code ? (
                          <span className="font-mono text-xs">
                            <Highlight text={node.code} keyword={kw} />
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {/* 负责人 */}
                      <TableCell>
                        {node.leaderName ? (
                          <span className="flex items-center gap-1.5 text-sm">
                            <Avatar className="size-5">
                              <AvatarFallback className="bg-primary/10 text-[10px] text-primary">
                                {node.leaderName.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            {node.leaderName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {/* 人数 */}
                      <TableCell>
                        <Badge variant="secondary" className="tabular-nums">
                          {node.userCount} 人
                        </Badge>
                      </TableCell>
                      {/* 排序：同级上移/下移 */}
                      <TableCell>
                        <div className="flex items-center gap-0.5">
                          <span className="w-6 text-sm tabular-nums text-muted-foreground">
                            {node.sort ?? 0}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            disabled={!canEdit || index <= 0}
                            aria-label="上移"
                            onClick={() => void move(node, -1)}
                          >
                            <ArrowUp className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            disabled={!canEdit || index < 0 || index >= siblings.length - 1}
                            aria-label="下移"
                            onClick={() => void move(node, 1)}
                          >
                            <ArrowDown className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                      {/* 状态 */}
                      <TableCell>
                        <Switch
                          checked={node.enabled}
                          disabled={!canEdit}
                          onCheckedChange={(checked) => void toggleEnabled(node, checked)}
                          aria-label="切换部门状态"
                        />
                      </TableCell>
                      {/* 创建时间 */}
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {node.createdAt ? node.createdAt.slice(0, 10) : "—"}
                        </span>
                      </TableCell>
                      {/* 操作 */}
                      <TableCell>
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canEdit}
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => openCreate(node)}
                          >
                            <FolderPlus className="size-3.5" />
                            新增子部门
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canEdit}
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => openEdit(node)}
                          >
                            <Pencil className="size-3.5" />
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canEdit}
                            className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-600"
                            onClick={() => setDeleteTarget(node)}
                          >
                            <Trash2 className="size-3.5" />
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 新增 / 编辑部门 */}
      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editTarget ? "编辑部门" : parentNode ? "新增子部门" : "新增根部门"}
        description={
          editTarget
            ? `修改部门「${editTarget.name}」的基本信息`
            : parentNode
              ? `在「${parentNode.name}」下创建新的子部门`
              : "创建新的顶级部门"
        }
        width={480}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button disabled={submitting} onClick={() => void submit()}>
              {submitting ? "保存中…" : editTarget ? "保存" : "创建"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="dept-form-name">
              <span className="text-destructive">*</span> 部门名称
            </Label>
            <Input
              id="dept-form-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="请输入部门名称"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dept-form-code">部门编码</Label>
            <Input
              id="dept-form-code"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="如 XC-TECH，全局唯一，留空不设置"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label>负责人</Label>
            <RecordPickerField
              labels={leader ? [{ id: String(leader.id), label: leader.name }] : []}
              placeholder="点击选择部门负责人"
              onOpen={() => setLeaderPickerOpen(true)}
              onRemove={() => setLeader(null)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dept-form-sort">排序</Label>
              <Input
                id="dept-form-sort"
                type="number"
                value={form.sort}
                onChange={(e) => setForm((f) => ({ ...f, sort: e.target.value }))}
                placeholder="数字越小越靠前"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dept-form-enabled">状态</Label>
              <div className="flex h-9 items-center gap-2">
                <Switch
                  id="dept-form-enabled"
                  checked={form.enabled}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, enabled: checked }))}
                />
                <span className="text-sm text-muted-foreground">{form.enabled ? "启用" : "停用"}</span>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* 负责人选择：RecordPicker 单选（存 id、展示姓名） */}
      <RecordPicker<UserOption>
        open={leaderPickerOpen}
        onOpenChange={setLeaderPickerOpen}
        title="选择部门负责人"
        description="从用户列表单选：存储用户 id，表单展示姓名"
        data={userOptions}
        columns={leaderColumns}
        idField="id"
        labelField="name"
        value={leader ? [String(leader.id)] : []}
        onConfirm={(_ids, selectedRows) => {
          const row = selectedRows[0]
          setLeader(row ? { id: row.id, name: row.name } : null)
        }}
        searchKeys={["name", "empNo"]}
      />

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除部门</DialogTitle>
            <DialogDescription>
              确定删除部门「{deleteTarget?.name}」吗？存在子部门或仍有人员任职时将无法删除。
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

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  CircleSlash,
  FolderPlus,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Trash2,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Modal } from "@/components/modal"
import { RecordPicker, RecordPickerField, type RecordPickerColumn } from "@/components/record-picker"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
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
import { useAuthStore } from "@/stores/auth-store"

/** 部门树节点（GET /api/system/depts/tree） */
export interface DeptNode {
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
      <mark className="rounded bg-primary/20 px-0.5 text-primary">
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

export interface DeptTreeProps {
  /** 受控选中部门 id；null=全部/根 */
  selectedId: number | null
  onSelect: (id: number | null, node: DeptNode | null) => void
  /** 树变动（增删改/排序/启停）后回调，供右表刷新计数等 */
  onChanged?: () => void
  canEdit: boolean
  className?: string
}

/**
 * 共享部门树：顶部搜索 + 工具栏（展开/折叠/新建根）+ 树体，右键菜单 CRUD（新增子部门/编辑/上下移/启停/删除）。
 * 自管数据加载（`/api/system/depts/tree`）、负责人 RecordPicker、增删改 Modal/Dialog。
 * 用户管理左栏与部门管理页共用；每次成功变动后 `void load()` 刷新自身并触发 `onChanged`。
 */
export function DeptTree({ selectedId, onSelect, onChanged, canEdit, className }: DeptTreeProps) {
  const [tree, setTree] = useState<DeptNode[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [keyword, setKeyword] = useState("")

  const offline = useAuthStore((s) => s.offline)

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
      const list = Array.isArray(data) ? data : []
      setTree(list)
      setExpanded(new Set(collectParentIds(list)))
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
      setUserOptions(Array.isArray(page.list) ? page.list : [])
    } catch {
      // 候选加载失败不阻塞树；后端未启动时树体自身空态兜底
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
      await load()
      onChanged?.()
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
      onChanged?.()
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
    setLeader(
      node.leaderId != null ? { id: node.leaderId, name: node.leaderName ?? `#${node.leaderId}` } : null,
    )
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
      await load()
      onChanged?.()
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
      // 删除的正是当前选中部门 → 回到"全部"
      if (selectedId === deleteTarget.id) onSelect(null, null)
      await load()
      onChanged?.()
    } catch (err) {
      // 有子部门或仍有人员任职时，后端返回业务错误信息
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {/* 顶部搜索 */}
      <div className="border-b p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索部门名称 / 编码"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={expandAll}>
          <ChevronsUpDown className="size-3.5" />
          展开
        </Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={collapseAll}>
          <ChevronsDownUp className="size-3.5" />
          折叠
        </Button>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="刷新"
            onClick={() => void load()}
          >
            <RotateCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={!canEdit}
            onClick={() => openCreate(null)}
          >
            <Plus className="size-3.5" />
            新建根
          </Button>
        </div>
      </div>

      {/* 树体 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">加载中…</div>
        ) : loadError ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {loadError === "network" ? "后端未连接，暂无部门数据" : loadError}
          </div>
        ) : (
          <>
            {/* 置顶「全部部门」：取消筛选（selectedId=null） */}
            <button
              type="button"
              onClick={() => onSelect(null, null)}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm",
                selectedId === null
                  ? "bg-primary/10 font-medium text-primary"
                  : "hover:bg-accent",
              )}
            >
              <Users className="size-3.5 shrink-0 opacity-70" />
              <span className="flex-1 truncate text-left">全部部门</span>
            </button>

            {rows.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {kw ? "没有匹配的部门" : "暂无部门数据"}
              </div>
            ) : (
              rows.map(({ node, depth }) => {
                const hasChildren = !!node.children?.length
                const isOpen = kw !== "" || expanded.has(node.id)
                const selected = selectedId === node.id
                const { siblings, index } = siblingInfo(node)
                return (
                  <ContextMenu key={node.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelect(node.id, node)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            onSelect(node.id, node)
                          }
                        }}
                        style={{ paddingLeft: depth * 14 + 4 }}
                        className={cn(
                          "group flex cursor-pointer items-center gap-1 rounded-md py-1.5 pr-1.5 text-sm outline-none",
                          selected
                            ? "bg-primary/10 font-medium text-primary"
                            : "hover:bg-accent",
                          !node.enabled && "opacity-60",
                        )}
                      >
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggle(node.id)
                            }}
                            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted/70"
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
                        <span className="min-w-0 flex-1 truncate">
                          <Highlight text={node.name} keyword={kw} />
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {node.userCount}
                        </span>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-44">
                      <ContextMenuItem disabled={!canEdit} onSelect={() => openCreate(node)}>
                        <FolderPlus className="size-3.5" /> 新增子部门
                      </ContextMenuItem>
                      <ContextMenuItem disabled={!canEdit} onSelect={() => openEdit(node)}>
                        <Pencil className="size-3.5" /> 编辑
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={!canEdit || index <= 0}
                        onSelect={() => void move(node, -1)}
                      >
                        <ArrowUp className="size-3.5" /> 上移
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={!canEdit || index < 0 || index >= siblings.length - 1}
                        onSelect={() => void move(node, 1)}
                      >
                        <ArrowDown className="size-3.5" /> 下移
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={!canEdit}
                        onSelect={() => void toggleEnabled(node, !node.enabled)}
                      >
                        {node.enabled ? (
                          <>
                            <CircleSlash className="size-3.5" /> 停用
                          </>
                        ) : (
                          <>
                            <CircleCheck className="size-3.5" /> 启用
                          </>
                        )}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        disabled={!canEdit}
                        onSelect={() => setDeleteTarget(node)}
                      >
                        <Trash2 className="size-3.5" /> 删除
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })
            )}
          </>
        )}
      </div>

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
                <span className="text-sm text-muted-foreground">
                  {form.enabled ? "启用" : "停用"}
                </span>
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

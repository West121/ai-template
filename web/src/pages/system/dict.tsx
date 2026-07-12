import { useCallback, useEffect, useMemo, useState } from "react"
import {
  BookMarked,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CloudOff,
  ListPlus,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"

interface DictType {
  id: number
  code: string
  name: string
  remark?: string | null
  enabled?: boolean
  itemCount: number
}

interface DictItem {
  id: number
  typeId: number
  parentId?: number | null
  label: string
  value: string
  sort?: number | null
  enabled: boolean
  remark?: string | null
  children?: DictItem[]
}

interface FlatItemRow {
  node: DictItem
  depth: number
}

interface TypeFormState {
  code: string
  name: string
  remark: string
}

interface ItemFormState {
  label: string
  value: string
  sort: string
  remark: string
}

const emptyTypeForm: TypeFormState = { code: "", name: "", remark: "" }
const emptyItemForm: ItemFormState = { label: "", value: "", sort: "10", remark: "" }

/** 收集所有含子节点的字典项 id（用于展开全部） */
function collectParentIds(nodes: DictItem[]): number[] {
  return nodes.flatMap((node) =>
    node.children?.length ? [node.id, ...collectParentIds(node.children)] : [],
  )
}

/** 底部悬浮批量操作胶囊（对齐 DataTable 的选中胶囊样式；此页两张自绘表格复用） */
function BatchBar({
  count,
  noun,
  bottomClass,
  onDelete,
  onCancel,
}: {
  count: number
  noun: string
  bottomClass: string
  onDelete: () => void
  onCancel: () => void
}) {
  return (
    <div className={cn("pointer-events-none fixed inset-x-0 z-50 flex justify-center", bottomClass)}>
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border bg-background/95 py-1.5 pl-4 pr-1.5 shadow-lg backdrop-blur animate-in fade-in-0 slide-in-from-bottom-2">
        <span className="text-sm">
          已选 <span className="font-semibold text-primary">{count}</span> 个{noun}
        </span>
        <span className="h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-full px-2.5 text-xs text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" /> 删除
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 rounded-full px-2.5 text-xs text-muted-foreground"
          onClick={onCancel}
        >
          取消
        </Button>
      </div>
    </div>
  )
}

export default function DictPage() {
  const [types, setTypes] = useState<DictType[]>([])
  const [typesLoading, setTypesLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [typeKeyword, setTypeKeyword] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const [items, setItems] = useState<DictItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const offline = useAuthStore((s) => s.offline)
  const canEdit = useHasPerm("system:dict:edit")

  // 类型表单：editType 有值=编辑，否则新增
  const [typeFormOpen, setTypeFormOpen] = useState(false)
  const [editType, setEditType] = useState<DictType | null>(null)
  const [typeForm, setTypeForm] = useState<TypeFormState>(emptyTypeForm)

  // 字典项表单：editItem 有值=编辑；parentItem 决定父级（null=根项）
  const [itemFormOpen, setItemFormOpen] = useState(false)
  const [editItem, setEditItem] = useState<DictItem | null>(null)
  const [parentItem, setParentItem] = useState<DictItem | null>(null)
  const [itemForm, setItemForm] = useState<ItemFormState>(emptyItemForm)

  const [submitting, setSubmitting] = useState(false)
  const [deleteType, setDeleteType] = useState<DictType | null>(null)
  const [deleteItem, setDeleteItem] = useState<DictItem | null>(null)

  // 多选批量删除：字典类型（左）/ 字典项（右）各一套选中集 + 二次确认开关
  const [selectedTypeIds, setSelectedTypeIds] = useState<Set<number>>(new Set())
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set())
  const [batchTypeConfirm, setBatchTypeConfirm] = useState(false)
  const [batchItemConfirm, setBatchItemConfirm] = useState(false)

  const selectedType = useMemo(
    () => types.find((t) => t.id === selectedId) ?? null,
    [types, selectedId],
  )

  const loadTypes = useCallback(async () => {
    setTypesLoading(true)
    setLoadError(null)
    try {
      const page = await api<PageResult<DictType>>("/api/infra/dict/types?pageNum=1&pageSize=100")
      setTypes(page.list)
      // 默认选中第一个；已有选中且仍存在则保持
      setSelectedId((prev) =>
        prev != null && page.list.some((t) => t.id === prev) ? prev : (page.list[0]?.id ?? null),
      )
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setTypesLoading(false)
    }
  }, [])

  const loadItems = useCallback(async (typeId: number) => {
    setItemsLoading(true)
    try {
      const data = await api<DictItem[]>(`/api/infra/dict/types/${typeId}/items`)
      setItems(data)
      setExpanded(new Set(collectParentIds(data)))
    } catch (err) {
      if (!(err instanceof NetworkError)) {
        toast.error(err instanceof Error ? err.message : "字典项加载失败")
      }
      setItems([])
    } finally {
      setItemsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (offline) {
      setTypesLoading(false)
      setLoadError("network")
      return
    }
    void loadTypes()
  }, [loadTypes, offline])

  useEffect(() => {
    if (selectedId != null && !offline) void loadItems(selectedId)
    else setItems([])
    // 切换字典类型 → 字典项选中作废（属于另一类型）
    setSelectedItemIds(new Set())
  }, [selectedId, offline, loadItems])

  /* ---------- 树表展开 ---------- */

  const itemRows = useMemo(() => {
    const out: FlatItemRow[] = []
    const walk = (nodes: DictItem[], depth: number) => {
      for (const node of nodes) {
        out.push({ node, depth })
        if (node.children?.length && expanded.has(node.id)) walk(node.children, depth + 1)
      }
    }
    walk(items, 0)
    return out
  }, [items, expanded])

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /* ---------- 字典类型 CRUD ---------- */

  const filteredTypes = useMemo(() => {
    const kw = typeKeyword.trim().toLowerCase()
    if (!kw) return types
    return types.filter(
      (t) => t.name.toLowerCase().includes(kw) || t.code.toLowerCase().includes(kw),
    )
  }, [types, typeKeyword])

  const openCreateType = () => {
    setEditType(null)
    setTypeForm(emptyTypeForm)
    setTypeFormOpen(true)
  }

  const openEditType = (t: DictType) => {
    setEditType(t)
    setTypeForm({ code: t.code, name: t.name, remark: t.remark ?? "" })
    setTypeFormOpen(true)
  }

  const submitType = async () => {
    if (!typeForm.code.trim() || !typeForm.name.trim()) {
      toast.error("请填写字典编码和名称")
      return
    }
    setSubmitting(true)
    try {
      const body = JSON.stringify({
        code: typeForm.code.trim(),
        name: typeForm.name.trim(),
        remark: typeForm.remark.trim() || null,
      })
      if (editType) {
        await api(`/api/infra/dict/types/${editType.id}`, { method: "PUT", body })
        toast.success(`字典类型「${typeForm.name.trim()}」已更新`)
      } else {
        await api("/api/infra/dict/types", { method: "POST", body })
        toast.success(`字典类型「${typeForm.name.trim()}」已创建`)
      }
      setTypeFormOpen(false)
      void loadTypes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDeleteType = async () => {
    if (!deleteType) return
    try {
      await api(`/api/infra/dict/types/${deleteType.id}`, { method: "DELETE" })
      toast.success(`字典类型「${deleteType.name}」已删除`)
      if (selectedId === deleteType.id) setSelectedId(null)
      void loadTypes()
    } catch (err) {
      // 类型下仍有字典项时后端返回业务错误
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteType(null)
    }
  }

  /* ---------- 字典项 CRUD ---------- */

  const openCreateItem = (parent: DictItem | null) => {
    setEditItem(null)
    setParentItem(parent)
    setItemForm(emptyItemForm)
    setItemFormOpen(true)
  }

  const openEditItem = (node: DictItem) => {
    setEditItem(node)
    setParentItem(null)
    setItemForm({
      label: node.label,
      value: node.value,
      sort: String(node.sort ?? 0),
      remark: node.remark ?? "",
    })
    setItemFormOpen(true)
  }

  const submitItem = async () => {
    if (selectedId == null) return
    if (!itemForm.label.trim() || !itemForm.value.trim()) {
      toast.error("请填写标签和值")
      return
    }
    setSubmitting(true)
    try {
      if (editItem) {
        await api(`/api/infra/dict/items/${editItem.id}`, {
          method: "PUT",
          body: JSON.stringify({
            label: itemForm.label.trim(),
            value: itemForm.value.trim(),
            sort: Number(itemForm.sort) || 0,
            remark: itemForm.remark.trim() || null,
          }),
        })
        toast.success(`字典项「${itemForm.label.trim()}」已更新`)
      } else {
        await api("/api/infra/dict/items", {
          method: "POST",
          body: JSON.stringify({
            typeId: selectedId,
            parentId: parentItem?.id ?? null,
            label: itemForm.label.trim(),
            value: itemForm.value.trim(),
            sort: Number(itemForm.sort) || 0,
            remark: itemForm.remark.trim() || null,
          }),
        })
        toast.success(
          parentItem
            ? `已在「${parentItem.label}」下新增字典项「${itemForm.label.trim()}」`
            : `根字典项「${itemForm.label.trim()}」已创建`,
        )
      }
      setItemFormOpen(false)
      void loadItems(selectedId)
      void loadTypes() // 刷新 itemCount
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSubmitting(false)
    }
  }

  const toggleItemEnabled = async (node: DictItem, checked: boolean) => {
    try {
      await api(`/api/infra/dict/items/${node.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: checked }),
      })
      const patchTree = (nodes: DictItem[]): DictItem[] =>
        nodes.map((n) =>
          n.id === node.id
            ? { ...n, enabled: checked }
            : n.children?.length
              ? { ...n, children: patchTree(n.children) }
              : n,
        )
      setItems((prev) => patchTree(prev))
      toast.success(`已${checked ? "启用" : "停用"}字典项「${node.label}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    }
  }

  const confirmDeleteItem = async () => {
    if (!deleteItem || selectedId == null) return
    try {
      await api(`/api/infra/dict/items/${deleteItem.id}`, { method: "DELETE" })
      toast.success(`字典项「${deleteItem.label}」已删除`)
      void loadItems(selectedId)
      void loadTypes()
    } catch (err) {
      // 有子项时后端返回业务错误
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteItem(null)
    }
  }

  /* ---------- 多选批量删除 ---------- */

  const toggleTypeSel = (id: number) =>
    setSelectedTypeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleItemSel = (id: number) =>
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAllItems = (checked: boolean) =>
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      for (const { node } of itemRows) {
        if (checked) next.add(node.id)
        else next.delete(node.id)
      }
      return next
    })

  const confirmBatchDeleteTypes = async () => {
    const ids = Array.from(selectedTypeIds)
    const result = await runBatch({
      ids,
      batchPath: "/api/infra/dict/types/batch-delete",
      single: (id) => api(`/api/infra/dict/types/${id}`, { method: "DELETE" }),
    })
    toastBatch(result, "删除")
    // 删掉的类型若含当前查看项 → 清空右表
    if (selectedId != null && result.successIds.includes(selectedId)) setSelectedId(null)
    setSelectedTypeIds(new Set())
    setBatchTypeConfirm(false)
    void loadTypes()
  }

  const confirmBatchDeleteItems = async () => {
    if (selectedId == null) return
    const ids = Array.from(selectedItemIds)
    const result = await runBatch({
      ids,
      batchPath: "/api/infra/dict/items/batch-delete",
      single: (id) => api(`/api/infra/dict/items/${id}`, { method: "DELETE" }),
    })
    toastBatch(result, "删除")
    setSelectedItemIds(new Set())
    setBatchItemConfirm(false)
    void loadItems(selectedId)
    void loadTypes()
  }

  // 字典项「全选可见行」状态（树形展开后可见的扁平行）
  const visibleItemIds = itemRows.map((r) => r.node.id)
  const allItemsSelected =
    visibleItemIds.length > 0 && visibleItemIds.every((id) => selectedItemIds.has(id))
  const someItemsSelected = visibleItemIds.some((id) => selectedItemIds.has(id))

  /* ---------- 渲染 ---------- */

  return (
    <div className="space-y-4">
      <PageHeader
        title="字典管理"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为真实数据"
            : "维护业务字典：左侧字典类型，右侧字典项（支持树形层级，如行政区划 region）"
        }
      />

      <PermissionBanner perm="system:dict:edit" action="字典维护" />

      {loadError === "network" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，
              然后用 admin（密码 admin123）重新登录，即可维护 leave_type / education / region（树形）等业务字典。
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => void loadTypes()}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={() => void loadTypes()}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[300px_1fr]">
          {/* 左：字典类型 */}
          <Card className="gap-0 py-0">
            <CardHeader className="gap-0 space-y-2.5 border-b px-4 py-3.5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">字典类型</CardTitle>
                <Button size="sm" className="h-7 gap-1 px-2 text-xs" disabled={!canEdit} onClick={openCreateType}>
                  <Plus className="size-3.5" /> 新增
                </Button>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={typeKeyword}
                  onChange={(e) => setTypeKeyword(e.target.value)}
                  placeholder="搜索名称 / 编码"
                  className="h-8 pl-8 text-sm"
                />
              </div>
            </CardHeader>
            <CardContent className="px-2 py-2">
              {typesLoading ? (
                <div className="py-10 text-center text-xs text-muted-foreground">加载中…</div>
              ) : filteredTypes.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground">
                  {typeKeyword ? "没有匹配的字典类型" : "暂无字典类型"}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredTypes.map((t, idx) => (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") setSelectedId(t.id)
                      }}
                      className={cn(
                        "group flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 transition-colors",
                        selectedId === t.id ? "bg-primary/10 text-primary" : "hover:bg-muted",
                      )}
                    >
                      {canEdit && (
                        <Checkbox
                          checked={selectedTypeIds.has(t.id)}
                          onCheckedChange={() => toggleTypeSel(t.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`选择字典类型 ${t.name}`}
                        />
                      )}
                      <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{t.name}</div>
                        <div
                          className={cn(
                            "truncate font-mono text-xs",
                            selectedId === t.id ? "text-primary/70" : "text-muted-foreground",
                          )}
                        >
                          {t.code}
                        </div>
                      </div>
                      <Badge variant="secondary" className="shrink-0 tabular-nums">
                        {t.itemCount}
                      </Badge>
                      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          disabled={!canEdit}
                          aria-label="编辑类型"
                          onClick={(e) => {
                            e.stopPropagation()
                            openEditType(t)
                          }}
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 text-rose-600 hover:text-rose-600"
                          disabled={!canEdit}
                          aria-label="删除类型"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteType(t)
                          }}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 右：字典项树形表格 */}
          <Card className="gap-0 py-0">
            <CardHeader className="gap-0 border-b px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <BookMarked className="size-4 text-muted-foreground" />
                  字典项{selectedType ? ` · ${selectedType.name}` : ""}
                </CardTitle>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={() => setExpanded(new Set(collectParentIds(items)))}
                  >
                    <ChevronsUpDown className="size-3.5" /> 展开全部
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={() => setExpanded(new Set())}
                  >
                    <ChevronsDownUp className="size-3.5" /> 折叠全部
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 gap-1"
                    disabled={!canEdit || selectedId == null}
                    onClick={() => openCreateItem(null)}
                  >
                    <Plus className="size-4" /> 新增根项
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10 bg-muted/50">
                      {canEdit && itemRows.length > 0 && (
                        <Checkbox
                          checked={allItemsSelected ? true : someItemsSelected ? "indeterminate" : false}
                          onCheckedChange={(v) => toggleAllItems(!!v)}
                          aria-label="全选字典项"
                        />
                      )}
                    </TableHead>
                    <TableHead className="w-12 bg-muted/50 text-center text-xs font-medium text-muted-foreground">#</TableHead>
                    <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">标签</TableHead>
                    <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">值</TableHead>
                    <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">排序</TableHead>
                    <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">状态</TableHead>
                    <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">备注</TableHead>
                    <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedId == null ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-12 text-center text-xs text-muted-foreground">
                        请先在左侧选择一个字典类型
                      </TableCell>
                    </TableRow>
                  ) : itemsLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-12 text-center text-xs text-muted-foreground">
                        加载中…
                      </TableCell>
                    </TableRow>
                  ) : itemRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-12 text-center text-xs text-muted-foreground">
                        该类型下暂无字典项，点击右上角「新增根项」创建
                      </TableCell>
                    </TableRow>
                  ) : (
                    itemRows.map(({ node, depth }, rowIndex) => {
                      const hasChildren = !!node.children?.length
                      const isOpen = expanded.has(node.id)
                      return (
                        <TableRow key={node.id} className={cn(!node.enabled && "opacity-60")}>
                          <TableCell className="w-10">
                            {canEdit && (
                              <Checkbox
                                checked={selectedItemIds.has(node.id)}
                                onCheckedChange={() => toggleItemSel(node.id)}
                                aria-label={`选择字典项 ${node.label}`}
                              />
                            )}
                          </TableCell>
                          <TableCell className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                            {rowIndex + 1}
                          </TableCell>
                          {/* 标签：层级缩进 + 展开箭头（树形） */}
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
                                  onClick={() => toggleExpand(node.id)}
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
                              <span className="ml-1 text-sm font-medium">{node.label}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs">{node.value}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm tabular-nums text-muted-foreground">{node.sort ?? 0}</span>
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={node.enabled}
                              disabled={!canEdit}
                              onCheckedChange={(checked) => void toggleItemEnabled(node, checked)}
                              aria-label="切换字典项状态"
                            />
                          </TableCell>
                          <TableCell>
                            <span className="block max-w-[160px] truncate text-xs text-muted-foreground">
                              {node.remark ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-0.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!canEdit}
                                className="h-7 gap-1 px-2 text-xs"
                                onClick={() => openCreateItem(node)}
                              >
                                <ListPlus className="size-3.5" /> 新增子项
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!canEdit}
                                className="h-7 gap-1 px-2 text-xs"
                                onClick={() => openEditItem(node)}
                              >
                                <Pencil className="size-3.5" /> 编辑
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!canEdit}
                                className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-600"
                                onClick={() => setDeleteItem(node)}
                              >
                                <Trash2 className="size-3.5" /> 删除
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 批量选中胶囊：字典类型（左）稍高、字典项（右）在下，二者可并存不重叠 */}
      {canEdit && selectedTypeIds.size > 0 && (
        <BatchBar
          count={selectedTypeIds.size}
          noun="字典类型"
          bottomClass="bottom-24"
          onDelete={() => setBatchTypeConfirm(true)}
          onCancel={() => setSelectedTypeIds(new Set())}
        />
      )}
      {canEdit && selectedItemIds.size > 0 && (
        <BatchBar
          count={selectedItemIds.size}
          noun="字典项"
          bottomClass="bottom-8"
          onDelete={() => setBatchItemConfirm(true)}
          onCancel={() => setSelectedItemIds(new Set())}
        />
      )}

      {/* 新增 / 编辑字典类型 */}
      <Modal
        open={typeFormOpen}
        onOpenChange={setTypeFormOpen}
        title={editType ? "编辑字典类型" : "新增字典类型"}
        description={editType ? `修改字典类型「${editType.name}」` : "创建新的业务字典类型（编码全局唯一）"}
        width={460}
        footer={
          <>
            <Button variant="outline" onClick={() => setTypeFormOpen(false)}>
              取消
            </Button>
            <Button disabled={submitting} onClick={() => void submitType()}>
              {submitting ? "保存中…" : editType ? "保存" : "创建"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="dict-type-code">
              <span className="text-destructive">*</span> 字典编码
            </Label>
            <Input
              id="dict-type-code"
              value={typeForm.code}
              onChange={(e) => setTypeForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="如 leave_type，全局唯一"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dict-type-name">
              <span className="text-destructive">*</span> 字典名称
            </Label>
            <Input
              id="dict-type-name"
              value={typeForm.name}
              onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="如 请假类型"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dict-type-remark">备注</Label>
            <Textarea
              id="dict-type-remark"
              value={typeForm.remark}
              onChange={(e) => setTypeForm((f) => ({ ...f, remark: e.target.value }))}
              placeholder="选填"
              rows={2}
            />
          </div>
        </div>
      </Modal>

      {/* 新增 / 编辑字典项 */}
      <Modal
        open={itemFormOpen}
        onOpenChange={setItemFormOpen}
        title={editItem ? "编辑字典项" : parentItem ? "新增子项" : "新增根项"}
        description={
          editItem
            ? `修改字典项「${editItem.label}」`
            : parentItem
              ? `在「${parentItem.label}」下创建子项（${selectedType?.name ?? ""}）`
              : `在「${selectedType?.name ?? ""}」下创建顶级字典项`
        }
        width={460}
        footer={
          <>
            <Button variant="outline" onClick={() => setItemFormOpen(false)}>
              取消
            </Button>
            <Button disabled={submitting} onClick={() => void submitItem()}>
              {submitting ? "保存中…" : editItem ? "保存" : "创建"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dict-item-label">
                <span className="text-destructive">*</span> 标签
              </Label>
              <Input
                id="dict-item-label"
                value={itemForm.label}
                onChange={(e) => setItemForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="展示文本，如 事假"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dict-item-value">
                <span className="text-destructive">*</span> 值
              </Label>
              <Input
                id="dict-item-value"
                value={itemForm.value}
                onChange={(e) => setItemForm((f) => ({ ...f, value: e.target.value }))}
                placeholder="存储值，如 PERSONAL"
                className="font-mono"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dict-item-sort">排序</Label>
            <Input
              id="dict-item-sort"
              type="number"
              value={itemForm.sort}
              onChange={(e) => setItemForm((f) => ({ ...f, sort: e.target.value }))}
              placeholder="数字越小越靠前"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dict-item-remark">备注</Label>
            <Textarea
              id="dict-item-remark"
              value={itemForm.remark}
              onChange={(e) => setItemForm((f) => ({ ...f, remark: e.target.value }))}
              placeholder="选填"
              rows={2}
            />
          </div>
        </div>
      </Modal>

      {/* 删除类型确认 */}
      <Dialog open={!!deleteType} onOpenChange={(open) => !open && setDeleteType(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除字典类型</DialogTitle>
            <DialogDescription>
              确定删除字典类型「{deleteType?.name}」（{deleteType?.code}）吗？类型下仍有字典项时将无法删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteType(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void confirmDeleteType()}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除字典项确认 */}
      <Dialog open={!!deleteItem} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除字典项</DialogTitle>
            <DialogDescription>
              确定删除字典项「{deleteItem?.label}」吗？存在子项时将无法删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void confirmDeleteItem()}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量删除字典类型确认（带选中数） */}
      <AlertDialog open={batchTypeConfirm} onOpenChange={setBatchTypeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除选中的 {selectedTypeIds.size} 个字典类型？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可恢复。类型下仍有字典项的将删除失败并逐条反馈。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmBatchDeleteTypes()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 批量删除字典项确认（带选中数） */}
      <AlertDialog open={batchItemConfirm} onOpenChange={setBatchItemConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除选中的 {selectedItemIds.size} 个字典项？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可恢复。存在子项的字典项将删除失败并逐条反馈。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmBatchDeleteItems()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

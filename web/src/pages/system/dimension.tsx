/**
 * 数据维度管理页（权限中心 P1，docs/design/permission-center.md §2）。
 * 列表（编码/名称/取值来源徽标/绑定摘要/选项数/启停）+ 右侧 Sheet 编辑抽屉：
 * 基本信息（code 新建可填编辑锁死）/ 取值来源三选（OPTION→内嵌选项编辑器；DICT→字典类型下拉；
 * DEPT→只读说明）/ 实体绑定（bindable-entities 选实体+列，P1 单绑定）。删除=软删确认（引用 409 文案）。
 * mock 先行 + banner；防白屏：列表归一 + 抽屉 ErrorBoundary。权限 system:dim:manage。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowDown, ArrowUp, Boxes, CloudOff, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ApiError } from "@/lib/api"
import { PageHeader } from "@/components/page-header"
import { ErrorBoundary } from "@/components/error-boundary"
import { DataTable, indexColumn } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { useAuthStore, useHasPerm } from "@/stores/auth-store"
import {
  CREATABLE_SOURCES,
  VALUE_SOURCE_META,
  createDimension,
  createDimOption,
  deleteDimension,
  deleteDimOption,
  fetchBindableEntities,
  fetchDictTypes,
  fetchDimensions,
  fetchDimOptionItems,
  updateDimension,
  updateDimOption,
  type BindableEntity,
  type DataDimension,
  type DimOptionRow,
  type DimValueSource,
} from "./dimension-api"

/* ============================ OPTION 源 · 内嵌选项编辑器 ============================ */

function OptionsEditor({ code, canEdit, onCountChange }: { code: string; canEdit: boolean; onCountChange?: (n: number) => void }) {
  const [rows, setRows] = useState<DimOptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState("")

  const load = useCallback(() => {
    setLoading(true)
    fetchDimOptionItems(code)
      .then((r) => {
        const sorted = [...r.data].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        setRows(sorted)
        onCountChange?.(sorted.length)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "选项加载失败"))
      .finally(() => setLoading(false))
    // onCountChange 引用稳定性由父层保证（useCallback）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  useEffect(() => {
    load()
  }, [load])

  const run = (p: Promise<unknown>, ok: string) =>
    p.then(() => {
      toast.success(ok)
      load()
    }).catch((e) => toast.error(e instanceof Error ? e.message : "操作失败"))

  const add = () => {
    const label = newLabel.trim()
    if (!label) return
    setNewLabel("")
    void run(createDimOption(code, { label, sort: rows.length + 1, enabled: true }), `已新增选项「${label}」`)
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const a = rows[i]
    const b = rows[j]
    // 交换 sort（两条 PUT，按行 PK，先后无碍）
    void Promise.all([
      updateDimOption(code, a.id, { sort: j + 1 }),
      updateDimOption(code, b.id, { sort: i + 1 }),
    ])
      .then(() => load())
      .catch((e) => toast.error(e instanceof Error ? e.message : "排序失败"))
  }

  return (
    <div className="space-y-2 rounded-md border p-2">
      {loading ? (
        <p className="py-3 text-center text-xs text-muted-foreground">选项加载中…</p>
      ) : rows.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">暂无选项，点「新增」添加该维度的可选值</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((o, i) => (
            <li key={o.id} className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-center font-mono text-[10px] text-muted-foreground">{i + 1}</span>
              {/* value=授权值，不可改（改值=删旧建新，后端口径） */}
              <span className="w-8 shrink-0 text-center font-mono text-[10px] text-muted-foreground" title="选项值（不可改）">
                {o.value}
              </span>
              <Input
                defaultValue={o.label}
                disabled={!canEdit}
                className="h-7 flex-1 text-xs"
                aria-label={`选项 ${o.label}`}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== o.label) void run(updateDimOption(code, o.id, { label: v }), "选项已更新")
                }}
              />
              <Switch
                checked={o.enabled !== false}
                disabled={!canEdit}
                aria-label={`启用 ${o.label}`}
                onCheckedChange={(en) => void run(updateDimOption(code, o.id, { enabled: en }), en ? "已启用" : "已停用")}
              />
              <Button variant="ghost" size="icon" className="size-6" disabled={!canEdit || i === 0} aria-label="上移" onClick={() => move(i, -1)}>
                <ArrowUp className="size-3" />
              </Button>
              <Button variant="ghost" size="icon" className="size-6" disabled={!canEdit || i === rows.length - 1} aria-label="下移" onClick={() => move(i, 1)}>
                <ArrowDown className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-destructive hover:text-destructive"
                disabled={!canEdit}
                aria-label={`删除选项 ${o.label}`}
                onClick={() => void run(deleteDimOption(code, o.id), `已删除「${o.label}」`)}
              >
                <Trash2 className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex items-center gap-1.5">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="新选项名称"
            className="h-7 flex-1 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
          />
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={!newLabel.trim()} onClick={add}>
            <Plus className="size-3" /> 新增
          </Button>
        </div>
      )}
    </div>
  )
}

/* ============================ 编辑抽屉 ============================ */

interface DimForm {
  code: string
  label: string
  enabled: boolean
  valueSource: DimValueSource
  dictType: string
  entity: string
  column: string
}

const EMPTY_FORM: DimForm = { code: "", label: "", enabled: true, valueSource: "OPTION", dictType: "", entity: "", column: "" }

function DimensionSheet({
  open,
  onOpenChange,
  editing,
  canEdit,
  entities,
  dictTypes,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editing: DataDimension | null
  canEdit: boolean
  entities: BindableEntity[]
  dictTypes: { type: string; name: string }[]
  onSaved: () => void
}) {
  const [form, setForm] = useState<DimForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(
      editing
        ? {
            code: editing.code,
            label: editing.label,
            enabled: editing.enabled,
            valueSource: editing.valueSource,
            dictType: editing.dictType ?? "",
            entity: editing.bindings[0]?.entity ?? "",
            column: editing.bindings[0]?.column ?? "",
          }
        : EMPTY_FORM,
    )
  }, [open, editing])

  const entityColumns = useMemo(() => entities.find((e) => e.entity === form.entity)?.columns ?? [], [entities, form.entity])

  const save = async () => {
    if (!form.label.trim()) {
      toast.error("请填写维度名称")
      return
    }
    if (!editing && !/^[a-zA-Z][\w]*$/.test(form.code.trim())) {
      toast.error("维度编码需以字母开头（字母/数字/下划线）")
      return
    }
    if (form.valueSource === "DICT" && !form.dictType) {
      toast.error("取值来源为「数据字典」时需选择字典类型")
      return
    }
    const bindings = form.entity && form.column ? [{ entity: form.entity, column: form.column }] : []
    setSaving(true)
    try {
      if (editing) {
        await updateDimension(editing.code, { label: form.label.trim(), enabled: form.enabled, dictType: form.valueSource === "DICT" ? form.dictType : undefined, bindings })
        toast.success(`维度「${form.label}」已更新`)
      } else {
        await createDimension({ code: form.code.trim(), label: form.label.trim(), valueSource: form.valueSource, dictType: form.valueSource === "DICT" ? form.dictType : undefined, bindings })
        toast.success(`维度「${form.label}」已创建`)
      }
      onOpenChange(false)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Boxes className="size-4 text-primary" />
            {editing ? `编辑「${editing.label}」` : "新增数据维度"}
          </SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {/* 基本信息 */}
          <div className="space-y-3">
            <div className="text-xs font-medium text-muted-foreground">基本信息</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dim-label">维度名称</Label>
                <Input id="dim-label" value={form.label} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="如：成本中心" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dim-code">维度编码</Label>
                <Input
                  id="dim-code"
                  value={form.code}
                  disabled={!!editing || !canEdit}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="如：costCenter"
                  className="font-mono"
                  title={editing ? "编码被授权/绑定引用，编辑态锁定" : undefined}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.enabled} disabled={!canEdit} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} /> 启用
            </label>
          </div>

          {/* 取值来源（三选一；编辑态锁定——授权数据按来源解释） */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">取值来源{editing && <span className="ml-1">（编辑态锁定）</span>}</div>
            <div className="grid grid-cols-3 gap-2">
              {(form.valueSource === "PROVIDER" ? (["PROVIDER"] as DimValueSource[]) : CREATABLE_SOURCES).map((src) => {
                const meta = VALUE_SOURCE_META[src]
                const active = form.valueSource === src
                return (
                  <button
                    key={src}
                    type="button"
                    disabled={!!editing || !canEdit}
                    onClick={() => setForm((f) => ({ ...f, valueSource: src }))}
                    className={cn(
                      "rounded-md border p-2 text-left text-xs transition-colors disabled:opacity-60",
                      active ? "border-primary/50 bg-primary/5" : "hover:bg-muted",
                    )}
                  >
                    <span className={cn("mb-1 inline-block rounded border px-1.5 py-0.5 text-[10px]", meta.className)}>{meta.label}</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">{meta.desc}</span>
                  </button>
                )
              })}
            </div>

            {/* 来源明细 */}
            {form.valueSource === "OPTION" &&
              (editing ? (
                <ErrorBoundary label="dim-options">
                  <OptionsEditor code={editing.code} canEdit={canEdit} />
                </ErrorBoundary>
              ) : (
                <p className="rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">保存维度后即可在此维护选项。</p>
              ))}
            {form.valueSource === "DICT" && (
              <div className="space-y-1.5">
                <Label>字典类型</Label>
                <Select value={form.dictType || undefined} disabled={!canEdit} onValueChange={(v) => setForm((f) => ({ ...f, dictType: v }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择字典类型" />
                  </SelectTrigger>
                  <SelectContent>
                    {dictTypes.map((t) => (
                      <SelectItem key={t.type} value={t.type}>
                        {t.name}（{t.type}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.valueSource === "DEPT" && (
              <p className="rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">取组织部门树作可选值（授权时用部门选择器选值），无需在此维护。</p>
            )}
            {form.valueSource === "PROVIDER" && (
              <p className="rounded-md border border-dashed bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
                由内置 Provider（代码注册 bean）提供取值——选项/字典不可在此维护；名称、启停、实体绑定仍可修改。
              </p>
            )}
          </div>

          {/* 实体绑定（P1 单绑定） */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">实体绑定（该维度过滤哪个功能实体的哪一列；P1 单绑定）</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>绑定功能实体</Label>
                <Select
                  value={form.entity || undefined}
                  disabled={!canEdit}
                  onValueChange={(v) => setForm((f) => ({ ...f, entity: v, column: "" }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="不绑定" />
                  </SelectTrigger>
                  <SelectContent>
                    {entities.map((e) => (
                      <SelectItem key={e.entity} value={e.entity}>
                        {e.label}（{e.entity}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>承载列</Label>
                <Select value={form.column || undefined} disabled={!canEdit || !form.entity} onValueChange={(v) => setForm((f) => ({ ...f, column: v }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={form.entity ? "选择列" : "先选实体"} />
                  </SelectTrigger>
                  <SelectContent>
                    {entityColumns.map((c) => (
                      <SelectItem key={c.column} value={c.column}>
                        {c.label}（{c.column}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">JSON 扩展列 P4 支持；P1 只登记单实体单物理列。</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t p-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!canEdit || saving} onClick={() => void save()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/* ============================ 页面 ============================ */

export default function DimensionPage() {
  const offline = useAuthStore((s) => s.offline)
  const canEdit = useHasPerm("system:dim:manage")

  const [rows, setRows] = useState<DataDimension[]>([])
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)
  const [entities, setEntities] = useState<BindableEntity[]>([])
  const [dictTypes, setDictTypes] = useState<{ type: string; name: string }[]>([])
  const [optionCounts, setOptionCounts] = useState<Record<string, number>>({})

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<DataDimension | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DataDimension | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchDimensions()
      .then((r) => {
        setRows(r.data)
        setDemo(r.demo)
        // OPTION 源统计选项数（并行、少量）
        r.data
          .filter((d) => d.valueSource === "OPTION")
          .forEach((d) => {
            void fetchDimOptionItems(d.code)
              .then((o) => setOptionCounts((m) => ({ ...m, [d.code]: o.data.length })))
              .catch(() => undefined)
          })
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "维度加载失败"))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    fetchBindableEntities()
      .then((r) => setEntities(r.data))
      .catch(() => setEntities([]))
    fetchDictTypes()
      .then((r) => setDictTypes(r.data))
      .catch(() => setDictTypes([]))
  }, [load])

  const toggleEnabled = async (row: DataDimension, enabled: boolean) => {
    try {
      await updateDimension(row.code, { label: row.label, enabled, dictType: row.dictType, bindings: row.bindings })
      setRows((prev) => prev.map((r) => (r.code === row.code ? { ...r, enabled } : r)))
      toast.success(`维度「${row.label}」已${enabled ? "启用" : "停用"}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败")
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteDimension(deleteTarget.code)
      toast.success(`维度「${deleteTarget.label}」已删除`)
      setDeleteTarget(null)
      load()
    } catch (e) {
      // 409：被授权引用
      if (e instanceof ApiError && e.code === 409) toast.error(e.message || "该维度已被授权引用，请先解除相关授权")
      else toast.error(e instanceof Error ? e.message : "删除失败")
      setDeleteTarget(null)
    }
  }

  const columns: ColumnDef<DataDimension, unknown>[] = useMemo(
    () => [
      indexColumn<DataDimension>(),
      {
        accessorKey: "label",
        meta: { title: "维度名称", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="维度名称" />,
        cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
      },
      {
        accessorKey: "code",
        meta: { title: "维度编码", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="维度编码" />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        accessorKey: "valueSource",
        meta: { title: "取值来源", filterType: "select", options: ["OPTION", "DICT", "DEPT", "PROVIDER"] },
        header: () => <span>取值来源</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const meta = VALUE_SOURCE_META[row.original.valueSource]
          return (
            <Badge variant="outline" className={meta.className}>
              {meta.label}
              {row.original.valueSource === "DICT" && row.original.dictType && (
                <span className="ml-1 font-mono text-[10px] opacity-80">{row.original.dictType}</span>
              )}
            </Badge>
          )
        },
      },
      {
        id: "binding",
        meta: { title: "绑定" },
        header: () => <span>绑定实体·列</span>,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.bindings.length ? (
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.bindings.map((b) => `${b.entity}.${b.column}`).join("、")}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "optionCount",
        meta: { title: "选项数" },
        header: () => <span>选项数</span>,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.valueSource === "OPTION" ? (
            <span className="tabular-nums">{optionCounts[row.original.code] ?? "…"}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "enabled",
        meta: { title: "状态" },
        header: () => <span>状态</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            disabled={!canEdit}
            aria-label={`启停 ${row.original.label}`}
            onCheckedChange={(v) => void toggleEnabled(row.original, v)}
          />
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
              onClick={() => {
                setEditing(row.original)
                setSheetOpen(true)
              }}
            >
              <Pencil className="size-3.5" /> 编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canEdit || row.original.builtin}
              className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-600"
              onClick={() => setDeleteTarget(row.original)}
            >
              <Trash2 className="size-3.5" /> 删除
            </Button>
          </div>
        ),
      },
    ],
    // 操作函数每渲染稳定，仅随 canEdit/选项数重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, optionCounts],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="数据维度"
        description={
          offline || demo
            ? "后端未接入——当前为演示维度，操作不落库"
            : "配置业务数据维度及其取值来源、实体绑定（内建 部门/本人 维度不在此页）"
        }
      />

      {demo && (
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <CloudOff className="size-3.5 shrink-0" /> 维度端点未接入（磐石 V51 并行）——演示数据可完整走通交互。
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchKeys={["label", "code"]}
        searchPlaceholder="搜索维度名称 / 编码"
        onRefresh={load}
        exportFileName="数据维度"
        actionSlot={
          <Button
            size="sm"
            className="h-8 gap-1"
            disabled={!canEdit}
            onClick={() => {
              setEditing(null)
              setSheetOpen(true)
            }}
          >
            <Plus className="size-4" /> 新增维度
          </Button>
        }
      />

      <ErrorBoundary label="dimension-sheet">
        <DimensionSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          editing={editing}
          canEdit={canEdit}
          entities={entities}
          dictTypes={dictTypes}
          onSaved={load}
        />
      </ErrorBoundary>

      {/* 删除确认（软删；被授权引用 → 409 文案） */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除维度「{deleteTarget?.label}」？</AlertDialogTitle>
            <AlertDialogDescription>
              软删除（可由后端恢复）。若该维度已被角色/用户授权引用，删除将被拦截并提示先解除授权。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void confirmDelete()}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * 表单定义管理 /workflow/form-defs
 * 列表（DataTable）+ 搜索 + 新建/编辑（全屏 Modal 承载表单设计器）+ 发布 + 版本历史 Drawer。
 * 接口：GET /api/wf/form-defs、POST /api/wf/form-defs、PUT /{id}、POST /{id}/publish、GET /{code}/versions
 * 后端未就绪时优雅空态（不造假数据）。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { CloudOff, FileText, History, Pencil, Plus, RotateCw, Send, Upload } from "lucide-react"
import { toast } from "sonner"
import { api, ApiError, NetworkError, type PageResult } from "@/lib/api"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Drawer } from "@/components/drawer"
import { Modal } from "@/components/modal"
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
import { Textarea } from "@/components/ui/textarea"
import { FormDesignerCore } from "@/pages/workflow/designer/form/designer-core"
import { ensureWidgetIdSeq, type FormWidget } from "@/pages/workflow/designer/form/model"
import type { FormEvents } from "@/types/workflow"
import { WF_STATUS_META, type FormDefItem } from "@/pages/workflow/designer/types"

interface EditorState {
  id: number | null
  code: string
  name: string
  remark: string
  title: string
  widgets: FormWidget[]
  events: FormEvents
  variables: Record<string, unknown>
}

const emptyEditor = (): EditorState => ({
  id: null,
  code: "",
  name: "",
  remark: "",
  title: "新建表单",
  widgets: [],
  events: {},
  variables: {},
})

/** 从后端返回的 schemaJson（字符串或对象）解析出 widgets/title/events/variables */
function parseSchema(raw: unknown): {
  title: string
  widgets: FormWidget[]
  events: FormEvents
  variables: Record<string, unknown>
} {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    const source = obj as {
      widgets?: unknown
      title?: unknown
      events?: FormEvents
      variables?: Record<string, unknown>
    } | null
    const widgets = Array.isArray(source?.widgets) ? (source.widgets as FormWidget[]) : []
    ensureWidgetIdSeq(widgets)
    return {
      title: typeof source?.title === "string" ? source.title : "",
      widgets,
      events: source?.events ?? {},
      variables: source?.variables ?? {},
    }
  } catch {
    return { title: "", widgets: [], events: {}, variables: {} }
  }
}

export default function WorkflowFormDefsPage() {
  const [rows, setRows] = useState<FormDefItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<"network" | string | null>(null)

  // 后端搜索 + 后端分页（避免只拉前 N 条本地搜索导致搜不全）
  const [keyword, setKeyword] = useState("")
  const [pageNum, setPageNum] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editor, setEditor] = useState<EditorState>(emptyEditor)
  const [metaOpen, setMetaOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [publishTarget, setPublishTarget] = useState<FormDefItem | null>(null)
  const [versionsFor, setVersionsFor] = useState<FormDefItem | null>(null)
  const [versions, setVersions] = useState<FormDefItem[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

  const load = useCallback(async (kw: string, pn: number, ps: number) => {
    setLoading(true)
    setLoadError(null)
    try {
      const query = `keyword=${encodeURIComponent(kw)}&pageNum=${pn}&pageSize=${ps}`
      const page = await api<PageResult<FormDefItem>>(`/api/wf/form-defs?${query}`)
      setRows(page.list)
      setTotal(page.total)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  const reload = useCallback(() => void load(keyword, pageNum, pageSize), [load, keyword, pageNum, pageSize])

  // 关键词/分页变化时查后端（关键词防抖 250ms）
  useEffect(() => {
    const timer = setTimeout(() => void load(keyword, pageNum, pageSize), keyword ? 250 : 0)
    return () => clearTimeout(timer)
  }, [load, keyword, pageNum, pageSize])

  const openCreate = () => {
    setEditor(emptyEditor())
    setEditorOpen(true)
  }

  const openEdit = async (row: FormDefItem) => {
    // 尝试拉最新版取 schema；失败则以列表已有信息打开空画布
    let schema = { title: row.name, widgets: [] as FormWidget[], events: {} as FormEvents, variables: {} as Record<string, unknown> }
    try {
      const detail = await api<FormDefItem & { schemaJson?: unknown }>(
        `/api/wf/form-defs/${row.code}/latest`,
      )
      schema = parseSchema(detail.schemaJson)
    } catch {
      /* 后端未就绪：以空画布进入，仍可编辑元信息 */
    }
    setEditor({
      id: row.id,
      code: row.code,
      name: row.name,
      remark: row.remark ?? "",
      title: schema.title || row.name,
      widgets: schema.widgets,
      events: schema.events,
      variables: schema.variables,
    })
    setEditorOpen(true)
  }

  const doSave = async (): Promise<FormDefItem | null> => {
    if (!editor.code.trim() || !editor.name.trim()) {
      setMetaOpen(true)
      toast.error("请先填写表单编码与名称")
      return null
    }
    setSaving(true)
    const body = JSON.stringify({
      code: editor.code.trim(),
      name: editor.name.trim(),
      remark: editor.remark.trim() || undefined,
      // 后端 schemaJson 字段为 JSON 字符串，需 stringify
      schemaJson: JSON.stringify({
        title: editor.title,
        widgets: editor.widgets,
        events: editor.events,
        variables: editor.variables,
      }),
    })
    try {
      const saved = editor.id
        ? await api<FormDefItem>(`/api/wf/form-defs/${editor.id}`, { method: "PUT", body })
        : await api<FormDefItem>("/api/wf/form-defs", { method: "POST", body })
      toast.success(`表单「${editor.name.trim()}」已保存为草稿`)
      if (saved?.id) setEditor((e) => ({ ...e, id: saved.id }))
      reload()
      return saved
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
      return null
    } finally {
      setSaving(false)
    }
  }

  const doPublish = async () => {
    if (!publishTarget) return
    try {
      await api(`/api/wf/form-defs/${publishTarget.id}/publish`, { method: "POST" })
      toast.success(`表单「${publishTarget.name}」已发布，可在流程定义中绑定`)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发布失败")
    } finally {
      setPublishTarget(null)
    }
  }

  const openVersions = async (row: FormDefItem) => {
    setVersionsFor(row)
    setVersions([])
    setVersionsLoading(true)
    try {
      const list = await api<FormDefItem[]>(`/api/wf/form-defs/${row.code}/versions`)
      setVersions(list)
    } catch (err) {
      if (!(err instanceof ApiError) && !(err instanceof NetworkError)) throw err
    } finally {
      setVersionsLoading(false)
    }
  }

  const columns = useMemo<ColumnDef<FormDefItem, unknown>[]>(
    () => [
      {
        accessorKey: "code",
        meta: { title: "编码", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="编码" />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        accessorKey: "name",
        meta: { title: "名称", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="名称" />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "version",
        meta: { title: "最新版本", filterType: "number" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="最新版本" />,
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">v{row.original.version ?? 1}</span>,
      },
      {
        accessorKey: "status",
        meta: { title: "状态" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) => {
          const meta = WF_STATUS_META[row.original.status] ?? WF_STATUS_META.DRAFT
          return (
            <Badge variant="outline" className={meta.className}>
              {meta.label}
            </Badge>
          )
        },
      },
      {
        accessorKey: "remark",
        meta: { title: "备注" },
        header: () => <span>备注</span>,
        cell: ({ row }) => (
          <span className="truncate text-sm text-muted-foreground">{row.original.remark || "—"}</span>
        ),
      },
      {
        accessorKey: "createdAt",
        meta: { title: "更新时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="更新时间" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.createdAt ? row.original.createdAt.replace("T", " ").slice(0, 16) : "—"}
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
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void openEdit(row.original)}>
              <Pencil className="size-3.5" />
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-emerald-600 hover:text-emerald-600"
              disabled={row.original.status === "PUBLISHED"}
              onClick={() => setPublishTarget(row.original)}
            >
              <Send className="size-3.5" />
              发布
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void openVersions(row.original)}>
              <History className="size-3.5" />
              版本
            </Button>
          </div>
        ),
      },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="表单定义"
        description="维护业务表单模板：拖拽设计字段、发布后供流程定义绑定"
      />

      {loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">表单定义接口尚未就绪</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              /api/wf/form-defs 暂不可用（{loadError === "network" ? "后端未启动" : loadError}）。
              后端工作流模块就绪后重试即可管理真实表单定义；现在仍可点击「新建表单」体验设计器。
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={openCreate}>
                <Plus className="size-3.5" /> 新建表单
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => reload()}>
                <RotateCw className="size-3.5" /> 重试连接
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          searchKeys={["name", "code"]}
          searchPlaceholder="搜索表单名称 / 编码（后端全量搜索）"
          serverSearch={{
            keyword,
            onKeywordChange: (kw) => {
              setKeyword(kw)
              setPageNum(1)
            },
          }}
          serverPagination={{
            pageIndex: pageNum - 1,
            pageSize,
            rowCount: total,
            onPaginationChange: (pi, ps) => {
              setPageNum(pi + 1)
              setPageSize(ps)
            },
          }}
          onRefresh={() => reload()}
          exportFileName="表单定义"
          actionSlot={
            <Button size="sm" className="h-8 gap-1" onClick={openCreate}>
              <Plus className="size-4" />
              新建表单
            </Button>
          }
        />
      )}

      {/* 全屏 Modal：表单设计器 */}
      <Modal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title={
          <span className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            {editor.id ? `编辑表单 · ${editor.name}` : "新建表单"}
          </span>
        }
        description="拖拽字段设计表单，右侧可编辑字段标识（流程条件/审批人规则按此绑定）"
        width={1180}
        height={720}
        bodyClassName="p-0"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setMetaOpen(true)}>
              表单信息
            </Button>
            <span className="mr-auto text-xs text-muted-foreground">
              {editor.code ? (
                <>
                  编码 <span className="font-mono">{editor.code}</span> · {editor.widgets.length} 个字段
                </>
              ) : (
                "尚未设置编码"
              )}
            </span>
            <Button variant="outline" size="sm" disabled={saving} onClick={() => void doSave()}>
              {saving ? "保存中…" : "保存草稿"}
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={saving}
              onClick={async () => {
                const saved = await doSave()
                if (saved?.id) setPublishTarget(saved)
              }}
            >
              <Upload className="size-3.5" />
              保存并发布
            </Button>
          </>
        }
      >
        <FormDesignerCore
          widgets={editor.widgets}
          onWidgetsChange={(updater) =>
            setEditor((e) => ({
              ...e,
              widgets:
                typeof updater === "function" ? (updater as (w: FormWidget[]) => FormWidget[])(e.widgets) : updater,
            }))
          }
          title={editor.title}
          onTitleChange={(title) => setEditor((e) => ({ ...e, title }))}
          showKeyField
          formEvents={editor.events}
          onFormEventsChange={(events) => setEditor((e) => ({ ...e, events }))}
          variables={editor.variables}
          onVariablesChange={(variables) => setEditor((e) => ({ ...e, variables }))}
        />
      </Modal>

      {/* 表单元信息（编码/名称/备注） */}
      <Dialog open={metaOpen} onOpenChange={setMetaOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>表单信息</DialogTitle>
            <DialogDescription>编码用于流程绑定，发布后不建议修改</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fd-code">表单编码</Label>
                <Input
                  id="fd-code"
                  value={editor.code}
                  disabled={editor.id != null}
                  onChange={(e) => setEditor((s) => ({ ...s, code: e.target.value }))}
                  placeholder="如：leave"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fd-name">表单名称</Label>
                <Input
                  id="fd-name"
                  value={editor.name}
                  onChange={(e) => setEditor((s) => ({ ...s, name: e.target.value }))}
                  placeholder="如：请假申请表"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-remark">备注</Label>
              <Textarea
                id="fd-remark"
                value={editor.remark}
                onChange={(e) => setEditor((s) => ({ ...s, remark: e.target.value }))}
                rows={3}
                placeholder="表单用途说明（可选）"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setMetaOpen(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 发布确认 */}
      <Dialog open={!!publishTarget} onOpenChange={(open) => !open && setPublishTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>发布表单</DialogTitle>
            <DialogDescription>
              确定发布表单「{publishTarget?.name}」吗？发布后将生成新版本，可在流程定义中绑定。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishTarget(null)}>
              取消
            </Button>
            <Button onClick={() => void doPublish()}>确认发布</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 版本历史 */}
      <Drawer
        open={!!versionsFor}
        onOpenChange={(open) => !open && setVersionsFor(null)}
        title={`版本历史 · ${versionsFor?.name ?? ""}`}
        description="表单每次发布生成一个不可变版本"
        width={420}
      >
        {versionsLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>
        ) : versions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <History className="size-8 opacity-30" />
            <span className="text-sm">暂无版本记录</span>
            <span className="text-xs">后端接口就绪后展示历史版本</span>
          </div>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => {
              const meta = WF_STATUS_META[v.status] ?? WF_STATUS_META.DRAFT
              return (
                <div key={`${v.code}-${v.version}`} className="flex items-center gap-3 rounded-md border p-3">
                  <Badge variant="outline" className="font-mono">
                    v{v.version}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{v.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {v.createdAt ? v.createdAt.replace("T", " ").slice(0, 16) : ""}
                      {v.createdBy ? ` · ${v.createdBy}` : ""}
                    </div>
                  </div>
                  <Badge variant="outline" className={meta.className}>
                    {meta.label}
                  </Badge>
                </div>
              )
            })}
          </div>
        )}
      </Drawer>
    </div>
  )
}

/**
 * 运行时台账 /bizdoc/run/:defCode（丹青 §4.2-4.5）。
 *
 * 动态列（list_config.columns）+ serverPagination + 动态筛选（filters）+ 固定 状态/关键字；
 * 新建/编辑抽屉 = FormRenderer（ONLINE）| CODE 跳转；提交（无流程即生效/有流程起审批）、
 * 作废（AlertDialog）、删除草稿；状态徽标按丹青 §4.4；APPROVING 行给流程实例链接；
 * 详情抽屉（只读 + 信息条 + 驳回原因条）；打印 → PrintPreview（VOID 水印）。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { ExternalLink, FileSpreadsheet, Plus, Printer, Send } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Drawer } from "@/components/drawer"
import { FormRenderer } from "@/components/form-renderer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useHasPerm } from "@/stores/auth-store"
import { useDebounced, useServerPage } from "@/lib/use-server-page"
import { DemoBanner } from "@/pages/document/gongwen/shared"
import type { FormWidget, WfFormData } from "@/types/workflow"
import {
  deleteDoc,
  fetchDef,
  fetchDefSchema,
  fetchDocPage,
  saveDoc,
  submitDoc,
  voidDoc,
  type BizDoc,
  type BizDocDef,
  type BizDocStatus,
} from "./mock"
import { PrintPreview } from "./print-preview"

/** 单据状态徽标（丹青 §4.4：VOID 加删除线形状编码） */
const DOC_STATUS_META: Record<BizDocStatus, { label: string; className: string }> = {
  DRAFT: { label: "草稿", className: "border-slate-500/30 bg-slate-500/10 text-slate-500" },
  APPROVING: { label: "审批中", className: "border-blue-500/30 bg-blue-500/10 text-blue-600" },
  EFFECTIVE: { label: "生效", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  REJECTED: { label: "驳回", className: "border-rose-500/30 bg-rose-500/10 text-rose-600" },
  VOID: { label: "作废", className: "border-gray-500/30 bg-gray-500/10 text-gray-400 line-through decoration-gray-400/60" },
}

function StatusBadge({ status }: { status: BizDocStatus }) {
  const meta = DOC_STATUS_META[status]
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  )
}

function fmtCell(v: unknown): string {
  if (v == null || v === "") return "—"
  return String(v)
}

export default function BizdocRunPage() {
  const { defCode = "" } = useParams<{ defCode: string }>()
  const navigate = useNavigate()
  const canWrite = useHasPerm("bizdoc:write")

  const [def, setDef] = useState<BizDocDef | null>(null)
  const [schema, setSchema] = useState<FormWidget[]>([])
  const [defMissing, setDefMissing] = useState(false)
  const [demo, setDemo] = useState(false)

  // 筛选（list_config.filters 动态 + 固定状态/关键字）
  const [keyword, setKeyword] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [filters, setFilters] = useState<Record<string, string>>({})

  // 抽屉：新建/编辑/详情
  const [editing, setEditing] = useState<{ doc: BizDoc | null; readOnly: boolean } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // 作废确认 / 删除确认 / 打印
  const [voiding, setVoiding] = useState<BizDoc | null>(null)
  const [deleting, setDeleting] = useState<BizDoc | null>(null)
  const [printing, setPrinting] = useState<BizDoc | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchDef(defCode).then(async (res) => {
      if (cancelled) return
      setDemo(res.demo)
      if (!res.data) {
        setDefMissing(true)
        return
      }
      setDef(res.data)
      const s = await fetchDefSchema(res.data)
      if (!cancelled) setSchema(s.data)
    })
    return () => {
      cancelled = true
    }
  }, [defCode])

  const query = useDebounced(keyword.trim())
  const debouncedFilters = useDebounced(JSON.stringify(filters))
  const page = useServerPage<BizDoc>(
    async (pageNum, pageSize) => {
      const res = await fetchDocPage({
        defCode,
        keyword: query || undefined,
        status: statusFilter === "all" ? undefined : (statusFilter as BizDocStatus),
        filters: JSON.parse(debouncedFilters) as Record<string, string>,
        pageNum,
        pageSize,
      })
      setDemo(res.demo)
      return res.data
    },
    { resetKey: `${defCode}|${statusFilter}|${query}|${debouncedFilters}`, offlineFetch: true },
  )
  const { rows, loading, reload } = page

  /* ---- 动作 ---- */

  const handleSave = useCallback(
    async (data: WfFormData, alsoSubmit: boolean) => {
      setSubmitting(true)
      try {
        const saved = await saveDoc({ id: editing?.doc?.id ?? null, defCode, formData: data })
        if (alsoSubmit) {
          const submitted = await submitDoc(saved.data.id)
          toast.success(
            submitted.data.status === "APPROVING"
              ? `已提交审批${submitted.data.docNo ? `，单号 ${submitted.data.docNo}` : ""}`
              : `已生效${submitted.data.docNo ? `，单号 ${submitted.data.docNo}` : ""}`,
          )
        } else {
          toast.success("草稿已保存")
        }
        setEditing(null)
        reload()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "保存失败")
      } finally {
        setSubmitting(false)
      }
    },
    [editing, defCode, reload],
  )

  const handleVoid = useCallback(async () => {
    if (!voiding) return
    try {
      await voidDoc(voiding.id)
      toast.success(`「${voiding.title}」已作废（单号不回收）`)
      setVoiding(null)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "作废失败")
    }
  }, [voiding, reload])

  const handleDelete = useCallback(async () => {
    if (!deleting) return
    try {
      await deleteDoc(deleting.id)
      toast.success("草稿已删除")
      setDeleting(null)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }, [deleting, reload])

  const submitRow = useCallback(
    async (doc: BizDoc) => {
      try {
        const res = await submitDoc(doc.id)
        toast.success(res.data.status === "APPROVING" ? "已提交审批" : "已生效")
        reload()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "提交失败")
      }
    },
    [reload],
  )

  /* ---- 动态列 ---- */
  const columns = useMemo<ColumnDef<BizDoc, unknown>[]>(() => {
    const dynamic: ColumnDef<BizDoc, unknown>[] = (def?.listConfig.columns ?? []).map((c) => ({
      id: `f_${c.field}`,
      meta: { title: c.label },
      header: () => <span>{c.label}</span>,
      cell: ({ row }) => <span className="text-sm">{fmtCell(row.original.formData[c.field])}</span>,
    }))
    return [
      {
        accessorKey: "docNo",
        meta: { title: "单号" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="单号" />,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.docNo ?? "—"}</span>,
      },
      {
        accessorKey: "title",
        meta: { title: "标题" },
        header: () => <span>标题</span>,
        cell: ({ row }) => (
          <button
            type="button"
            className="block max-w-64 truncate text-left text-sm font-medium text-primary hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              setEditing({ doc: row.original, readOnly: true })
            }}
          >
            {row.original.title}
          </button>
        ),
      },
      ...dynamic,
      {
        accessorKey: "status",
        meta: { title: "状态" },
        header: () => <span>状态</span>,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "creatorName",
        meta: { title: "创建人" },
        header: () => <span>创建人</span>,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.creatorName}</span>,
      },
      {
        accessorKey: "createdAt",
        meta: { title: "创建时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="创建时间" />,
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.createdAt.slice(0, 16).replace("T", " ")}</span>,
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => {
          const doc = row.original
          const btn = (label: string, onClick: () => void, cls = "text-primary hover:text-primary") => (
            <Button
              key={label}
              variant="ghost"
              size="sm"
              className={`h-7 px-2 text-xs ${cls}`}
              onClick={(e) => {
                e.stopPropagation()
                onClick()
              }}
            >
              {label}
            </Button>
          )
          const ops: React.ReactNode[] = []
          if (doc.status === "DRAFT" && canWrite) {
            ops.push(
              btn("编辑", () => setEditing({ doc, readOnly: false })),
              btn("提交", () => void submitRow(doc), "text-emerald-600 hover:text-emerald-600"),
              btn("删除", () => setDeleting(doc), "text-rose-600 hover:text-rose-600"),
            )
          }
          if (doc.status === "APPROVING" && doc.processInstanceId) {
            ops.push(btn("查看流程", () => navigate(`/workflow/instances/${doc.processInstanceId}`)))
          }
          if (doc.status === "EFFECTIVE") {
            ops.push(btn("打印", () => setPrinting(doc)))
            if (canWrite) ops.push(btn("作废", () => setVoiding(doc), "text-rose-600 hover:text-rose-600"))
          }
          if (doc.status === "REJECTED" && canWrite) {
            ops.push(
              btn("编辑", () => setEditing({ doc, readOnly: false })),
              btn("作废", () => setVoiding(doc), "text-rose-600 hover:text-rose-600"),
            )
          }
          if (doc.status === "VOID") {
            ops.push(btn("打印", () => setPrinting(doc), "text-muted-foreground"))
          }
          return <div className="flex items-center">{ops}</div>
        },
      },
    ]
  }, [def, canWrite, navigate, submitRow])

  if (defMissing) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <FileSpreadsheet className="size-8 text-muted-foreground/40" />
          <div className="text-sm">单据定义「{defCode}」不存在或未发布</div>
          <Button size="sm" variant="outline" onClick={() => navigate("/bizdoc/center")}>
            返回单据中心
          </Button>
        </CardContent>
      </Card>
    )
  }

  const hasFlow = !!def?.wfDefCode
  const editingDoc = editing?.doc

  return (
    <div className="space-y-4">
      <PageHeader
        title={def?.name ?? defCode}
        description={`${def?.category ?? "通用"}${hasFlow ? " · 提交后发起审批" : " · 提交即生效"}${def?.numberRuleId != null ? " · 自动编号" : ""}`}
      />
      {demo && <DemoBanner />}

      <DataTable
        columns={columns}
        data={rows}
        searchKeys={["title", "docNo"]}
        searchPlaceholder="搜索单号 / 标题"
        loading={loading}
        onRefresh={reload}
        exportFileName={def?.name ?? "单据台账"}
        serverSearch={{ keyword, onKeywordChange: setKeyword }}
        serverPagination={{
          pageIndex: page.pageIndex,
          pageSize: page.pageSize,
          rowCount: page.total,
          onPaginationChange: page.onPaginationChange,
        }}
        filterSlot={
          <>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger size="sm" className="h-8 w-28 text-sm">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                {(Object.keys(DOC_STATUS_META) as BizDocStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {DOC_STATUS_META[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(def?.listConfig.filters ?? []).map((f) => {
              const widget = schema.find((w) => (w.key ?? w.id) === f.field)
              if (f.type === "select" && widget?.options?.length) {
                return (
                  <Select
                    key={f.field}
                    value={filters[f.field] || "all"}
                    onValueChange={(v) => setFilters((prev) => ({ ...prev, [f.field]: v === "all" ? "" : v }))}
                  >
                    <SelectTrigger size="sm" className="h-8 w-32 text-sm">
                      <SelectValue placeholder={f.label} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部{f.label}</SelectItem>
                      {widget.options.map((o) => {
                        const v = typeof o === "string" ? o : o.value
                        const l = typeof o === "string" ? o : o.label
                        return (
                          <SelectItem key={v} value={v}>
                            {l}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                )
              }
              return (
                <Input
                  key={f.field}
                  value={filters[f.field] ?? ""}
                  onChange={(e) => setFilters((prev) => ({ ...prev, [f.field]: e.target.value }))}
                  placeholder={f.label}
                  className="h-8 w-36 text-sm"
                />
              )
            })}
          </>
        }
        actionSlot={
          canWrite && def ? (
            <Button size="sm" className="h-8" onClick={() => setEditing({ doc: null, readOnly: false })}>
              <Plus className="size-4" />
              新建{def.name}
            </Button>
          ) : undefined
        }
      />

      {/* 新建/编辑/详情抽屉（ONLINE 表单内嵌 FormRenderer） */}
      <Drawer
        open={editing !== null}
        onOpenChange={(o) => !o && !submitting && setEditing(null)}
        title={editing?.readOnly ? "单据详情" : editingDoc ? `编辑 · ${def?.name}` : `新建 · ${def?.name}`}
        description={editing?.readOnly ? editingDoc?.title : hasFlow ? "提交后将发起审批流程" : "提交后立即生效"}
        width={640}
      >
        {editing && (
          <div className="space-y-4">
            {/* 详情信息条 */}
            {editing.readOnly && editingDoc && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                <span className="font-mono">{editingDoc.docNo ?? "（未占号）"}</span>
                <StatusBadge status={editingDoc.status} />
                <span className="text-muted-foreground">{editingDoc.creatorName}</span>
                <span className="text-muted-foreground">{editingDoc.createdAt.slice(0, 16).replace("T", " ")}</span>
                {editingDoc.processInstanceId && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-primary hover:underline"
                    onClick={() => navigate(`/workflow/instances/${editingDoc.processInstanceId}`)}
                  >
                    审批记录 <ExternalLink className="size-3" />
                  </button>
                )}
              </div>
            )}
            {editing.readOnly && editingDoc?.status === "REJECTED" && editingDoc.rejectReason && (
              <div className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-600">
                驳回原因：{editingDoc.rejectReason}
              </div>
            )}

            {schema.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">该单据未完成配置（缺表单绑定）</div>
            ) : (
              <FormRenderer
                key={editingDoc?.id ?? "new"}
                widgets={schema}
                initialValues={editingDoc?.formData}
                readOnly={editing.readOnly}
                submitting={submitting}
                submitLabel={
                  (
                    <span className="flex items-center gap-1.5">
                      <Send className="size-3.5" /> {hasFlow ? "提交审批" : "提交"}
                    </span>
                  ) as unknown as string
                }
                onSubmit={editing.readOnly ? undefined : (data) => void handleSave(data, true)}
                onSaveDraft={editing.readOnly ? undefined : (data) => void handleSave(data, false)}
                saveDraftLabel="保存草稿"
                onCancel={() => setEditing(null)}
              />
            )}

            {/* 详情态：可打印 */}
            {editing.readOnly && editingDoc && (editingDoc.status === "EFFECTIVE" || editingDoc.status === "VOID") && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPrinting(editingDoc)}>
                  <Printer className="size-3.5" /> 打印
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* 作废确认 */}
      <AlertDialog open={voiding !== null} onOpenChange={(o) => !o && setVoiding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>作废单据</AlertDialogTitle>
            <AlertDialogDescription>
              确定作废「{voiding?.title}」（{voiding?.docNo ?? "无单号"}）吗？作废后不可恢复，单号不回收（台账连续可查），打印件将带「作废」水印。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void handleVoid()}>
              确认作废
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除草稿确认 */}
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除草稿</AlertDialogTitle>
            <AlertDialogDescription>删除后不可恢复，确定删除「{deleting?.title}」吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void handleDelete()}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 打印预览 */}
      <PrintPreview doc={printing} open={printing !== null} onClose={() => setPrinting(null)} />
    </div>
  )
}

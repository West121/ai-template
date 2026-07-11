/**
 * 单据管理 /bizdoc/defs（丹青 §3 + §10 范式修正二）：定义列表 + 编辑抽屉（纵向分区①-⑥）。
 * ② 单据字段设计：INLINE 主路径（复用 FormDesignerCore 全屏 Modal，产物存 def.formSchema）；
 * 高级保留 CODE 手写表单；存量 ONLINE 兼容读并可一键转内置。台账列/筛选字段从统一字段源派生。
 * 发布/停用/删除（仅 DRAFT）；INLINE 发布校验 schema 非空且 key 唯一；bizdoc:def:write 门控。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { FileSpreadsheet, LayoutPanelTop, PenLine, Plus, Printer, ShieldAlert, Star, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Drawer } from "@/components/drawer"
import { Modal } from "@/components/modal"
import { FormDesignerCore } from "@/pages/workflow/designer/form/designer-core"
import { ensureWidgetIdSeq, type FormWidget as DesignerWidget } from "@/pages/workflow/designer/form/model"
import type { FormWidget } from "@/types/workflow"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
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
import { api } from "@/lib/api"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"
import { DemoBanner } from "@/pages/document/gongwen/shared"
import { deriveSchemaFields, fieldsForDef, schemaKeyIssues, type DefField } from "./fields"
import {
  deleteDef,
  deletePrintTpl,
  disableDef,
  fetchDefSchema,
  fetchDefs,
  fetchNumberRules,
  fetchPrintTpls,
  fetchPublishedWfDefs,
  publishDef,
  saveDef,
  setDefaultPrintTpl,
  type BizDocDef,
  type BizDocDefStatus,
  type BizDocPrintTpl,
  type ListConfig,
  type NumberRule,
  type WfDefOption,
} from "./mock"

const DEF_STATUS_META: Record<BizDocDefStatus, { label: string; className: string }> = {
  DRAFT: { label: "草稿", className: "border-slate-500/30 bg-slate-500/10 text-slate-500" },
  PUBLISHED: { label: "已发布", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  DISABLED: { label: "已停用", className: "border-gray-500/30 bg-gray-500/10 text-gray-500" },
}

interface FormOption {
  code: string
  name: string
}

/** 系统字段（台账配置可选，丹青 §3.2 ⑤） */
const SYS_FIELD_OPTIONS: DefField[] = [
  { key: "docNo", label: "单号" },
  { key: "status", label: "状态" },
  { key: "creator", label: "创建人" },
  { key: "date", label: "创建时间" },
]

type EditorState = Omit<BizDocDef, "id" | "status" | "updatedAt"> & { id: number | null; status: BizDocDefStatus }

function emptyEditor(): EditorState {
  return {
    id: null,
    code: "",
    name: "",
    category: "",
    // §10：内置字段设计为默认主路径
    formType: "INLINE",
    formCode: "",
    formSchema: [],
    numberRuleId: null,
    wfDefCode: null,
    listConfig: { columns: [], filters: [] },
    status: "DRAFT",
    remark: "",
    titleTpl: "",
  }
}

export default function BizdocDefsPage() {
  const offline = useAuthStore((s) => s.offline)
  const canWrite = useHasPerm("bizdoc:def:write")
  const navigate = useNavigate()

  const [rows, setRows] = useState<BizDocDef[]>([])
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)

  // 下拉数据源（§10：ONLINE 绑定选项已移除，仅剩 CODE 手写表单清单）
  const [codeForms, setCodeForms] = useState<FormOption[]>([])
  const [rules, setRules] = useState<NumberRule[]>([])
  const [wfDefs, setWfDefs] = useState<WfDefOption[]>([])

  const [editor, setEditor] = useState<EditorState | null>(null)
  /** CODE/存量 ONLINE 的统一清单字段（INLINE 直接本地派生，不走此状态） */
  const [fields, setFields] = useState<DefField[]>([])
  const [tpls, setTpls] = useState<BizDocPrintTpl[]>([])
  const [saving, setSaving] = useState(false)
  const [disabling, setDisabling] = useState<BizDocDef | null>(null)
  const [deleting, setDeleting] = useState<BizDocDef | null>(null)
  /** 字段设计器 Modal（FormDesignerCore，产物写回 editor.formSchema） */
  const [designerOpen, setDesignerOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchDefs()
      setRows(res.data)
      setDemo(res.demo)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // 下拉源（失败降级内置演示）
    void api<{ formKey: string; name: string }[]>("/api/wf/forms/code")
      .then((list) => setCodeForms(list.map((f) => ({ code: f.formKey, name: f.name }))))
      .catch(() => setCodeForms([{ code: "gw_send", name: "发文办理单" }, { code: "gw_recv", name: "收文办理单" }]))
    void fetchNumberRules().then((r) => setRules(r.data))
    void fetchPublishedWfDefs().then((r) => setWfDefs(r.data))
  }, [load, offline])

  /** 非 INLINE 的字段清单（统一字段源；INLINE 由 deriveSchemaFields 本地派生） */
  const loadFields = useCallback(async (def: Pick<BizDocDef, "formType" | "formCode" | "formSchema">) => {
    setFields(def.formType === "INLINE" ? [] : await fieldsForDef(def))
  }, [])

  /* ---- 编辑抽屉打开：拉字段清单 + 打印模板 ---- */
  const openEdit = useCallback(
    async (def: BizDocDef | null) => {
      // listConfig 兜底:API 直建/smoke 留存的定义可能为 null——缺省空配置,避免展开 null 崩整页白屏
      const next: EditorState = def
        ? {
            ...def,
            id: def.id,
            formType: def.formType ?? "INLINE",
            formSchema: Array.isArray(def.formSchema) ? [...def.formSchema] : [],
            listConfig: {
              columns: [...(def.listConfig?.columns ?? [])],
              filters: [...(def.listConfig?.filters ?? [])],
            },
          }
        : emptyEditor()
      ensureWidgetIdSeq((next.formSchema ?? []) as unknown as DesignerWidget[])
      setEditor(next)
      setFields([])
      setTpls([])
      if (def) void fetchPrintTpls(def.id).then((r) => setTpls(r.data))
      void loadFields(next)
    },
    [loadFields],
  )

  const patch = (p: Partial<EditorState>) => setEditor((e) => (e ? { ...e, ...p } : e))
  const patchList = (p: Partial<ListConfig>) =>
    setEditor((e) => (e ? { ...e, listConfig: { ...e.listConfig, ...p } } : e))

  /** 存量 ONLINE → 一键转内置：复制外部在线表单 widgets 进私有 schema */
  const convertToInline = async () => {
    if (!editor) return
    const s = await fetchDefSchema({ ...editor, id: editor.id ?? 0, status: editor.status } as BizDocDef)
    if (!s.data.length) {
      toast.error("未取到原在线表单字段，无法转换（可手动重新设计）")
      return
    }
    patch({ formType: "INLINE", formCode: "", formSchema: s.data })
    setFields([])
    toast.success(`已转为内置设计（复制 ${s.data.length} 个控件），保存后生效`)
  }

  const doSave = async (publishAfter: boolean) => {
    if (!editor) return
    if (!editor.code.trim() || !editor.name.trim()) {
      toast.error("请填写编码与名称")
      return
    }
    if (editor.formType === "CODE" && !editor.formCode) {
      toast.error("CODE 形态需选择手写表单")
      return
    }
    // §10 发布校验：INLINE 要求 schema 非空且字段 key 唯一
    if (publishAfter && editor.formType === "INLINE") {
      const issues = schemaKeyIssues(editor.formSchema)
      if (issues.length > 0) {
        toast.error(issues[0])
        return
      }
    }
    setSaving(true)
    try {
      const saved = await saveDef({ ...editor, id: editor.id })
      if (publishAfter) {
        await publishDef(saved.data.id)
        toast.success(`「${editor.name}」已发布，单据中心可见`)
      } else {
        toast.success("定义已保存")
      }
      setEditor(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const doPublishRow = useCallback(
    async (def: BizDocDef) => {
      try {
        await publishDef(def.id)
        toast.success(`「${def.name}」已发布`)
        void load()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "发布失败")
      }
    },
    [load],
  )

  const doDisable = async () => {
    if (!disabling) return
    try {
      await disableDef(disabling.id)
      toast.success(`「${disabling.name}」已停用`)
      setDisabling(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "停用失败")
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    try {
      await deleteDef(deleting.id)
      toast.success("定义已删除")
      setDeleting(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  /* ---- 列表列 ---- */
  const columns = useMemo<ColumnDef<BizDocDef, unknown>[]>(
    () => [
      {
        accessorKey: "code",
        meta: { title: "编码" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="编码" />,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.code}</span>,
      },
      {
        accessorKey: "name",
        meta: { title: "名称" },
        header: () => <span>名称</span>,
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 font-medium">
            <FileSpreadsheet className="size-3.5 text-muted-foreground" />
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: "category",
        meta: { title: "分类" },
        header: () => <span>分类</span>,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-muted-foreground">
            {row.original.category || "通用"}
          </Badge>
        ),
      },
      {
        id: "form",
        meta: { title: "字段" },
        header: () => <span>字段</span>,
        cell: ({ row }) => {
          const d = row.original
          if (d.formType === "CODE") {
            return (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="rounded bg-violet-500/10 px-1 text-[10px] text-violet-600">CODE</span>
                <span className="font-mono text-muted-foreground">{d.formCode}</span>
              </span>
            )
          }
          if (d.formType === "ONLINE") {
            return (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="rounded bg-amber-500/10 px-1 text-[10px] text-amber-600">存量 ONLINE</span>
                <span className="font-mono text-muted-foreground">{d.formCode}</span>
              </span>
            )
          }
          const n = deriveSchemaFields(d.formSchema).length
          return (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="rounded bg-blue-500/10 px-1 text-[10px] text-blue-600">内置</span>
              <span className="text-muted-foreground">{n > 0 ? `${n} 个字段` : "未设计"}</span>
            </span>
          )
        },
      },
      {
        id: "rule",
        meta: { title: "编号规则" },
        header: () => <span>编号规则</span>,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.numberRuleId != null
              ? rules.find((r) => r.id === row.original.numberRuleId)?.name ?? `#${row.original.numberRuleId}`
              : "—"}
          </span>
        ),
      },
      {
        accessorKey: "wfDefCode",
        meta: { title: "审批流" },
        header: () => <span>审批流</span>,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.wfDefCode ?? "—"}</span>,
      },
      {
        accessorKey: "status",
        meta: { title: "状态" },
        header: () => <span>状态</span>,
        cell: ({ row }) => {
          const meta = DEF_STATUS_META[row.original.status]
          return (
            <Badge variant="outline" className={meta.className}>
              {meta.label}
            </Badge>
          )
        },
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => {
          const def = row.original
          return (
            <div className="flex items-center">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-primary hover:text-primary" onClick={() => void openEdit(def)}>
                编辑
              </Button>
              {def.status !== "PUBLISHED" ? (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-emerald-600 hover:text-emerald-600" onClick={() => void doPublishRow(def)}>
                  发布
                </Button>
              ) : (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-amber-600 hover:text-amber-600" onClick={() => setDisabling(def)}>
                  停用
                </Button>
              )}
              {def.status === "DRAFT" && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-rose-600 hover:text-rose-600" onClick={() => setDeleting(def)}>
                  删除
                </Button>
              )}
            </div>
          )
        },
      },
    ],
    [rules, openEdit, doPublishRow],
  )

  if (!canWrite) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <ShieldAlert className="size-8 text-rose-500/60" />
          <div className="text-sm">需要「bizdoc:def:write」权限才能管理单据定义</div>
        </CardContent>
      </Card>
    )
  }

  // §10 统一字段源：INLINE=私有 schema 本地派生；CODE/存量 ONLINE=统一清单（fields 状态）
  const formFields = editor?.formType === "INLINE" ? deriveSchemaFields(editor.formSchema) : fields
  const allFieldOptions = [...formFields, ...SYS_FIELD_OPTIONS]

  return (
    <div className="space-y-4">
      <PageHeader title="单据管理" description="在线定义业务单据：内置字段设计 + 编号规则 + 打印模板 + 可选审批流，发布后运行时自动获得台账/录入/打印" />
      {demo && <DemoBanner />}

      <DataTable
        columns={columns}
        data={rows}
        searchKeys={["code", "name"]}
        searchPlaceholder="搜索编码 / 名称"
        loading={loading}
        onRefresh={() => void load()}
        exportFileName="单据定义"
        actionSlot={
          <Button size="sm" className="h-8" onClick={() => void openEdit(null)}>
            <Plus className="size-4" />
            新建定义
          </Button>
        }
      />

      {/* 编辑抽屉：纵向分区 ①-⑥（丹青 §3.2） */}
      <Drawer
        open={editor !== null}
        onOpenChange={(o) => !o && !saving && setEditor(null)}
        title={editor?.id ? `编辑定义 · ${editor.name}` : "新建单据定义"}
        width={640}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>
              取消
            </Button>
            <Button variant="outline" onClick={() => void doSave(false)} disabled={saving}>
              保存草稿
            </Button>
            {editor?.status === "DRAFT" && (
              <Button onClick={() => void doSave(true)} disabled={saving}>
                {saving ? "保存中…" : "保存并发布"}
              </Button>
            )}
          </>
        }
      >
        {editor && (
          <div className="space-y-5">
            {/* ① 基本信息 */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">① 基本信息</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">编码</Label>
                  <Input value={editor.code} onChange={(e) => patch({ code: e.target.value })} disabled={editor.id != null} className="h-8 font-mono text-xs" placeholder="如 expense" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">名称</Label>
                  <Input value={editor.name} onChange={(e) => patch({ name: e.target.value })} className="h-8 text-sm" placeholder="如 费用报销单" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">分类</Label>
                  <Input value={editor.category ?? ""} onChange={(e) => patch({ category: e.target.value })} className="h-8 text-sm" placeholder="如 财务 / 行政" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">标题模板（可选）</Label>
                  <Input value={editor.titleTpl ?? ""} onChange={(e) => patch({ titleTpl: e.target.value })} className="h-8 text-xs" placeholder="缺省=定义名+创建人" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">备注</Label>
                <Textarea value={editor.remark ?? ""} onChange={(e) => patch({ remark: e.target.value })} rows={2} className="text-xs" />
              </div>
            </section>
            <Separator />

            {/* ② 单据字段设计（§10：内置设计主路径；高级=CODE；存量 ONLINE 兼容读+转内置） */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">② 单据字段设计</h3>

              {editor.formType === "ONLINE" ? (
                <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    存量定义：引用外部在线表单 <span className="font-mono">{editor.formCode}</span>（兼容读，绑定选项已下线）。
                  </p>
                  <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => void convertToInline()}>
                    <LayoutPanelTop className="size-3.5" /> 转为内置设计（复制当前字段）
                  </Button>
                </div>
              ) : (
                <Tabs
                  value={editor.formType}
                  onValueChange={(v) => patch({ formType: v as "INLINE" | "CODE", formCode: "" })}
                >
                  <TabsList>
                    <TabsTrigger value="INLINE">内置设计</TabsTrigger>
                    <TabsTrigger value="CODE">高级：CODE 表单</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}

              {editor.formType === "INLINE" && (
                <>
                  <Button variant="outline" className="h-9 w-full gap-1.5 border-dashed text-sm" onClick={() => setDesignerOpen(true)}>
                    <LayoutPanelTop className="size-4 text-primary" />
                    {formFields.length > 0 ? `打开字段设计器（已设计 ${formFields.length} 个字段）` : "打开字段设计器"}
                  </Button>
                  {formFields.length > 0 ? (
                    <div className="rounded-lg border bg-muted/30 p-2.5">
                      <div className="mb-1.5 text-[11px] text-muted-foreground">字段清单（台账/打印/流程绑定按此取）</div>
                      <div className="flex flex-wrap gap-1.5">
                        {formFields.slice(0, 8).map((f) => (
                          <span key={f.key} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                            {f.label}
                          </span>
                        ))}
                        {formFields.length > 8 && <span className="text-[11px] text-muted-foreground">…共 {formFields.length} 个</span>}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">字段与录入界面为本单据私有（不进表单管理），发布前需至少设计一个字段。</p>
                  )}
                </>
              )}

              {editor.formType === "CODE" && (
                <>
                  <Select
                    value={editor.formCode || undefined}
                    onValueChange={(v) => {
                      patch({ formCode: v })
                      void loadFields({ formType: "CODE", formCode: v, formSchema: null })
                    }}
                  >
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue placeholder={codeForms.length ? "选择手写表单" : "暂无可选表单"} />
                    </SelectTrigger>
                    <SelectContent>
                      {codeForms.map((f) => (
                        <SelectItem key={f.code} value={f.code}>
                          {f.name}（{f.code}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="space-y-1.5">
                    <Label className="text-xs">发起页路径（submitPath）</Label>
                    <Input
                      value={editor.submitPath ?? ""}
                      onChange={(e) => patch({ submitPath: e.target.value })}
                      placeholder="如 /document/send?new=1（录入跳该页面）"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  {fields.length > 0 && (
                    <div className="rounded-lg border bg-muted/30 p-2.5">
                      <div className="mb-1.5 text-[11px] text-muted-foreground">字段清单（统一接口，共 {fields.length} 个）</div>
                      <div className="flex flex-wrap gap-1.5">
                        {fields.slice(0, 8).map((f) => (
                          <span key={f.key} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                            {f.label}
                          </span>
                        ))}
                        {fields.length > 8 && <span className="text-[11px] text-muted-foreground">…</span>}
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
            <Separator />

            {/* ③ 编号规则 */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">③ 编号规则</h3>
              <Select
                value={editor.numberRuleId != null ? String(editor.numberRuleId) : "none"}
                onValueChange={(v) => patch({ numberRuleId: v === "none" ? null : Number(v) })}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不占号</SelectItem>
                  {rules.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editor.numberRuleId != null && (
                <p className="font-mono text-xs text-muted-foreground">
                  {rules.find((r) => r.id === editor.numberRuleId)?.pattern ?? ""}（提交时占号，作废不回收）
                </p>
              )}
            </section>
            <Separator />

            {/* ④ 审批流 */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">④ 审批流</h3>
              <Select
                value={editor.wfDefCode ?? "none"}
                onValueChange={(v) => patch({ wfDefCode: v === "none" ? null : v })}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不绑定（纯台账，提交即生效）</SelectItem>
                  {wfDefs.map((d) => (
                    <SelectItem key={d.defCode} value={d.defCode}>
                      {d.name}（{d.defCode}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editor.wfDefCode && <p className="text-xs text-muted-foreground">提交后将发起「{editor.wfDefCode}」审批，通过后生效、驳回可改再提。</p>}
            </section>
            <Separator />

            {/* ⑤ 台账配置 */}
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">⑤ 台账配置</h3>
                <span className="text-[11px] text-muted-foreground">发布后修改即时生效</span>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">台账列</Label>
                {editor.listConfig.columns.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Select
                      value={c.field || undefined}
                      onValueChange={(v) =>
                        patchList({
                          columns: editor.listConfig.columns.map((x, xi) =>
                            xi === i ? { ...x, field: v, label: x.label || allFieldOptions.find((f) => f.key === v)?.label || v } : x,
                          ),
                        })
                      }
                    >
                      <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue placeholder="字段" />
                      </SelectTrigger>
                      <SelectContent>
                        {allFieldOptions.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            {f.label}（{f.key}）
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={c.label}
                      onChange={(e) => patchList({ columns: editor.listConfig.columns.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)) })}
                      placeholder="显示名"
                      className="h-8 flex-1 text-xs"
                    />
                    <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-rose-600" onClick={() => patchList({ columns: editor.listConfig.columns.filter((_, xi) => xi !== i) })}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => patchList({ columns: [...editor.listConfig.columns, { field: "", label: "" }] })}>
                  <Plus className="size-3.5" /> 加列
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">查询条件</Label>
                {editor.listConfig.filters.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Select
                      value={f.field || undefined}
                      onValueChange={(v) =>
                        patchList({
                          filters: editor.listConfig.filters.map((x, xi) =>
                            xi === i ? { ...x, field: v, label: x.label || allFieldOptions.find((o) => o.key === v)?.label || v } : x,
                          ),
                        })
                      }
                    >
                      <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue placeholder="字段" />
                      </SelectTrigger>
                      <SelectContent>
                        {allFieldOptions.map((o) => (
                          <SelectItem key={o.key} value={o.key}>
                            {o.label}（{o.key}）
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={f.label}
                      onChange={(e) => patchList({ filters: editor.listConfig.filters.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)) })}
                      placeholder="显示名"
                      className="h-8 w-28 text-xs"
                    />
                    <Select
                      value={f.type}
                      onValueChange={(v) => patchList({ filters: editor.listConfig.filters.map((x, xi) => (xi === i ? { ...x, type: v as "text" | "select" | "dateRange" } : x)) })}
                    >
                      <SelectTrigger className="h-8 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">文本</SelectItem>
                        <SelectItem value="select">下拉</SelectItem>
                        <SelectItem value="dateRange">日期区间</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-rose-600" onClick={() => patchList({ filters: editor.listConfig.filters.filter((_, xi) => xi !== i) })}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => patchList({ filters: [...editor.listConfig.filters, { field: "", label: "", type: "text" }] })}>
                  <Plus className="size-3.5" /> 加条件
                </Button>
              </div>
            </section>
            <Separator />

            {/* ⑥ 打印模板（文档流式设计器 §9；v1 旧模板只读兼容） */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">⑥ 打印模板</h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={editor.id == null}
                  title={editor.id == null ? "先保存定义再建模板" : undefined}
                  onClick={() => navigate(`/bizdoc/tpl/${editor.code}/new`)}
                >
                  <Plus className="size-3.5" /> 新建模板
                </Button>
              </div>
              {tpls.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无模板{editor.id == null ? "（先保存定义）" : "，点右上「新建模板」进设计器"}。</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {tpls.map((t) => {
                    const v1 = t.content.schemaVersion !== 2
                    return (
                      <div key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <Printer className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{t.name}</span>
                        {v1 && (
                          <Badge variant="outline" className="text-[10px] text-amber-600">
                            v1 只读
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {t.paper}
                          {t.landscape ? "·横" : ""}
                        </Badge>
                        {t.isDefault ? (
                          <Star className="size-3.5 shrink-0 text-amber-500" />
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 shrink-0 text-muted-foreground hover:text-amber-500"
                            title="设为默认"
                            onClick={() =>
                              void setDefaultPrintTpl(t.id).then(() => editor.id != null && void fetchPrintTpls(editor.id).then((r) => setTpls(r.data)))
                            }
                          >
                            <Star className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0 text-primary"
                          title={v1 ? "v1 模板只读，不能进设计器" : "设计"}
                          disabled={v1}
                          onClick={() => navigate(`/bizdoc/tpl/${editor.code}/${t.id}`)}
                        >
                          <PenLine className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0 text-muted-foreground hover:text-rose-600"
                          title="删除模板"
                          onClick={() =>
                            void deletePrintTpl(t.id).then(() => editor.id != null && void fetchPrintTpls(editor.id).then((r) => setTpls(r.data)))
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="rounded-md border border-dashed bg-muted/30 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
                文档流式模板设计器：块级堆叠排版、字段 token 绑定、明细/审批区/二维码、打印自动分页；旧 v1 自由定位模板仅保留打印兼容。
              </p>
            </section>
          </div>
        )}
      </Drawer>

      {/* §10 单据字段设计器：复用 FormDesignerCore（全屏 Modal），产物受控写回 editor.formSchema */}
      <Modal
        open={designerOpen && editor !== null}
        onOpenChange={setDesignerOpen}
        title={
          <span className="flex items-center gap-2">
            <LayoutPanelTop className="size-4 text-primary" />
            单据字段设计{editor?.name ? ` · ${editor.name}` : ""}
          </span>
        }
        description="字段与录入界面为本单据私有（存 def.formSchema，不进表单管理）；字段标识供台账/打印模板/流程条件绑定"
        width={1180}
        height={720}
        bodyClassName="p-0"
        footer={
          <>
            <span className="mr-auto text-xs text-muted-foreground">
              {formFields.length} 个数据字段 · 关闭即暂存，随定义「保存」一并持久化
            </span>
            <Button size="sm" onClick={() => setDesignerOpen(false)}>
              完成
            </Button>
          </>
        }
      >
        {editor && (
          <FormDesignerCore
            widgets={(editor.formSchema ?? []) as unknown as DesignerWidget[]}
            onWidgetsChange={(updater) =>
              setEditor((e) => {
                if (!e) return e
                const cur = (e.formSchema ?? []) as unknown as DesignerWidget[]
                const next = typeof updater === "function" ? (updater as (w: DesignerWidget[]) => DesignerWidget[])(cur) : updater
                return { ...e, formSchema: next as unknown as FormWidget[] }
              })
            }
            title={editor.name || "单据表单"}
            onTitleChange={() => undefined}
            showKeyField
          />
        )}
      </Modal>

      {/* 停用确认 */}
      <AlertDialog open={disabling !== null} onOpenChange={(o) => !o && setDisabling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>停用定义</AlertDialogTitle>
            <AlertDialogDescription>停用「{disabling?.name}」后单据中心不再展示入口，存量单据不受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void doDisable()}>
              确认停用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除确认（仅 DRAFT） */}
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除定义</AlertDialogTitle>
            <AlertDialogDescription>删除草稿定义「{deleting?.name}」，不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void doDelete()}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

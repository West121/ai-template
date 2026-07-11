/**
 * 单据模板 /bizdoc/tpls（§11.3，对齐参考平台「单据管理」）：独立文档模板卡片列表
 * （名称/编码/分类徽标/已发布/vN/时间；搜索+分类+绑定类型筛选）+「新建模板」弹窗
 * （名称/编码/绑定类型 流程|表单 双选钮 + 对应编码下拉/描述）→ 进文档编辑器。
 * 与业务单据（单据中心/单据定义）两套并存。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FileText, GitBranch, LayoutTemplate, Plus, Search, ShieldAlert, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Modal } from "@/components/modal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useHasPerm } from "@/stores/auth-store"
import { DemoBanner } from "@/pages/document/gongwen/shared"
import {
  createTpl,
  deleteTpl,
  fetchBindOptions,
  fetchTpls,
  filterTpls,
  publishTpl,
  type BizDocTpl,
  type TplBindType,
} from "./tpls"

const BIND_META: Record<TplBindType, { label: string; className: string }> = {
  FLOW: { label: "绑定流程", className: "bg-blue-500/10 text-blue-600" },
  FORM: { label: "绑定表单", className: "bg-violet-500/10 text-violet-600" },
  BIZDOC: { label: "业务单据", className: "bg-emerald-500/10 text-emerald-600" },
}

export default function BizdocTplsPage() {
  const navigate = useNavigate()
  const canWrite = useHasPerm("bizdoc:def:write")

  const [rows, setRows] = useState<BizDocTpl[]>([])
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)

  const [keyword, setKeyword] = useState("")
  const [category, setCategory] = useState("all")
  const [bindType, setBindType] = useState("all")

  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<BizDocTpl | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchTpls()
      setRows(res.data)
      setDemo(res.demo)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const categories = useMemo(() => [...new Set(rows.map((t) => t.category).filter(Boolean))] as string[], [rows])
  const list = useMemo(
    () =>
      filterTpls(rows, {
        keyword,
        category: category === "all" ? "" : category,
        bindType: bindType === "all" ? "" : (bindType as TplBindType),
      }),
    [rows, keyword, category, bindType],
  )

  const doPublish = async (t: BizDocTpl) => {
    try {
      await publishTpl(t.id)
      toast.success(`「${t.name}」已发布`)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发布失败")
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    try {
      await deleteTpl(deleting.id)
      toast.success("模板已删除")
      setDeleting(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  if (!canWrite) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <ShieldAlert className="size-8 text-rose-500/60" />
          <div className="text-sm">需要「bizdoc:def:write」权限才能管理单据模板</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title="单据模板" description="独立文档模板：绑定到流程或表单，把一条数据渲染成可打印文档（与「单据中心/单据定义」的业务单据并存）" />
      {demo && <DemoBanner />}

      {/* 筛选条 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索名称 / 编码" className="h-8 w-56 pl-8 text-sm" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger size="sm" className="h-8 w-32 text-sm">
            <SelectValue placeholder="分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={bindType} onValueChange={setBindType}>
          <SelectTrigger size="sm" className="h-8 w-32 text-sm">
            <SelectValue placeholder="绑定类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部绑定</SelectItem>
            <SelectItem value="FLOW">绑定流程</SelectItem>
            <SelectItem value="FORM">绑定表单</SelectItem>
            <SelectItem value="BIZDOC">业务单据</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" className="ml-auto h-8" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          新建模板
        </Button>
      </div>

      {/* 卡片墙 */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
            <LayoutTemplate className="size-8 text-muted-foreground/40" />
            暂无匹配的模板
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((t) => {
            const bind = BIND_META[t.bindType]
            return (
              <Card key={t.id} className="group cursor-pointer gap-0 py-0 transition-shadow hover:shadow-md" onClick={() => navigate(`/bizdoc/tpl/t/${t.id}`)}>
                <CardContent className="space-y-2.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {t.bindType === "FLOW" ? (
                        <GitBranch className="size-4 shrink-0 text-blue-500" />
                      ) : (
                        <FileText className="size-4 shrink-0 text-violet-500" />
                      )}
                      <span className="truncate text-sm font-medium">{t.name}</span>
                    </div>
                    {t.status === "PUBLISHED" ? (
                      <Badge variant="outline" className="shrink-0 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600">
                        已发布 v{t.version}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0 border-slate-500/30 bg-slate-500/10 text-[10px] text-slate-500">
                        草稿
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="font-mono text-muted-foreground">{t.code}</span>
                    <span className={`rounded px-1 py-0.5 ${bind.className}`}>{bind.label}</span>
                    {t.bindCode && <span className="font-mono text-muted-foreground">{t.bindCode}</span>}
                    {t.category && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {t.category}
                      </Badge>
                    )}
                  </div>
                  {t.description && <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p>}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-muted-foreground">{t.updatedAt?.slice(0, 16).replace("T", " ") ?? "—"}</span>
                    <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                      {t.status !== "PUBLISHED" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[11px] text-emerald-600 hover:text-emerald-600"
                          onClick={(e) => {
                            e.stopPropagation()
                            void doPublish(t)
                          }}
                        >
                          发布
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-rose-600"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleting(t)
                        }}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <CreateTplDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/bizdoc/tpl/t/${id}`)} />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除模板</AlertDialogTitle>
            <AlertDialogDescription>删除「{deleting?.name}」（{deleting?.code}）后不可恢复，确定？</AlertDialogDescription>
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

/* ============================ 新建模板弹窗 ============================ */

function CreateTplDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [bindType, setBindType] = useState<"FLOW" | "FORM">("FLOW")
  const [bindCode, setBindCode] = useState("")
  const [category, setCategory] = useState("")
  const [description, setDescription] = useState("")
  const [options, setOptions] = useState<{ code: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName("")
    setCode("")
    setBindType("FLOW")
    setBindCode("")
    setCategory("")
    setDescription("")
  }, [open])

  useEffect(() => {
    if (!open) return
    setBindCode("")
    void fetchBindOptions(bindType).then((r) => setOptions(r.data))
  }, [open, bindType])

  const submit = async () => {
    if (!name.trim() || !code.trim()) {
      toast.error("请填写模板名称与编码")
      return
    }
    if (!bindCode) {
      toast.error(bindType === "FLOW" ? "请选择绑定的流程" : "请选择绑定的表单")
      return
    }
    setSaving(true)
    try {
      const res = await createTpl({ name: name.trim(), code: code.trim(), bindType, bindCode, category: category.trim() || undefined, description: description.trim() || undefined })
      toast.success("模板已创建，进入编辑器排版")
      onClose()
      onCreated(res.data.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !saving && onClose()}
      title="新建单据模板"
      description="绑定到流程或表单；创建后进入文档编辑器排版"
      width={520}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "创建中…" : "创建并编辑"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">模板名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 请假条" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">模板编码</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如 leave_print" className="h-8 font-mono text-xs" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">绑定类型</Label>
          <RadioGroup value={bindType} onValueChange={(v) => setBindType(v as "FLOW" | "FORM")} className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <RadioGroupItem value="FLOW" /> 绑定到流程
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <RadioGroupItem value="FORM" /> 绑定到表单
            </label>
          </RadioGroup>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{bindType === "FLOW" ? "流程（已发布）" : "表单（已发布）"}</Label>
          <Select value={bindCode || undefined} onValueChange={setBindCode}>
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue placeholder={options.length ? "选择绑定对象" : "暂无可选项"} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.code} value={o.code}>
                  {o.name}（{o.code}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            {bindType === "FLOW" ? "字段树 = 该流程绑定表单的字段 + 审批数据（_approvals）" : "字段树 = 该表单的字段清单"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">分类（可选）</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="如 人事 / 财务" className="h-8 text-sm" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">描述（可选）</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="text-xs" />
        </div>
      </div>
    </Modal>
  )
}

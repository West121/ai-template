/**
 * 套打模板设计器 v2（bizdoc-design.md §9.2 文档流式 + §11 独立模板接入 + §12 计算配置）。
 * 三栏：左=元素库（分组照参考图）｜中=纸面文档流画布｜右=属性面板（未选中=页面设置）。
 * 顶部：撤销/重做（≤20步，Ctrl+Z/Y）/ 预览（样例+审批样例+计算演示）/ JSON 源码（导入导出）/
 * 「启用计算配置」开关（§12：开启变两步向导 ① 计算配置 → ② 模板设计，步骤条+下一步）/ 保存（独立模板另有发布）。
 * 路由：/bizdoc/tpl/:defCode/:tplId（业务单据绑定，tplId=new 新建）｜/bizdoc/tpl/t/:tplId（§11 独立模板，
 * 字段树按绑定来源聚合端点取，FLOW 绑定 _approvals 组常驻）。v1 旧模板只读兼容不进设计器。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, ArrowRight, Braces, Eye, Loader2, Redo2, Save, Undo2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent } from "@/components/ui/card"
import { useHasPerm } from "@/stores/auth-store"
import {
  FOOTER_ID,
  HEADER_ID,
  calcIssues,
  calcVarFields,
  emptyTemplateV2,
  findBlock,
  isV2,
  newBlock,
  newPageBand,
  patchBlock,
  type BdBlock,
  type BdBlockType,
  type BdPageV2,
  type BdTemplateV2,
} from "@/components/bizdoc/model-v2"
import { fetchDef, fetchPrintTpl, savePrintTpl, type BizDocDef } from "../mock"
import { fetchTpl, fetchTplFields, publishTpl, saveTpl, type BizDocTpl } from "../tpls"
import { deriveSubformFields, fieldsForDef } from "../fields"
import { useHistory } from "./history"
import { Palette } from "./palette"
import { DesignerCanvas } from "./canvas"
import { PagePanel, BlockPanel, BandPanel } from "./props-panel"
import { PreviewDialog, JsonDialog } from "./dialogs"
import { CalcConfig } from "./calc-config"
import { buildVarGroups, type FieldOption } from "./token-vars"

export default function TplDesignerPage() {
  const { defCode, tplId = "new" } = useParams()
  // §11 独立模板路由 /bizdoc/tpl/t/:tplId（无 defCode 参数）
  const standalone = defCode === undefined
  const navigate = useNavigate()
  const canWrite = useHasPerm("bizdoc:def:write")

  const [def, setDef] = useState<BizDocDef | null>(null)
  /** §11 独立模板（绑定信息/状态/版本） */
  const [sTpl, setSTpl] = useState<BizDocTpl | null>(null)
  const [fields, setFields] = useState<FieldOption[]>([])
  const [loading, setLoading] = useState(true)
  const [legacyV1, setLegacyV1] = useState(false)
  const [tplDbId, setTplDbId] = useState<number | null>(null)
  const [name, setName] = useState("新模板")
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
  /** §12 两步向导当前步（calc 段存在时才有意义） */
  const [step, setStep] = useState<"calc" | "design">("design")

  const history = useHistory<BdTemplateV2>(emptyTemplateV2())
  const tpl = history.state
  const resetHistory = history.reset

  /* ---- 载入（独立模板 或 定义绑定模板）+ 字段清单 ---- */
  useEffect(() => {
    let alive = true
    void (async () => {
      setLoading(true)
      try {
        if (standalone) {
          // §11：独立模板 + 绑定来源字段树（FLOW→表单清单+_approvals；FORM→统一清单）
          const res = await fetchTpl(Number(tplId))
          if (!alive) return
          if (!res.data) {
            toast.error("模板不存在")
            return
          }
          setSTpl(res.data)
          setName(res.data.name)
          setTplDbId(res.data.id)
          const f = await fetchTplFields(res.data)
          if (!alive) return
          setFields(f.data)
          if (isV2(res.data.content)) {
            resetHistory(res.data.content)
            setStep(res.data.content.calc ? "calc" : "design")
          } else {
            setLegacyV1(true)
          }
          return
        }
        const defRes = await fetchDef(defCode ?? "")
        if (!alive) return
        setDef(defRes.data)
        if (defRes.data) {
          // §10 统一字段源：INLINE=def.formSchema 本地派生；CODE/存量 ONLINE=统一清单；
          // 另并入子表字段及其列（与 /fields 端点同形状，供明细数据源/列拾取器）
          const fs = await fieldsForDef(defRes.data)
          const subs = defRes.data.formType === "INLINE" ? deriveSubformFields(defRes.data.formSchema) : []
          if (alive) setFields([...fs, ...subs])
        }
        if (tplId !== "new") {
          const tplRes = await fetchPrintTpl(Number(tplId))
          if (!alive) return
          if (tplRes.data) {
            setName(tplRes.data.name)
            setTplDbId(tplRes.data.id)
            if (isV2(tplRes.data.content)) {
              resetHistory(tplRes.data.content)
              setStep(tplRes.data.content.calc ? "calc" : "design")
            } else {
              setLegacyV1(true)
            }
          } else {
            toast.error("模板不存在")
          }
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [defCode, tplId, standalone, resetHistory])

  /* ---- 快捷键：撤销/重做 ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const target = e.target as HTMLElement
      if (target.closest("input,textarea,[contenteditable]")) return
      if (e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) history.redo()
        else history.undo()
      } else if (e.key.toLowerCase() === "y") {
        e.preventDefault()
        history.redo()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [history])

  /* ---- 字段源分流（视觉对齐规范拾取器裁定）：
     端点/派生清单里的 subform 条目与其列（`子表key.列key` 点分键）只进拾取器，
     不进 token 选择器/插入变量浮层（{{items}} 直插数组无意义） ---- */
  const subformKeys = useMemo(() => new Set(fields.filter((f) => f.type === "subform").map((f) => f.key)), [fields])
  const tokenFields = useMemo(
    () =>
      fields.filter((f) => {
        if (f.type === "subform") return false
        const dot = f.key.indexOf(".")
        if (dot > 0 && subformKeys.has(f.key.slice(0, dot))) return false // 子表列只进拾取器
        return true
      }),
    [fields, subformKeys],
  )

  /* ---- §12 计算配置派生 ---- */
  const calcEnabled = !!tpl.calc
  const calcVars = useMemo(() => calcVarFields(tpl.calc), [tpl.calc])
  /** chip 显示名：表单字段 ∪ 计算变量 */
  const fieldMap = useMemo(
    () => ({ ...Object.fromEntries(tokenFields.map((f) => [f.key, f.label])), ...Object.fromEntries(calcVars.map((c) => [c.key, c.label])) }),
    [tokenFields, calcVars],
  )
  /** 「插入变量」浮层分组（与 field-picker 同源） */
  const varGroups = useMemo(() => buildVarGroups(tokenFields, calcVars), [tokenFields, calcVars])
  /** 数据源候选（明细/聚合共用）：字段清单 subform ∪ 模板 detailTable 引用的子表 */
  const subformOptions = useMemo(() => {
    const out = new Map<string, string>()
    for (const f of fields) if (f.type === "subform") out.set(f.key, f.label)
    const scan = (blocks: BdBlock[]) => {
      for (const b of blocks) {
        if (b.type === "detailTable" && b.field.trim() && !out.has(b.field)) out.set(b.field, `明细（${b.field}）`)
        if (b.type === "row") b.children.forEach(scan)
      }
    }
    scan(tpl.blocks)
    return [...out.entries()].map(([key, label]) => ({ key, label }))
  }, [fields, tpl.blocks])
  /** 各子表已知列：端点点分键（`items.name`）∪ 模板 detailTable columns（明细列拾取 + 聚合 chips 共用） */
  const columnsBySource = useMemo(() => {
    const out: Record<string, { field: string; label: string }[]> = {}
    const put = (source: string, field: string, label: string) => {
      const list = (out[source] ??= [])
      if (field && !list.some((c) => c.field === field)) list.push({ field, label })
    }
    // 字段端点下发的子表列：`子表key.列key`
    for (const f of fields) {
      const dot = f.key.indexOf(".")
      if (dot > 0 && subformKeys.has(f.key.slice(0, dot))) {
        put(f.key.slice(0, dot), f.key.slice(dot + 1), f.label)
      }
    }
    const scan = (blocks: BdBlock[]) => {
      for (const b of blocks) {
        if (b.type === "detailTable" && b.field.trim()) {
          for (const c of b.columns) if (c.field.trim()) put(b.field, c.field, c.label)
        }
        if (b.type === "row") b.children.forEach(scan)
      }
    }
    scan(tpl.blocks)
    return out
  }, [fields, subformKeys, tpl.blocks])

  const selectedBand = selectedId === HEADER_ID ? "header" : selectedId === FOOTER_ID ? "footer" : null
  const selected = selectedId && !selectedBand ? findBlock(tpl.blocks, selectedId)?.block ?? null : null

  const onBlocks = useCallback(
    (blocks: BdBlock[]) => history.push({ ...history.state, blocks }),
    [history],
  )

  const addBlock = (type: BdBlockType) => {
    const block = newBlock(type)
    history.push({ ...tpl, blocks: [...tpl.blocks, block] })
    setSelectedId(block.id)
  }

  /** 启用文档页眉/页脚（页面级） */
  const addBand = (which: "header" | "footer") => {
    if (tpl.page[which]) return
    history.push({ ...tpl, page: { ...tpl.page, [which]: newPageBand(which) } })
    setSelectedId(which === "header" ? HEADER_ID : FOOTER_ID)
  }

  const patchSelected = (patch: Partial<BdBlock>) => {
    if (!selectedId) return
    const next = patchBlock(tpl.blocks, selectedId, patch)
    if (next !== tpl.blocks) history.push({ ...tpl, blocks: next })
  }

  const patchPage = (patch: Partial<BdPageV2>) => {
    history.push({ ...tpl, page: { ...tpl.page, ...patch } })
  }

  /* ---- §12：开关 + 向导 ---- */
  const formFieldMap = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.label])), [fields])

  const toggleCalc = (on: boolean) => {
    if (on) {
      history.push({ ...tpl, calc: tpl.calc ?? { aggregates: [], computed: [] } })
      setStep("calc")
    } else {
      const { calc: _calc, ...rest } = tpl
      history.push(rest as BdTemplateV2)
      setStep("design")
      toast.info("已停用计算配置（可撤销恢复）")
    }
  }

  /** 下一步（① → ②）：§12 校验拦截（重名/公式空/聚合未选子表） */
  const goDesignStep = () => {
    const issues = calcIssues(tpl.calc, formFieldMap)
    if (issues.length > 0) {
      toast.error(issues[0], { description: issues.length > 1 ? `等 ${issues.length} 个问题` : undefined })
      return
    }
    setStep("design")
  }

  const doSave = async (silent = false) => {
    if (!name.trim()) {
      toast.error("请填写模板名称")
      return false
    }
    setSaving(true)
    try {
      if (standalone) {
        if (!sTpl) return false
        const saved = await saveTpl(sTpl.id, { name: name.trim(), content: tpl, paper: tpl.page.size, landscape: tpl.page.landscape })
        setSTpl(saved.data)
      } else {
        if (!def) return false
        const saved = await savePrintTpl({
          id: tplDbId,
          defId: def.id,
          name: name.trim(),
          paper: tpl.page.size,
          landscape: tpl.page.landscape,
          content: tpl,
        })
        setTplDbId(saved.data.id)
      }
      if (!silent) toast.success(`模板「${name.trim()}」已保存`)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
      return false
    } finally {
      setSaving(false)
    }
  }

  /** §11 独立模板：先保存再发布（version+1）；§12 计算配置校验拦截 */
  const doPublish = async () => {
    if (!sTpl) return
    const issues = calcIssues(tpl.calc, formFieldMap)
    if (issues.length > 0) {
      toast.error(issues[0], { description: issues.length > 1 ? `等 ${issues.length} 个问题` : undefined })
      setStep("calc")
      return
    }
    if (!(await doSave(true))) return
    setSaving(true)
    try {
      const res = await publishTpl(sTpl.id)
      setSTpl(res.data)
      toast.success(`「${name.trim()}」已发布 v${res.data.version}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发布失败")
    } finally {
      setSaving(false)
    }
  }

  if (!canWrite) {
    return (
      <Card>
        <CardContent className="py-14 text-center text-sm">需要「bizdoc:def:write」权限才能设计打印模板</CardContent>
      </Card>
    )
  }

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">加载模板…</span>
      </div>
    )
  }

  if (legacyV1) {
    return (
      <Card>
        <CardContent className="space-y-3 py-14 text-center text-sm">
          <p>该模板为 v1（自由定位）旧格式：打印/预览保留兼容渲染，但设计器仅支持 v2（文档流式）。</p>
          <p className="text-xs text-muted-foreground">如需改版式，请新建 v2 模板。</p>
          <Button variant="outline" size="sm" onClick={() => navigate(standalone ? "/bizdoc/tpls" : "/bizdoc/defs")}>
            返回{standalone ? "单据模板" : "单据管理"}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="-mx-4 -my-4 flex h-[calc(100dvh-6.5rem)] min-h-[34rem] flex-col overflow-hidden md:-mx-5 md:-my-5">
      {/* 顶部条 */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur">
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate(standalone ? "/bizdoc/tpls" : "/bizdoc/defs")}>
          <ArrowLeft className="size-4" />
          退出
        </Button>
        <div className="mx-1 h-6 w-px bg-border" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="模板名称" className="h-8 w-52 text-sm" />
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {standalone
            ? `${sTpl?.bindType === "FLOW" ? "绑定流程" : "绑定表单"} ${sTpl?.bindCode ?? ""} · ${sTpl?.status === "PUBLISHED" ? `已发布 v${sTpl.version}` : "草稿"}`
            : `${def?.name ?? defCode}`}{" "}
          · {tpl.page.size}
          {tpl.page.landscape ? "·横" : ""}
        </span>
        {/* §12 步骤条（启用计算配置后出现） */}
        {calcEnabled && (
          <div className="hidden items-center gap-1 md:flex">
            <button
              type="button"
              onClick={() => setStep("calc")}
              className={`rounded-full px-2.5 py-1 text-xs ${step === "calc" ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent"}`}
            >
              ① 计算配置
            </button>
            <span className="text-muted-foreground/40">→</span>
            <button
              type="button"
              onClick={goDesignStep}
              className={`rounded-full px-2.5 py-1 text-xs ${step === "design" ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent"}`}
            >
              ② 模板设计
            </button>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="size-8" title="撤销（Ctrl+Z）" disabled={!history.canUndo} onClick={history.undo}>
            <Undo2 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" title="重做（Ctrl+Y）" disabled={!history.canRedo} onClick={history.redo}>
            <Redo2 className="size-4" />
          </Button>
          <div className="mx-1 h-6 w-px bg-border" />
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setPreview(true)}>
            <Eye className="size-3.5" /> 预览
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setJsonOpen(true)}>
            <Braces className="size-3.5" /> JSON
          </Button>
          {/* §12 启用计算配置开关（保存前） */}
          <label className="flex cursor-pointer items-center gap-1.5 px-1 text-xs text-muted-foreground" title="开启后进入两步向导：① 计算配置 → ② 模板设计">
            <Switch checked={calcEnabled} onCheckedChange={toggleCalc} />
            计算配置
          </label>
          {calcEnabled && step === "calc" ? (
            <Button size="sm" className="h-8 gap-1.5" onClick={goDesignStep}>
              下一步 <ArrowRight className="size-3.5" />
            </Button>
          ) : (
            calcEnabled && (
              <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => setStep("calc")}>
                <ArrowLeft className="size-3.5" /> 上一步
              </Button>
            )
          )}
          <Button size="sm" variant={standalone ? "outline" : "default"} className="h-8 gap-1.5" disabled={saving} onClick={() => void doSave()}>
            <Save className="size-3.5" /> {saving ? "保存中…" : "保存"}
          </Button>
          {standalone && (
            <Button size="sm" className="h-8 gap-1.5" disabled={saving} onClick={() => void doPublish()}>
              <Upload className="size-3.5" /> 发布{sTpl && sTpl.version > 0 ? ` v${sTpl.version + 1}` : ""}
            </Button>
          )}
        </div>
      </div>

      {/* §12 第 ① 步：计算配置页（全宽）；第 ② 步/未启用：三栏模板设计 */}
      {calcEnabled && step === "calc" ? (
        <main className="min-h-0 flex-1 overflow-y-auto bg-muted/20">
          <CalcConfig
            calc={tpl.calc ?? { aggregates: [], computed: [] }}
            subformOptions={subformOptions}
            columnsBySource={columnsBySource}
            onChange={(calc) => history.push({ ...tpl, calc })}
          />
        </main>
      ) : (
      <div className="flex min-h-0 flex-1">
        {/* 左：元素库 */}
        <aside className="w-52 shrink-0 overflow-y-auto border-r bg-background/60">
          <Palette onAdd={addBlock} onAddBand={addBand} hasBand={{ header: !!tpl.page.header, footer: !!tpl.page.footer }} />
        </aside>

        {/* 中：纸面画布 */}
        <main className="bd-desk min-w-0 flex-1 overflow-auto p-8">
          <div className="mx-auto w-fit">
            <DesignerCanvas
              tpl={tpl}
              ctx={{ data: {}, fields: fieldMap }}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onBlocks={onBlocks}
              onPatchPage={patchPage}
              varGroups={varGroups}
            />
          </div>
        </main>

        {/* 右：属性面板 */}
        <aside className="w-72 shrink-0 overflow-y-auto border-l bg-background/60">
          {selectedBand && tpl.page[selectedBand] ? (
            <BandPanel
              which={selectedBand}
              band={tpl.page[selectedBand]!}
              fields={tokenFields}
              calcVars={calcVars}
              onChange={(b) => patchPage(selectedBand === "header" ? { header: b } : { footer: b })}
              onRemove={() => {
                patchPage(selectedBand === "header" ? { header: null } : { footer: null })
                setSelectedId(null)
              }}
            />
          ) : selected ? (
            <BlockPanel
              block={selected}
              fields={tokenFields}
              calcVars={calcVars}
              subformOptions={subformOptions}
              columnsBySource={columnsBySource}
              onPatch={patchSelected}
            />
          ) : (
            <PagePanel page={tpl.page} onPatch={patchPage} />
          )}
        </aside>
      </div>
      )}

      <PreviewDialog tpl={tpl} fields={tokenFields} open={preview} onClose={() => setPreview(false)} />
      <JsonDialog
        tpl={tpl}
        name={name}
        open={jsonOpen}
        onClose={() => setJsonOpen(false)}
        onApply={(next) => {
          history.push(next)
          setSelectedId(null)
          setStep(next.calc ? "calc" : "design")
        }}
      />
    </div>
  )
}

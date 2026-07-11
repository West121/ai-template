/**
 * 套打模板设计器 v2（bizdoc-design.md §9.2，文档流式）。
 * 三栏：左=元素库（分组照参考图）｜中=纸面文档流画布｜右=属性面板（未选中=页面设置）。
 * 顶部：撤销/重做（≤20步，Ctrl+Z/Y）/ 预览（样例+审批样例）/ JSON 源码（导入导出）/ 保存。
 * 路由 /bizdoc/tpl/:defCode/:tplId（tplId=new 新建）；v1 旧模板只读兼容不进设计器。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Braces, Eye, Loader2, Redo2, Save, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { useHasPerm } from "@/stores/auth-store"
import {
  emptyTemplateV2,
  findBlock,
  isV2,
  newBlock,
  patchBlock,
  type BdBlock,
  type BdBlockType,
  type BdPageV2,
  type BdTemplateV2,
} from "@/components/bizdoc/model-v2"
import { fetchDef, fetchPrintTpl, savePrintTpl, type BizDocDef } from "../mock"
import { fieldsForDef } from "../fields"
import { useHistory } from "./history"
import { Palette } from "./palette"
import { DesignerCanvas } from "./canvas"
import { PagePanel, BlockPanel } from "./props-panel"
import { PreviewDialog, JsonDialog } from "./dialogs"
import type { FieldOption } from "./field-picker"

export default function TplDesignerPage() {
  const { defCode = "", tplId = "new" } = useParams()
  const navigate = useNavigate()
  const canWrite = useHasPerm("bizdoc:def:write")

  const [def, setDef] = useState<BizDocDef | null>(null)
  const [fields, setFields] = useState<FieldOption[]>([])
  const [loading, setLoading] = useState(true)
  const [legacyV1, setLegacyV1] = useState(false)
  const [tplDbId, setTplDbId] = useState<number | null>(null)
  const [name, setName] = useState("新模板")
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)

  const history = useHistory<BdTemplateV2>(emptyTemplateV2())
  const tpl = history.state
  const resetHistory = history.reset

  /* ---- 载入定义 + 模板 + 字段清单 ---- */
  useEffect(() => {
    let alive = true
    void (async () => {
      setLoading(true)
      try {
        const defRes = await fetchDef(defCode)
        if (!alive) return
        setDef(defRes.data)
        if (defRes.data) {
          // §10 统一字段源：INLINE=def.formSchema 本地派生；CODE/存量 ONLINE=统一清单
          const fs = await fieldsForDef(defRes.data)
          if (alive) setFields(fs)
        }
        if (tplId !== "new") {
          const tplRes = await fetchPrintTpl(Number(tplId))
          if (!alive) return
          if (tplRes.data) {
            setName(tplRes.data.name)
            setTplDbId(tplRes.data.id)
            if (isV2(tplRes.data.content)) {
              resetHistory(tplRes.data.content)
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
  }, [defCode, tplId, resetHistory])

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

  const fieldMap = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.label])), [fields])
  const selected = selectedId ? findBlock(tpl.blocks, selectedId)?.block ?? null : null

  const onBlocks = useCallback(
    (blocks: BdBlock[]) => history.push({ ...history.state, blocks }),
    [history],
  )

  const addBlock = (type: BdBlockType) => {
    const block = newBlock(type)
    history.push({ ...tpl, blocks: [...tpl.blocks, block] })
    setSelectedId(block.id)
  }

  const patchSelected = (patch: Partial<BdBlock>) => {
    if (!selectedId) return
    const next = patchBlock(tpl.blocks, selectedId, patch)
    if (next !== tpl.blocks) history.push({ ...tpl, blocks: next })
  }

  const patchPage = (patch: Partial<BdPageV2>) => {
    history.push({ ...tpl, page: { ...tpl.page, ...patch } })
  }

  const doSave = async () => {
    if (!def) return
    if (!name.trim()) {
      toast.error("请填写模板名称")
      return
    }
    setSaving(true)
    try {
      const saved = await savePrintTpl({
        id: tplDbId,
        defId: def.id,
        name: name.trim(),
        paper: tpl.page.size,
        landscape: tpl.page.landscape,
        content: tpl,
      })
      setTplDbId(saved.data.id)
      toast.success(`模板「${name.trim()}」已保存`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
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
          <p className="text-xs text-muted-foreground">如需改版式，请在定义里新建 v2 模板。</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/bizdoc/defs")}>
            返回单据管理
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="-mx-4 -my-4 flex h-[calc(100dvh-6.5rem)] min-h-[34rem] flex-col overflow-hidden md:-mx-5 md:-my-5">
      {/* 顶部条 */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur">
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate("/bizdoc/defs")}>
          <ArrowLeft className="size-4" />
          退出
        </Button>
        <div className="mx-1 h-6 w-px bg-border" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="模板名称" className="h-8 w-52 text-sm" />
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {def?.name ?? defCode} · {tpl.page.size}
          {tpl.page.landscape ? "·横" : ""}
        </span>
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
          <Button size="sm" className="h-8 gap-1.5" disabled={saving} onClick={() => void doSave()}>
            <Save className="size-3.5" /> {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>

      {/* 三栏 */}
      <div className="flex min-h-0 flex-1">
        {/* 左：元素库 */}
        <aside className="w-52 shrink-0 overflow-y-auto border-r bg-background/60">
          <Palette onAdd={addBlock} />
        </aside>

        {/* 中：纸面画布 */}
        <main className="bd-desk min-w-0 flex-1 overflow-auto p-8">
          <div className="mx-auto w-fit">
            <DesignerCanvas tpl={tpl} ctx={{ data: {}, fields: fieldMap }} selectedId={selectedId} onSelect={setSelectedId} onBlocks={onBlocks} />
          </div>
        </main>

        {/* 右：属性面板 */}
        <aside className="w-72 shrink-0 overflow-y-auto border-l bg-background/60">
          {selected ? <BlockPanel block={selected} fields={fields} onPatch={patchSelected} /> : <PagePanel page={tpl.page} onPatch={patchPage} />}
        </aside>
      </div>

      <PreviewDialog tpl={tpl} fields={fields} open={preview} onClose={() => setPreview(false)} />
      <JsonDialog
        tpl={tpl}
        name={name}
        open={jsonOpen}
        onClose={() => setJsonOpen(false)}
        onApply={(next) => {
          history.push(next)
          setSelectedId(null)
        }}
      />
    </div>
  )
}

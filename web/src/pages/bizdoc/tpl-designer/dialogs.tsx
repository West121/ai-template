/**
 * 设计器对话框：预览（样例数据 + 可切审批样例，PaperRenderer final 态 = 三态同源）、
 * JSON 源码（查看/复制/导入应用/导出下载）。
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Check, Copy, Download, Upload } from "lucide-react"
import { toast } from "sonner"
import { Modal } from "@/components/modal"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { PaperRenderer } from "@/components/bizdoc/paper-renderer"
import {
  buildSampleData,
  evalCalcDemo,
  pageSizeMm,
  parseAnyTemplate,
  staleTokensV2,
  type BdTemplateV2,
} from "@/components/bizdoc/model-v2"
import type { FieldOption } from "./field-picker"

const MM_TO_PX = 96 / 25.4

export function PreviewDialog({ tpl, fields, open, onClose }: { tpl: BdTemplateV2; fields: FieldOption[]; open: boolean; onClose: () => void }) {
  const [withApprovals, setWithApprovals] = useState(true)
  const deskRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  const fieldMap = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.label])), [fields])
  const data = useMemo(() => {
    const d = buildSampleData(tpl, fieldMap)
    if (!withApprovals) d._approvals = []
    // §12 计算配置：样例数据上演示求值（真实由后端出数据时求值）
    Object.assign(d, evalCalcDemo(tpl.calc, d))
    return d
  }, [tpl, fieldMap, withApprovals])
  const stale = useMemo(() => staleTokensV2(tpl, { data, fields: fieldMap }), [tpl, data, fieldMap])

  useLayoutEffect(() => {
    if (!open || !deskRef.current) return
    const paperPx = pageSizeMm(tpl.page).w * MM_TO_PX
    const avail = deskRef.current.clientWidth - 48
    setScale(avail >= paperPx ? 1 : Math.max(0.3, Math.round((avail / paperPx) * 20) / 20))
  }, [open, tpl])

  const size = pageSizeMm(tpl.page)

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="模板预览（样例数据）"
      width={900}
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={withApprovals} onCheckedChange={setWithApprovals} />
            含审批样例（_approvals）
          </label>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </>
      }
    >
      {stale.length > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0" />
          {stale.length} 处绑定不在字段清单内（{[...new Set(stale.map((s) => s.expr))].slice(0, 3).join("、")}
          {stale.length > 3 ? "…" : ""}），运行时将输出空值。
        </div>
      )}
      <div ref={deskRef} className="bd-desk max-h-[70vh] rounded-md p-6">
        <div className="mx-auto" style={{ width: `${size.w * MM_TO_PX * scale}px`, minHeight: `${size.h * MM_TO_PX * scale}px` }}>
          <PaperRenderer tpl={tpl} ctx={{ data, fields: fieldMap }} scale={scale} />
        </div>
      </div>
    </Modal>
  )
}

export function JsonDialog({
  tpl,
  name,
  open,
  onClose,
  onApply,
}: {
  tpl: BdTemplateV2
  name: string
  open: boolean
  onClose: () => void
  /** 导入应用（已校验 v2） */
  onApply: (tpl: BdTemplateV2) => void
}) {
  const [text, setText] = useState("")
  const [copied, setCopied] = useState(false)
  const json = useMemo(() => JSON.stringify(tpl, null, 2), [tpl])

  // 打开时回填当前 JSON
  useLayoutEffect(() => {
    if (open) setText(json)
  }, [open, json])

  const apply = () => {
    const parsed = parseAnyTemplate(text)
    if (!parsed) {
      toast.error("JSON 解析失败：不是合法的模板结构")
      return
    }
    if (parsed.schemaVersion !== 2) {
      toast.error("仅支持导入 v2（文档流）模板；v1 自由定位模板只读兼容，不能进设计器")
      return
    }
    onApply(parsed)
    toast.success("已应用导入的模板 JSON")
    onClose()
  }

  const exportFile = () => {
    const blob = new Blob([text], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${name || "bizdoc-template"}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="模板 JSON 源码"
      description="可直接改动后应用，或导入/导出 .json 文件"
      width={720}
      footer={
        <>
          <label className="mr-auto">
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => setText(String(reader.result))
                reader.readAsText(file)
                e.target.value = ""
              }}
            />
            <Button variant="outline" size="sm" className="gap-1.5" asChild>
              <span>
                <Upload className="size-3.5" /> 导入文件
              </span>
            </Button>
          </label>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportFile}>
            <Download className="size-3.5" /> 导出
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />} 复制
          </Button>
          <Button size="sm" onClick={apply}>
            应用
          </Button>
        </>
      }
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="h-[52vh] w-full resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    </Modal>
  )
}

/**
 * 打印预览 Modal（丹青 §4.5）：.bd-desk 灰底 + PaperRenderer（与批B设计器同一渲染器），
 * 模板切换 / 缩放适应 / window.print；VOID 单据 45°「作废」水印进打印（§8 裁定）；
 * 失效字段黄条提示。打印容器 Portal 到 body（bizdoc.css @media print 隔离 .bd-print-root）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Printer, Star } from "lucide-react"
import { toast } from "sonner"
import { Modal } from "@/components/modal"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { PaperRenderer } from "@/components/bizdoc/paper-renderer"
import { paperSize, staleElementIds } from "@/components/bizdoc/model"
import { fetchPrintData, fetchPrintTpls, type BizDoc, type BizDocPrintTpl, type PrintData } from "./mock"

const MM_TO_PX = 96 / 25.4

export function PrintPreview({ doc, open, onClose }: { doc: BizDoc | null; open: boolean; onClose: () => void }) {
  const [tpls, setTpls] = useState<BizDocPrintTpl[]>([])
  const [tplId, setTplId] = useState<number | null>(null)
  const [printData, setPrintData] = useState<PrintData | null>(null)
  const [loading, setLoading] = useState(false)
  const deskRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [printing, setPrinting] = useState(false)

  const load = useCallback(
    async (id: number, tpl?: number) => {
      setLoading(true)
      try {
        const res = await fetchPrintData(id, tpl)
        setPrintData(res.data)
        setTplId(res.data.tpl.id)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "打印数据加载失败")
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!open || !doc) return
    setPrintData(null)
    void load(doc.id)
    void fetchPrintTpls(doc.defId).then((res) => setTpls(res.data))
  }, [open, doc, load])

  // 适应宽度缩放
  useLayoutEffect(() => {
    if (!printData || !deskRef.current) return
    const size = paperSize(printData.tpl.content.paper, printData.tpl.content.landscape)
    const paperPx = size.w * MM_TO_PX
    const avail = deskRef.current.clientWidth - 48
    setScale(avail >= paperPx ? 1 : Math.max(0.3, Math.round((avail / paperPx) * 20) / 20))
  }, [printData])

  const stale = printData ? staleElementIds(printData.tpl.content, { data: printData.data, fields: printData.fields }) : []

  const doPrint = () => {
    setPrinting(true)
    // Portal 打印容器渲染后触发系统打印
    window.setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 60)
  }

  const size = printData ? paperSize(printData.tpl.content.paper, printData.tpl.content.landscape) : null

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title={`打印预览${doc ? ` · ${doc.title}` : ""}`}
        description={doc?.docNo ?? undefined}
        width={900}
        footer={
          <>
            {tpls.length > 1 && (
              <Select
                value={tplId != null ? String(tplId) : undefined}
                onValueChange={(v) => doc && void load(doc.id, Number(v))}
              >
                <SelectTrigger size="sm" className="h-8 w-52 text-xs">
                  <SelectValue placeholder="选择模板" />
                </SelectTrigger>
                <SelectContent>
                  {tpls.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      <span className="flex items-center gap-1.5">
                        {t.isDefault && <Star className="size-3 text-amber-500" />}
                        {t.name}（{t.paper}
                        {t.landscape ? "·横" : ""}）
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
            <Button className="gap-1.5" disabled={loading || !printData} onClick={doPrint}>
              <Printer className="size-4" /> 打印
            </Button>
          </>
        }
      >
        {stale.length > 0 && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-4 shrink-0" />
            模板存在 {stale.length} 处失效字段绑定（输出空值），建议联系管理员更新模板。
          </div>
        )}
        <div ref={deskRef} className="bd-desk max-h-[70vh] rounded-md p-6">
          {loading || !printData ? (
            <Skeleton className="mx-auto aspect-[210/297] w-full max-w-[560px]" />
          ) : (
            <div
              className="mx-auto"
              style={
                size
                  ? { width: `${size.w * MM_TO_PX * scale}px`, height: `${size.h * MM_TO_PX * scale}px` }
                  : undefined
              }
            >
              <PaperRenderer
                tpl={printData.tpl.content}
                ctx={{ data: printData.data, fields: printData.fields }}
                voidWatermark={doc?.status === "VOID"}
                scale={scale}
              />
            </div>
          )}
        </div>
      </Modal>

      {/* 打印容器：Portal 到 body，@media print 只显示它（scale=1 原始尺寸） */}
      {printing &&
        printData &&
        createPortal(
          <div className="bd-print-root fixed left-[-200vw] top-0" aria-hidden>
            <style>{`@page { size: ${printData.tpl.content.paper} ${printData.tpl.content.landscape ? "landscape" : "portrait"}; margin: 0; }`}</style>
            <PaperRenderer
              tpl={printData.tpl.content}
              ctx={{ data: printData.data, fields: printData.fields }}
              voidWatermark={doc?.status === "VOID"}
            />
          </div>,
          document.body,
        )}
    </>
  )
}

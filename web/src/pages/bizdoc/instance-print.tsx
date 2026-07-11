/**
 * 「打印单据」入口（§11.3）：流程实例详情 / 公文办文单复用。
 * for-instance 拉可打印模板（无匹配 → 按钮不渲染）→ 选模板 → render-data →
 * PaperRenderer 渲染（同源红线）→ window.print（@page 由 buildPrintPageCss 生成）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Printer, Star } from "lucide-react"
import { toast } from "sonner"
import { Modal } from "@/components/modal"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PaperRenderer } from "@/components/bizdoc/paper-renderer"
import { paperSize } from "@/components/bizdoc/model"
import { buildPrintPageCss, isV2, pageSizeMm } from "@/components/bizdoc/model-v2"
import { fetchTplRenderData, fetchTplsForInstance, type BizDocTpl, type TplRenderData } from "./tpls"

const MM_TO_PX = 96 / 25.4

export interface InstancePrintProps {
  /** wf 实例 id（数字 id 或 procInstId，与后端 for-instance 口径一致） */
  instanceId: string | number
  /** mock 匹配提示（真实端点后端按实例算；FLOW 传 defCode / FORM 传 formCode） */
  defCode?: string
  formCode?: string
}

/** 打印单据按钮：拉到匹配模板才渲染（§11.3 无匹配隐藏） */
export function InstancePrintButton({ instanceId, defCode, formCode }: InstancePrintProps) {
  const [tpls, setTpls] = useState<BizDocTpl[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    void fetchTplsForInstance(instanceId, { defCode, formCode })
      .then((res) => alive && setTpls(res.data))
      .catch(() => alive && setTpls([]))
    return () => {
      alive = false
    }
  }, [instanceId, defCode, formCode])

  if (tpls.length === 0) return null
  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Printer className="size-3.5" /> 打印单据
      </Button>
      <InstancePrintDialog instanceId={instanceId} tpls={tpls} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function InstancePrintDialog({
  instanceId,
  tpls,
  open,
  onClose,
}: {
  instanceId: string | number
  tpls: BizDocTpl[]
  open: boolean
  onClose: () => void
}) {
  const [tplId, setTplId] = useState<number | null>(null)
  const [rd, setRd] = useState<TplRenderData | null>(null)
  const [loading, setLoading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const deskRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  const load = useCallback(
    async (id: number) => {
      setLoading(true)
      try {
        const res = await fetchTplRenderData(id, instanceId)
        setRd(res.data)
        setTplId(id)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "渲染数据加载失败")
      } finally {
        setLoading(false)
      }
    },
    [instanceId],
  )

  useEffect(() => {
    if (!open) return
    setRd(null)
    void load(tpls[0].id)
  }, [open, tpls, load])

  const sizeOf = (t: TplRenderData) =>
    isV2(t.tpl.content) ? pageSizeMm(t.tpl.content.page) : paperSize(t.tpl.content.paper, t.tpl.content.landscape)
  const size = rd ? sizeOf(rd) : null

  useLayoutEffect(() => {
    if (!rd || !deskRef.current) return
    const paperPx = (isV2(rd.tpl.content) ? pageSizeMm(rd.tpl.content.page) : paperSize(rd.tpl.content.paper, rd.tpl.content.landscape)).w * MM_TO_PX
    const avail = deskRef.current.clientWidth - 48
    setScale(avail >= paperPx ? 1 : Math.max(0.3, Math.round((avail / paperPx) * 20) / 20))
  }, [rd])

  const doPrint = () => {
    setPrinting(true)
    window.setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 60)
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title="打印单据"
        description={rd ? `${rd.tpl.name}（v${rd.tpl.version}）` : undefined}
        width={900}
        footer={
          <>
            {tpls.length > 1 && (
              <Select value={tplId != null ? String(tplId) : undefined} onValueChange={(v) => void load(Number(v))}>
                <SelectTrigger size="sm" className="h-8 w-56 text-xs">
                  <SelectValue placeholder="选择模板" />
                </SelectTrigger>
                <SelectContent>
                  {tpls.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      <span className="flex items-center gap-1.5">
                        <Star className="size-3 text-amber-500" />
                        {t.name}（v{t.version}）
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
            <Button className="gap-1.5" disabled={loading || !rd} onClick={doPrint}>
              <Printer className="size-4" /> 打印
            </Button>
          </>
        }
      >
        <div ref={deskRef} className="bd-desk max-h-[70vh] rounded-md p-6">
          {loading || !rd || !size ? (
            <Skeleton className="mx-auto aspect-[210/297] w-full max-w-[560px]" />
          ) : (
            <div className="mx-auto" style={{ width: `${size.w * MM_TO_PX * scale}px`, minHeight: `${size.h * MM_TO_PX * scale}px` }}>
              <PaperRenderer tpl={rd.tpl.content} ctx={{ data: rd.data, fields: rd.fields }} scale={scale} />
            </div>
          )}
        </div>
      </Modal>

      {/* 打印容器：Portal 到 body，@media print 只显示它 */}
      {printing &&
        rd &&
        createPortal(
          <div className="bd-print-root fixed left-[-200vw] top-0" aria-hidden>
            <style>{buildPrintPageCss(rd.tpl.content, rd.data)}</style>
            <PaperRenderer tpl={rd.tpl.content} ctx={{ data: rd.data, fields: rd.fields }} />
          </div>,
          document.body,
        )}
    </>
  )
}

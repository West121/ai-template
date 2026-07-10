/**
 * 工作流 P3 · 套打打印视图。
 *
 * 打印页无需新端点：用 GET instances/{id} 详情（表单快照 + timeline + seals）渲染
 * 套打视图（表单信息 + 审批记录表 + 电子章叠加 + 实例号），调 window.print() 由浏览器打印。
 *
 * 采用 visibility 打印样式：打印时仅 #wf-print-area 可见，其余隐藏，避免另开窗口丢失样式。
 */
import { createPortal } from "react-dom"
import { Printer, X } from "lucide-react"
import { AuthImg } from "@/components/auth-img"
import { Button } from "@/components/ui/button"
import {
  widgetKey,
  wfFormatTime,
  type FormSchema,
  type WfFormData,
  type WfTimelineItem,
} from "@/types/workflow"
import type { WfInstanceDetailP3, WfSeal } from "@/types/workflow-p3"

/* AuthImg 已抽到 @/components/auth-img 复用；此处再导出以兼容既有 `./wf-print` 引用 */
export { AuthImg } from "@/components/auth-img"

/* ---------------- 详情内的电子章条（叠加展示已用章） ---------------- */

export function SealStrip({ seals }: { seals?: WfSeal[] }) {
  if (!seals || seals.length === 0) return null
  return (
    <div className="flex flex-wrap gap-4 rounded-lg border bg-muted/20 p-3">
      {seals.map((seal, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <AuthImg
            src={seal.sealImageUrl}
            alt={`${seal.nodeName}电子章`}
            className="size-20 rounded-full object-contain mix-blend-multiply dark:mix-blend-normal"
          />
          <div className="text-center text-[11px] leading-tight text-muted-foreground">
            <div className="font-medium text-foreground">{seal.nodeName}</div>
            <div>{seal.userName}</div>
            {seal.time && <div>{wfFormatTime(seal.time)}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------------- 打印样式 ---------------- */

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #wf-print-area, #wf-print-area * { visibility: visible !important; }
  #wf-print-area { position: absolute !important; inset: 0 !important; margin: 0 !important; padding: 24px 32px !important; background: #fff !important; color: #000 !important; }
  .wf-print-toolbar { display: none !important; }
  @page { margin: 12mm; }
}
`

/* ---------------- 表单值格式化 ---------------- */

function formatValue(v: unknown): string {
  if (v == null || v === "") return "—"
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join("、")
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>
    if ("name" in obj) return String(obj.name)
    if ("label" in obj) return String(obj.label)
    return JSON.stringify(v)
  }
  if (typeof v === "boolean") return v ? "是" : "否"
  return String(v)
}

/** 从表单 schema + 数据抽取展示用键值行（跳过分割线/说明/布局类） */
function formRows(schema: FormSchema, data: WfFormData): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  const walk = (widgets: FormSchema["widgets"]) => {
    for (const w of widgets) {
      if (w.type === "divider" || w.type === "note") continue
      if (Array.isArray(w.children) && w.children.length > 0) {
        walk(w.children)
        continue
      }
      const key = widgetKey(w)
      rows.push({ label: w.label || key, value: formatValue(data[key]) })
    }
  }
  walk(schema.widgets)
  return rows
}

const ACTION_LABEL: Record<string, string> = {
  START: "发起",
  CREATE: "发起",
  SUBMIT: "发起",
  APPROVE: "同意",
  REJECT: "驳回",
  RESUBMIT: "重新提交",
  CANCEL: "撤销",
  TERMINATE: "终止",
  CC: "抄送",
  URGE: "催办",
  COMMENT: "意见",
}

/* ---------------- 套打视图 ---------------- */

export function WfPrintView({
  detail,
  schema,
  data,
  open,
  onClose,
}: {
  detail: WfInstanceDetailP3
  schema: FormSchema
  data: WfFormData
  open: boolean
  onClose: () => void
}) {
  if (!open) return null
  const rows = formRows(schema, data)
  const timeline: WfTimelineItem[] = detail.timeline ?? []
  const displayTime = detail.bizTime ?? detail.createdAt

  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-auto bg-black/40">
      <style>{PRINT_CSS}</style>
      {/* 工具栏（打印时隐藏） */}
      <div className="wf-print-toolbar sticky top-0 z-10 flex items-center justify-between border-b bg-card px-4 py-2 shadow-sm">
        <span className="text-sm font-medium">套打预览 · {detail.title}</span>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" onClick={() => window.print()}>
            <Printer className="size-3.5" /> 打印
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onClose}>
            <X className="size-3.5" /> 关闭
          </Button>
        </div>
      </div>

      {/* 打印区域 */}
      <div className="mx-auto my-6 max-w-3xl bg-white p-8 text-black shadow-lg print:my-0 print:shadow-none">
        <div id="wf-print-area">
          <div className="mb-1 text-center text-xl font-bold">{detail.defName}</div>
          <div className="mb-4 text-center text-sm text-gray-500">{detail.title}</div>

          <table className="mb-4 w-full border-collapse text-sm">
            <tbody>
              <tr>
                <td className="w-24 border border-gray-400 bg-gray-50 px-2 py-1 font-medium">实例号</td>
                <td className="border border-gray-400 px-2 py-1 font-mono">{detail.procInstId}</td>
                <td className="w-24 border border-gray-400 bg-gray-50 px-2 py-1 font-medium">发起人</td>
                <td className="border border-gray-400 px-2 py-1">{detail.initiatorName}</td>
              </tr>
              <tr>
                <td className="border border-gray-400 bg-gray-50 px-2 py-1 font-medium">
                  {detail.bizTime ? "业务日期" : "发起时间"}
                </td>
                <td className="border border-gray-400 px-2 py-1" colSpan={3}>
                  {wfFormatTime(displayTime)}
                  {detail.bizTime && <span className="ml-2 text-xs text-gray-500">（穿越时空补审）</span>}
                </td>
              </tr>
            </tbody>
          </table>

          {/* 表单信息 */}
          <div className="mb-1 border-l-4 border-gray-700 pl-2 text-sm font-bold">表单信息</div>
          <table className="mb-4 w-full border-collapse text-sm">
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="border border-gray-400 px-2 py-2 text-center text-gray-400">无表单数据</td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={i}>
                    <td className="w-32 border border-gray-400 bg-gray-50 px-2 py-1 font-medium">{r.label}</td>
                    <td className="border border-gray-400 px-2 py-1">{r.value}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* 审批记录 */}
          <div className="mb-1 border-l-4 border-gray-700 pl-2 text-sm font-bold">审批记录</div>
          <table className="mb-4 w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-gray-400 bg-gray-50 px-2 py-1 text-left">节点</th>
                <th className="border border-gray-400 bg-gray-50 px-2 py-1 text-left">处理人</th>
                <th className="border border-gray-400 bg-gray-50 px-2 py-1 text-left">动作</th>
                <th className="border border-gray-400 bg-gray-50 px-2 py-1 text-left">意见</th>
                <th className="border border-gray-400 bg-gray-50 px-2 py-1 text-left">时间</th>
              </tr>
            </thead>
            <tbody>
              {timeline.length === 0 ? (
                <tr>
                  <td className="border border-gray-400 px-2 py-2 text-center text-gray-400" colSpan={5}>
                    无审批记录
                  </td>
                </tr>
              ) : (
                timeline.map((t, i) => (
                  <tr key={i}>
                    <td className="border border-gray-400 px-2 py-1">{t.nodeName ?? "—"}</td>
                    <td className="border border-gray-400 px-2 py-1">{t.actorName ?? "系统"}</td>
                    <td className="border border-gray-400 px-2 py-1">{ACTION_LABEL[t.action] ?? t.action}</td>
                    <td className="border border-gray-400 px-2 py-1">{t.comment ?? ""}</td>
                    <td className="border border-gray-400 px-2 py-1">{wfFormatTime(t.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* 电子章 */}
          {detail.seals && detail.seals.length > 0 && (
            <>
              <div className="mb-1 border-l-4 border-gray-700 pl-2 text-sm font-bold">用章</div>
              <div className="flex flex-wrap gap-6 px-2 py-2">
                {detail.seals.map((seal, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <AuthImg
                      src={seal.sealImageUrl}
                      alt={`${seal.nodeName}电子章`}
                      className="size-24 object-contain mix-blend-multiply"
                    />
                    <div className="text-center text-[11px] text-gray-500">
                      <div>{seal.nodeName}</div>
                      <div>
                        {seal.userName} {seal.time ? wfFormatTime(seal.time) : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

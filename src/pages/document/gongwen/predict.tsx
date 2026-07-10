/**
 * 办文单流程预测：按钮 + 面板。
 *
 * 复用审批详情 wf-p3.tsx 的 `PredictChain`（节点链 + 预计办理人观感），走公文预测接口
 * `POST /api/office/doc/{id}/predict`（未就绪 → mock 演算，见 mock.ts predictDoc）。
 * 与流程图同属「流程」维度，放在办文单顶部操作区（刷新旁）。
 */
import { useCallback, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { ApiError, NetworkError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/modal"
import { PredictChain } from "@/pages/workflow/wf-p3"
import type { WfPredictResult } from "@/types/workflow-p3"
import { predictDoc } from "./mock"
import type { GwDoc } from "./types"

export function GwPredictButton({ doc }: { doc: GwDoc }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<WfPredictResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await predictDoc(doc)
      setResult(res.data)
    } catch (err) {
      if (err instanceof NetworkError) setError("后端未启动，无法预测")
      else if (err instanceof ApiError) setError(err.message || "预测接口尚未就绪")
      else setError("预测失败")
    } finally {
      setLoading(false)
    }
  }, [doc])

  const openPredict = () => {
    setOpen(true)
    void run()
  }

  return (
    <>
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={openPredict}>
        <Sparkles className="size-3.5" /> 流程预测
      </Button>

      {open && (
        <Modal
          open={open}
          onOpenChange={(o) => !o && setOpen(false)}
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> 流程预测
            </span>
          }
          description="按当前办文环节演算后续将经过的节点与预计办理人（不落库）"
          width={480}
          resizable={false}
          fullscreenable={false}
          footer={
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                关闭
              </Button>
              <Button className="gap-1.5" disabled={loading} onClick={() => void run()}>
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {result ? "重新预测" : "开始预测"}
              </Button>
            </>
          }
        >
          <div className="min-h-40">
            {loading && (
              <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                <Loader2 className="size-6 animate-spin" />
                <span className="text-sm">正在演算路径…</span>
              </div>
            )}
            {!loading && error && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                {error}
              </div>
            )}
            {!loading && result && (
              <>
                <PredictChain path={result.path} />
                {result.note && (
                  <p className="mt-2 rounded bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">{result.note}</p>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

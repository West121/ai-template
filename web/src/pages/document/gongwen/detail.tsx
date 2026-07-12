/**
 * 公文办文单详情（重构阶段 D）：**收发文共用一个 GongwenDetail**（direction 分流），套统一基座
 * `WorkflowDetailShell`——与审批一致风格，公文由此**自动获得**流程图全增强（节点办理信息 / 回放 /
 * 预测完整链路 / 连线高亮 / DINGTALK）。
 *
 * slot 填充（docs/design/workflow-detail-shell.md §4.2 + §2 重设计）：
 *  ① 头卡：标题 / 状态 / badges(文种·密级·紧急·红白头·文号·已用印) / actions(单据模板打印) / 刷新 + 流程预测(基座内建)
 *  ② 环节条：当前环节 + **[用印/签发/退回…]并入同框**（OpinionActionBar，不再孤立）
 *  ③ 信息区：**公文信息分组网格**（拟稿/文号/收发 + 附件），不再平铺散
 *  ④ Tabs：办理记录(ShellTimeline·DECISION_META) + 流程图(WorkflowFlowTrack·defCode·图内预测) + 正文 + [传阅单(收文)]
 *  ⑤ 底部：红头正文预览专区（GongwenPreview 自带区头 · 打印/PDF · GB/T 9704）
 */
import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { FileText, Users } from "lucide-react"
import { useAuthStore } from "@/stores/auth-store"
import { Card } from "@/components/ui/card"
import { RichTextViewer } from "@/components/rich-text"
import { GongwenPreview } from "@/components/gongwen/gongwen-preview"
import { InstancePrintButton } from "@/pages/bizdoc/instance-print"
import { WorkflowDetailShell, type ShellTab } from "@/pages/workflow/workflow-detail-shell"
import { fetchDoc, predictDoc, deriveHighlight } from "./mock"
import { statusMeta, DECISION_META, type GwDirection, type GwDoc } from "./types"
import { DocTypeBadge, SecretBadge, UrgencyBadge } from "./badges"
import { OpinionActionBar } from "./handling"
import { CirculationPanel } from "./circulation"
import { GongwenInfoGrid } from "./info-grid"
import { opinionsToTimeline } from "./adapters"
import { DemoBanner } from "./shared"

export function GongwenDetail({ direction }: { direction: GwDirection }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const isSend = direction === "SEND"

  const [doc, setDoc] = useState<GwDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setNotFound(false)
    try {
      const res = await fetchDoc(Number(id), direction)
      setDemo(res.demo)
      if (!res.data) setNotFound(true)
      else setDoc(res.data)
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id, direction])

  useEffect(() => {
    void load()
  }, [load, offline])

  const isPlain = doc?.headerType === "PLAIN"
  const sm = doc ? statusMeta(direction, doc.status) : undefined
  const showStage = !!doc && doc.status !== "ARCHIVED"

  /* ④ Tabs：正文（+ 收文传阅单） */
  const extraTabs: ShellTab[] = doc
    ? [
        ...(isSend
          ? []
          : [
              {
                key: "circulation",
                label: "传阅单",
                icon: <Users className="size-3.5" />,
                count: doc.circulations?.length,
                content: <CirculationPanel doc={doc} onUpdated={setDoc} />,
              } as ShellTab,
            ]),
        {
          key: "content",
          label: "正文",
          icon: <FileText className="size-3.5" />,
          content: doc.content ? (
            <RichTextViewer html={doc.content} className="mx-auto max-w-2xl text-sm leading-7" />
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">{isSend ? "暂无正文" : "暂无来文正文"}</div>
          ),
        },
      ]
    : []

  return (
    <>
      {demo && !loading && !notFound && (
        <div className="mb-4">
          <DemoBanner />
        </div>
      )}
      <WorkflowDetailShell
        title={doc?.title ?? ""}
        onBack={() => navigate(isSend ? "/document/send" : "/document/receive")}
        status={sm ? { label: sm.label, className: sm.className } : undefined}
        badges={
          doc && (
            <>
              <DocTypeBadge docType={doc.docType} />
              <SecretBadge secret={doc.secret} />
              <UrgencyBadge urgency={doc.urgency} />
              {isSend && (
                <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">{isPlain ? "白头文件" : "红头公文"}</span>
              )}
              <span className="font-mono text-xs text-muted-foreground">{isSend ? doc.code : doc.registerNo ?? doc.code}</span>
              {isSend && doc.sealStatus === "SEALED" && (
                <span className="text-xs text-violet-600 dark:text-violet-400">已用印</span>
              )}
            </>
          )
        }
        actions={doc?.processInstanceId ? <InstancePrintButton instanceId={doc.processInstanceId} defCode={isSend ? "gw_send" : "gw_recv"} /> : undefined}
        onRefresh={() => void load()}
        currentNode={showStage ? doc?.currentNode : undefined}
        currentAssignee={showStage ? doc?.currentAssignee : undefined}
        stageActions={doc ? <OpinionActionBar doc={doc} onUpdated={setDoc} /> : undefined}
        infoTitle={isSend ? "办文信息" : "来文信息"}
        info={doc ? <GongwenInfoGrid doc={doc} /> : null}
        flow={{
          source: { load: "defCode", defCode: isSend ? "gw_send" : "gw_recv" },
          timeline: opinionsToTimeline(doc?.opinions),
          timelineMeta: DECISION_META,
          highlight: doc ? doc.highlight ?? deriveHighlight(doc) : undefined,
          predict: doc ? { enabled: true, run: () => predictDoc(doc).then((r) => r.data) } : undefined,
        }}
        extraTabs={extraTabs}
        bottom={
          doc && (
            <Card className="overflow-hidden py-0">
              <GongwenPreview doc={doc} className="min-h-[720px]" />
            </Card>
          )
        }
        loading={loading}
        error={notFound ? "notfound" : null}
        onRetry={() => void load()}
      />
    </>
  )
}

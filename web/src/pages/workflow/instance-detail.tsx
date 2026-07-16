import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Bell, ExternalLink, FileCode2, MessagesSquare, Send, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { useAuthStore } from "@/stores/auth-store"
import { api, NetworkError } from "@/lib/api"
import { FormRenderer } from "@/components/form-renderer"
import { HostedForm } from "@/components/hosted-form"
import { fetchMineFieldPerms, intersectFieldPolicy, type MineFieldPerms } from "@/lib/field-perms"
import { buildFieldPolicyMap } from "@/components/field-perms-editor"
import { getForm, isCodeForm } from "@/lib/form-registry"
import { normalizeFormType } from "@/pages/workflow/designer/types"
import type { FieldPolicyMap } from "@/lib/form-manifest"
import "@/pages/workflow/forms" // 触发 CODE 表单登记（registerForm 副作用）
import { Modal } from "@/components/modal"
import { WfOpBar } from "@/components/wf-op-dialogs"
import { InstancePrintButton } from "@/pages/bizdoc/instance-print"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  parseFormData,
  parseFormSchema,
  WF_STATUS_META,
  wfFormatTime,
  type WfComment,
  type WfFormData,
} from "@/types/workflow"
import type { WfInstanceDetailP3, WfPredictResult } from "@/types/workflow-p3"
import { SubInstanceLinks, WfP3Bar } from "./wf-p3"
import { SealStrip } from "./wf-print"
import {
  ShellTimeline,
  WorkflowDetailShell,
  type ShellMetaItem,
  type WorkflowDetailShellProps,
} from "./workflow-detail-shell"

/* ================= 审批记录时间线 meta（传给基座 ShellTimeline / 通知 Tab） ================= */

const TIMELINE_META: Record<string, { label: string; dot: string }> = {
  START: { label: "发起申请", dot: "bg-blue-500" },
  CREATE: { label: "发起申请", dot: "bg-blue-500" },
  SUBMIT: { label: "发起申请", dot: "bg-blue-500" },
  APPROVE: { label: "同意", dot: "bg-emerald-500" },
  REJECT: { label: "驳回", dot: "bg-rose-500" },
  RESUBMIT: { label: "重新提交", dot: "bg-blue-500" },
  CANCEL: { label: "撤销申请", dot: "bg-gray-400" },
  TERMINATE: { label: "终止流程", dot: "bg-orange-500" },
  CC: { label: "抄送", dot: "bg-violet-500" },
  URGE: { label: "催办", dot: "bg-amber-500" },
  COMMENT: { label: "意见", dot: "bg-slate-400" },
  AI_APPROVE: { label: "AI 通过", dot: "bg-emerald-500" },
  AI_REJECT: { label: "AI 拒绝", dot: "bg-rose-500" },
}

/* ================= 沟通线程（评论 Tab） ================= */

function CommentThread({ items }: { items: WfComment[] }) {
  const { t } = useTranslation()
  if (items.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">{t("暂无沟通记录")}</div>
  }
  return (
    <div className="space-y-3 py-1">
      {items.map((item, index) => (
        <div key={index} className="rounded-lg border bg-muted/30 px-3 py-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{item.fromName ?? t("系统")}</span>
            <span>{wfFormatTime(item.createdAt)}</span>
          </div>
          <div className="mt-1 text-sm">{item.content}</div>
        </div>
      ))}
    </div>
  )
}

/* ================= 页面（套 WorkflowDetailShell 基座） ================= */

export default function WorkflowInstanceDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const userId = useAuthStore((s) => s.userId)

  const [detail, setDetail] = useState<WfInstanceDetailP3 | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 操作弹窗
  const [canceling, setCanceling] = useState(false)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      const data = await api<WfInstanceDetailP3>(`/api/wf/instances/${id}`)
      setDetail(data)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : t("加载失败"))
    } finally {
      setLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
  }, [load, offline])

  // 打开详情自动标记已阅（仅当有我的任务且未阅；后端未就绪时静默失败）
  useEffect(() => {
    if (!detail?.myTaskId || detail.readByMe) return
    void api(`/api/wf/tasks/${detail.myTaskId}/read`, { method: "POST" }).catch(() => {
      /* 已阅接口未就绪：忽略 */
    })
  }, [detail?.myTaskId, detail?.readByMe])

  const formSchema = useMemo(() => parseFormSchema(detail?.formSchema), [detail?.formSchema])
  const formData = useMemo(() => parseFormData(detail?.formData), [detail?.formData])
  // 通知：从流转记录中筛出抄送 / 催办等通知类事件
  const notifyItems = useMemo(
    () => (detail?.timeline ?? []).filter((it) => ["CC", "URGE"].includes(it.action ?? "")),
    [detail?.timeline],
  )
  // 时间线行为标记文案在渲染处翻译（数据 TIMELINE_META 保持原样，t 命中 zh-CN 时原样回退）
  const timelineMeta = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(TIMELINE_META).map(([k, v]) => [k, { ...v, label: t(v.label) }]),
      ),
    [t],
  )

  const isInitiator = detail != null && userId != null && detail.initiatorId === userId
  /** 被驳回到发起人：实例状态为 REJECTED 且我是发起人 → 表单可编辑 + 重新提交 */
  const resubmitMode = detail?.bizStatus === "REJECTED" && isInitiator
  const statusMeta = detail ? WF_STATUS_META[detail.bizStatus] : undefined

  /* ---------- 操作（留页面：业务态） ---------- */

  const doCancel = useCallback(async () => {
    if (!detail) return
    setActing(true)
    try {
      await api(`/api/wf/instances/${detail.id}/cancel`, { method: "POST" })
      toast.success(t("流程已撤销"))
      setCanceling(false)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("撤销失败"))
    } finally {
      setActing(false)
    }
  }, [detail, load, t])

  const doResubmit = useCallback(
    async (data: WfFormData) => {
      if (!detail) return
      setActing(true)
      try {
        await api(`/api/wf/instances/${detail.id}/resubmit`, { method: "POST", body: JSON.stringify({ formData: data }) })
        toast.success(t("已重新提交"))
        void load()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("提交失败"))
      } finally {
        setActing(false)
      }
    },
    [detail, load, t],
  )

  /* ---------- 派生（防御 detail 可空：基座 loading/error 态短路，不会读到） ---------- */

  const currentNodeNames = detail
    ? (detail.currentNodes ?? [])
        .map((n) => n.nodeName ?? n.nodeId)
        .filter(Boolean)
        .join("、")
    : ""
  // 可看完整链路预测：运行中(predictable) 或 已办结（/predict 返回全 done 链路）
  const canPredictChain =
    detail != null &&
    (!!detail.predictable || ["APPROVED", "REJECTED", "TERMINATED", "CANCELED", "CANCELLED"].includes(detail.bizStatus))

  // 角色级字段权限（P3）：mine 按 feature 缓存拉取，失败={}全放行；与节点级交集取更严
  const [mineFieldPerms, setMineFieldPerms] = useState<MineFieldPerms>({})
  useEffect(() => {
    let alive = true
    void fetchMineFieldPerms("WORKFLOW_TASKS").then((m) => {
      if (alive) setMineFieldPerms(m)
    })
    return () => {
      alive = false
    }
  }, [])

  // CODE 表单：registry 命中 → HostedForm；套 nodeFormPerms 合成的字段策略（只读查看）
  const codeFormKey = detail?.formKey && isCodeForm(detail.formKey) ? detail.formKey : undefined
  const codeFieldPolicy: FieldPolicyMap | undefined = (() => {
    if (!codeFormKey || !detail) return undefined
    const manifest = getForm(codeFormKey)?.manifest
    if (!manifest) return undefined
    const policy = buildFieldPolicyMap(manifest.fields, detail.nodeFormPerms)
    // 详情区为只读查看：强制不可编辑（可编辑填写→提交在办理动作里进行，见 wf-op-dialogs ApproveDialog）
    const view: FieldPolicyMap = {}
    for (const [k, p] of Object.entries(policy)) view[k] = { ...p, editable: false }
    // 角色级 × 节点级 交集更严（visible=两层都可见）
    return intersectFieldPolicy(view, mineFieldPerms)
  })()

  /* ---------- 基座 loading / error 归一 ---------- */

  const shellError: WorkflowDetailShellProps["error"] = loading
    ? null
    : loadError === "network"
      ? "network"
      : loadError
        ? loadError
        : detail
          ? null
          : "notfound"

  /* ---------- ③ 信息区（表单快照 + 电子章 + 子流程），整块进 info slot ---------- */

  const info = detail ? (
    <>
      {codeFormKey ? (
        <HostedForm formKey={codeFormKey} formData={formData} fieldPolicy={codeFieldPolicy} />
      ) : normalizeFormType(detail.formType) === "CODE" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 text-sm">
            <FileCode2 className="size-4 shrink-0 text-primary" />
            <span className="text-muted-foreground">{t("此流程使用自定义表单")}</span>
          </div>
          {detail.formViewPath ? (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(detail.formViewPath as string)}>
              <ExternalLink className="size-3.5" /> {t("查看自定义表单")}
            </Button>
          ) : (
            <div className="text-xs text-muted-foreground">{t("未配置查看页路径")}</div>
          )}
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">{t("表单数据（只读）")}</div>
            <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
              {JSON.stringify(formData, null, 2)}
            </pre>
          </div>
        </div>
      ) : formSchema.widgets.length === 0 ? (
        <div className="flex h-28 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          {t("暂无表单快照")}
        </div>
      ) : resubmitMode ? (
        <FormRenderer
          widgets={formSchema.widgets}
          initialValues={formData}
          submitting={acting}
          submitLabel={
            (
              <span className="flex items-center gap-1.5">
                <Send className="size-3.5" /> {t("重新提交")}
              </span>
            ) as unknown as string
          }
          onSubmit={doResubmit}
        />
      ) : (
        <FormRenderer widgets={formSchema.widgets} initialValues={formData} perms={detail.nodeFormPerms} readOnly />
      )}

      {/* 电子章展示（按节点盖章记录叠加） */}
      {detail.seals && detail.seals.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">{t("电子章")}</div>
          <SealStrip seals={detail.seals} />
        </div>
      )}

      {/* 子流程入口 */}
      {detail.subInstances && detail.subInstances.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">{t("子流程")}</div>
          <SubInstanceLinks subInstances={detail.subInstances} />
        </div>
      )}
    </>
  ) : null

  const meta: ShellMetaItem[] = detail
    ? [
        { label: t("流程"), value: detail.defName },
        { label: t("发起人"), value: detail.initiatorName },
        { label: t("发起时间"), value: wfFormatTime(detail.createdAt) },
        ...(detail.bizTime ? [{ label: t("业务时间"), value: t("{{time}}（穿越时空）", { time: wfFormatTime(detail.bizTime) }), tone: "warn" as const }] : []),
        ...(detail.endedAt ? [{ label: t("结束时间"), value: wfFormatTime(detail.endedAt) }] : []),
      ]
    : []

  return (
    <>
      <WorkflowDetailShell
        title={detail?.title ?? ""}
        onBack={() => navigate(-1)}
        status={detail ? { label: statusMeta?.label ? t(statusMeta.label) : detail.bizStatus, className: statusMeta?.className } : undefined}
        badges={
          resubmitMode ? (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
              {t("已驳回至发起人，可修改后重新提交")}
            </Badge>
          ) : undefined
        }
        meta={meta}
        actions={
          detail && (
            <>
              {/* §11 单据模板打印入口（有匹配已发布模板才显示） + P3 打印/唤醒 + 撤销 */}
              <InstancePrintButton instanceId={detail.id} defCode={detail.defCode} />
              <WfP3Bar detail={detail} schema={formSchema} data={formData} onReload={() => void load()} />
              {detail.canCancel && isInitiator && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCanceling(true)}>
                  <Undo2 className="size-3.5" /> {t("撤销")}
                </Button>
              )}
            </>
          )
        }
        onRefresh={() => void load()}
        currentNode={currentNodeNames || undefined}
        stageActions={detail ? <WfOpBar detail={detail} onReload={() => void load()} /> : undefined}
        infoTitle={t("表单信息")}
        info={info}
        flow={{
          source: { load: "inline", designerType: detail?.designerType, designerJson: detail?.designerJson, bpmnXml: detail?.bpmnXml },
          timeline: detail?.timeline ?? [],
          timelineMeta,
          highlight: detail?.highlight,
          currentNodes: detail?.currentNodes,
          predict:
            detail && canPredictChain
              ? { enabled: true, run: () => api<WfPredictResult>(`/api/wf/instances/${detail.id}/predict`, { method: "POST" }) }
              : undefined,
        }}
        optionalTabs={
          detail
            ? [
                {
                  key: "comments",
                  label: t("评论"),
                  icon: <MessagesSquare className="size-3.5" />,
                  count: detail.comments?.length,
                  content: <CommentThread items={detail.comments ?? []} />,
                },
                {
                  key: "notify",
                  label: t("通知"),
                  icon: <Bell className="size-3.5" />,
                  count: notifyItems.length,
                  content:
                    notifyItems.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">{t("暂无通知记录")}</div>
                    ) : (
                      <ShellTimeline items={notifyItems} meta={timelineMeta} />
                    ),
                },
              ]
            : []
        }
        loading={loading}
        error={shellError}
        onRetry={() => void load()}
      />

      {/* 撤销确认（业务态留页面） */}
      {detail && (
        <Modal
          open={canceling}
          onOpenChange={(open) => !open && !acting && setCanceling(false)}
          title={t("撤销流程")}
          description={detail.title}
          width={420}
          resizable={false}
          fullscreenable={false}
          footer={
            <>
              <Button variant="outline" onClick={() => setCanceling(false)} disabled={acting}>
                {t("取消")}
              </Button>
              <Button variant="destructive" onClick={() => void doCancel()} disabled={acting}>
                {acting ? t("撤销中…") : t("确认撤销")}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">{t("撤销后流程立即终止，状态记为「已撤销」。确定要撤销这条申请吗？")}</p>
        </Modal>
      )}
    </>
  )
}

/**
 * WorkflowDetailShell · 审批/公文统一详情基座（重构阶段 B，docs/design/workflow-detail-shell.md §1-3 + 附拍板）。
 *
 * **数据模型无关（红线）**：基座只吃归一化 props + 渲染插槽，**不认识** WfInstanceDetailP3 / GwDoc；
 * 两边各写适配层把自己的模型填进 6 个 slot。所有"带流程的业务详情"（审批 / 公文 / 单据 / 请假 / 报销…）
 * 都套这个基座，流程图增强（节点办理信息 / 回放 / 预测完整链路 / 连线高亮 / DINGTALK）由基座统一承载。
 *
 * 五段骨架（自上而下）：
 *   ① 头卡：[←] 标题 [状态徽标] 《badges》 ‖ 《actions》[流程预测][刷新] + 元信息行
 *   ② 当前环节条：当前节点 · 当前办理人 —— 《stageActions 办理动作》（内建结构，动作插同框）
 *   ③ 信息区：《info》（标准卡壳 + 可选标题）
 *   ④ Tabs：办理记录(内建 ShellTimeline) ‖ 流程图(内建 WorkflowFlowTrack) ‖《extraTabs》‖《optionalTabs》
 *   ⑤ 底部：《bottom》
 * 统一 loading / error（network 离线卡 / notfound 不存在卡），消除两边重复。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 适配示例（TS，本阶段不接入；C=审批、D=公文）：
 *
 *  审批（instance-detail）：
 *    <WorkflowDetailShell
 *      title={detail.title} onBack={() => navigate(-1)}
 *      status={{ label: statusMeta.label, className: statusMeta.className }}
 *      meta={[{ label:"流程", value:detail.defName }, { label:"当前节点", value:names, tone:"strong" }]}
 *      actions={<><InstancePrintButton .../><WfP3Bar .../>{cancelBtn}</>}
 *      onRefresh={load}
 *      currentNode={currentNodeNames} stageActions={<WfOpBar detail={detail} onReload={load}/>}
 *      infoTitle="表单信息" info={<FormRenderer .../> + SealStrip + SubInstanceLinks}
 *      flow={{ source:{load:"inline",designerType:detail.designerType,designerJson:detail.designerJson,bpmnXml:detail.bpmnXml},
 *              timeline:detail.timeline, timelineMeta:TIMELINE_META, highlight:detail.highlight,
 *              currentNodes:detail.currentNodes,
 *              predict: canPredict ? { enabled:true, run:()=>api(`/api/wf/instances/${id}/predict`,{method:"POST"}) } : undefined }}
 *      optionalTabs={[{ key:"comments", label:"评论", content:<CommentThread .../> }, { key:"notify", ... }]}
 *      loading={loading} error={loadError} onRetry={load} />
 *
 *  公文（send-detail / receive-detail）：
 *    <WorkflowDetailShell
 *      title={doc.title} onBack={() => navigate("/document/send")}
 *      status={{ label: GW_SEND_STATUS[doc.status].label, className: GW_SEND_STATUS[doc.status].className }}
 *      badges={<><DocTypeBadge/><SecretBadge/>…{doc.code}</>} actions={<InstancePrintButton .../>} onRefresh={load}
 *      currentNode={doc.currentNode} currentAssignee={doc.currentAssignee} stageActions={<OpinionActionBar .../>}
 *      infoTitle="办文信息" info={<GongwenInfoGrid doc={doc}/>}
 *      flow={{ source:{load:"defCode",defCode: doc.direction==="SEND"?"gw_send":"gw_recv"},
 *              timeline: opinionsToTimeline(doc.opinions), timelineMeta: DECISION_META,
 *              highlight: doc.highlight, currentNodes:[{nodeId:doc.currentNodeId, nodeName:doc.currentNode}],
 *              predict:{ enabled:true, run:()=>predictDoc(doc).then(r=>r.data) } }}
 *      extraTabs={[{ key:"content", label:"正文", content:<RichTextViewer html={doc.content}/> }]}
 *      bottom={<GongwenPreviewSection doc={doc}/>} loading={loading} error={notFound?"notfound":null} onRetry={load} />
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState, type ReactNode } from "react"
import { ArrowLeft, CloudOff, GitBranch, History, RotateCw, Sparkles, ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RichTextViewer } from "@/components/rich-text"
import { wfFormatTime, type WfHighlight, type WfTimelineItem } from "@/types/workflow"
import {
  WorkflowFlowTrack,
  type WorkflowFlowPredict,
  type WorkflowFlowSource,
} from "./designer/flow/workflow-flow-track"

/* ============================ 契约（§3） ============================ */

/** 头卡元信息一项 */
export interface ShellMetaItem {
  label: string
  value: ReactNode
  /** 强调色（如"当前节点""业务时间"） */
  tone?: "default" | "strong" | "warn"
}

/** 状态徽标（label + className，复用 WF_STATUS_META / 公文 badges 的类名口径） */
export interface ShellStatus {
  label: string
  className?: string
}

/** 时间线行为标记 → 圆点色 + 文案（收敛审批 TIMELINE_META / 公文 DECISION_META） */
export type ShellTimelineMeta = Record<string, { label: string; dot: string }>

/** 流程图数据源（= 阶段 A WorkflowFlowSource：inline designerJson/bpmnXml；defCode 拉最新模型） */
export type ShellFlowSource = WorkflowFlowSource
/** 图内预测配置（= 阶段 A WorkflowFlowPredict：端点用 run 回调解耦） */
export type ShellPredict = WorkflowFlowPredict

/** 基座内建"办理记录 + 流程图"所需的流程数据（一处传，nodeInfo/replay 由 WorkflowFlowTrack 内部 build） */
export interface ShellFlow {
  source: ShellFlowSource
  /** 归一化时间线（内建办理记录 + 流程图 nodeInfo/replay 共用） */
  timeline: WfTimelineItem[]
  timelineMeta: ShellTimelineMeta
  highlight?: WfHighlight
  currentNodes?: { nodeId?: string; nodeName?: string }[]
  predict?: ShellPredict
}

export interface ShellTab {
  key: string
  label: ReactNode
  icon?: ReactNode
  count?: number
  content: ReactNode
}

export interface WorkflowDetailShellProps {
  /* ① 头卡 */
  title: ReactNode
  onBack: () => void
  status?: ShellStatus
  /** 业务标签 slot（公文：文种/密级/紧急/红白头/文号/已用印；审批：可空或"可重提"） */
  badges?: ReactNode
  meta?: ShellMetaItem[]
  /** 业务额外动作（打印/自定义）；流程预测键与刷新由基座内建 */
  actions?: ReactNode
  onRefresh?: () => void

  /* ② 当前环节条 */
  currentNode?: string | null
  currentAssignee?: string | null
  /** 办理动作区（审批 WfOpBar/P3Bar；公文 OpinionActionBar），并入环节条同框 */
  stageActions?: ReactNode

  /* ③ 信息区 */
  infoTitle?: ReactNode
  info?: ReactNode

  /* ④ Tabs */
  flow: ShellFlow
  /** 业务 Tab（公文正文等），排在 办理记录、流程图 之后 */
  extraTabs?: ShellTab[]
  /** 选配 Tab（审批评论/通知），机制同 extraTabs，语义单列 */
  optionalTabs?: ShellTab[]
  /** 覆盖内建办理记录（逃生口；默认用内建通用时间线） */
  timelineSlot?: ReactNode

  /* ⑤ 底部扩展 */
  bottom?: ReactNode

  /* 状态：加载 / 错误（基座统一 Skeleton / 离线卡 / 不存在卡） */
  loading?: boolean
  error?: "network" | "notfound" | (string & {}) | null
  onRetry?: () => void
}

/* ============================ 复用件：ShellField / ShellTimeline ============================ */

/** 信息区 label-value 字段（§2.2 分组网格用；空值 —，长文本 truncate+title） */
export function ShellField({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm" title={typeof value === "string" ? value : undefined}>
        {value === "" || value == null ? "—" : value}
      </div>
    </div>
  )
}

/**
 * 通用办理记录时间线（合并审批 Timeline + 公文 OpinionTimeline）：参数化 `meta` + 内建当前环节脉冲行。
 * 意见富文本走 RichTextViewer（统一 sanitize 出口）。current 由基座据 currentNode/currentAssignee 生成。
 */
export function ShellTimeline({
  items,
  meta,
  current,
}: {
  items: WfTimelineItem[]
  meta: ShellTimelineMeta
  current?: { node?: string | null; assignee?: string | null }
}) {
  const hasCurrent = !!current?.node
  if (items.length === 0 && !hasCurrent) {
    return <div className="py-6 text-center text-sm text-muted-foreground">暂无流转记录</div>
  }
  return (
    <div className="space-y-0 py-1">
      {items.map((item, index) => {
        const m = meta[item.action] ?? { label: item.action, dot: "bg-muted-foreground/30" }
        const showLine = index < items.length - 1 || hasCurrent
        return (
          <div key={index} className="relative flex gap-3 pb-6 last:pb-0">
            {showLine && <div className="absolute left-[5px] top-4 h-full w-px bg-border" />}
            <div className={cn("mt-1 size-[11px] shrink-0 rounded-full", m.dot)} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{m.label}</span>
                {item.nodeName && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground">
                    {item.nodeName}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {item.actorName ?? "系统"} · {wfFormatTime(item.createdAt)}
              </div>
              {item.comment && (
                <div className="mt-1 rounded bg-muted/60 px-2 py-1">
                  <RichTextViewer html={item.comment} className="text-xs" />
                </div>
              )}
            </div>
          </div>
        )
      })}
      {/* 当前环节脉冲行（进行中） */}
      {hasCurrent && (
        <div className="relative flex gap-3 pb-0">
          <div className="mt-1 size-[11px] shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-primary">进行中</span>
              <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal text-primary">
                {current!.node}
              </Badge>
            </div>
            {current?.assignee && <div className="mt-0.5 text-xs text-muted-foreground">{current.assignee} · 办理中</div>}
          </div>
        </div>
      )}
    </div>
  )
}

/* ============================ 加载 / 错误（统一） ============================ */

function ShellLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  )
}

function ShellError({ error, onBack, onRetry }: { error: string; onBack: () => void; onRetry?: () => void }) {
  const isNetwork = error === "network"
  const isNotFound = error === "notfound"
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <div className={cn("flex size-12 items-center justify-center rounded-full", isNetwork ? "bg-muted" : "")}>
          {isNetwork ? <CloudOff className="size-5 text-muted-foreground" /> : <ShieldAlert className="size-8 text-rose-500/60" />}
        </div>
        <div className="text-sm font-medium">
          {isNetwork ? "后端服务未启动" : isNotFound ? "记录不存在或已删除" : error}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onBack}>
            <ArrowLeft className="size-3.5" /> 返回
          </Button>
          {onRetry && (
            <Button size="sm" className="gap-1.5" onClick={onRetry}>
              <RotateCw className="size-3.5" /> 重试
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/* ============================ 基座主体 ============================ */

export function WorkflowDetailShell(p: WorkflowDetailShellProps) {
  const [tab, setTab] = useState("timeline")

  if (p.loading) return <ShellLoading />
  if (p.error) return <ShellError error={p.error} onBack={p.onBack} onRetry={p.onRetry} />

  const showStage = !!(p.currentNode || p.currentAssignee || p.stageActions)

  return (
    <div className="space-y-4">
      {/* ① 头卡 */}
      <Card className="py-4">
        <CardContent className="space-y-3 px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="返回" onClick={p.onBack}>
                <ArrowLeft className="size-4.5" />
              </Button>
              <h1 className="truncate text-base font-semibold">{p.title}</h1>
              {p.status && (
                <Badge variant="outline" className={p.status.className}>
                  {p.status.label}
                </Badge>
              )}
              {p.badges}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {p.actions}
              {/* 流程预测键（内建）：点击切到流程图 Tab 走图内连线预测（非独立弹窗） */}
              {p.flow.predict?.enabled && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setTab("flow")}>
                  <Sparkles className="size-3.5" /> 流程预测
                </Button>
              )}
              {p.onRefresh && (
                <Button variant="ghost" size="icon" className="size-8" title="刷新" onClick={p.onRefresh}>
                  <RotateCw className="size-4" />
                </Button>
              )}
            </div>
          </div>
          {p.meta && p.meta.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-10 text-xs text-muted-foreground">
              {p.meta.map((m, i) => (
                <span
                  key={i}
                  className={cn(m.tone === "strong" && "font-medium text-foreground/75", m.tone === "warn" && "text-amber-600 dark:text-amber-400")}
                >
                  {m.label}：{m.value}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ② 当前环节条（终态无环节且无动作 → 不渲染） */}
      {showStage && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          {(p.currentNode || p.currentAssignee) && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              {p.currentNode && (
                <span>
                  <span className="text-muted-foreground">当前环节</span> <span className="font-medium">{p.currentNode}</span>
                </span>
              )}
              {p.currentAssignee && (
                <span>
                  <span className="text-muted-foreground">当前办理人</span> <span className="font-medium">{p.currentAssignee}</span>
                </span>
              )}
            </div>
          )}
          {p.stageActions && (
            <>
              {(p.currentNode || p.currentAssignee) && <div className="my-2.5 border-t border-primary/10" />}
              <div className="empty:hidden">{p.stageActions}</div>
            </>
          )}
        </div>
      )}

      {/* ③ 信息区 */}
      {p.info && (
        <Card>
          {p.infoTitle && (
            <CardHeader className="pb-0">
              <CardTitle className="text-sm">{p.infoTitle}</CardTitle>
            </CardHeader>
          )}
          <CardContent>{p.info}</CardContent>
        </Card>
      )}

      {/* ④ Tabs：办理记录(内建) ‖ 流程图(内建) ‖ extraTabs ‖ optionalTabs */}
      <Card className="gap-0 py-0">
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-wrap items-center gap-2 border-b px-4 pt-3">
            <TabsList>
              <TabsTrigger value="timeline" className="gap-1.5">
                <History className="size-3.5" /> 办理记录
                {p.flow.timeline.length > 0 && <span className="text-xs text-muted-foreground">({p.flow.timeline.length})</span>}
              </TabsTrigger>
              <TabsTrigger value="flow" className="gap-1.5">
                <GitBranch className="size-3.5 text-primary" /> 流程图
                <span className="hidden text-[10px] text-muted-foreground sm:inline">· 回放 / 预测</span>
              </TabsTrigger>
              {p.extraTabs?.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                  {t.icon} {t.label}
                  {t.count != null && t.count > 0 && <span className="text-xs text-muted-foreground">({t.count})</span>}
                </TabsTrigger>
              ))}
              {p.optionalTabs?.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                  {t.icon} {t.label}
                  {t.count != null && t.count > 0 && <span className="text-xs text-muted-foreground">({t.count})</span>}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="timeline" className="m-0 px-5 py-4">
            {p.timelineSlot ?? (
              <ShellTimeline
                items={p.flow.timeline}
                meta={p.flow.timelineMeta}
                current={{ node: p.currentNode, assignee: p.currentAssignee }}
              />
            )}
          </TabsContent>
          <TabsContent value="flow" className="m-0 p-4">
            <WorkflowFlowTrack
              source={p.flow.source}
              timeline={p.flow.timeline}
              highlight={p.flow.highlight}
              currentNodes={p.flow.currentNodes}
              predict={p.flow.predict}
            />
          </TabsContent>
          {p.extraTabs?.map((t) => (
            <TabsContent key={t.key} value={t.key} className="m-0 px-5 py-4">
              {t.content}
            </TabsContent>
          ))}
          {p.optionalTabs?.map((t) => (
            <TabsContent key={t.key} value={t.key} className="m-0 px-5 py-4">
              {t.content}
            </TabsContent>
          ))}
        </Tabs>
      </Card>

      {/* ⑤ 底部扩展（公文红头预览专区等） */}
      {p.bottom}
    </div>
  )
}

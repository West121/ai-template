# WorkflowDetailShell · 审批/公文统一详情基座(丹青)

> 架构级设计(用户要求)。目标:把审批详情 `web/src/pages/workflow/instance-detail.tsx`(727 行)与
> 公文办文单 `web/src/pages/document/send-detail.tsx`+`receive-detail.tsx`+`gongwen/handling.tsx`
> 收敛到**一个共享基座 `WorkflowDetailShell` + 业务插槽**。审批刚做的流程图增强(节点办理信息 /
> 回放 / 预测连线 / 完整链路 / DINGTALK 跟踪)由基座统一承载,**公文接上基座即自动获得**,以后所有
> "带流程的业务详情"(单据 BizDoc、请假、报销…)都套这个基座。
>
> 用户原话:"保持一致风格,只是多一个正文,不要完全单独;审批改的东西公文里都要有;公文布局有点乱,
> 重新设计。" 本文只出设计与迁移 checklist,**不改代码、不 commit**。

---

## 0. 现状对照(先看清两边长什么样)

### 0.1 审批 `instance-detail.tsx`(增强完备,当基座蓝本)

| 区 | 内容 |
|---|---|
| 顶部卡 | 返回 + 标题 + 状态徽标 ‖ 打印(InstancePrintButton)+ P3Bar(加签/并签/转办…)+ 撤销 + 刷新 ; 元信息行(流程/发起人/时间/当前节点) ; **办理动作条 WfOpBar**(同意/驳回/…) |
| 表单信息卡(全宽) | FormRenderer / HostedForm(CODE)/ 只读快照 ; 电子章 SealStrip ; 子流程 SubInstanceLinks ; 驳回可改重提 |
| Tabs 卡 | 审批记录(Timeline)‖ **流程图(全增强)** ‖ 评论 ‖ 通知 |
| 流程图增强 | FlowTrack:FlowViewer + `nodeInfo`(节点办理信息浮层)+ `replaySteps`(回放)+ **在图内预测**(useTrackPredict→蓝虚线连线)+ 全屏 ; DINGTALK→DingtalkTrackHost |

### 0.2 公文 `send-detail.tsx` / `receive-detail.tsx`(滞后,要重构)

| 区 | 内容 | 与审批差距 |
|---|---|---|
| 办文信息卡 | 返回+标题+一排 badges(文种/密级/紧急/红白头/文号/状态/已用印)+ 打印 + **GwPredictButton(旧式弹窗)** + 刷新 ; 当前环节条(独立 primary/5 块) ; **OpinionActionBar**(提交/同意/退回/转办/签发/用印/归档) ; 次要项 dl 网格(拟稿人/签发人/成文日期/发文机关/主送/抄送/份号/附注) ; 附件 | 预测是**独立旧弹窗**,非图内连线 |
| Tabs 卡 | 办理记录(OpinionTimeline)‖ 正文(HTML)‖ **流程图(DocFlowTrack)** | **DocFlowTrack 只有 FlowViewer+highlight**——无节点办理信息 / 无回放 / 无图内预测 / 无全屏 |
| 红头预览卡 | GongwenPreview(GB/T 9704 红头正文,全宽) | 审批无此区(公文独有) |

**独立实现清单(要删/要共用)**:
- `gongwen/flow-track.tsx`(DocFlowTrack)→ **删**,改用共享增强 FlowTrack。
- `gongwen/predict.tsx`(GwPredictButton 旧弹窗)→ **删**,预测并入图内(共享 useTrackPredict,只换端点)。
- `gongwen/handling.tsx` 的 `OpinionTimeline`/`OpinionActionBar`→ **保留为公文业务插槽**(填进基座对应 slot)。

### 0.3 已经是共享/可共享的基建(基座直接吃)

| 资产 | 位置 | 说明 |
|---|---|---|
| FlowViewer | `pages/workflow/designer/flow/flow-viewer.tsx` | 只读流程图,已支持 highlight/nodeInfo/replay/predict |
| buildNodeInfo / buildReplaySteps | `pages/workflow/designer/flow/runtime-info.ts` | **已抽出**,纯函数,吃 `WfTimelineItem[]` |
| DingtalkTrackHost / FlowTrack / useTrackPredict | 目前**内联在** `instance-detail.tsx`(L75-226 等) | **需抽到共享文件**,基座调用 |
| InstancePrintButton | `pages/bizdoc/instance-print.tsx` | 两边已在用 |
| PredictChain | `pages/workflow/wf-p3.tsx` | 预测节点链视图 |
| WF_STATUS_META / 公文 badges | `types/workflow.ts` / `gongwen/badges.tsx` | 状态与业务徽标 |

---

## 1. 抽象:通用骨架 + 业务插槽

基座**不认识** `WfInstanceDetailP3` 或 `GwDoc`——两边数据模型/接口都不同。基座只吃**归一化 props +
渲染插槽**,各页把自己的模型适配进来。这是复用能成立的关键。

### 1.1 五段骨架(自上而下,对齐主控清单)

```
┌─ WorkflowDetailShell ────────────────────────────────────────┐
│ ① 顶部头卡                                                     │
│   [←] 标题  [状态徽标]  《badgesSlot 业务标签》   《actionsSlot 业务动作》[刷新]│
│   元信息行(metaSlot / meta[])                                 │
│ ─────────────────────────────────────────────────────────── │
│ ② 当前环节条(currentNode / currentAssignee) —— 基座内建     │
│   《stageActionsSlot 办理动作区》  ← 审批=WfOpBar/P3 ; 公文=用印/签发/退回│
│ ─────────────────────────────────────────────────────────── │
│ ③ 《infoSlot 信息区》 ← 审批=表单快照卡 ; 公文=文号/拟稿网格+附件│
│                                                               │
│ ④ Tabs 卡(基座内建 Tabs 容器)                               │
│    办理记录(内建) ‖ 流程图(内建·全增强) ‖《extraTabs 业务Tab》‖(评论/通知 选配)│
│                                                               │
│ ⑤ 《bottomSlot 底部扩展》 ← 公文=红头正文预览(专门区)        │
└───────────────────────────────────────────────────────────────┘
```

### 1.2 哪些是"内建共用",哪些是"业务插槽"

| 区 | 内建(基座实现,两边共享) | 插槽(业务各填) |
|---|---|---|
| ① 头卡 | 返回/标题/状态徽标框位、刷新键、打印键位、**流程预测键**(共用) | `badges`(业务标签)、`actions`(额外业务动作) |
| ② 环节条 | 当前环节 + 当前办理人 的展示与配色 | `stageActions`(办理动作区,派生按钮各自实现) |
| ③ 信息区 | 标准卡容器 + 标题 | `info`(整块内容:表单快照 / 元数据网格) |
| ④ Tabs | Tabs 外壳、**办理记录**(内建通用时间线)、**流程图**(内建增强 FlowTrack)、评论/通知(选配) | `extraTabs`(如公文正文) |
| ⑤ 底部 | 无 | `bottom`(公文红头预览) |

**关键决策**:
1. **流程预测收进头卡内建**——两边都要,统一放头卡右侧动作区(键位一致),点击后走**图内连线预测**
   (不再是公文那种独立弹窗)。预测端点不同 → 基座吃 `predict` 配置(见 §3)。
2. **流程图 = 唯一增强出口**——基座内建的 FlowTrack 承载 nodeInfo/replay/predict/全屏/DINGTALK,
   公文删自己的 DocFlowTrack,自动获得全部增强。这是本次重构的核心收益。
3. **办理记录 = 内建通用时间线**(参数化 meta 映射 + 当前环节脉冲),吃归一化 `timeline`;
   审批的 `TIMELINE_META` 与公文的 `DECISION_META` 收敛为传入的 `timelineMeta` prop。
   (低风险逃生口:`timelineSlot` 可整块覆盖,先迁移后统一。)

---

## 2. 公文布局重设计(解决截图三宗罪)

截图问题:**用印按钮孤立**(飘在 badges 和网格之间)、**信息区平铺散**(8 项 dl 一把铺开无层次)、
**Tab 与红头预览割裂**(底部预览像块掉队的卡)。重设计对应基座五段:

### 2.1 用印/签发 → 并入②当前环节条(不再孤立)

办文动作(用印/签发/退回/转办/办结/归档)属于"对当前环节的处置",视觉上必须**紧贴当前环节条**,
成为一个决策组。基座②内建结构:

```
┌ 当前环节条(border-primary/20 bg-primary/5 rounded-lg px-4 py-3) ─────────┐
│ 当前环节  用印    ·    当前办理人  张主任                                  │
│ ─────────────────────────────(细分隔 border-primary/10)────────────────  │
│ [🔖 用印]  [↩ 退回]              ← stageActionsSlot,与环节同框、右对齐或左起 │
└──────────────────────────────────────────────────────────────────────────┘
```
- 办理动作**进环节条内**(同一 `bg-primary/5` 卡,顶部信息行 + 底部动作行,中间发丝分隔),
  用印不再游离。终态(已归档/办结)环节条隐藏,动作为空自然不渲染。
- 审批侧同理:WfOpBar 进这个环节条内,视觉与公文一致。

### 2.2 信息区 → 分组网格(拟稿 / 文号 / 收发),不再平铺

`infoSlot` 里把 8+ 项按语义**分组**,每组一个小标题,组内 `Field`(label 灰 + value)网格。审批的
`Field` 样式(`send-detail` 已有)沿用,统一到基座导出的 `<ShellField>`:

```
信息区卡(或并入头卡下半区)
  ┌ 拟稿信息 ────────────────────────────────┐
  │ 拟稿人  李明     签发人  王总    成文日期 2026-07-10 │
  ├ 文号信息 ────────────────────────────────┤
  │ 发文机关 星辰科技…  文号 星辰办〔2026〕15号  份号 000123 │
  ├ 收发信息 ────────────────────────────────┤
  │ 主送  各部门        抄送  工会、财务         │
  └ 附注 (此件公开发布) ─────────────────────┘
  ── 附件(2) ──  [📎 预算表.xlsx] [📎 附图.pdf]
```
- 分组小标题 `text-xs font-medium text-muted-foreground mb-2`;组间 `border-t pt-3`。
- 网格 `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-3`(现状网格保留,只是**加分组**)。
- 空值 `—`;长文本 `truncate` + `title`。这块作为公文的 `infoSlot` 传入,基座只给标准卡壳。

> 放头卡里还是独立卡?**独立信息卡**(与审批"表单信息卡"同层级)——头卡只保留标题/徽标/环节/动作,
> 让头卡轻,信息归信息卡,层次立刻清楚。

### 2.3 正文进 Tab,红头预览升为"专门区"(不再像掉队卡)

- **正文**:作为 `extraTabs` 一项(图标 `FileText`),与"办理记录/流程图"并列。正文 HTML 走
  `RichTextViewer`(统一 sanitize 出口),不再散写 `dangerouslySetInnerHTML`。
- **红头预览**:`bottomSlot`,但给它**正式的区头**,读起来是"最终成文版式"专区而非零散卡:
  ```
  ┌ 卡 header(border-b px-4 py-2.5) ─────────────────────────────┐
  │ 🗎 红头正文预览        [A4] [缩放 100%]        [🖨 打印] [⬇ PDF] │
  ├──────────────────────────────────────────────────────────────┤
  │            (灰底桌面 · A4 红头版式居中,min-h-[720px])          │
  └──────────────────────────────────────────────────────────────┘
  ```
  区头把打印/缩放收进来(现状打印键在顶部飘着),预览成为自洽的一块。`GongwenPreview` 主体不变。

### 2.4 重设计后的公文详情骨架(套基座)

```
① 头卡:← 标题 [文种][密级][紧急][红头][文号][状态][已用印]   [打印][流程预测][刷新]
② 环节条:当前环节 用印 · 办理人 张主任 —— [用印][退回]
③ 信息卡:拟稿信息 / 文号信息 / 收发信息 / 附注 / 附件(分组网格)
④ Tabs:办理记录 ‖ 流程图(全增强)‖ 正文
⑤ 底部:红头正文预览(带区头:打印/缩放)
```
比现状清楚在:动作不再孤立(并入②)、信息有层次(③分组)、预览成专区(⑤有区头)。

---

## 3. Shell props / slot 契约

`web/src/components/workflow-detail/workflow-detail-shell.tsx`(新建;放 `components/` 因跨模块共用)。

```ts
import type { ReactNode } from "react"
import type { WfTimelineItem, WfHighlight } from "@/types/workflow"

/* 头卡元信息一项 */
export interface ShellMetaItem {
  label: string
  value: ReactNode
  /** 强调色(如"当前节点""业务时间") */
  tone?: "default" | "strong" | "warn"
}

/* 状态徽标(直接给 label+className,复用 WF_STATUS_META / 公文 badges 的类名口径) */
export interface ShellStatus {
  label: string
  className?: string
}

/* 内建时间线的行为标记 → 圆点色 + 文案(替代分散的 TIMELINE_META/DECISION_META) */
export type ShellTimelineMeta = Record<string, { label: string; dot: string }>

/* 流程图数据源:两种装载方式 */
export type ShellFlowSource =
  /** 审批:详情内嵌 designerJson / bpmnXml */
  | { load: "inline"; designerType: "DINGTALK" | "BPMN" | "GRAPH"; designerJson?: string | null; bpmnXml?: string | null }
  /** 公文/单据:按流程定义 code 拉最新 designerJson(/api/wf/process-defs/{code}/latest) */
  | { load: "defCode"; defCode: string }

/* 图内预测配置(端点不同 → 传运行函数;不传=不显预测) */
export interface ShellPredict {
  enabled: boolean
  /** 返回预测结果(审批 /api/wf/instances/{id}/predict;公文 /api/office/doc/{id}/predict) */
  run: () => Promise<import("@/types/workflow-p3").WfPredictResult>
}

/* 基座内建"办理记录 + 流程图"所需的流程数据(一处传,nodeInfo/replay 基座内部 build) */
export interface ShellFlow {
  source: ShellFlowSource
  /** 归一化时间线(基座用它 build nodeInfo/replaySteps + 渲染内建办理记录) */
  timeline: WfTimelineItem[]
  timelineMeta: ShellTimelineMeta
  highlight?: WfHighlight
  currentNodes?: { nodeId: string; nodeName?: string }[]
  predict?: ShellPredict
}

export interface WorkflowDetailShellProps {
  /* ① 头卡 */
  title: ReactNode
  onBack: () => void
  status?: ShellStatus
  /** 业务标签 slot(公文:文种/密级/紧急/红白头/文号/已用印;审批:可空或"可重提") */
  badges?: ReactNode
  meta?: ShellMetaItem[]
  /** 业务额外动作(打印/自定义);流程预测与刷新由基座内建,不必重复传 */
  actions?: ReactNode
  onRefresh?: () => void

  /* ② 当前环节条 */
  currentNode?: string | null
  currentAssignee?: string | null
  /** 办理动作区(审批 WfOpBar/P3Bar;公文 OpinionActionBar 派生按钮),并入环节条同框 */
  stageActions?: ReactNode

  /* ③ 信息区(整块;基座给标准卡壳 + 可选标题) */
  infoTitle?: ReactNode
  info?: ReactNode

  /* ④ Tabs */
  flow: ShellFlow            // 内建"办理记录 + 流程图(全增强)"
  /** 业务 Tab(公文正文等);顺序排在 办理记录、流程图 之后 */
  extraTabs?: ShellTab[]
  /** 审批的评论/通知等选配 Tab(同 extraTabs 机制,单列出便于语义) */
  optionalTabs?: ShellTab[]
  /** 覆盖内建办理记录(逃生口;默认用内建通用时间线) */
  timelineSlot?: ReactNode

  /* ⑤ 底部扩展 */
  bottom?: ReactNode

  /* 状态:加载/错误(基座统一 Skeleton / 离线卡 / 不存在卡,消除两边重复) */
  loading?: boolean
  error?: "network" | "notfound" | string | null
  onRetry?: () => void
}

export interface ShellTab {
  key: string
  label: ReactNode
  icon?: ReactNode
  count?: number
  content: ReactNode
}
```

基座内部职责:
- 渲染五段骨架 + 统一 loading/error(把 `instance-detail`、`send-detail` 各自的 Skeleton/离线卡/
  不存在卡合并成一处)。
- 头卡内建:刷新键(`onRefresh`)、流程预测键(当 `flow.predict?.enabled`,点击驱动图内预测并切到流程图 Tab)。
- ② 环节条内建结构(§2.1),`stageActions` 插进同框动作行。
- ④ Tabs:第一个"办理记录"(内建通用 `<ShellTimeline items meta current>`,current 由
  `currentNode/currentAssignee` 生成脉冲行)、第二个"流程图"(内建 `<WorkflowFlowTrack {...flow}>`),
  其后拼 `extraTabs`、`optionalTabs`。
- 导出复用件:`ShellField`(§2.2 的 label-value)、`ShellTimeline`、`WorkflowFlowTrack`。

---

## 4. 两边如何填(适配层示例)

### 4.1 审批(`instance-detail.tsx` 收敛)

```tsx
<WorkflowDetailShell
  title={detail.title}
  onBack={() => navigate(-1)}
  status={{ label: statusMeta?.label ?? detail.bizStatus, className: statusMeta?.className }}
  badges={resubmitMode && <Badge className="…amber…">已驳回至发起人，可修改后重新提交</Badge>}
  meta={[
    { label: "流程", value: detail.defName },
    { label: "发起人", value: detail.initiatorName },
    { label: "发起时间", value: wfFormatTime(detail.createdAt) },
    ...(currentNodeNames ? [{ label: "当前节点", value: currentNodeNames, tone: "strong" }] : []),
  ]}
  actions={<>
    <InstancePrintButton instanceId={detail.id} defCode={detail.defCode} />
    <WfP3Bar detail={detail} … />
    {detail.canCancel && isInitiator && <Button …>撤销</Button>}
  </>}
  onRefresh={() => void load()}
  currentNode={currentNodeNames}
  stageActions={<WfOpBar detail={detail} onReload={() => void load()} />}
  infoTitle="表单信息"
  info={/* FormRenderer / HostedForm / CODE 快照 + SealStrip + SubInstanceLinks(原样搬进来) */}
  flow={{
    source: { load: "inline", designerType: detail.designerType, designerJson: detail.designerJson, bpmnXml: detail.bpmnXml },
    timeline: detail.timeline ?? [],
    timelineMeta: TIMELINE_META,
    highlight: detail.highlight,
    currentNodes: detail.currentNodes,
    predict: detail.predictable ? { enabled: true, run: () => predictInstance(detail.id) } : undefined,
  }}
  optionalTabs={[
    { key: "comments", label: "评论", icon: <MessagesSquare/>, count: detail.comments?.length, content: <CommentThread items={detail.comments ?? []}/> },
    { key: "notify", label: "通知", icon: <Bell/>, count: notifyItems.length, content: <Timeline items={notifyItems}/> },
  ]}
  loading={loading}
  error={loadError}
  onRetry={() => void load()}
/>
```

### 4.2 公文(`send-detail.tsx` / `receive-detail.tsx` 收敛)

```tsx
<WorkflowDetailShell
  title={doc.title}
  onBack={() => navigate("/document/send")}
  status={{ label: GW_SEND_STATUS[doc.status].label, className: GW_SEND_STATUS[doc.status].className }}
  badges={<>
    <DocTypeBadge docType={doc.docType}/> <SecretBadge …/> <UrgencyBadge …/>
    <Badge variant="outline">{isPlain ? "白头文件" : "红头公文"}</Badge>
    <span className="font-mono text-xs text-muted-foreground">{doc.code}</span>
    {doc.sealStatus === "SEALED" && <span className="…violet…"><Stamp/> 已用印</span>}
  </>}
  actions={doc.processInstanceId && <InstancePrintButton instanceId={doc.processInstanceId} defCode="gw_send"/>}
  onRefresh={() => void load()}
  currentNode={doc.status !== "ARCHIVED" ? doc.currentNode : undefined}
  currentAssignee={doc.currentAssignee}
  stageActions={<OpinionActionBar doc={doc} onUpdated={setDoc}/>}   /* 保留,只是搬进环节条同框 */
  infoTitle="办文信息"
  info={<GongwenInfoGrid doc={doc}/>}                                /* §2.2 分组网格 + 附件 */
  flow={{
    source: { load: "defCode", defCode: doc.direction === "SEND" ? "gw_send" : "gw_recv" },
    timeline: opinionsToTimeline(doc.opinions ?? []),                /* GwOpinion[] → WfTimelineItem[] 适配 */
    timelineMeta: DECISION_META,
    highlight: doc.highlight ?? deriveHighlight(doc),
    currentNodes: doc.currentNode ? [{ nodeId: doc.currentNodeId ?? doc.currentNode, nodeName: doc.currentNode }] : [],
    predict: { enabled: true, run: () => predictDoc(doc).then(r => r.data) },  /* 换端点即得图内预测 */
  }}
  extraTabs={[
    { key: "content", label: "正文", icon: <FileText/>, content: <RichTextViewer html={doc.content}/> },
  ]}
  bottom={<GongwenPreviewSection doc={doc}/>}                         /* §2.3 带区头的红头预览专区 */
  loading={loading} error={notFound ? "notfound" : null} onRetry={() => void load()}
/>
```

适配要点:
- `opinionsToTimeline`:`{taskKey→nodeName, userName→actorName, decision→action, opinion→comment, createdAt, nodeId}`。
  **nodeId 对齐**是图内 nodeInfo 高亮的前提——磐石需在 opinion 上回 `nodeId`(见 §6 开放项)。
- 公文的"办理中"脉冲行由基座 `currentNode/currentAssignee` 内建生成,`opinionsToTimeline` 不含它。
- 预测:`predictDoc` 已有(mock.ts),只把它塞进 `flow.predict.run`,弃用 `GwPredictButton` 弹窗。

---

## 5. 迁移步骤(疾风 checklist)

### 阶段 A:抽共享流程图组件(先做,两边都依赖)
- [ ] 新建 `web/src/pages/workflow/designer/flow/workflow-flow-track.tsx`,把 `instance-detail.tsx`
      L75-226 的 `FlowTrack`、`DingtalkTrackHost`、`useTrackPredict` **搬进来**,改成吃
      `ShellFlowSource`(`inline` 用 designerJson/bpmnXml;`defCode` 走 `/process-defs/{code}/latest`
      拉模型——把 `gongwen/flow-track.tsx` 的 defCode 装载逻辑并入这里)+ `predict.run` 回调(端点解耦)。
- [ ] `buildNodeInfo`/`buildReplaySteps` 已在 `runtime-info.ts`,直接 import;基座内部对 `flow.timeline`
      调用它们生成 nodeInfo/replaySteps 喂 FlowViewer。
- [ ] 全屏、图例、DINGTALK 分支原样保留。

### 阶段 B:建基座
- [ ] 新建 `web/src/components/workflow-detail/workflow-detail-shell.tsx`(§3 props),内建五段骨架 +
      统一 loading/error + 头卡刷新/预测键 + ② 环节条 + ④ Tabs(内建办理记录+流程图)。
- [ ] 导出 `ShellField`(§2.2)、`ShellTimeline`(合并 `Timeline`+`OpinionTimeline`:参数化 meta +
      内建当前环节脉冲行)、复用 `WorkflowFlowTrack`。
- [ ] `ShellTimeline` 迁移:审批 `TIMELINE_META`、公文 `DECISION_META` 都作为 `timelineMeta` 传入;
      意见富文本走 `RichTextViewer`(两边现状一致,零改动)。

### 阶段 C:审批接基座
- [ ] `instance-detail.tsx` 改用 `<WorkflowDetailShell>`(§4.1);删除内联 `FlowTrack`/`DingtalkTrackHost`/
      `useTrackPredict`(已搬去阶段 A)、内联 `Timeline`(用 `ShellTimeline`)、重复的 loading/error 卡。
- [ ] 表单信息区(FormRenderer/HostedForm/CODE 快照/SealStrip/SubInstanceLinks)整块搬进 `info` slot。
- [ ] 撤销 Modal、resubmit 逻辑保留在页面(业务态)。
- [ ] 回归:jsdom mount 冒烟测试(反白屏红线 §4)。

### 阶段 D:公文接基座 + 布局重设计
- [ ] `send-detail.tsx`/`receive-detail.tsx` 改用 `<WorkflowDetailShell>`(§4.2)。
- [ ] **删** `gongwen/flow-track.tsx`(DocFlowTrack)、`gongwen/predict.tsx`(GwPredictButton);
      流程图与预测走基座。
- [ ] 新建 `gongwen/info-grid.tsx`(§2.2 分组网格 `GongwenInfoGrid`,用 `ShellField`)。
- [ ] 新建 `gongwen/preview-section.tsx`(§2.3 带区头的红头预览专区,包 `GongwenPreview` + 打印/缩放)。
- [ ] `handling.tsx` 的 `OpinionActionBar` 保留、塞 `stageActions`;`OpinionTimeline` 删(用 `ShellTimeline`),
      或先保留走 `timelineSlot` 逃生口再统一。
- [ ] 加 `opinionsToTimeline` 适配器(`gongwen/adapters.ts`);正文改 `RichTextViewer`。
- [ ] 回归冒烟测试;确认公文现在有:节点办理信息浮层 / 回放 / 图内预测连线 / 全屏 / DINGTALK(若公文流程是钉钉式)。

### 阶段 E:立为范式(以后所有业务)
- [ ] 在基座文件头注释写清"带流程的业务详情一律套 `WorkflowDetailShell`,填 6 个 slot";
      BizDoc 单据详情(§bizdoc)、请假/报销详情后续直接复用。

**不动**:FlowViewer 内部、runtime-info.ts、InstancePrintButton、PredictChain、gongwen badges、
GongwenPreview 主体、gongwen.css 版式。

---

## 6. 开放项(待主控/磐石对齐)

1. **opinion.nodeId**:图内 `nodeInfo` 节点办理信息高亮按 `nodeId` 对齐流程图元素;公文 `GwOpinion`
   当前无 `nodeId`。需磐石在办文意见上回 `nodeId`(或提供 taskKey→nodeId 映射),否则公文流程图
   只能高亮当前节点、无法逐节点回填办理信息。**建议磐石补字段**。
2. **信息区归位**:公文信息区定为**独立信息卡**(与审批表单卡同层),头卡只留标题/徽标/环节/动作。
   若主控希望信息并进头卡下半区(更紧凑),基座 `info` 也能放头卡内——请主控定一处口径,两边统一。
3. **办理记录统一**:建议直接上内建 `ShellTimeline`(参数化 meta),彻底删两套时间线;若担心迁移风险,
   可先用 `timelineSlot` 各自保留、二期统一。倾向一次到位。
4. **收文差异**:`receive-detail.tsx` 与 `send-detail.tsx` 走同一基座,仅 badges/info 网格字段与
   defCode(gw_recv)不同——建议二者共用一个 `GongwenDetail` 适配组件,`direction` 分流,避免再分叉。
5. **红头预览是否也做成 Tab**:本文定为 `bottomSlot` 专区(始终可见,符合"最终成文"心智);若信息密度
   过高,可退化为 Tab。默认专区。
```

---
## 附:主控对 §6 开放项拍板(2026-07-12)

1. **opinion.nodeId 补**:同意——磐石在公文接基座前补 GwOpinion 实体 + 公文 detail/timeline DTO 的
   nodeId(对齐钉钉节点 id),否则公文流程图无法逐节点回填办理信息(只能高亮当前节点)。列入公文实施单。
2. **信息区**:独立段(骨架第③段),公文信息**分组网格**(拟稿组/文号组/收发组),不并头卡。
3. **办理记录**:一次统一到通用 `ShellTimeline`(timelineMeta prop),审批 TIMELINE_META 与公文
   DECISION_META 都收敛;保留 timelineSlot 逃生口。
4. **收发文**:共用**一个 `GongwenDetail`** 组件(收/发差异走 props/适配层),不各写一套。
5. **红头正文预览**:**底部专门区**(带区头,打印/缩放收区头),**不做 Tab**——它是最终成品,值得独立
   常驻展示;正文进 Tab(RichTextViewer)。
6. **迁移节奏**:按 5 阶段;疾风排在**预测前端全链路收口之后**执行。**A 阶段(抽共享 WorkflowFlowTrack)
   是关键**,务必保证审批现有流程图(节点信息/回放/预测/连线高亮/完整链路)**零回归**——A 完成先跑
   审批 instance-detail 反白屏冒烟再往下。每阶段独立可提交、可回滚。

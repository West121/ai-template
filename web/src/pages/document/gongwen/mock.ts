/**
 * 公文高级化 —— in-file 演示数据 + API 层。
 *
 * 后端（gw_send / gw_recv 两个 Flowable 流程 + /api/office/doc 子路由）可能尚未就绪。
 * 本层严格遵循项目 offline/NetworkError 降级约定：offline 或 fetch 失败 → 用内存 mock 顶住，
 * 并向调用方回传 `demo=true`（页面据此显示"后端未连接（演示数据）"提示）。真实 ApiError
 * （403 无权限 / 400 业务错误）照常抛出，不吞。接口就绪后 demo 恒为 false，自然切真实数据。
 */
import { api, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import type { WfPredictResult } from "@/types/workflow-p3"
import type {
  GwCirculation,
  GwDirection,
  GwDoc,
  GwLedgerRow,
  GwOpinion,
  GwTemplate,
} from "./types"

const DOC_BASE = "/api/office/doc"

/* --------------------------- 演示数据（会话内可变） --------------------------- */

let seq = 9000
const nextId = () => ++seq

function nowIso() {
  return new Date().toISOString().slice(0, 19)
}

const SEND_DOCS: GwDoc[] = [
  {
    id: 8101,
    direction: "SEND",
    code: "星辰办〔2026〕012号",
    title: "关于开展2026年度信息安全专项检查的通知",
    docType: "通知",
    secret: "INTERNAL",
    urgency: "URGENT",
    status: "PUBLISHED",
    issuingOrg: "星辰科技有限公司文件",
    issuer: "王建国",
    mainRecipients: "各分公司、各部门",
    ccRecipients: "董事会办公室、审计部",
    content:
      "<p>为切实加强公司信息安全管理，防范数据泄露与网络攻击风险，经研究，决定于2026年第三季度开展信息安全专项检查。现将有关事项通知如下：</p>" +
      "<p>一、检查范围：全公司各业务系统、办公终端及第三方接入。</p>" +
      "<p>二、检查时间：2026年7月15日至8月15日。</p>" +
      "<p>三、各单位要高度重视，认真自查整改，确保专项检查取得实效。</p>",
    annotation: "此件公开发布",
    docDate: "2026-07-05",
    sealStatus: "SEALED",
    sealedBy: "综合办公室",
    sealedAt: "2026-07-05T10:20:00",
    drafter: "李文",
    deptName: "综合办公室",
    createdAt: "2026-07-01T09:12:00",
    templateId: 1,
    opinions: [
      { id: 1, taskKey: "拟稿", userName: "李文", opinion: "已按主任要求拟稿，请核。", decision: "SUBMIT", createdAt: "2026-07-01T09:20:00" },
      { id: 2, taskKey: "核稿", userName: "赵敏", opinion: "文字已校核，同意上报签发。", decision: "AGREE", createdAt: "2026-07-02T14:03:00" },
      { id: 3, taskKey: "签发", userName: "王建国", opinion: "同意发文。", decision: "SIGN", createdAt: "2026-07-05T08:41:00" },
      { id: 4, taskKey: "用印", userName: "综合办公室", opinion: "已加盖公司公章。", decision: "SEAL", createdAt: "2026-07-05T10:20:00" },
    ],
  },
  {
    id: 8102,
    direction: "SEND",
    code: "星辰办〔2026〕013号",
    title: "关于表彰2026年上半年优秀员工的通报",
    docType: "通报",
    secret: "PUBLIC",
    urgency: "NORMAL",
    status: "ISSUED",
    issuingOrg: "星辰科技有限公司文件",
    issuer: "王建国",
    mainRecipients: "全体员工",
    content:
      "<p>2026年上半年，公司广大员工爱岗敬业、开拓进取，涌现出一批表现突出的先进个人。为表彰先进、树立标杆，经研究决定，予以通报表彰。</p>",
    docDate: "2026-07-08",
    sealStatus: "PENDING",
    drafter: "李文",
    deptName: "人力资源部",
    createdAt: "2026-07-06T11:00:00",
    templateId: 1,
    opinions: [
      { id: 1, taskKey: "拟稿", userName: "李文", opinion: "拟稿完成，请核。", decision: "SUBMIT", createdAt: "2026-07-06T11:10:00" },
      { id: 2, taskKey: "核稿", userName: "赵敏", opinion: "同意。", decision: "AGREE", createdAt: "2026-07-07T09:30:00" },
      { id: 3, taskKey: "签发", userName: "王建国", opinion: "同意发文，请用印。", decision: "SIGN", createdAt: "2026-07-08T08:15:00" },
    ],
  },
  {
    id: 8103,
    direction: "SEND",
    code: "（拟稿·未占号）",
    title: "关于申请增拨研发专项经费的请示",
    docType: "请示",
    secret: "INTERNAL",
    urgency: "NORMAL",
    status: "REVIEWING",
    issuingOrg: "星辰科技有限公司文件",
    mainRecipients: "公司董事会",
    content: "<p>因2026年度重点研发项目投入增加，现有预算已难以支撑，特申请增拨研发专项经费人民币500万元。妥否，请批示。</p>",
    drafter: "陈立",
    deptName: "研发中心",
    createdAt: "2026-07-09T15:20:00",
    templateId: 1,
    opinions: [
      { id: 1, taskKey: "拟稿", userName: "陈立", opinion: "请领导核稿。", decision: "SUBMIT", createdAt: "2026-07-09T15:25:00" },
    ],
    currentNode: "核稿",
    currentTask: "核稿",
  },
  {
    id: 8104,
    direction: "SEND",
    code: "（草稿）",
    title: "关于调整公司作息时间的通知",
    docType: "通知",
    secret: "PUBLIC",
    urgency: "NORMAL",
    status: "DRAFT",
    issuingOrg: "星辰科技有限公司文件",
    mainRecipients: "各部门",
    content: "<p>为适应夏季工作特点，经研究决定调整公司作息时间……</p>",
    drafter: "李文",
    deptName: "综合办公室",
    createdAt: "2026-07-10T08:30:00",
    templateId: 1,
    opinions: [],
    currentNode: "拟稿",
    currentTask: "拟稿",
  },
  {
    id: 8105,
    direction: "SEND",
    code: "星辰办便〔2026〕007号",
    title: "关于召开第三季度部门负责人例会的通知",
    docType: "通知",
    headerType: "PLAIN",
    secret: "PUBLIC",
    urgency: "NORMAL",
    status: "ISSUED",
    issuingOrg: "星辰科技有限公司办公室",
    issuer: "李文",
    mainRecipients: "各部门负责人",
    content:
      "<p>经研究，定于2026年7月18日（周五）下午14:30在公司三楼会议室召开第三季度部门负责人例会，现将有关事项通知如下：</p>" +
      "<p>一、参会人员：各部门负责人。</p>" +
      "<p>二、会议议题：上半年工作总结、下半年重点安排。</p>" +
      "<p>请准时参加，如有特殊情况需请假的，提前报办公室。</p>",
    docDate: "2026-07-10",
    drafter: "李文",
    deptName: "综合办公室",
    createdAt: "2026-07-10T09:10:00",
    opinions: [
      { id: 1, taskKey: "拟稿", userName: "李文", opinion: "普通事务通知，走白头。", decision: "SUBMIT", createdAt: "2026-07-10T09:12:00" },
      { id: 2, taskKey: "签发", userName: "李文", opinion: "同意发文。", decision: "SIGN", createdAt: "2026-07-10T10:00:00" },
    ],
    currentNode: "用印",
    currentTask: "用印",
  },
]

const RECV_DOCS: GwDoc[] = [
  {
    id: 8201,
    direction: "RECEIVE",
    code: "收〔2026〕058号",
    registerNo: "收〔2026〕058号",
    title: "关于组织参加全市数字经济发展论坛的通知",
    docType: "通知",
    secret: "PUBLIC",
    urgency: "URGENT",
    status: "CIRCULATING",
    sourceUnit: "市工业和信息化局",
    sourceCode: "市工信〔2026〕89号",
    mainRecipients: "各相关企业",
    content: "<p>为推动全市数字经济高质量发展，定于2026年7月20日举办数字经济发展论坛，请贵单位组织相关人员参加。</p>",
    receivedAt: "2026-07-08",
    docDate: "2026-07-06",
    deptName: "综合办公室",
    createdAt: "2026-07-08T09:00:00",
    opinions: [
      { id: 1, taskKey: "签收登记", userName: "值班室", opinion: "已签收登记。", decision: "SUBMIT", createdAt: "2026-07-08T09:05:00" },
      { id: 2, taskKey: "拟办", userName: "李文", opinion: "拟请王总阅示，建议由市场部牵头组织参会。", decision: "SUBMIT", createdAt: "2026-07-08T10:12:00" },
      { id: 3, taskKey: "批办", userName: "王建国", opinion: "同意，请市场部落实，办公室做好协调。", decision: "AGREE", createdAt: "2026-07-08T14:30:00" },
    ],
    circulations: [
      { id: 1, readerId: 11, readerName: "张伟", status: "READ", readAt: "2026-07-08T16:20:00", opinion: "已阅，将安排参会。" },
      { id: 2, readerId: 12, readerName: "刘洋", status: "READ", readAt: "2026-07-09T09:10:00" },
      { id: 3, readerId: 13, readerName: "孙丽", status: "PENDING" },
    ],
    currentNode: "传阅",
    currentTask: "传阅",
  },
  {
    id: 8202,
    direction: "RECEIVE",
    code: "收〔2026〕059号",
    registerNo: "收〔2026〕059号",
    title: "关于报送2026年上半年安全生产自查报告的函",
    docType: "函",
    secret: "INTERNAL",
    urgency: "NORMAL",
    status: "HANDLING",
    sourceUnit: "市应急管理局",
    sourceCode: "市应急函〔2026〕124号",
    content: "<p>请贵单位于2026年7月25日前报送上半年安全生产自查报告。</p>",
    receivedAt: "2026-07-09",
    docDate: "2026-07-07",
    deptName: "综合办公室",
    createdAt: "2026-07-09T08:40:00",
    opinions: [
      { id: 1, taskKey: "签收登记", userName: "值班室", opinion: "已签收。", decision: "SUBMIT", createdAt: "2026-07-09T08:45:00" },
      { id: 2, taskKey: "拟办", userName: "李文", opinion: "拟请安全部承办并按期报送。", decision: "SUBMIT", createdAt: "2026-07-09T09:30:00" },
      { id: 3, taskKey: "批办", userName: "王建国", opinion: "同意，安全部办理。", decision: "AGREE", createdAt: "2026-07-09T11:00:00" },
    ],
    circulations: [],
    currentNode: "承办",
    currentTask: "承办",
  },
  {
    id: 8203,
    direction: "RECEIVE",
    code: "收〔2026〕060号",
    registerNo: "收〔2026〕060号",
    title: "关于征求《行业数据安全自律公约》意见的函",
    docType: "函",
    secret: "PUBLIC",
    urgency: "NORMAL",
    status: "REGISTERED",
    sourceUnit: "省软件行业协会",
    sourceCode: "省软协〔2026〕33号",
    content: "<p>现将《行业数据安全自律公约（征求意见稿）》印送贵单位，请于7月底前反馈意见。</p>",
    receivedAt: "2026-07-10",
    docDate: "2026-07-08",
    deptName: "综合办公室",
    createdAt: "2026-07-10T08:20:00",
    opinions: [
      { id: 1, taskKey: "签收登记", userName: "值班室", opinion: "已签收登记，待拟办。", decision: "SUBMIT", createdAt: "2026-07-10T08:25:00" },
    ],
    circulations: [],
    currentNode: "拟办",
    currentTask: "拟办",
  },
]

const LEDGER: GwLedgerRow[] = [
  { id: 1, docNumber: "星辰办〔2026〕010号", documentId: 8091, docTitle: "关于印发2026年度工作要点的通知", issuedAt: "2026-06-18", issuer: "王建国", status: "ACTIVE", ruleName: "综合办公室行文", year: "2026" },
  { id: 2, docNumber: "星辰办〔2026〕011号", documentId: 8092, docTitle: "关于成立数字化转型工作领导小组的通知", issuedAt: "2026-06-28", issuer: "王建国", status: "ACTIVE", ruleName: "综合办公室行文", year: "2026" },
  { id: 3, docNumber: "星辰办〔2026〕012号", documentId: 8101, docTitle: "关于开展2026年度信息安全专项检查的通知", issuedAt: "2026-07-05", issuer: "王建国", status: "ACTIVE", ruleName: "综合办公室行文", year: "2026" },
  { id: 4, docNumber: "星辰办〔2026〕013号", documentId: 8102, docTitle: "关于表彰2026年上半年优秀员工的通报", issuedAt: "2026-07-08", issuer: "王建国", status: "ACTIVE", ruleName: "综合办公室行文", year: "2026" },
  { id: 5, docNumber: "星辰办〔2026〕014号", docTitle: "关于××合作意向的函（已作废）", issuedAt: "2026-07-09", issuer: "王建国", status: "VOIDED", ruleName: "综合办公室行文", year: "2026" },
  { id: 6, docNumber: "星辰办〔2025〕128号", documentId: 7801, docTitle: "关于2025年度先进集体表彰的决定", issuedAt: "2025-12-20", issuer: "王建国", status: "ACTIVE", ruleName: "综合办公室行文", year: "2025" },
]

const ARCHIVES: GwDoc[] = [
  { id: 8101, direction: "SEND", code: "星辰办〔2026〕012号", title: "关于开展2026年度信息安全专项检查的通知", docType: "通知", secret: "INTERNAL", urgency: "URGENT", status: "ARCHIVED", archived: true, archiveNo: "2026-发文-0032", archiveCategory: "发文", archivedAt: "2026-07-06", docDate: "2026-07-05" },
  { id: 8091, direction: "SEND", code: "星辰办〔2026〕010号", title: "关于印发2026年度工作要点的通知", docType: "通知", secret: "PUBLIC", urgency: "NORMAL", status: "ARCHIVED", archived: true, archiveNo: "2026-发文-0030", archiveCategory: "发文", archivedAt: "2026-06-20", docDate: "2026-06-18" },
  { id: 8188, direction: "RECEIVE", code: "收〔2026〕052号", title: "关于开展安全生产大检查的通知", docType: "通知", secret: "PUBLIC", urgency: "URGENT", status: "ARCHIVED", archived: true, archiveNo: "2026-收文-0051", archiveCategory: "收文", archivedAt: "2026-06-30", docDate: "2026-06-25" },
  { id: 7801, direction: "SEND", code: "星辰办〔2025〕128号", title: "关于2025年度先进集体表彰的决定", docType: "决定", secret: "PUBLIC", urgency: "NORMAL", status: "ARCHIVED", archived: true, archiveNo: "2025-发文-0128", archiveCategory: "发文", archivedAt: "2025-12-22", docDate: "2025-12-20" },
]

const TEMPLATES: GwTemplate[] = [
  { id: 1, code: "TPL_STD_RED", name: "标准红头（星辰科技有限公司文件）", type: "FULL", issuingOrg: "星辰科技有限公司文件" },
  { id: 2, code: "TPL_OFFICE", name: "办公室便函红头", type: "FULL", issuingOrg: "星辰科技有限公司办公室" },
]

function docStore(direction: GwDirection): GwDoc[] {
  return direction === "SEND" ? SEND_DOCS : RECV_DOCS
}

/* --------------------------- demo 判定 + 包装 --------------------------- */

/** 结果携带 demo 标记：true 表示走了 mock（后端未连接） */
export interface GwResult<T> {
  data: T
  demo: boolean
}

async function withMock<T>(fn: () => Promise<T>, mock: () => T): Promise<GwResult<T>> {
  if (useAuthStore.getState().offline) return { data: mock(), demo: true }
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    if (err instanceof NetworkError) return { data: mock(), demo: true }
    throw err
  }
}

/** 是否处于演示模式（offline）——用于 mutation 前置判断 */
function isDemo(): boolean {
  return useAuthStore.getState().offline
}

/* --------------------- 后端 DTO → 前端 GwDoc 适配 --------------------- */
// 后端 DocDetailResponse/GongwenListItem/LedgerResponse/RenderResponse 与前端 GwDoc 模型字段
// 不完全同名（timeline vs opinions、currentTask 对象、unit vs sourceUnit、render 返回 {html}）。
// 这里集中做映射，保证真实接口就绪后 UI 无需改动。

interface RawTimeline {
  id: number
  taskKey: string
  /** 流程图节点 id（磐石补，对齐 gw_send/gw_recv designerJson） */
  nodeId?: string
  userId?: number
  userName?: string
  opinion?: string
  decision: string
  createdAt: string
}
interface RawCirc {
  id: number
  readerId: number
  readerName: string
  status: string
  readAt?: string
  opinion?: string
}
interface RawDetail {
  id: number
  direction: string
  code: string
  title: string
  docType: string
  headerType?: "RED" | "PLAIN"
  issuingOrg?: string
  secret: string
  urgency: string
  status: string
  unit?: string
  mainRecipients?: string
  ccRecipients?: string
  copyNo?: string
  issuer?: string
  annotation?: string
  drafter?: string
  content?: string
  docDate?: string
  sealStatus?: string
  sealedBy?: string
  sealedAt?: string
  archived?: boolean
  archiveNo?: string
  templateId?: number
  deptName?: string
  processInstanceId?: string
  createdAt?: string
  currentTask?: { taskId?: string; taskKey?: string; taskName?: string; assignee?: string }
  timeline?: RawTimeline[]
  circulations?: RawCirc[]
  /** 流程图高亮（节点 id）：completed 已完成 / active 当前 */
  highlight?: { completed?: string[]; active?: string[] }
}
interface RawListItem {
  id: number
  direction: string
  code: string
  title: string
  docType: string
  secret: string
  urgency: string
  status: string
  unit?: string
  drafter?: string
  sealStatus?: string
  archived?: boolean
  archiveNo?: string
  docDate?: string
  deptName?: string
  createdAt?: string
}
interface RawLedger {
  id: number
  docNumber: string
  documentId?: number
  docTitle: string
  issuer?: string
  status: string
  issuedAt?: string
}

function mapDetail(r: RawDetail): GwDoc {
  const isRecv = r.direction === "RECEIVE"
  return {
    id: r.id,
    direction: (r.direction as GwDirection) ?? "SEND",
    code: r.code,
    title: r.title,
    docType: r.docType,
    headerType: r.headerType ?? "RED",
    secret: r.secret,
    urgency: r.urgency,
    status: r.status,
    issuingOrg: r.issuingOrg,
    mainRecipients: r.mainRecipients,
    ccRecipients: r.ccRecipients,
    copyNo: r.copyNo,
    issuer: r.issuer,
    annotation: r.annotation,
    drafter: r.drafter,
    content: r.content,
    docDate: r.docDate,
    sealStatus: r.sealStatus,
    sealedBy: r.sealedBy,
    sealedAt: r.sealedAt,
    archived: r.archived,
    archiveNo: r.archiveNo,
    templateId: r.templateId,
    deptName: r.deptName,
    processInstanceId: r.processInstanceId,
    createdAt: r.createdAt,
    sourceUnit: isRecv ? r.unit : undefined,
    sourceCode: isRecv ? r.code : undefined,
    registerNo: isRecv ? r.code : undefined,
    receivedAt: isRecv ? r.createdAt?.slice(0, 10) : undefined,
    // currentTask 用中文环节名（与 mock 数据、handling.tsx 动作派生口径一致：核稿/签发/…）。
    // 后端 currentTask 是对象 {taskKey:"review", taskName:"核稿"}——办文动作条按 taskName 匹配，
    // 若取 taskKey(review) 则永远匹配不上中文分支、动作条为空。
    currentTask: r.currentTask?.taskName ?? r.currentTask?.taskKey,
    currentNode: r.currentTask?.taskName ?? r.currentTask?.taskKey,
    currentAssignee: r.currentTask?.assignee,
    opinions: (r.timeline ?? []).map((t) => ({
      id: t.id,
      taskKey: t.taskKey,
      nodeId: t.nodeId,
      userId: t.userId,
      userName: t.userName ?? "系统",
      opinion: t.opinion ?? "",
      decision: t.decision,
      createdAt: t.createdAt,
    })),
    circulations: (r.circulations ?? []).map((c) => ({
      id: c.id,
      readerId: c.readerId,
      readerName: c.readerName,
      status: c.status === "READ" ? "READ" : "PENDING",
      readAt: c.readAt,
      opinion: c.opinion,
    })),
    // 后端流程图高亮（节点 id）：present 则用之，缺省留空由前端 deriveHighlight 兜底
    highlight: r.highlight ? { completed: r.highlight.completed ?? [], active: r.highlight.active ?? [] } : undefined,
  }
}

/* --------------------- 流程图高亮派生（按环节推） --------------------- */
// 节点 id 与 gw_send/gw_recv 种子 designerJson 对齐（关键回写节点 id：见 locked 节点契约）。
// 后端返回 highlight 时优先用后端；无 highlight（未就绪）时按 currentTask 推算，best-effort：
// id 命不中真实流程图也无副作用（FlowViewer 只对命中的 id 高亮）。

interface FlowNodeStep {
  id: string
  /** 对应中文环节名（currentTask 匹配用；start/end 为空） */
  task: string
  /** 展示名（预测链节点名） */
  name: string
  /** 演示预计办理人（预测链用） */
  assignees?: string[]
}

const SEND_FLOW_NODES: FlowNodeStep[] = [
  { id: "start", task: "", name: "开始" },
  { id: "draft", task: "拟稿", name: "拟稿", assignees: ["拟稿人"] },
  { id: "review", task: "核稿", name: "核稿", assignees: ["赵敏"] },
  { id: "countersign", task: "会签", name: "会签", assignees: ["财务部经理", "法务部经理"] },
  { id: "issue", task: "签发", name: "签发", assignees: ["王建国"] },
  { id: "seal", task: "用印", name: "用印", assignees: ["综合办公室"] },
  { id: "publish", task: "分发", name: "成文分发", assignees: ["综合办公室"] },
  { id: "end", task: "", name: "办结归档" },
]

const RECV_FLOW_NODES: FlowNodeStep[] = [
  { id: "start", task: "", name: "开始" },
  { id: "register", task: "签收登记", name: "签收登记" },
  { id: "propose", task: "拟办", name: "拟办", assignees: ["李文"] },
  { id: "approve", task: "批办", name: "批办", assignees: ["王建国"] },
  { id: "handle", task: "承办", name: "承办", assignees: ["市场部"] },
  { id: "circulate", task: "传阅", name: "传阅", assignees: ["张伟", "刘洋"] },
  { id: "finish", task: "办结", name: "办结", assignees: ["综合办公室"] },
  { id: "end", task: "", name: "归档" },
]

/** 别名：成文=分发，登记=签收登记 */
const TASK_ALIAS: Record<string, string> = { 成文: "分发", 成文分发: "分发", 登记: "签收登记", 已归档: "" }

/**
 * 按 currentTask + 状态派生流程图高亮：当前环节 active，之前环节 completed。
 * 归档/办结/成文态 → 全部 completed、无 active。缺 currentTask 亦回落全 completed。
 */
export function deriveHighlight(doc: GwDoc): { completed: string[]; active: string[] } {
  const nodes = doc.direction === "SEND" ? SEND_FLOW_NODES : RECV_FLOW_NODES
  const terminal = doc.archived || ["ARCHIVED", "PUBLISHED", "FINISHED"].includes(doc.status)
  const task = TASK_ALIAS[doc.currentTask ?? ""] ?? doc.currentTask ?? ""
  const idx = terminal ? -1 : nodes.findIndex((n) => n.task && n.task === task)

  if (idx < 0) {
    // 终态或未匹配到环节：整链已完成（end 也点亮），无进行中
    return { completed: nodes.map((n) => n.id), active: [] }
  }
  return {
    completed: nodes.slice(0, idx).map((n) => n.id),
    active: [nodes[idx].id],
  }
}

/* --------------------- 流程预测（后续节点链 + 预计办理人） --------------------- */

/** 按当前环节静态演算后续将经过的节点 + 预计办理人（演示数据，与 wf PredictResponse 同构） */
function predictMock(doc: GwDoc): WfPredictResult {
  const nodes = doc.direction === "SEND" ? SEND_FLOW_NODES : RECV_FLOW_NODES
  const terminal = doc.archived || ["ARCHIVED", "PUBLISHED", "FINISHED"].includes(doc.status)
  const task = TASK_ALIAS[doc.currentTask ?? ""] ?? doc.currentTask ?? ""
  const idx = terminal ? -1 : nodes.findIndex((n) => n.task && n.task === task)
  if (idx < 0) {
    return { path: [], note: "流程已办结或已归档，无后续节点。" }
  }
  const path = nodes.slice(idx + 1).map((n) => ({
    nodeId: n.id,
    nodeName: n.name,
    type: n.id === "end" ? "end" : "approval",
    assignees: n.assignees?.map((name) => ({ name })),
  }))
  return {
    path,
    note: "按当前办文环节静态演算的后续路径与预计办理人（演示数据，不落库）；实际以运行时取人规则为准。",
  }
}

/** 流程预测：POST /api/office/doc/{id}/predict（未就绪 → mock 演算） */
export async function predictDoc(doc: GwDoc): Promise<GwResult<WfPredictResult>> {
  return withMock(
    () => api<WfPredictResult>(`${DOC_BASE}/${doc.id}/predict`, { method: "POST" }),
    () => predictMock(doc),
  )
}

function mapListItem(r: RawListItem): GwDoc {
  const isRecv = r.direction === "RECEIVE"
  return {
    id: r.id,
    direction: (r.direction as GwDirection) ?? "SEND",
    code: r.code,
    title: r.title,
    docType: r.docType,
    secret: r.secret,
    urgency: r.urgency,
    status: r.status,
    drafter: r.drafter,
    sealStatus: r.sealStatus,
    archived: r.archived,
    archiveNo: r.archiveNo,
    docDate: r.docDate,
    deptName: r.deptName,
    createdAt: r.createdAt,
    sourceUnit: isRecv ? r.unit : undefined,
    registerNo: isRecv ? r.code : undefined,
    receivedAt: isRecv ? r.createdAt?.slice(0, 10) : undefined,
    archiveCategory: r.direction === "SEND" ? "发文" : "收文",
    archivedAt: r.archived ? r.createdAt?.slice(0, 10) : undefined,
  }
}

function mapLedger(r: RawLedger): GwLedgerRow {
  const yearMatch = /〔(\d{4})〕/.exec(r.docNumber)
  return {
    id: r.id,
    docNumber: r.docNumber,
    documentId: r.documentId,
    docTitle: r.docTitle,
    issuer: r.issuer,
    issuedAt: r.issuedAt?.slice(0, 10),
    status: r.status === "VOIDED" || r.status === "作废" ? "VOIDED" : "ACTIVE",
    year: yearMatch?.[1],
  }
}

/* ------------------------------- 查询 API ------------------------------- */

export interface GwListQuery {
  direction: GwDirection
  keyword?: string
  secret?: string
  urgency?: string
  docType?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  /** 1-based（对齐后端） */
  pageNum: number
  pageSize: number
}

/** mock 分页切片（真分页语义：list=当前页，total=过滤后总数） */
function slicePage<T>(list: T[], pageNum: number, pageSize: number): PageResult<T> {
  const start = (pageNum - 1) * pageSize
  return { list: list.slice(start, start + pageSize), total: list.length, pageNum, pageSize }
}

function applyFilter(list: GwDoc[], q: GwListQuery): GwDoc[] {
  return list.filter((d) => {
    if (q.keyword) {
      const k = q.keyword.toLowerCase()
      if (!d.title.toLowerCase().includes(k) && !d.code.toLowerCase().includes(k)) return false
    }
    if (q.secret && d.secret !== q.secret) return false
    if (q.urgency && d.urgency !== q.urgency) return false
    if (q.docType && d.docType !== q.docType) return false
    if (q.status && d.status !== q.status) return false
    const date = d.docDate ?? d.receivedAt ?? d.createdAt?.slice(0, 10)
    if (q.dateFrom && (!date || date < q.dateFrom)) return false
    if (q.dateTo && (!date || date > q.dateTo)) return false
    return true
  })
}

function toQueryString(q: GwListQuery): string {
  // 参数名对齐后端 GongwenController#list（日期用 from/to）
  const p = new URLSearchParams({ direction: q.direction, pageNum: String(q.pageNum), pageSize: String(q.pageSize) })
  if (q.keyword) p.set("keyword", q.keyword)
  if (q.secret) p.set("secret", q.secret)
  if (q.urgency) p.set("urgency", q.urgency)
  if (q.docType) p.set("docType", q.docType)
  if (q.status) p.set("status", q.status)
  if (q.dateFrom) p.set("from", q.dateFrom)
  if (q.dateTo) p.set("to", q.dateTo)
  return p.toString()
}

/** 发文/收文列表（服务端分页 + keyword；mock 路径过滤后本地切片，同一分页语义） */
export function fetchDocPage(q: GwListQuery): Promise<GwResult<PageResult<GwDoc>>> {
  return withMock(
    async () => {
      const page = await api<PageResult<RawListItem>>(`${DOC_BASE}/list?${toQueryString(q)}`)
      return { ...page, list: page.list.map(mapListItem) }
    },
    () => slicePage(applyFilter(docStore(q.direction), q), q.pageNum, q.pageSize),
  )
}

export function fetchDoc(id: number, direction: GwDirection): Promise<GwResult<GwDoc | null>> {
  return withMock(
    async () => mapDetail(await api<RawDetail>(`${DOC_BASE}/${id}`)),
    () => docStore(direction).find((d) => d.id === id) ?? null,
  )
}

export interface GwLedgerQuery {
  year?: string
  keyword?: string
  pageNum: number
  pageSize: number
}

/** 文号台账（服务端分页 + year/keyword） */
export function fetchLedgerPage(q: GwLedgerQuery): Promise<GwResult<PageResult<GwLedgerRow>>> {
  return withMock(
    async () => {
      const p = new URLSearchParams({ pageNum: String(q.pageNum), pageSize: String(q.pageSize) })
      if (q.year) p.set("year", q.year)
      if (q.keyword) p.set("keyword", q.keyword)
      const page = await api<PageResult<RawLedger>>(`${DOC_BASE}/ledger?${p.toString()}`)
      return { ...page, list: page.list.map(mapLedger) }
    },
    () =>
      slicePage(
        LEDGER.filter(
          (r) =>
            (!q.year || r.year === q.year) &&
            (!q.keyword || r.docNumber.includes(q.keyword) || r.docTitle.includes(q.keyword)),
        ),
        q.pageNum,
        q.pageSize,
      ),
  )
}

export interface GwArchiveQuery {
  year?: string
  category?: string
  keyword?: string
  pageNum: number
  pageSize: number
}

/** 归档卷宗（服务端分页 + direction/keyword；year 参数一并下发，后端未支持时仅 mock 生效——缺口已上报） */
export function fetchArchivePage(q: GwArchiveQuery): Promise<GwResult<PageResult<GwDoc>>> {
  return withMock(
    async () => {
      const p = new URLSearchParams({ pageNum: String(q.pageNum), pageSize: String(q.pageSize) })
      if (q.category === "发文") p.set("direction", "SEND")
      else if (q.category === "收文") p.set("direction", "RECEIVE")
      if (q.keyword) p.set("keyword", q.keyword)
      if (q.year) p.set("year", q.year)
      const page = await api<PageResult<RawListItem>>(`${DOC_BASE}/archive?${p.toString()}`)
      return { ...page, list: page.list.map(mapListItem) }
    },
    () =>
      slicePage(
        ARCHIVES.filter((d) => {
          if (q.year && d.archivedAt?.slice(0, 4) !== q.year) return false
          if (q.category && d.archiveCategory !== q.category) return false
          if (q.keyword && !d.title.includes(q.keyword) && !d.code.includes(q.keyword)) return false
          return true
        }),
        q.pageNum,
        q.pageSize,
      ),
  )
}

export function fetchTemplates(): Promise<GwResult<GwTemplate[]>> {
  return withMock(
    () => api<GwTemplate[]>(`${DOC_BASE}/templates`),
    () => TEMPLATES,
  )
}

/**
 * 渲染红头正文 HTML（GB/T 9704）。真实后端：POST /api/office/doc/{id}/render。
 * demo 模式：本地按公文字段拼装规范版式 HTML（见 renderMockHtml）。
 */
export async function renderDoc(doc: GwDoc): Promise<GwResult<string>> {
  return withMock(
    async () => {
      const res = await api<{ html: string }>(`${DOC_BASE}/${doc.id}/render`, { method: "POST" })
      return res.html
    },
    () => renderMockHtml(doc),
  )
}

/* ------------------------------- 变更 API ------------------------------- */

export interface GwDraftPayload {
  direction: GwDirection
  title: string
  docType: string
  /** 文头类型：RED 红头 / PLAIN 白头，缺省 RED */
  headerType?: "RED" | "PLAIN"
  secret: string
  urgency: string
  issuingOrg?: string
  mainRecipients?: string
  ccRecipients?: string
  content?: string
  annotation?: string
  attachments?: GwDoc["attachments"]
  templateId?: number
  copyNo?: string
  // 收文登记专有
  sourceUnit?: string
  sourceCode?: string
}

/** 拟稿（发文）/ 登记（收文）：起流程并落库，返回新公文 id */
export async function createDoc(payload: GwDraftPayload): Promise<GwResult<GwDoc>> {
  return withMock(
    async () => {
      // 请求体对齐后端 SendDraftRequest / RecvRegisterRequest（收文用 unit/code）
      const body =
        payload.direction === "SEND"
          ? {
              title: payload.title,
              docType: payload.docType,
              headerType: payload.headerType ?? "RED",
              issuingOrg: payload.issuingOrg,
              mainRecipients: payload.mainRecipients,
              ccRecipients: payload.ccRecipients,
              secret: payload.secret,
              urgency: payload.urgency,
              copyNo: payload.copyNo,
              annotation: payload.annotation,
              content: payload.content,
              templateId: payload.templateId,
            }
          : {
              title: payload.title,
              code: payload.sourceCode,
              unit: payload.sourceUnit,
              docType: payload.docType,
              headerType: payload.headerType ?? "RED",
              secret: payload.secret,
              urgency: payload.urgency,
              content: payload.content,
            }
      const path = payload.direction === "SEND" ? `${DOC_BASE}/send/draft` : `${DOC_BASE}/recv/register`
      return mapDetail(await api<RawDetail>(path, { method: "POST", body: JSON.stringify(body) }))
    },
    () => {
      const store = docStore(payload.direction)
      const isSend = payload.direction === "SEND"
      const doc: GwDoc = {
        id: nextId(),
        direction: payload.direction,
        code: isSend ? "（草稿）" : `收〔2026〕${String(60 + store.length).padStart(3, "0")}号`,
        title: payload.title,
        docType: payload.docType,
        headerType: payload.headerType ?? "RED",
        secret: payload.secret,
        urgency: payload.urgency,
        status: isSend ? "DRAFT" : "REGISTERED",
        issuingOrg: payload.issuingOrg,
        mainRecipients: payload.mainRecipients,
        ccRecipients: payload.ccRecipients,
        content: payload.content,
        annotation: payload.annotation,
        attachments: payload.attachments,
        templateId: payload.templateId,
        copyNo: payload.copyNo,
        sourceUnit: payload.sourceUnit,
        sourceCode: payload.sourceCode,
        registerNo: isSend ? undefined : `收〔2026〕${String(60 + store.length).padStart(3, "0")}号`,
        drafter: useAuthStore.getState().user?.name ?? "演示用户",
        deptName: useAuthStore.getState().user?.dept ?? "综合办公室",
        receivedAt: isSend ? undefined : nowIso().slice(0, 10),
        createdAt: nowIso(),
        currentNode: isSend ? "拟稿" : "拟办",
        currentTask: isSend ? "拟稿" : "拟办",
        opinions: [
          {
            id: 1,
            taskKey: isSend ? "拟稿" : "签收登记",
            userName: useAuthStore.getState().user?.name ?? "演示用户",
            opinion: isSend ? "已拟稿，提交核稿。" : "已签收登记。",
            decision: "SUBMIT",
            createdAt: nowIso(),
          },
        ],
        circulations: [],
      }
      store.unshift(doc)
      return doc
    },
  )
}

/** 发文流转下一步映射（demo 用） */
const SEND_FLOW: Record<string, { next: string; status: string }> = {
  拟稿: { next: "核稿", status: "REVIEWING" },
  核稿: { next: "签发", status: "REVIEWING" },
  会签: { next: "签发", status: "REVIEWING" },
  签发: { next: "用印", status: "ISSUED" },
  用印: { next: "分发", status: "SEALED" },
  分发: { next: "办结", status: "PUBLISHED" },
}
const RECV_FLOW: Record<string, { next: string; status: string }> = {
  拟办: { next: "批办", status: "ASSIGNING" },
  批办: { next: "承办", status: "APPROVING" },
  承办: { next: "传阅", status: "HANDLING" },
  传阅: { next: "办结", status: "CIRCULATING" },
  办结: { next: "归档", status: "FINISHED" },
}

export interface GwOpinionPayload {
  /** AGREE 同意 / REJECT 退回 / TRANSFER 转办 */
  decision: string
  opinion: string
  /** 转办目标（TRANSFER 时） */
  transferTo?: string
}

/** 提交办文意见并办理当前节点（透传 Flowable） */
export async function submitOpinion(doc: GwDoc, payload: GwOpinionPayload): Promise<GwResult<GwDoc>> {
  return withMock(
    async () =>
      mapDetail(
        await api<RawDetail>(`${DOC_BASE}/${doc.id}/opinion`, {
          method: "POST",
          // 后端 OpinionRequest：{ opinion, decision, targetUserId }（转办对象用 id，见偏差说明）
          body: JSON.stringify({ opinion: payload.opinion, decision: payload.decision }),
        }),
      ),
    () => {
      const store = docStore(doc.direction)
      const target = store.find((d) => d.id === doc.id)
      if (!target) return doc
      const user = useAuthStore.getState().user?.name ?? "演示用户"
      const op: GwOpinion = {
        id: (target.opinions?.length ?? 0) + 1,
        taskKey: target.currentTask ?? "办理",
        userName: user,
        opinion: payload.opinion || (payload.decision === "AGREE" ? "同意。" : payload.decision === "REJECT" ? "退回。" : "转办。"),
        decision: payload.decision,
        createdAt: nowIso(),
      }
      target.opinions = [...(target.opinions ?? []), op]
      const flow = doc.direction === "SEND" ? SEND_FLOW : RECV_FLOW
      if (payload.decision === "REJECT") {
        // 退回：回到拟稿/拟办
        target.currentTask = doc.direction === "SEND" ? "拟稿" : "拟办"
        target.currentNode = target.currentTask
        target.status = doc.direction === "SEND" ? "DRAFT" : "REGISTERED"
      } else if (payload.decision === "TRANSFER") {
        // 转办：节点不变，仅换人（demo 不建模具体人）
      } else {
        const step = flow[target.currentTask ?? ""]
        if (step) {
          target.currentTask = step.next
          target.currentNode = step.next
          target.status = step.status
        }
      }
      return { ...target }
    },
  )
}

/** 签发（占号 + ISSUED） */
export async function signIssue(doc: GwDoc, opinion: string): Promise<GwResult<GwDoc>> {
  return withMock(
    // 签发 = 在「签发」环节提交同意意见；后端在该节点占正式文号（幂等）
    async () =>
      mapDetail(
        await api<RawDetail>(`${DOC_BASE}/${doc.id}/opinion`, {
          method: "POST",
          body: JSON.stringify({ decision: "AGREE", opinion }),
        }),
      ),
    () => {
      const target = SEND_DOCS.find((d) => d.id === doc.id)
      if (!target) return doc
      const user = useAuthStore.getState().user?.name ?? "演示用户"
      // 占号（六角括号，幂等：已有正式号则不重复占）
      if (!/〔/.test(target.code)) {
        const n = 15 + SEND_DOCS.filter((d) => /〔/.test(d.code)).length
        target.code = `星辰办〔2026〕${String(n).padStart(3, "0")}号`
      }
      target.issuer = user
      target.status = "ISSUED"
      target.currentTask = "用印"
      target.currentNode = "用印"
      target.docDate = target.docDate ?? nowIso().slice(0, 10)
      target.sealStatus = "PENDING"
      target.opinions = [
        ...(target.opinions ?? []),
        { id: (target.opinions?.length ?? 0) + 1, taskKey: "签发", userName: user, opinion: opinion || "同意发文。", decision: "SIGN", createdAt: nowIso() },
      ]
      return { ...target }
    },
  )
}

/** 用印 */
export async function sealDoc(doc: GwDoc, opinion: string): Promise<GwResult<GwDoc>> {
  return withMock(
    async () =>
      mapDetail(await api<RawDetail>(`${DOC_BASE}/${doc.id}/seal`, { method: "POST", body: JSON.stringify({ opinion }) })),
    () => {
      const target = SEND_DOCS.find((d) => d.id === doc.id)
      if (!target) return doc
      const user = useAuthStore.getState().user?.name ?? "综合办公室"
      target.sealStatus = "SEALED"
      target.sealedBy = user
      target.sealedAt = nowIso()
      target.status = "SEALED"
      target.currentTask = "分发"
      target.currentNode = "分发"
      target.opinions = [
        ...(target.opinions ?? []),
        { id: (target.opinions?.length ?? 0) + 1, taskKey: "用印", userName: user, opinion: opinion || "已用印。", decision: "SEAL", createdAt: nowIso() },
      ]
      return { ...target }
    },
  )
}

/** 发起传阅（收文） */
export async function circulate(
  doc: GwDoc,
  readers: { id: number; name: string }[],
): Promise<GwResult<GwDoc>> {
  return withMock(
    async () =>
      mapDetail(
        // 后端 CirculateRequest：{ readers: [{ id, name }] }
        await api<RawDetail>(`${DOC_BASE}/${doc.id}/circulate`, {
          method: "POST",
          body: JSON.stringify({ readers }),
        }),
      ),
    () => {
      const target = RECV_DOCS.find((d) => d.id === doc.id)
      if (!target) return doc
      const base = target.circulations?.length ?? 0
      const added: GwCirculation[] = readers.map((r, i) => ({
        id: base + i + 1,
        readerId: r.id,
        readerName: r.name,
        status: "PENDING",
      }))
      target.circulations = [...(target.circulations ?? []), ...added]
      if (target.status !== "CIRCULATING") {
        target.status = "CIRCULATING"
        target.currentTask = "传阅"
        target.currentNode = "传阅"
      }
      return { ...target }
    },
  )
}

/** 已阅回执 */
export async function markRead(doc: GwDoc, circulationId: number, opinion?: string): Promise<GwResult<GwDoc>> {
  return withMock(
    async () =>
      mapDetail(
        await api<RawDetail>(`${DOC_BASE}/circulation/${circulationId}/read`, {
          method: "POST",
          body: JSON.stringify({ opinion }),
        }),
      ),
    () => {
      const target = RECV_DOCS.find((d) => d.id === doc.id)
      if (!target) return doc
      target.circulations = (target.circulations ?? []).map((c) =>
        c.id === circulationId ? { ...c, status: "READ", readAt: nowIso(), opinion: opinion ?? c.opinion } : c,
      )
      return { ...target }
    },
  )
}

/** 催办（对未阅传阅人/超时环节发提醒） */
export async function urge(doc: GwDoc): Promise<GwResult<{ notified: number }>> {
  return withMock(
    () => api<{ notified: number }>(`${DOC_BASE}/${doc.id}/urge`, { method: "POST" }),
    () => {
      const target = RECV_DOCS.find((d) => d.id === doc.id)
      const pending = target?.circulations?.filter((c) => c.status === "PENDING").length ?? 0
      return { notified: pending }
    },
  )
}

/** 归档 */
export async function archiveDoc(doc: GwDoc): Promise<GwResult<GwDoc>> {
  return withMock(
    async () =>
      mapDetail(
        await api<RawDetail>(`${DOC_BASE}/${doc.id}/archive`, {
          method: "POST",
          body: JSON.stringify({ category: doc.direction === "SEND" ? "发文" : "收文" }),
        }),
      ),
    () => {
      const target = docStore(doc.direction).find((d) => d.id === doc.id)
      if (!target) return doc
      target.archived = true
      target.archivedAt = nowIso().slice(0, 10)
      target.archiveCategory = doc.direction === "SEND" ? "发文" : "收文"
      target.archiveNo = `2026-${target.archiveCategory}-${String(target.id).slice(-4)}`
      target.status = "ARCHIVED"
      target.currentTask = undefined
      target.currentNode = "已归档"
      return { ...target }
    },
  )
}

export { isDemo }

/* --------------------------- demo 红头 HTML 渲染 --------------------------- */

/**
 * 本地按 GB/T 9704 版式拼装红头正文 HTML（后端 render 未就绪时的兜底）。
 *
 * 关键：输出与 docs/design/gongwen-format-spec.md §9 一致的 **`.gw-typearea` 内部 HTML**
 * （`.gw-*` class 命名照 spec）。前端只套 `.gongwen-paper > .gw-page > .gw-typearea` 外壳。
 * 后端 `POST /api/office/doc/{id}/render` 返回同结构 HTML 时可无缝替换，零改版。
 */
export function renderMockHtml(doc: GwDoc): string {
  const isReceive = doc.direction === "RECEIVE"
  // 收文用来文单位/来文字号作红头与发文字号（呈现来文原件观感）
  const org = isReceive ? `${doc.sourceUnit ?? "来文单位"}文件` : doc.issuingOrg ?? "星辰科技有限公司文件"
  const rawNumber = isReceive ? doc.sourceCode ?? "" : doc.code
  const number = /[（(]/.test(rawNumber) ? "" : rawNumber // 草稿/未占号不显示
  // 上行文（请示/报告）：发文字号居左，签发人居右
  const isUpward = !isReceive && (doc.docType === "请示" || doc.docType === "报告")

  const bodyHtml = doc.content?.includes("<")
    ? doc.content
    : (doc.content ?? "")
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("")

  // 印发机关：去掉"文件"后缀；若机关名已以"办公室"结尾则不再叠加（避免"…办公室办公室"）
  const orgBase = org.replace(/文件$/, "")
  const printOrg = /办公室$/.test(orgBase) ? orgBase : `${orgBase}办公室`
  const printDate = formatChineseDate(doc.docDate)

  // 顶部标注：份号（左1）/密级★期限（左2）/紧急程度（右）
  const marksLeft =
    (doc.copyNo ? `<div class="gw-copyno">${escapeHtml(doc.copyNo)}</div>` : "") +
    (doc.secret && doc.secret !== "PUBLIC" ? `<div class="gw-secret">${secretMark(doc.secret)}</div>` : "")
  const urgencyMark =
    doc.urgency && doc.urgency !== "NORMAL"
      ? `<div class="gw-urgency">${doc.urgency === "EXTRA" ? "特急" : "加急"}</div>`
      : ""
  const marks =
    marksLeft || urgencyMark
      ? `<div class="gw-marks"><div class="gw-marks-left">${marksLeft}</div>${urgencyMark}</div>`
      : ""

  // 发文字号行
  const docnum = number
    ? isUpward
      ? `<div class="gw-docnum gw-docnum--upward"><span class="gw-docnum-text">${escapeHtml(number)}</span>${doc.issuer ? `<span class="gw-issuer">签发人：${escapeHtml(doc.issuer)}</span>` : ""}</div>`
      : `<div class="gw-docnum gw-docnum--center">${escapeHtml(number)}</div>`
    : ""

  // 成文日期 + 电子印章（SEALED 用纯 CSS 兜底章；无图片时的演示章）
  const sealHtml = doc.sealStatus === "SEALED" ? `<span class="gw-seal gw-seal--css" aria-hidden="true">${escapeHtml(org.replace(/文件$/, ""))}公章</span>` : ""
  const docdate =
    !isReceive && printDate
      ? `<div class="gw-docdate">${printDate}${sealHtml}</div>`
      : ""

  // 版记（抄送 + 印发机关和日期）
  const record = `<div class="gw-record">${doc.ccRecipients ? `<div class="gw-cc">抄送：${escapeHtml(doc.ccRecipients)}。</div>` : ""}<div class="gw-print-info"><span class="gw-print-org">${escapeHtml(printOrg)}</span><span class="gw-print-date">${printDate}印发</span></div></div>`

  // 白头（PLAIN）普通文件：不画红色发文机关标志 / 红反线 / 发文字号，走「标题 + 主送 + 正文 + 日期」版式。
  const isPlain = doc.headerType === "PLAIN"

  // 与后端 GongwenRenderer 一致：返回含 .gw-typearea 包裹的完整片段（前端只套 .gongwen-paper>.gw-page 外壳）
  const inner = [
    marks,
    isPlain ? "" : `<div class="gw-header">${escapeHtml(org)}</div>`,
    isPlain ? "" : docnum,
    isPlain ? "" : `<hr class="gw-red-line" />`,
    `<div class="gw-title">${escapeHtml(doc.title)}</div>`,
    doc.mainRecipients ? `<div class="gw-recipients">${escapeHtml(doc.mainRecipients)}</div>` : "",
    `<div class="gw-body">${bodyHtml}</div>`,
    docdate,
    doc.annotation ? `<div class="gw-annotation">（${escapeHtml(doc.annotation)}）</div>` : "",
    record,
  ]
    .filter(Boolean)
    .join("\n")
  return `<div class="gw-typearea${isPlain ? " gw-typearea--plain" : ""}">\n${inner}\n</div>`
}

function secretMark(secret: string): string {
  const text = { INTERNAL: "内部", SECRET: "秘密", CONFIDENTIAL: "机密" }[secret] ?? ""
  // 密级与保密期限间加 ★（GB/T）
  return secret === "PUBLIC" ? text : `${text}★`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function formatChineseDate(iso?: string): string {
  if (!iso) return ""
  const [y, m, d] = iso.slice(0, 10).split("-")
  if (!y || !m || !d) return iso
  return `${y}年${Number(m)}月${Number(d)}日`
}

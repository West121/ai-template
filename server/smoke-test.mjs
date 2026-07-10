#!/usr/bin/env node
/**
 * OA 平台后端全模块冒烟测试（node >= 18，直接 `node smoke-test.mjs`）
 * 覆盖：认证/兼任切换、审批全流程、公文、会议(含冲突)、考勤打卡、请假、出差、
 *      公告、日程、工作台聚合、系统管理 CRUD、功能权限 403、数据权限。
 */
import http from "node:http"
import { execFileSync } from "node:child_process"

const BASE = process.env.OA_BASE ?? "http://localhost:8081"

/**
 * 冒烟测试会创建大量测试流程定义/实例；跑完自动清理，避免污染流程定义/待办等列表。
 * 保留种子 leave_approval 及手动测试样例 purchase_approval（复杂 BPMN 定义，表单 purchase_form）。
 * 通过 docker psql 直连（本地环境）；不可用时静默跳过。设 OA_SMOKE_KEEP=1 可保留全部测试数据（调试用）。
 */
const KEEP_DEF_CODES = ["leave_approval", "purchase_approval", "gw_send", "gw_recv"]
function cleanupTestData() {
  if (process.env.OA_SMOKE_KEEP === "1") {
    console.log("🧪 OA_SMOKE_KEEP=1，保留测试数据")
    return
  }
  const keepList = KEEP_DEF_CODES.map((c) => `'${c}'`).join(",")
  const sql = [
    `DELETE FROM wf_process_ext WHERE def_code NOT IN (${keepList});`,
    "TRUNCATE wf_instance_ext,wf_operation,wf_cc,wf_notify,wf_task_read,wf_add_sign,wf_vote RESTART IDENTITY;",
    "TRUNCATE act_ru_task,act_ru_execution,act_ru_variable,act_ru_identitylink,act_ru_actinst,act_ru_job,",
    "act_ru_timer_job,act_ru_suspended_job,act_ru_deadletter_job,act_ru_external_job,act_ru_entitylink,",
    "act_ru_event_subscr,act_ru_history_job,act_hi_procinst,act_hi_taskinst,act_hi_actinst,act_hi_varinst,",
    "act_hi_identitylink,act_hi_comment,act_hi_detail,act_hi_attachment,act_hi_entitylink,act_hi_tsk_log CASCADE;",
    // 中国式公文（V20）测试数据：删办文流程公文（有 process_instance_id）+ 清办文意见/传阅/文号台账/序号池
    "DELETE FROM oa_document WHERE process_instance_id IS NOT NULL;",
    "TRUNCATE oa_doc_opinion,oa_doc_circulation RESTART IDENTITY;",
    "DELETE FROM oa_doc_number_ledger; DELETE FROM oa_doc_number_seq;",
  ].join(" ")
  const pg = process.env.OA_PG_CONTAINER ?? "oa-postgres"
  try {
    // execFile + 参数数组：不经 shell，sql/容器名作为独立参数传递，无注入风险
    // stderr 保留（非 ignore），失败时把 psql/docker 的真实报错抛进 catch，不再静默吞掉
    execFileSync("docker", ["exec", pg, "psql", "-U", "oa", "-d", "oa_platform", "-c", sql], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    console.log(`🧹 测试数据已清理（保留：${KEEP_DEF_CODES.join(", ")}）`)
  } catch (e) {
    // 从静默跳过改为醒目 WARNING：明确告知「数据未清理」及原因，避免误以为清理成功（Q-03）
    const detail = (e?.stderr?.toString().trim() || e?.message || "docker/psql 不可用").split("\n").slice(-3).join(" ")
    console.warn("\n" + "!".repeat(64))
    console.warn(`⚠️  WARNING: 测试数据未清理（清理命令失败）—— 容器=${pg}`)
    console.warn(`⚠️  原因：${detail}`)
    console.warn(`⚠️  请手动清理 wf_*/act_* 表，或设置 OA_PG_CONTAINER 指向正确的 pg 容器；OA_SMOKE_KEEP=1 可跳过清理。`)
    console.warn("!".repeat(64) + "\n")
  }
}

let passed = 0
let failed = 0
const failures = []

function check(name, cond, extra = "") {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push(`${name} ${extra}`)
    console.error(`  ✗ ${name} ${extra}`)
  }
}

async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, body: json }
}

async function login(username, password = "admin123") {
  const { body } = await call(null, "POST", "/api/auth/login", { username, password })
  check(`login ${username}`, body?.code === 0 && body.data?.token, JSON.stringify(body))
  return body.data
}

console.log(`==> 冒烟测试 ${BASE}`)

/* ---------- 1. 认证与兼任 ---------- */
const admin = await login("admin")
const manager = await login("manager")
const zhangsan = await login("zhangsan")
check("manager 有 2 条任职（主任职+兼任）", manager.assignments?.length === 2)
check("admin 权限含全部", admin.permissions?.includes("system:user:edit") && admin.permissions?.includes("office:approval:approve"))
check("zhangsan 无审批权限", !zhangsan.permissions?.includes("office:approval:approve"))

const sw = await call(manager.token, "POST", "/api/auth/switch", { assignmentId: String(manager.assignments.find((a) => !a.primary).id) })
check("manager 切换兼任身份", sw.body?.code === 0 && sw.body.data?.token)
const managerFinance = sw.body.data
const swBad = await call(zhangsan.token, "POST", "/api/auth/switch", { assignmentId: String(manager.assignments[0].id) })
check("zhangsan 切他人任职被拒", swBad.body?.code !== 0)

/* ---------- 2. 数据权限 ---------- */
const pmList = await call(manager.token, "GET", "/api/office/approvals?status=PENDING&pageNum=1&pageSize=100")
const pmDepts = new Set((pmList.body?.data?.list ?? []).map((r) => r.deptName))
check("manager 主任职只见产品部待办", pmList.body?.code === 0 && [...pmDepts].every((d) => d === "产品部"), [...pmDepts].join(","))
const pfList = await call(managerFinance.token, "GET", "/api/office/approvals?status=PENDING&pageNum=1&pageSize=100")
// 数据权限 = 可见部门 ∪ 本人数据：兼任(财务部)下可见 财务部单据 + 自己提交的单据
const pfRows = pfList.body?.data?.list ?? []
check(
  "manager 兼任可见范围=财务部∪本人",
  pfList.body?.code === 0 && pfRows.length > 0 && pfRows.every((r) => r.deptName === "财务部" || r.applicant === "王经理"),
  pfRows.map((r) => `${r.deptName}/${r.applicant}`).join(","),
)
check("manager 兼任能看到财务部单据", pfRows.some((r) => r.deptName === "财务部"))
const zsList = await call(zhangsan.token, "GET", "/api/office/approvals?status=PENDING&pageNum=1&pageSize=100")
check("zhangsan 仅见本人数据", (zsList.body?.data?.list ?? []).every((r) => r.applicant === "张三"))

/* ---------- 3. 审批全流程 ---------- */
const created = await call(zhangsan.token, "POST", "/api/office/approvals", {
  title: "冒烟测试请假", type: "LEAVE", reason: "自动化测试", startDate: "2026-07-10", endDate: "2026-07-11", ccUserIds: [1],
})
check("zhangsan 创建审批单", created.body?.code === 0 && created.body.data?.id, JSON.stringify(created.body))
const newId = created.body?.data?.id
const my = await call(zhangsan.token, "GET", "/api/office/approvals/my?pageNum=1&pageSize=100")
check("我的申请含新单", (my.body?.data?.list ?? []).some((r) => r.id === newId))
const logs1 = await call(zhangsan.token, "GET", `/api/office/approvals/${newId}/logs`)
check("新单有 CREATE 日志", (logs1.body?.data ?? []).some((l) => l.action === "CREATE"))
const denied = await call(zhangsan.token, "POST", `/api/office/approvals/${newId}/approve`, {})
check("zhangsan 审批 → 403", denied.status === 403)
// admin(全部数据)同意该单 + 日志
const ok1 = await call(admin.token, "POST", `/api/office/approvals/${newId}/approve`, { comment: "冒烟通过" })
check("admin 审批通过", ok1.body?.code === 0)
const logs2 = await call(zhangsan.token, "GET", `/api/office/approvals/${newId}/logs`)
check("APPROVE 日志已写入", (logs2.body?.data ?? []).some((l) => l.action === "APPROVE"))
const done = await call(admin.token, "GET", "/api/office/approvals/done?pageNum=1&pageSize=100")
check("已办事项含该单", (done.body?.data?.list ?? []).some((r) => r.id === newId && r.myAction === "APPROVE"))
// 撤销流程
const created2 = await call(zhangsan.token, "POST", "/api/office/approvals", { title: "待撤销单", type: "OTHER", reason: "x" })
const wd = await call(zhangsan.token, "POST", `/api/office/approvals/${created2.body.data.id}/withdraw`)
check("本人撤销 PENDING 单", wd.body?.code === 0)
// 抄送
const ccList = await call(admin.token, "GET", "/api/office/approvals/cc?pageNum=1&pageSize=100")
check("admin 收到抄送(含新单)", (ccList.body?.data?.list ?? []).some((r) => r.id === newId))
const zsCc = await call(zhangsan.token, "GET", "/api/office/approvals/cc?pageNum=1&pageSize=100")
check("zhangsan 抄送列表查询", zsCc.body?.code === 0 && (zsCc.body?.data?.list ?? []).length >= 1)
const unreadCc = (zsCc.body?.data?.list ?? []).filter((r) => !r.readFlag)
if (unreadCc[0]) {
  const rd = await call(zhangsan.token, "POST", `/api/office/approvals/cc/${unreadCc[0].id}/read`)
  check("抄送标记已读", rd.body?.code === 0)
} else {
  const ra = await call(zhangsan.token, "POST", "/api/office/approvals/cc/read-all")
  check("抄送全部已读(幂等)", ra.body?.code === 0)
}

/* ---------- 4. 公文 ---------- */
const docs = await call(admin.token, "GET", "/api/office/documents?direction=RECEIVE&pageNum=1&pageSize=100")
check("收文列表(admin 全量≥6)", (docs.body?.data?.total ?? 0) >= 6)
const toSign = (docs.body?.data?.list ?? []).find((d) => d.status === "TO_SIGN")
if (toSign) {
  const sg = await call(admin.token, "POST", `/api/office/documents/${toSign.id}/sign`)
  check("收文签收", sg.body?.code === 0)
  const fin = await call(admin.token, "POST", `/api/office/documents/${toSign.id}/finish`)
  check("收文办结", fin.body?.code === 0)
}
const newDoc = await call(manager.token, "POST", "/api/office/documents", {
  direction: "SEND", title: "冒烟测试发文", unit: "全体部门", secret: "INTERNAL", urgency: "NORMAL", content: "测试正文",
})
check("新建发文(自动文号)", newDoc.body?.code === 0 && /星发/.test(newDoc.body.data?.code ?? ""), newDoc.body?.data?.code)
const rv = await call(manager.token, "POST", `/api/office/documents/${newDoc.body.data.id}/review`)
check("发文送核", rv.body?.code === 0)
const is = await call(manager.token, "POST", `/api/office/documents/${newDoc.body.data.id}/issue`)
check("发文签发(signer)", is.body?.code === 0)
const delDenied = await call(zhangsan.token, "DELETE", `/api/office/documents/${newDoc.body.data.id}`)
check("zhangsan 删公文 → 403", delDenied.status === 403)

/* ---------- 4b. 中国式公文高级化（V20：发文/收文办文 + 文号防跳 + 台账 + 权限码） ---------- */
// 六角括号 + 年度序号（星辰发〔2026〕001号）
const seqOf = (code) => {
  const m = /〔\d{4}〕(\d+)号/.exec(code ?? "")
  return m ? parseInt(m[1], 10) : NaN
}
// —— 发文全链路：拟稿 → 核稿 → 签发(占号) → 用印 → 成文 → 归档 ——
async function draftAndIssue(title) {
  const dr = await call(admin.token, "POST", "/api/office/doc/send/draft", {
    title, docType: "通知", issuingOrg: "星辰科技有限公司文件", mainRecipients: "各部门",
    ccRecipients: "档案室", secret: "INTERNAL", urgency: "NORMAL", content: "关于测试的通知正文。",
  })
  const id = dr.body?.data?.id
  await call(admin.token, "POST", `/api/office/doc/${id}/opinion`, { decision: "APPROVE", opinion: "核稿通过" })
  const is = await call(admin.token, "POST", `/api/office/doc/${id}/opinion`, { decision: "APPROVE", opinion: "同意签发" })
  return { id, draft: dr.body, issued: is.body }
}

// gw_send/gw_recv 已注册为 wf 流程定义（GRAPH，可在设计器打开编辑）
const pdefs = await call(admin.token, "GET", "/api/wf/process-defs?pageNum=1&pageSize=200")
const pdCodes = new Set((pdefs.body?.data?.list ?? []).map((p) => p.defCode))
check("公文流程进入流程定义列表(gw_send/gw_recv)", pdCodes.has("gw_send") && pdCodes.has("gw_recv"), [...pdCodes].join(","))

const sendPrev = await call(admin.token, "POST", "/api/office/doc/number/preview", { docType: "通知" })
check("文号预览含六角括号〔〕", /〔\d{4}〕/.test(sendPrev.body?.data?.number ?? ""), sendPrev.body?.data?.number)

// 发文A 显式分步：校验真实取人（核稿=部门主管、签发=部门经理≠发起人）+ 非发起人可见待办
const drA = await call(admin.token, "POST", "/api/office/doc/send/draft", {
  title: "冒烟测试发文A：情况通报", docType: "通知", issuingOrg: "星辰科技有限公司文件",
  mainRecipients: "各部门", ccRecipients: "档案室", secret: "INTERNAL", urgency: "NORMAL", content: "关于测试的通知正文。",
})
const aId = drA.body?.data?.id
check("发文拟稿起流程(status=REVIEWING,当前核稿)", drA.body?.data?.status === "REVIEWING" && drA.body?.data?.currentTask?.taskKey === "review", JSON.stringify(drA.body?.data?.currentTask))
check("核稿办理人=真实取人(部门主管,非硬编 initiator)", !!drA.body?.data?.currentTask?.assignee, drA.body?.data?.currentTask?.assignee)
check("发文拟稿占位号=待编号", drA.body?.data?.code === "待编号", drA.body?.data?.code)
const rvA = await call(admin.token, "POST", `/api/office/doc/${aId}/opinion`, { decision: "APPROVE", opinion: "核稿通过" })
check("核稿后=签发, 办理人=部门经理(单位领导,id 2)≠发起人(admin,id 1)", rvA.body?.data?.currentTask?.taskKey === "issue" && rvA.body?.data?.currentTask?.assignee === "2", JSON.stringify(rvA.body?.data?.currentTask))
const gwMgrTodo = await call(manager.token, "GET", "/api/wf/tasks/todo?pageNum=1&pageSize=100")
const gwSignTask = (gwMgrTodo.body?.data?.list ?? []).find((t) => t.nodeName === "签发")
check("非发起人(王经理)待办含签发任务", !!gwSignTask, (gwMgrTodo.body?.data?.list ?? []).map((t) => t.nodeName).join(","))
check("公文任务在通用待办显示流程名/标题/发起人(非空)",
  !!gwSignTask && gwSignTask.defName === "发文办理单" && gwSignTask.instanceTitle === "冒烟测试发文A：情况通报" && !!gwSignTask.initiatorName,
  JSON.stringify({ defName: gwSignTask?.defName, title: gwSignTask?.instanceTitle, initiator: gwSignTask?.initiatorName }))
const isA = await call(admin.token, "POST", `/api/office/doc/${aId}/opinion`, { decision: "APPROVE", opinion: "同意签发" })
const a = { id: aId, draft: drA.body, issued: isA.body }
check("签发占正式号(ISSUED)", a.issued?.data?.status === "ISSUED" && a.issued?.data?.currentTask?.taskKey === "seal", JSON.stringify({ s: a.issued?.data?.status, t: a.issued?.data?.currentTask?.taskKey }))
check("文号六角括号〔〕格式", /^星辰[发办]〔\d{4}〕\d{3}号$/.test(a.issued?.data?.code ?? ""), a.issued?.data?.code)
// 用印
const seal = await call(admin.token, "POST", `/api/office/doc/${a.id}/seal`, { opinion: "用印" })
check("用印(SEALED)", seal.body?.data?.status === "SEALED" && seal.body?.data?.sealStatus === "SEALED" && seal.body?.data?.currentTask?.taskKey === "publish", JSON.stringify({ s: seal.body?.data?.status, ss: seal.body?.data?.sealStatus }))
// 红头正文渲染
const render = await call(admin.token, "POST", `/api/office/doc/${a.id}/render`)
const html = render.body?.data?.html ?? ""
check("render 返回 .gw-* 片段(gw-typearea/gw-header)", html.includes("gw-typearea") && html.includes("gw-header"), html.slice(0, 60))
check("render 含文号六角括号", html.includes(a.issued?.data?.code) && html.includes("〔"), a.issued?.data?.code)
check("render 已用印→渲染印章(gw-seal)", html.includes("gw-seal"))
// 成文分发
const sendPub = await call(admin.token, "POST", `/api/office/doc/${a.id}/opinion`, { decision: "APPROVE", opinion: "成文分发" })
check("成文(PUBLISHED,流程结束)", sendPub.body?.data?.status === "PUBLISHED" && !sendPub.body?.data?.currentTask, JSON.stringify({ s: sendPub.body?.data?.status, t: sendPub.body?.data?.currentTask }))
// 归档
const arch = await call(admin.token, "POST", `/api/office/doc/${a.id}/archive`, {})
check("发文归档(ARCHIVED,卷宗号)", arch.body?.data?.status === "ARCHIVED" && /^\d{4}-.+-\d{4}$/.test(arch.body?.data?.archiveNo ?? ""), arch.body?.data?.archiveNo)
// 时间线留痕：至少 拟稿/核稿/签发/用印/成文
check("办文时间线留痕(≥5 条意见)", (arch.body?.data?.timeline?.length ?? 0) >= 5, String(arch.body?.data?.timeline?.length))

// —— 文号防跳：连续两次占号序号 +1 ——
const b = await draftAndIssue("冒烟测试发文B：工作安排")
check("文号防跳(第二次序号 = 第一次 +1)", seqOf(b.issued?.data?.code) === seqOf(a.issued?.data?.code) + 1, `${a.issued?.data?.code} → ${b.issued?.data?.code}`)

// —— 台账连续可查 ——
const ledger = await call(admin.token, "GET", `/api/office/doc/ledger?year=${new Date().getFullYear()}&pageNum=1&pageSize=100`)
const lrows = ledger.body?.data?.list ?? []
check("文号台账含两条占号记录", lrows.length >= 2 && lrows.every((r) => r.status === "OCCUPIED"), String(lrows.length))
const lseqs = lrows.map((r) => seqOf(r.docNumber)).filter((n) => !Number.isNaN(n))
const lastTwo = lseqs.slice(-2)
check("台账序号连续(末两条 +1)", lastTwo.length === 2 && lastTwo[1] === lastTwo[0] + 1, lastTwo.join(","))

// —— 收文全链路：登记 → 拟办 → 批办 → 承办 → 传阅(回执) → 办结 → 归档 ——
const reg = await call(admin.token, "POST", "/api/office/doc/recv/register", {
  title: "冒烟测试收文：上级来文", code: "外来〔2026〕88号", unit: "上级机关", docType: "通知", needCirculate: true,
})
const gwRid = reg.body?.data?.id
check("收文登记起流程(REGISTERED→ASSIGNING,当前拟办)", reg.body?.data?.status === "ASSIGNING" && reg.body?.data?.currentTask?.taskKey === "propose", JSON.stringify({ s: reg.body?.data?.status, t: reg.body?.data?.currentTask?.taskKey }))
const propose = await call(admin.token, "POST", `/api/office/doc/${gwRid}/opinion`, { decision: "APPROVE", opinion: "拟办：请王经理阅处" })
check("拟办→批办(APPROVING)", propose.body?.data?.status === "APPROVING" && propose.body?.data?.currentTask?.taskKey === "approve")
const approve = await call(admin.token, "POST", `/api/office/doc/${gwRid}/opinion`, { decision: "APPROVE", opinion: "批办：同意办理" })
check("批办→承办(HANDLING)+意见留痕", approve.body?.data?.status === "HANDLING" && approve.body?.data?.currentTask?.taskKey === "handle" && (approve.body?.data?.timeline ?? []).some((o) => o.taskKey === "approve"))
const handle = await call(admin.token, "POST", `/api/office/doc/${gwRid}/opinion`, { decision: "APPROVE", opinion: "承办完毕，转传阅" })
check("承办→传阅(CIRCULATING)", handle.body?.data?.status === "CIRCULATING" && handle.body?.data?.currentTask?.taskKey === "circulate", JSON.stringify({ s: handle.body?.data?.status, t: handle.body?.data?.currentTask?.taskKey }))
const urge = await call(admin.token, "POST", `/api/office/doc/${gwRid}/urge`)
check("催办(不 404,留痕 urge)", urge.body?.code === 0 && (urge.body?.data?.timeline ?? []).some((o) => o.taskKey === "urge"), `status=${urge.status}`)
const circ = await call(admin.token, "POST", `/api/office/doc/${gwRid}/circulate`, { readers: [{ id: 3, name: "张三" }, { id: 2, name: "王经理" }] })
check("发起传阅(2 人,PENDING)", (circ.body?.data?.circulations?.length ?? 0) === 2 && circ.body?.data?.circulations.every((c) => c.status === "PENDING"), String(circ.body?.data?.circulations?.length))
check("传阅后当前=办结", circ.body?.data?.currentTask?.taskKey === "finish")
const cid = circ.body?.data?.circulations?.[0]?.id
const readr = await call(admin.token, "POST", `/api/office/doc/circulation/${cid}/read`, { opinion: "已阅" })
check("传阅已阅回执(READ)", (readr.body?.data?.circulations ?? []).some((c) => c.id === cid && c.status === "READ"))
const rfin = await call(admin.token, "POST", `/api/office/doc/${gwRid}/opinion`, { decision: "APPROVE", opinion: "办结" })
check("收文办结(FINISHED,流程结束)", rfin.body?.data?.status === "FINISHED" && !rfin.body?.data?.currentTask)
const rarch = await call(admin.token, "POST", `/api/office/doc/${gwRid}/archive`, { category: "收文" })
check("收文归档(ARCHIVED)", rarch.body?.data?.status === "ARCHIVED" && !!rarch.body?.data?.archiveNo)

// —— 权限码（@PreAuthorize 硬 403） ——
const gwDenySend = await call(zhangsan.token, "POST", "/api/office/doc/send/draft", { title: "无权拟稿" })
check("zhangsan 拟稿 → 403(office:doc:send)", gwDenySend.status === 403, `status=${gwDenySend.status}`)
const gwDenyRecv = await call(zhangsan.token, "POST", "/api/office/doc/recv/register", { title: "无权登记" })
check("zhangsan 收文登记 → 403(office:doc:recv)", gwDenyRecv.status === 403, `status=${gwDenyRecv.status}`)
const gwRules = await call(admin.token, "GET", "/api/office/doc/number/rules")
check("admin 文号规则列表(≥2,含预览)", (gwRules.body?.data?.length ?? 0) >= 2 && /〔\d{4}〕/.test(gwRules.body?.data?.[0]?.nextPreview ?? ""), JSON.stringify(gwRules.body?.data?.map((r) => r.nextPreview)))
const gwRulesDeny = await call(zhangsan.token, "GET", "/api/office/doc/number/rules")
check("zhangsan 文号规则 → 403(office:doc:number)", gwRulesDeny.status === 403, `status=${gwRulesDeny.status}`)

/* ---------- 5. 会议（含冲突 409） ---------- */
// 时间脆弱性修复（Q-03）：会议日期取「明天」（本地日历日），任何时刻跑都必然是 UPCOMING，
// 避免写死 2026-07-09 15-18 点在当天该时段过后变 FINISHED，导致「我的会议含新预订(HOST)」误判。
const _tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
const meetDate = `${_tomorrow.getFullYear()}-${String(_tomorrow.getMonth() + 1).padStart(2, "0")}-${String(_tomorrow.getDate()).padStart(2, "0")}`
const rooms = await call(manager.token, "GET", `/api/office/meeting-rooms?date=${meetDate}`)
check("会议室 6 间", (rooms.body?.data ?? []).length === 6)
const freeRoom = (rooms.body?.data ?? []).find((r) => r.status !== "MAINTAIN")
// 明天 9~20 点间找一个空闲时段预订（避免多次运行的时段残留）
let bk = null
let usedStart = 9
for (let h = 9; h < 20 && !(bk?.body?.code === 0); h++) {
  usedStart = h
  bk = await call(manager.token, "POST", "/api/office/meetings", {
    roomId: freeRoom.id, subject: `冒烟测试会议-${Date.now()}`, date: meetDate, startHour: h, endHour: h + 1,
  })
}
check("预订会议", bk.body?.code === 0, JSON.stringify(bk.body))
const conflict = await call(admin.token, "POST", "/api/office/meetings", {
  roomId: freeRoom.id, subject: "冲突会议", date: meetDate, startHour: usedStart, endHour: usedStart + 1,
})
check("时段冲突 → 409", conflict.body?.code === 409, JSON.stringify(conflict.body))
const myMeetings = await call(manager.token, "GET", "/api/office/meetings/my?pageNum=1&pageSize=100")
const mine = (myMeetings.body?.data?.list ?? []).find((m) => m.subject.startsWith("冒烟测试会议") && m.status === "UPCOMING")
check("我的会议含新预订(HOST)", mine?.role === "HOST")
if (mine) {
  const cc = await call(manager.token, "POST", `/api/office/meetings/${mine.id}/cancel`)
  check("主持人取消会议", cc.body?.code === 0)
}

/* ---------- 6. 考勤 ---------- */
const att = await call(manager.token, "GET", "/api/office/attendance/records?month=2026-07")
check("考勤汇总+明细", att.body?.code === 0 && att.body.data?.summary && (att.body.data.list ?? []).length > 0)
const chk = await call(manager.token, "POST", "/api/office/attendance/check", {})
check(
  "打卡接口(成功或当日已完成)",
  (chk.body?.code === 0 && (chk.body.data?.checkIn || chk.body.data?.checkOut)) || chk.body?.code === 400,
  JSON.stringify(chk.body),
)

/* ---------- 7. 请假 / 出差 ---------- */
const quotas = await call(manager.token, "GET", "/api/office/leaves/quotas")
check("假期额度 3 类", (quotas.body?.data ?? []).length >= 3)
const lv = await call(manager.token, "POST", "/api/office/leaves", {
  type: "ANNUAL", startDate: "2026-07-20", endDate: "2026-07-21", days: 2, reason: "冒烟测试",
})
check("创建请假", lv.body?.code === 0)
const lvw = await call(manager.token, "POST", `/api/office/leaves/${lv.body.data.id}/withdraw`)
check("撤销请假", lvw.body?.code === 0)
const tr = await call(manager.token, "POST", "/api/office/trips", {
  destination: "上海", startDate: "2026-07-22", endDate: "2026-07-23", transport: "TRAIN", budget: 2000, reason: "冒烟测试",
})
check("创建出差", tr.body?.code === 0)

/* ---------- 8. 公告 ---------- */
const anns = await call(zhangsan.token, "GET", "/api/office/announcements?pageNum=1&pageSize=100")
check("公告列表 ≥8", (anns.body?.data?.total ?? 0) >= 8)
const before = await call(zhangsan.token, "GET", "/api/office/announcements/unread-count")
const unreadAnn = (anns.body?.data?.list ?? []).find((a) => !a.readFlag)
if (unreadAnn) {
  await call(zhangsan.token, "POST", `/api/office/announcements/${unreadAnn.id}/read`)
  const after = await call(zhangsan.token, "GET", "/api/office/announcements/unread-count")
  check("公告已读后未读数-1", after.body?.data === before.body?.data - 1, `${before.body?.data}→${after.body?.data}`)
}
const pubDenied = await call(zhangsan.token, "POST", "/api/office/announcements", { category: "NOTICE", title: "x", content: "y", top: false })
check("zhangsan 发公告 → 403", pubDenied.status === 403)
const pub = await call(manager.token, "POST", "/api/office/announcements", { category: "NOTICE", title: "冒烟测试公告", content: "内容", top: false })
check("manager 发布公告", pub.body?.code === 0)

/* ---------- 9. 日程 ---------- */
const sch = await call(manager.token, "GET", "/api/office/schedules?month=2026-07")
check("manager 7 月日程 ≥8", (sch.body?.data ?? []).length >= 8)
const ns = await call(manager.token, "POST", "/api/office/schedules", {
  title: "冒烟测试日程", date: "2026-07-15", startTime: "10:00", endTime: "11:00", place: "线上", type: "OTHER",
})
check("新建日程", ns.body?.code === 0)
const ds = await call(manager.token, "DELETE", `/api/office/schedules/${ns.body.data.id}`)
check("删除日程", ds.body?.code === 0)

/* ---------- 10. 工作台聚合 ---------- */
const dash = await call(manager.token, "GET", "/api/office/dashboard")
const dd = dash.body?.data
check("dashboard 字段齐全", dd && "pendingCount" in dd && "todayMeetings" in dd && Array.isArray(dd.pendingList) && dd.weekApprovalStats?.length === 7, JSON.stringify(Object.keys(dd ?? {})))

/* ---------- 11. 系统管理 ---------- */
const tree = await call(admin.token, "GET", "/api/system/depts/tree")
check("部门树(根=星辰科技)", tree.body?.data?.[0]?.name === "星辰科技" && (tree.body.data[0].children ?? []).length >= 4)
check("部门树根节点 code=XC-ROOT", tree.body?.data?.[0]?.code === "XC-ROOT", tree.body?.data?.[0]?.code)
check("子部门 leaderName 已组装", (tree.body?.data?.[0]?.children ?? []).some((d) => typeof d.leaderName === "string" && d.leaderName.length > 0))
// 组织架构计数/查询语义（子树聚合去重 + deptId 含子部门）
const company = tree.body?.data?.[0]
// ① 公司节点 userCount = 子树聚合去重 = 5（admin/王经理/张三/李四/王五；王经理兼任财务部不重复计）
check("公司节点 userCount=5（子树聚合去重）", company?.userCount === 5, `userCount=${company?.userCount}`)
// ③ 叶子部门直属计数不变：人事行政部=3、财务部=1（王经理兼任）、技术部=1、产品部=1
const leafByName = Object.fromEntries((company?.children ?? []).map((d) => [d.name, d.userCount]))
check("叶子直属计数不变（人事行政部=3/财务部=1/技术部=1/产品部=1）",
  leafByName["人事行政部"] === 3 && leafByName["财务部"] === 1 && leafByName["技术部"] === 1 && leafByName["产品部"] === 1,
  JSON.stringify(leafByName))
// ② 按公司/父部门 deptId 查询返回子部门的人（去重后应为全部 5 人）
const companyUsers = await call(admin.token, "GET", `/api/system/users?pageNum=1&pageSize=100&deptId=${company.id}`)
const companyUserNames = new Set((companyUsers.body?.data?.list ?? []).map((u) => u.name))
check("按公司 deptId 查询含子部门人员（去重=5）",
  companyUsers.body?.data?.total === 5 && ["系统管理员", "王经理", "张三", "李四", "王五"].every((n) => companyUserNames.has(n)),
  `total=${companyUsers.body?.data?.total} names=${[...companyUserNames].join("/")}`)
// 叶子部门精确查询仍按该部门返回：人事行政部(id=4) → 3 人
const hrDept = (company?.children ?? []).find((d) => d.name === "人事行政部")
const hrUsers = await call(admin.token, "GET", `/api/system/users?pageNum=1&pageSize=100&deptId=${hrDept.id}`)
check("按叶子部门 deptId 查询返回该部门人员（人事行政部=3）", hrUsers.body?.data?.total === 3, `total=${hrUsers.body?.data?.total}`)
const posts = await call(admin.token, "GET", "/api/system/posts?pageNum=1&pageSize=100")
check("岗位列表", (posts.body?.data?.total ?? 0) >= 5)
const roles = await call(admin.token, "GET", "/api/system/roles?pageNum=1&pageSize=100")
check("角色列表 4+", (roles.body?.data?.total ?? 0) >= 4)
const permsTree = await call(admin.token, "GET", "/api/system/permissions/tree")
check("权限树非空", (permsTree.body?.data ?? []).length > 0)
// 用户 CRUD + 兼任
const deptId = tree.body.data[0].children[0].id
const postId = posts.body.data.list[0].id
const roleId = roles.body.data.list.find((r) => r.code === "EMPLOYEE")?.id ?? roles.body.data.list[0].id
const nu = await call(admin.token, "POST", "/api/system/users", {
  username: "smoketest", name: "冒烟测试员", phone: "13800000000", password: "admin123", deptId, postId, roleIds: [roleId],
})
check("创建用户", nu.body?.code === 0, JSON.stringify(nu.body))
const uid = nu.body?.data?.id ?? nu.body?.data
const nuLogin = await call(null, "POST", "/api/auth/login", { username: "smoketest", password: "admin123" })
check("新用户可登录", nuLogin.body?.code === 0)
const dept2 = tree.body.data[0].children[1].id
const asg = await call(admin.token, "POST", `/api/system/users/${uid}/assignments`, { deptId: dept2, postId, roleIds: [roleId], primary: false })
check("为用户添加兼任", asg.body?.code === 0, JSON.stringify(asg.body))
const asgs = await call(admin.token, "GET", `/api/system/users/${uid}/assignments`)
check("用户任职=2(主+兼)", (asgs.body?.data ?? []).length === 2)
const sub = (asgs.body?.data ?? []).find((a) => !a.primary)
if (sub) {
  const da = await call(admin.token, "DELETE", `/api/system/assignments/${sub.id}`)
  check("删除兼任", da.body?.code === 0)
}
const denyCreate = await call(zhangsan.token, "POST", "/api/system/users", { username: "x1", name: "x", password: "p", deptId, postId, roleIds: [roleId] })
check("zhangsan 建用户 → 403", denyCreate.status === 403)
const du = await call(admin.token, "DELETE", `/api/system/users/${uid}`)
check("删除测试用户", du.body?.code === 0)
// 角色权限配置
const nr = await call(admin.token, "POST", "/api/system/roles", { code: "SMOKE_ROLE", name: "冒烟角色", dataScope: "SELF" })
check("创建角色", nr.body?.code === 0)
const rid = nr.body?.data?.id ?? nr.body?.data
const setP = await call(admin.token, "PUT", `/api/system/roles/${rid}/permissions`, { permissionIds: [1] })
check("配置角色权限", setP.body?.code === 0)
const dr = await call(admin.token, "DELETE", `/api/system/roles/${rid}`)
check("删除角色", dr.body?.code === 0)

/* ---------- 12. 定时任务信息 ---------- */
const jobs = await call(admin.token, "GET", "/api/system/jobs")
check("定时任务信息(3 个 handler)", jobs.body?.data?.handlers?.length === 3 && jobs.body.data.appname === "oa-executor")

/* ---------- 13. 基础设施：文件 / 字典 / 日志（oa-module-infra） ---------- */
// 文件直传 → 列表 → 下载 → 删除
const fileContent = `冒烟测试文件内容-${Date.now()}`
const fd = new FormData()
fd.append("file", new Blob([fileContent], { type: "text/plain" }), "smoke-infra.txt")
const upRes = await fetch(`${BASE}/api/infra/files/upload`, {
  method: "POST", headers: { Authorization: `Bearer ${admin.token}` }, body: fd,
})
const upBody = await upRes.json().catch(() => null)
check("infra 文件直传", upBody?.code === 0 && upBody.data?.id, JSON.stringify(upBody))
const fileId = upBody?.data?.id
const dlRes = await fetch(`${BASE}/api/infra/files/${fileId}/download`, {
  headers: { Authorization: `Bearer ${admin.token}` },
})
const dlText = await dlRes.text()
check("infra 文件下载内容一致", dlRes.status === 200 && dlText === fileContent, `status=${dlRes.status}`)
// B-04/B-19：文件下载越权 —— SELF 用户不得下载他人无关文件（鉴权拒绝为真 HTTP 403）
const idorDl = await fetch(`${BASE}/api/infra/files/${fileId}/download`, {
  headers: { Authorization: `Bearer ${zhangsan.token}` },
})
check("infra 越权下载他人文件 → 403 (B-04/B-19)", idorDl.status === 403, `status=${idorDl.status}`)
// 正例：用户可下载自己上传的文件
const zfd = new FormData()
zfd.append("file", new Blob([`own-${Date.now()}`], { type: "text/plain" }), "own.txt")
const zUp = await fetch(`${BASE}/api/infra/files/upload`, {
  method: "POST", headers: { Authorization: `Bearer ${zhangsan.token}` }, body: zfd,
}).then((r) => r.json()).catch(() => null)
const zFileId = zUp?.data?.id
const zOwnDl = await fetch(`${BASE}/api/infra/files/${zFileId}/download`, {
  headers: { Authorization: `Bearer ${zhangsan.token}` },
})
check("infra 用户下载自己上传的文件 → 200", zOwnDl.status === 200, `status=${zOwnDl.status}`)
await call(admin.token, "DELETE", `/api/infra/files/${zFileId}`)
const delFile = await call(admin.token, "DELETE", `/api/infra/files/${fileId}`)
check("infra 文件删除", delFile.body?.code === 0)
// 字典 options 树（region：省 > 市 > 区）
const region = await call(zhangsan.token, "GET", "/api/infra/dict/region/options")
const gd = (region.body?.data ?? []).find((n) => n.label === "广东省")
check(
  "infra region 字典树(省>市>区)",
  region.body?.code === 0 && gd?.children?.length === 2 && (gd.children[0].children ?? []).length >= 1,
  JSON.stringify((region.body?.data ?? []).map((n) => n.label)),
)
// 登录 / 操作日志（本次运行已产生登录与 @OperLog 操作）
const loginLogs = await call(admin.token, "GET", "/api/infra/logs/login?pageNum=1&pageSize=10")
check("infra 登录日志非空", (loginLogs.body?.data?.total ?? 0) > 0)
const latestLogin = loginLogs.body?.data?.list?.[0]
check("infra 登录日志 location 非空(本机=内网)", !!latestLogin?.location, JSON.stringify(latestLogin))
const operLogs = await call(admin.token, "GET", "/api/infra/logs/oper?pageNum=1&pageSize=10")
check("infra 操作日志非空", (operLogs.body?.data?.total ?? 0) > 0)
const rt = await call(admin.token, "GET", "/api/infra/logs/runtime?lines=50")
check("infra 运行日志 tail", rt.body?.code === 0 && Array.isArray(rt.body.data?.lines) && rt.body.data.lines.length > 0)

/* ---------- 14. 工作流平台（oa-module-workflow / Flowable） ---------- */
const TS = Date.now()

// 可发起流程（含请假审批 + 表单 schema）
const startable = await call(zhangsan.token, "GET", "/api/wf/startable")
check(
  "wf 可发起流程含请假审批",
  (startable.body?.data ?? []).some((s) => s.defCode === "leave_approval" && s.formSchema),
  JSON.stringify((startable.body?.data ?? []).map((s) => s.defCode)),
)

// 场景 A：days=2 → 部门经理(王经理)审批 → 直接结束 APPROVED
const titleA = `冒烟请假2天-${TS}`
// 发起前记录经理未读数（TODO 通知在任务创建即发起时写入）
const mgrUnreadBefore = (await call(manager.token, "GET", "/api/wf/notifies/unread-count")).body?.data ?? 0
const startA = await call(zhangsan.token, "POST", "/api/wf/instances", {
  defCode: "leave_approval", title: titleA,
  formData: { leaveType: "ANNUAL", startDate: "2026-08-01", endDate: "2026-08-02", days: 2, reason: "冒烟测试" },
})
check("wf 发起实例(days=2)", startA.body?.code === 0 && startA.body.data?.bizStatus === "RUNNING", JSON.stringify(startA.body))
const iidA = startA.body?.data?.id
check("wf 发起后当前节点=部门经理审批", (startA.body?.data?.currentNodes ?? []).some((n) => n.nodeName === "部门经理审批"))

const mgrTodo = await call(manager.token, "GET", "/api/wf/tasks/todo?pageNum=1&pageSize=100")
const taskA = (mgrTodo.body?.data?.list ?? []).find((t) => t.instanceTitle === titleA)
check("wf 部门经理待办出现", !!taskA, JSON.stringify((mgrTodo.body?.data?.list ?? []).map((t) => t.instanceTitle)))
const mgrUnreadAfter = (await call(manager.token, "GET", "/api/wf/notifies/unread-count")).body?.data ?? 0
check("wf 部门经理收到 TODO 通知(未读+)", mgrUnreadAfter > mgrUnreadBefore, `${mgrUnreadBefore}->${mgrUnreadAfter}`)

if (taskA) {
  const apprA = await call(manager.token, "POST", `/api/wf/tasks/${taskA.taskId}/approve`, { comment: "冒烟通过" })
  check("wf 部门经理审批通过", apprA.body?.code === 0)
}
const detA = await call(zhangsan.token, "GET", `/api/wf/instances/${iidA}`)
check("wf days=2 实例结束为 APPROVED", detA.body?.data?.bizStatus === "APPROVED", detA.body?.data?.bizStatus)
check("wf 时间线含 SUBMIT+APPROVE", (detA.body?.data?.timeline ?? []).map((t) => t.action).join(",").includes("APPROVE"))
// 跟踪图分流：DINGTALK 定义详情回传 designerType=DINGTALK + designerJson(钉钉模型，含节点 id 供高亮)，前端据此渲染钉钉跟踪图
check("wf 详情返回 designerType=DINGTALK", detA.body?.data?.designerType === "DINGTALK", detA.body?.data?.designerType)
check(
  "wf 详情返回 designerJson(含节点 mgr/cc1)",
  Array.isArray(detA.body?.data?.designerJson?.nodes) &&
    detA.body.data.designerJson.nodes.some((n) => n.id === "mgr"),
  JSON.stringify(detA.body?.data?.designerJson?.nodes?.map((n) => n.id)),
)
const mgrDone = await call(manager.token, "GET", "/api/wf/tasks/done?pageNum=1&pageSize=100")
check("wf 经理已办含该任务", (mgrDone.body?.data?.list ?? []).some((t) => t.instanceTitle === titleA))

// 抄送：zhangsan(人事)被抄送可见
const ccA = await call(zhangsan.token, "GET", "/api/wf/instances/cc?pageNum=1&pageSize=100")
check("wf 抄送可见(发起人被抄送)", (ccA.body?.data?.list ?? []).some((c) => c.title === titleA))

// 通知：发起人收到结果/抄送通知，未读数变化 + 已读
const zUnread = (await call(zhangsan.token, "GET", "/api/wf/notifies/unread-count")).body?.data ?? 0
check("wf 发起人有未读通知(RESULT/CC)", zUnread > 0, String(zUnread))
const zNotifies = await call(zhangsan.token, "GET", "/api/wf/notifies?pageNum=1&pageSize=100")
const oneUnread = (zNotifies.body?.data?.list ?? []).find((n) => !n.readFlag)
if (oneUnread) {
  const before = (await call(zhangsan.token, "GET", "/api/wf/notifies/unread-count")).body?.data
  await call(zhangsan.token, "POST", `/api/wf/notifies/${oneUnread.id}/read`)
  const after = (await call(zhangsan.token, "GET", "/api/wf/notifies/unread-count")).body?.data
  check("wf 通知已读后未读数-1", after === before - 1, `${before}->${after}`)
} else {
  const ra = await call(zhangsan.token, "POST", "/api/wf/notifies/read-all")
  check("wf 通知全部已读(幂等)", ra.body?.code === 0)
}

// 场景 B：days=5 → 经理批 → 总经理(admin)待办 → 驳回回发起人 → 重提(改2天) → 走通结束
const titleB = `冒烟请假5天-${TS}`
const startB = await call(zhangsan.token, "POST", "/api/wf/instances", {
  defCode: "leave_approval", title: titleB,
  formData: { leaveType: "ANNUAL", days: 5, reason: "冒烟条件分支" },
})
const iidB = startB.body?.data?.id
const taskB1 = ((await call(manager.token, "GET", "/api/wf/tasks/todo?pageNum=1&pageSize=100")).body?.data?.list ?? [])
  .find((t) => t.instanceTitle === titleB)
check("wf days=5 经理待办出现", !!taskB1)
if (taskB1) await call(manager.token, "POST", `/api/wf/tasks/${taskB1.taskId}/approve`, { comment: "经理同意" })
const taskGm = ((await call(admin.token, "GET", "/api/wf/tasks/todo?pageNum=1&pageSize=100")).body?.data?.list ?? [])
  .find((t) => t.instanceTitle === titleB)
check("wf 天数>3 条件分支进入总经理(admin)待办", !!taskGm && taskGm.nodeName === "总经理审批", JSON.stringify(taskGm))
if (taskGm) {
  const rejB = await call(admin.token, "POST", `/api/wf/tasks/${taskGm.taskId}/reject`, { comment: "资料不足，退回", target: "START" })
  check("wf 总经理驳回回发起人", rejB.body?.code === 0)
}
const detB1 = await call(zhangsan.token, "GET", `/api/wf/instances/${iidB}`)
check("wf 驳回后实例=REJECTED(可重提)", detB1.body?.data?.bizStatus === "REJECTED", detB1.body?.data?.bizStatus)
const resB = await call(zhangsan.token, "POST", `/api/wf/instances/${iidB}/resubmit`, {
  formData: { leaveType: "ANNUAL", days: 2, reason: "改为2天重新提交" },
})
check("wf 发起人重新提交=RUNNING", resB.body?.code === 0 && resB.body.data?.bizStatus === "RUNNING")
const taskB2 = ((await call(manager.token, "GET", "/api/wf/tasks/todo?pageNum=1&pageSize=100")).body?.data?.list ?? [])
  .find((t) => t.instanceTitle === titleB)
check("wf 重提后经理再次待办", !!taskB2)
if (taskB2) await call(manager.token, "POST", `/api/wf/tasks/${taskB2.taskId}/approve`, { comment: "重提同意" })
const detB2 = await call(zhangsan.token, "GET", `/api/wf/instances/${iidB}`)
check("wf 重提改2天后走通=APPROVED", detB2.body?.data?.bizStatus === "APPROVED", detB2.body?.data?.bizStatus)

// 场景 C：撤销（无节点通过前）
const titleC = `冒烟待撤销-${TS}`
const startC = await call(zhangsan.token, "POST", "/api/wf/instances", {
  defCode: "leave_approval", title: titleC, formData: { leaveType: "SICK", days: 1, reason: "撤销场景" },
})
const cancelC = await call(zhangsan.token, "POST", `/api/wf/instances/${startC.body.data.id}/cancel`)
check("wf 发起人撤销(无节点通过)", cancelC.body?.code === 0 && cancelC.body.data?.bizStatus === "CANCELED", JSON.stringify(cancelC.body))

// 我发起列表
const wfMine = await call(zhangsan.token, "GET", "/api/wf/instances/my?pageNum=1&pageSize=100")
check("wf 我发起列表含新单", (wfMine.body?.data?.list ?? []).some((r) => r.title === titleC))

// 权限：无 wf:def:edit 建流程定义 → 403
const denyDef = await call(zhangsan.token, "POST", "/api/wf/process-defs", { defCode: `x-${TS}`, name: "x", designerType: "DINGTALK" })
check("wf zhangsan 建流程定义 → 403", denyDef.status === 403)

// 场景 D：OR 条件分支（前端多条件 OR），发起后应命中 OR 分支进入审批节点并走通
const orCode = `smoke_or_${TS}`
const orJson = {
  nodes: [
    {
      id: "cond", type: "condition", name: "OR判断", branches: [
        {
          id: "b1", name: "大额或加急", logic: "OR",
          conditions: [{ field: "amount", operator: ">", value: 1000 }, { field: "urgent", operator: "==", value: true }],
          steps: [{ id: "review", type: "approval", name: "复核", assigneeRules: [{ type: "INITIATOR" }], multiMode: "ANY" }],
        },
        { id: "b0", name: "默认", default: true, steps: [] },
      ],
    },
  ],
}
const orCreate = await call(admin.token, "POST", "/api/wf/process-defs", {
  defCode: orCode, name: "OR条件测试", designerType: "DINGTALK", designerJson: JSON.stringify(orJson),
})
check("wf 创建 OR 流程定义", orCreate.body?.code === 0, JSON.stringify(orCreate.body))
const orPub = await call(admin.token, "POST", `/api/wf/process-defs/${orCreate.body.data.id}/publish`)
check("wf 发布 OR 流程(JSON→BPMN)", orPub.body?.code === 0, JSON.stringify(orPub.body))
// amount=500(不满足) 但 urgent=true(满足) → OR 命中 → 进入复核节点
const orStart = await call(admin.token, "POST", "/api/wf/instances", {
  defCode: orCode, title: `OR走通-${TS}`, formData: { amount: 500, urgent: true, reason: "OR" },
})
check("wf OR 分支命中进入复核节点", (orStart.body?.data?.currentNodes ?? []).some((n) => n.nodeName === "复核"), JSON.stringify(orStart.body?.data?.currentNodes))
const orTask = ((await call(admin.token, "GET", "/api/wf/tasks/todo?pageNum=1&pageSize=100")).body?.data?.list ?? [])
  .find((t) => t.instanceTitle === `OR走通-${TS}`)
check("wf OR 复核任务到达发起人(INITIATOR)", !!orTask)
if (orTask) await call(admin.token, "POST", `/api/wf/tasks/${orTask.taskId}/approve`, { comment: "OR复核通过" })
const orDetail = await call(admin.token, "GET", `/api/wf/instances/${orStart.body.data.id}`)
check("wf OR 流程走通=APPROVED", orDetail.body?.data?.bizStatus === "APPROVED", orDetail.body?.data?.bizStatus)

// 种子流程 bpmnXml 含 BPMNDI（前端 bpmn-js 渲染依赖），且引用为 id 制
const seedDef = await call(admin.token, "GET", "/api/wf/process-defs/leave_approval/latest")
const seedXml = seedDef.body?.data?.bpmnXml ?? ""
check("wf 种子 bpmnXml 含 BPMNShape(DI)", (seedXml.match(/<bpmndi:BPMNShape/g) ?? []).length >= 7, String((seedXml.match(/<bpmndi:BPMNShape/g) ?? []).length))
check("wf 种子 designerJson ORG 引用为 id 制", /"refs":\s*\[\s*\{\s*"kind":\s*"USER",\s*"id":\s*1/.test(seedDef.body?.data?.designerJson ?? ""), seedDef.body?.data?.designerJson)

/* ---------- 15. 工作流 P2 批次1：核心操作 ---------- */
const lisi = await login("lisi")
const wangwu = await login("wangwu")
// 用户 id 非确定（序列有空洞），运行时按用户名解析
const allUsers = await call(admin.token, "GET", "/api/system/users?pageNum=1&pageSize=200")
const uidByName = Object.fromEntries((allUsers.body?.data?.list ?? []).map((u) => [u.username, u.id]))
const MANAGER = uidByName.manager, LISI = uidByName.lisi, WANGWU = uidByName.wangwu
check("p2 解析测试用户 id", !!MANAGER && !!LISI && !!WANGWU, JSON.stringify({ MANAGER, LISI, WANGWU }))

// 辅助：创建并发布一个 DINGTALK 流程定义，返回 defCode
async function mkProc(code, nodes) {
  const c = await call(admin.token, "POST", "/api/wf/process-defs", {
    defCode: code, name: code, designerType: "DINGTALK", designerJson: JSON.stringify({ nodes }),
  })
  const pub = await call(admin.token, "POST", `/api/wf/process-defs/${c.body?.data?.id}/publish`)
  check(`p2 发布流程 ${code}`, pub.body?.code === 0, JSON.stringify(pub.body))
  return code
}
// 辅助：在某人待办中按标题找任务
async function findTodo(token, title) {
  const r = await call(token, "GET", "/api/wf/tasks/todo?pageNum=1&pageSize=100")
  return (r.body?.data?.list ?? []).find((t) => t.instanceTitle === title)
}
async function startInst(defCode, title, formData = {}) {
  const r = await call(zhangsan.token, "POST", "/api/wf/instances", { defCode, title, formData })
  return r.body?.data
}
async function bizStatus(token, iid) {
  return (await call(token, "GET", `/api/wf/instances/${iid}`)).body?.data?.bizStatus
}
const orgUser = (id) => ({ kind: "USER", id })
const approvalNode = (id, name, uid, multiMode = "ANY") => ({
  id, type: "approval", name, assigneeRules: [{ type: "ORG", refs: [orgUser(uid)] }], multiMode, emptyStrategy: "TO_ADMIN",
})

// 定义 P2 测试流程
const P_SIGN = await mkProc(`p2sign_${TS}`, [{ id: "ap", type: "approval", name: "会签节点", assigneeRules: [{ type: "ORG", refs: [orgUser(MANAGER)] }], multiMode: "ALL", emptyStrategy: "TO_ADMIN" }])
const P_MULTI = await mkProc(`p2multi_${TS}`, [{ id: "ap", type: "approval", name: "多人会签", assigneeRules: [{ type: "ORG", refs: [orgUser(MANAGER), orgUser(LISI)] }], multiMode: "ALL", emptyStrategy: "TO_ADMIN" }])
const P_SINGLE = await mkProc(`p2single_${TS}`, [approvalNode("ap", "经理审批", MANAGER, "ANY")])
const P_SEQ = await mkProc(`p2seq_${TS}`, [approvalNode("a", "A经理", MANAGER, "ANY"), approvalNode("b", "B李四", LISI, "ANY")])
const P_AGENT = await mkProc(`p2agent_${TS}`, [approvalNode("ap", "代理审批", MANAGER, "ANY")])

// --- 前加签 PRE（串行 B→A）：李四先审→回到经理→经理终审→下一节点 ---
{
  const t = `前加签-${TS}`
  const inst = await startInst(P_SINGLE, t)
  const mt = await findTodo(manager.token, t)
  check("p2 前加签前经理待办出现", !!mt)
  const add = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/add-sign`, { mode: "PRE", users: [orgUser(LISI)], comment: "请李四先审" })
  check("p2 前加签成功", add.body?.code === 0, JSON.stringify(add.body))
  check("p2 前加签后经理待办转出(等李四先审)", !(await findTodo(manager.token, t)))
  const lt = await findTodo(lisi.token, t)
  check("p2 前加签李四先拿到待办", !!lt)
  if (lt) await call(lisi.token, "POST", `/api/wf/tasks/${lt.taskId}/approve`, { comment: "李四先审同意" })
  check("p2 前加签李四审后仍RUNNING(回原审批人)", (await bizStatus(zhangsan.token, inst.id)) === "RUNNING")
  check("p2 前加签李四审后回到经理待办", !!(await findTodo(manager.token, t)))
  check("p2 前加签李四审后李四待办清空", !(await findTodo(lisi.token, t)))
  const mt2 = await findTodo(manager.token, t)
  if (mt2) await call(manager.token, "POST", `/api/wf/tasks/${mt2.taskId}/approve`, { comment: "经理终审" })
  check("p2 前加签串行(B→A)走通→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 后加签 POST（串行 A→B）：经理先审→李四后审→下一节点 ---
{
  const t = `后加签-${TS}`
  const inst = await startInst(P_SINGLE, t)
  const mt = await findTodo(manager.token, t)
  const add = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/add-sign`, { mode: "POST", users: [orgUser(LISI)], comment: "我先审李四后审" })
  check("p2 后加签成功", add.body?.code === 0, JSON.stringify(add.body))
  check("p2 后加签后经理仍先审(待办保留)", !!(await findTodo(manager.token, t)))
  check("p2 后加签李四暂无待办", !(await findTodo(lisi.token, t)))
  const mt1 = await findTodo(manager.token, t)
  await call(manager.token, "POST", `/api/wf/tasks/${mt1.taskId}/approve`, { comment: "经理先审" })
  check("p2 后加签经理审后仍RUNNING(转李四)", (await bizStatus(zhangsan.token, inst.id)) === "RUNNING")
  const lt = await findTodo(lisi.token, t)
  check("p2 后加签经理审后李四才拿到待办", !!lt)
  if (lt) await call(lisi.token, "POST", `/api/wf/tasks/${lt.taskId}/approve`, { comment: "李四终审" })
  check("p2 后加签串行(A→B)走通→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 并签：经理并签王五，双方审 ---
{
  const t = `并签-${TS}`
  const inst = await startInst(P_SIGN, t)
  const mt = await findTodo(manager.token, t)
  const cs = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/counter-sign`, { users: [orgUser(WANGWU)], comment: "加个王五" })
  check("p2 并签成功", cs.body?.code === 0, JSON.stringify(cs.body))
  const wt = await findTodo(wangwu.token, t)
  check("p2 并签后王五出现待办", !!wt)
  if (wt) await call(wangwu.token, "POST", `/api/wf/tasks/${wt.taskId}/approve`, {})
  const mt2 = await findTodo(manager.token, t)
  if (mt2) await call(manager.token, "POST", `/api/wf/tasks/${mt2.taskId}/approve`, {})
  check("p2 并签双方通过→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 减签：经理+李四会签，经理减掉李四，经理单独通过 ---
{
  const t = `减签-${TS}`
  const inst = await startInst(P_MULTI, t)
  const mt = await findTodo(manager.token, t)
  check("p2 减签前李四也有待办", !!(await findTodo(lisi.token, t)))
  const det = await call(manager.token, "GET", `/api/wf/instances/${inst.id}`)
  check("p2 详情 currentHandlers 含本节点其他处理人(李四)+taskId", (det.body?.data?.currentHandlers ?? []).some((h) => h.userId === LISI && !!h.taskId), JSON.stringify(det.body?.data?.currentHandlers))
  const rs = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/reduce-sign`, { removeUserIds: [LISI] })
  check("p2 减签成功", rs.body?.code === 0, JSON.stringify(rs.body))
  check("p2 减签后李四待办消失", !(await findTodo(lisi.token, t)))
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
  check("p2 减签后经理单独通过→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 转办：经理转办李四，李四办结 ---
{
  const t = `转办-${TS}`
  const inst = await startInst(P_SINGLE, t)
  const mt = await findTodo(manager.token, t)
  const tr = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/transfer`, { user: orgUser(LISI), comment: "转给李四" })
  check("p2 转办成功", tr.body?.code === 0, JSON.stringify(tr.body))
  const lt = await findTodo(lisi.token, t)
  check("p2 转办后李四待办出现", !!lt)
  check("p2 转办后经理待办消失", !(await findTodo(manager.token, t)))
  if (lt) await call(lisi.token, "POST", `/api/wf/tasks/${lt.taskId}/approve`, { comment: "李四审批" })
  check("p2 转办后李四办结→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 委派：经理委派李四，李四审→回经理→经理提交 ---
{
  const t = `委派-${TS}`
  const inst = await startInst(P_SINGLE, t)
  const mt = await findTodo(manager.token, t)
  const dg = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/delegate`, { user: orgUser(LISI), comment: "委派李四" })
  check("p2 委派成功", dg.body?.code === 0, JSON.stringify(dg.body))
  const lt = await findTodo(lisi.token, t)
  check("p2 委派后李四待办(delegated标记)", !!lt && lt.delegated === true, JSON.stringify(lt))
  if (lt) await call(lisi.token, "POST", `/api/wf/tasks/${lt.taskId}/approve`, { comment: "李四代办" })
  check("p2 委派受托人办理后仍RUNNING(回委派人)", (await bizStatus(zhangsan.token, inst.id)) === "RUNNING")
  const mt2 = await findTodo(manager.token, t)
  check("p2 委派回到经理待办", !!mt2)
  if (mt2) await call(manager.token, "POST", `/api/wf/tasks/${mt2.taskId}/approve`, { comment: "经理确认提交" })
  check("p2 委派确认后→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 拿回：经理办完A，下一节点B(李四)未处理前拿回重办 ---
{
  const t = `拿回-${TS}`
  const inst = await startInst(P_SEQ, t)
  const mtA = await findTodo(manager.token, t)
  await call(manager.token, "POST", `/api/wf/tasks/${mtA.taskId}/approve`, { comment: "A通过" })
  check("p2 拿回前李四(B)待办出现", !!(await findTodo(lisi.token, t)))
  const rb = await call(manager.token, "POST", `/api/wf/tasks/${mtA.taskId}/retrieve`, { comment: "我再看看" })
  check("p2 拿回成功", rb.body?.code === 0, JSON.stringify(rb.body))
  check("p2 拿回后李四(B)待办消失", !(await findTodo(lisi.token, t)))
  const mtA2 = await findTodo(manager.token, t)
  check("p2 拿回后经理重获A待办", !!mtA2)
  if (mtA2) await call(manager.token, "POST", `/api/wf/tasks/${mtA2.taskId}/approve`, { comment: "重新A通过" })
  const ltB = await findTodo(lisi.token, t)
  if (ltB) await call(lisi.token, "POST", `/api/wf/tasks/${ltB.taskId}/approve`, { comment: "B通过" })
  check("p2 拿回后走通→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 任意驳回到指定节点：李四(B)驳回到A重审 ---
{
  const t = `驳回到节点-${TS}`
  const inst = await startInst(P_SEQ, t)
  const mtA = await findTodo(manager.token, t)
  await call(manager.token, "POST", `/api/wf/tasks/${mtA.taskId}/approve`, {})
  const ltB = await findTodo(lisi.token, t)
  const rj = await call(lisi.token, "POST", `/api/wf/tasks/${ltB.taskId}/reject`, { comment: "退回A重审", target: "NODE", targetNodeId: "a", resumeStrategy: "BACK" })
  check("p2 任意驳回到指定节点成功", rj.body?.code === 0, JSON.stringify(rj.body))
  const mtA2 = await findTodo(manager.token, t)
  check("p2 驳回后经理A节点重审", !!mtA2)
  if (mtA2) await call(manager.token, "POST", `/api/wf/tasks/${mtA2.taskId}/approve`, {})
  const ltB2 = await findTodo(lisi.token, t)
  if (ltB2) await call(lisi.token, "POST", `/api/wf/tasks/${ltB2.taskId}/approve`, {})
  check("p2 驳回重审走通→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 管理员跳转：从A跳到B ---
{
  const t = `跳转-${TS}`
  const inst = await startInst(P_SEQ, t)
  check("p2 跳转前经理(A)待办", !!(await findTodo(manager.token, t)))
  const jp = await call(admin.token, "POST", `/api/wf/instances/${inst.id}/jump`, { targetNodeId: "b", comment: "直接到B" })
  check("p2 管理员跳转成功", jp.body?.code === 0, JSON.stringify(jp.body))
  check("p2 跳转后李四(B)待办出现", !!(await findTodo(lisi.token, t)))
  check("p2 跳转后经理(A)待办消失", !(await findTodo(manager.token, t)))
  const jpDeny = await call(zhangsan.token, "POST", `/api/wf/instances/${inst.id}/jump`, { targetNodeId: "a" })
  check("p2 无权限跳转→403", jpDeny.status === 403)
  const ltB = await findTodo(lisi.token, t)
  if (ltB) await call(lisi.token, "POST", `/api/wf/tasks/${ltB.taskId}/approve`, {})
}

// --- 管理员终止 ---
{
  const t = `终止-${TS}`
  const inst = await startInst(P_SINGLE, t)
  const tm = await call(admin.token, "POST", `/api/wf/instances/${inst.id}/terminate`, { comment: "违规终止" })
  check("p2 管理员终止成功", tm.body?.code === 0 && tm.body.data?.bizStatus === "TERMINATED", JSON.stringify(tm.body))
  const tmDeny = await call(zhangsan.token, "POST", `/api/wf/instances/${inst.id}/terminate`, {})
  check("p2 无权限终止→403或已终止", tmDeny.status === 403 || tmDeny.body?.code === 400)
}

// --- 催办 ---
{
  const t = `催办-${TS}`
  const inst = await startInst(P_SINGLE, t)
  const before = (await call(manager.token, "GET", "/api/wf/notifies/unread-count")).body?.data ?? 0
  const ur = await call(zhangsan.token, "POST", `/api/wf/instances/${inst.id}/urge`, { comment: "尽快处理" })
  check("p2 催办成功", ur.body?.code === 0, JSON.stringify(ur.body))
  const after = (await call(manager.token, "GET", "/api/wf/notifies/unread-count")).body?.data ?? 0
  check("p2 催办后经理未读+", after > before, `${before}->${after}`)
  const mt = await findTodo(manager.token, t)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

// --- 委托规则（代理）：经理预设李四为代理，命中任务双方可见可办 ---
{
  const rule = await call(manager.token, "POST", "/api/wf/delegate-rules", { delegateToId: LISI, defCode: P_AGENT, enabled: true })
  check("p2 创建委托规则(代理)", rule.body?.code === 0, JSON.stringify(rule.body))
  const t = `代理-${TS}`
  const inst = await startInst(P_AGENT, t)
  check("p2 代理:委托人(经理)可见", !!(await findTodo(manager.token, t)))
  const lt = await findTodo(lisi.token, t)
  check("p2 代理:受托人(李四)也可见", !!lt)
  if (lt) await call(lisi.token, "POST", `/api/wf/tasks/${lt.taskId}/approve`, { comment: "代理办结" })
  check("p2 代理:任一办结→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  const rules = await call(manager.token, "GET", "/api/wf/delegate-rules")
  check("p2 委托规则列表可查", (rules.body?.data ?? []).some((r) => r.id === rule.body.data.id))
  const del = await call(manager.token, "DELETE", `/api/wf/delegate-rules/${rule.body.data.id}`)
  check("p2 删除委托规则", del.body?.code === 0)
}

// --- 健壮性：无效 userId 不静默创建幽灵任务 ---
{
  const t = `无效用户-${TS}`
  const inst = await startInst(P_SINGLE, t)
  const mt = await findTodo(manager.token, t)
  const badT = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/transfer`, { user: orgUser(999999) })
  check("p2 转办不存在用户→业务错误(非静默)", badT.body?.code === 400, JSON.stringify(badT.body))
  const badA = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/add-sign`, { mode: "PRE", users: [orgUser(999999)] })
  check("p2 加签不存在用户→业务错误", badA.body?.code === 400, JSON.stringify(badA.body))
  check("p2 无效操作后经理待办仍在(未产生幽灵流转)", !!(await findTodo(manager.token, t)))
  await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

// --- 管理员实例列表 + DTO 扩展(allowedOps/isAdmin) ---
{
  const adminList = await call(admin.token, "GET", "/api/wf/instances/admin?pageNum=1&pageSize=5")
  check("p2 管理员实例列表", adminList.body?.code === 0 && (adminList.body?.data?.list ?? []).length > 0)
  const adminDeny = await call(zhangsan.token, "GET", "/api/wf/instances/admin?pageNum=1&pageSize=5")
  check("p2 无权限访问管理员列表→403", adminDeny.status === 403)
  const t = `DTO扩展-${TS}`
  const inst = await startInst(P_SINGLE, t)
  const mt = await findTodo(manager.token, t)
  const det = await call(manager.token, "GET", `/api/wf/instances/${inst.id}`)
  check("p2 详情 allowedOps 含 approve", (det.body?.data?.allowedOps ?? []).includes("approve"))
  const adminDet = await call(admin.token, "GET", `/api/wf/instances/${inst.id}`)
  check("p2 详情 isAdmin=true(管理员) + jumpTargets 非空", adminDet.body?.data?.isAdmin === true && (adminDet.body?.data?.jumpTargets ?? []).length > 0)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

/* ---------- 16. 工作流 P2 批次2：协作与治理 ---------- */
async function findTodoByNode(token, nodePrefix) {
  const r = await call(token, "GET", "/api/wf/tasks/todo?pageNum=1&pageSize=100")
  return (r.body?.data?.list ?? []).find((t) => (t.nodeName ?? "").startsWith(nodePrefix))
}

// --- 暂存草稿：存→列表→改→提交激活 ---
{
  const dr = await call(zhangsan.token, "POST", "/api/wf/instances/draft", { defCode: P_SINGLE, title: `草稿单-${TS}`, formData: { note: "初稿" } })
  check("p2 存草稿(DRAFT,不启引擎)", dr.body?.code === 0 && dr.body.data?.bizStatus === "DRAFT", JSON.stringify(dr.body))
  const did = dr.body?.data?.id
  const drafts = await call(zhangsan.token, "GET", "/api/wf/instances/drafts?pageNum=1&pageSize=100")
  check("p2 我的草稿列表含新草稿", (drafts.body?.data?.list ?? []).some((r) => r.id === did))
  const up = await call(zhangsan.token, "PUT", `/api/wf/instances/${did}/draft`, { title: `草稿单改-${TS}`, formData: { note: "改稿" } })
  check("p2 修改草稿", up.body?.code === 0 && up.body.data?.title === `草稿单改-${TS}`)
  const sub = await call(zhangsan.token, "POST", `/api/wf/instances/${did}/submit`, { formData: { note: "定稿" } })
  check("p2 提交草稿→RUNNING(启引擎)", sub.body?.code === 0 && sub.body.data?.bizStatus === "RUNNING", JSON.stringify(sub.body))
  const mt = await findTodo(manager.token, `草稿单改-${TS}`)
  check("p2 草稿提交后经理待办出现", !!mt)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

// --- 协办：经理邀李四协办，李四给意见（不阻塞主流程） ---
{
  const t = `协办-${TS}`
  const inst = await startInst(P_SINGLE, t)
  const mt = await findTodo(manager.token, t)
  const as = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/assist`, { users: [orgUser(LISI)], comment: "请李四把关" })
  check("p2 协办发起成功", as.body?.code === 0, JSON.stringify(as.body))
  const at = await findTodoByNode(lisi.token, "协办")
  check("p2 协办任务到达李四", !!at, JSON.stringify(at))
  if (at) {
    const rep = await call(lisi.token, "POST", `/api/wf/tasks/${at.taskId}/complete-adhoc`, { comment: "李四协办意见：同意" })
    check("p2 协办意见提交", rep.body?.code === 0)
  }
  // 主流程不受协办阻塞：经理正常审批
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, { comment: "经理审批" })
  check("p2 协办不阻塞主流程→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  const det = await call(zhangsan.token, "GET", `/api/wf/instances/${inst.id}`)
  check("p2 协办意见入时间线", (det.body?.data?.timeline ?? []).some((x) => x.action === "ASSIST_REPLY" || x.action === "ASSIST"))
}

// --- 沟通 + 已阅 ---
{
  const t = `沟通已阅-${TS}`
  const inst = await startInst(P_SINGLE, t)
  const mt = await findTodo(manager.token, t)
  const cm = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/communicate`, { toUserIds: [uidByName.zhangsan], content: "请补充材料" })
  check("p2 沟通留言成功", cm.body?.code === 0, JSON.stringify(cm.body))
  const det = await call(zhangsan.token, "GET", `/api/wf/instances/${inst.id}`)
  check("p2 沟通线程入详情 comments", (det.body?.data?.comments ?? []).some((c) => c.content === "请补充材料"))
  const rd = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/read`)
  check("p2 已阅标记成功", rd.body?.code === 0)
  const detM = await call(manager.token, "GET", `/api/wf/instances/${inst.id}`)
  check("p2 已阅后详情 readByMe=true", detM.body?.data?.readByMe === true)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

// --- 追加节点：为运行中实例动态加处理人(李四) ---
{
  const t = `追加节点-${TS}`
  const inst = await startInst(P_SINGLE, t)
  const mt = await findTodo(manager.token, t)
  const ap = await call(admin.token, "POST", `/api/wf/instances/${inst.id}/append-node`, { name: "补充审核", assignees: [orgUser(LISI)], multiMode: "ANY" })
  check("p2 追加节点成功", ap.body?.code === 0, JSON.stringify(ap.body))
  const at = await findTodoByNode(lisi.token, "补充审核")
  check("p2 追加节点任务到达李四", !!at)
  if (at) await call(lisi.token, "POST", `/api/wf/tasks/${at.taskId}/complete-adhoc`, { comment: "补充审核通过" })
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
  check("p2 追加节点不阻塞主流程→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 离职交接：把经理全部在途任务转交李四 ---
{
  const t = `交接-${TS}`
  const inst = await startInst(P_SINGLE, t)
  check("p2 交接前经理有待办", !!(await findTodo(manager.token, t)))
  const ho = await call(admin.token, "POST", "/api/wf/handover", { fromUserId: MANAGER, toUserId: LISI, comment: "经理离职交接" })
  check("p2 离职交接成功(count≥1)", ho.body?.code === 0 && ho.body.data >= 1, JSON.stringify(ho.body))
  const lt = await findTodo(lisi.token, t)
  check("p2 交接后李四接手待办", !!lt)
  check("p2 交接后经理待办清空", !(await findTodo(manager.token, t)))
  const hoDeny = await call(zhangsan.token, "POST", "/api/wf/handover", { fromUserId: MANAGER, toUserId: LISI })
  check("p2 无权限交接→403", hoDeny.status === 403)
  if (lt) await call(lisi.token, "POST", `/api/wf/tasks/${lt.taskId}/approve`, {})
}

/* ---------- 17. 工作流 P2 批次3：引擎增强 ---------- */
async function waitFor(fn, timeoutMs = 16000, stepMs = 1000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return false
}
const ZS = uidByName.zhangsan

// --- 票签 VOTE：权重 2/1/1 阈值0.5，赞成权重过半提前完成 ---
{
  const weights = {}
  weights[MANAGER] = 2; weights[ZS] = 1; weights[LISI] = 1
  const P_VOTE = await mkProc(`p2vote_${TS}`, [{
    id: "vote", type: "approval", name: "票签评审",
    assigneeRules: [{ type: "ORG", refs: [orgUser(MANAGER), orgUser(ZS), orgUser(LISI)] }],
    multiMode: "VOTE", voteConfig: { weights, threshold: 0.5 }, emptyStrategy: "TO_ADMIN",
  }])
  const t = `票签-${TS}`
  const inst = await startInst(P_VOTE, t)
  check("p2 票签发起后三人皆有待办", !!(await findTodo(manager.token, t)) && !!(await findTodo(lisi.token, t)) && !!(await findTodo(zhangsan.token, t)))
  const mt = await findTodo(manager.token, t)
  await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, { comment: "经理赞成(权重2)" })
  check("p2 票签仅经理赞成(2/4)未过阈值", (await bizStatus(zhangsan.token, inst.id)) === "RUNNING")
  const zt = await findTodo(zhangsan.token, t)
  await call(zhangsan.token, "POST", `/api/wf/tasks/${zt.taskId}/approve`, { comment: "张三赞成(权重1)" })
  check("p2 票签赞成权重过半(3/4)→提前完成APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  check("p2 票签过阈值后李四剩余票被收敛", !(await findTodo(lisi.token, t)))
}

// --- 包容分支 INCLUSIVE：多条件命中多路并行 ---
{
  const P_INC = await mkProc(`p2inc_${TS}`, [{
    id: "inc", type: "condition", name: "包容判断", gatewayType: "INCLUSIVE",
    branches: [
      { id: "b1", name: "大额", conditions: [{ field: "amount", operator: ">", value: 100 }], steps: [approvalNode("na", "大额审", MANAGER)] },
      { id: "b2", name: "加急", conditions: [{ field: "urgent", operator: "==", value: true }], steps: [approvalNode("nb", "加急审", LISI)] },
      { id: "bd", name: "默认", default: true, steps: [] },
    ],
  }])
  const t = `包容-${TS}`
  const inst = await startInst(P_INC, t, { amount: 200, urgent: true })
  const na = await findTodo(manager.token, t)
  const nb = await findTodo(lisi.token, t)
  check("p2 包容分支两路并行(经理+李四均待办)", !!na && !!nb, JSON.stringify({ na: !!na, nb: !!nb }))
  if (na) await call(manager.token, "POST", `/api/wf/tasks/${na.taskId}/approve`, {})
  check("p2 包容分支一路完成后仍RUNNING(等另一路)", (await bizStatus(zhangsan.token, inst.id)) === "RUNNING")
  if (nb) await call(lisi.token, "POST", `/api/wf/tasks/${nb.taskId}/approve`, {})
  check("p2 包容分支两路汇聚→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 分组策略 CLAIM + 认领/退回池 ---
{
  const P_CLAIM = await mkProc(`p2claim_${TS}`, [{
    id: "pool", type: "approval", name: "公共池审批", groupMode: "CLAIM",
    assigneeRules: [{ type: "ORG", refs: [orgUser(MANAGER), orgUser(LISI)] }],
  }])
  const t = `认领-${TS}`
  const inst = await startInst(P_CLAIM, t)
  const mt = await findTodo(manager.token, t)
  check("p2 CLAIM 任务入池(经理可见待认领)", !!mt && mt.groupClaim === true, JSON.stringify(mt))
  check("p2 CLAIM 任务李四也可见(候选)", !!(await findTodo(lisi.token, t)))
  const cl = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/claim`)
  check("p2 认领成功", cl.body?.code === 0, JSON.stringify(cl.body))
  const mtA = await findTodo(manager.token, t)
  check("p2 认领后 groupClaim=false(已归属)", !!mtA && mtA.groupClaim === false)
  const un = await call(manager.token, "POST", `/api/wf/tasks/${mtA.taskId}/unclaim`)
  check("p2 退回池成功", un.body?.code === 0)
  const mtB = await findTodo(manager.token, t)
  check("p2 退回池后 groupClaim=true", !!mtB && mtB.groupClaim === true)
  await call(manager.token, "POST", `/api/wf/tasks/${mtB.taskId}/claim`)
  const mtC = await findTodo(manager.token, t)
  await call(manager.token, "POST", `/api/wf/tasks/${mtC.taskId}/approve`, {})
  check("p2 认领后办结→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 超时自动通过（短 timer，服务层扫描驱动）---
{
  const P_TIMEOUT = await mkProc(`p2timeout_${TS}`, [{
    id: "ap", type: "approval", name: "限时审批", assigneeRules: [{ type: "ORG", refs: [orgUser(MANAGER)] }],
    multiMode: "ANY", emptyStrategy: "TO_ADMIN", timeout: { seconds: 4, action: "AUTO_PASS" },
  }])
  const t = `超时-${TS}`
  const inst = await startInst(P_TIMEOUT, t)
  check("p2 超时前经理有待办", !!(await findTodo(manager.token, t)))
  const passed2 = await waitFor(async () => (await bizStatus(zhangsan.token, inst.id)) === "APPROVED", 20000, 1500)
  check("p2 超时自动通过(未人工审批即APPROVED)", passed2)
}

// --- WEBHOOK 事件：异步 POST 实例上下文到外部 URL ---
{
  const hits = []
  const wsrv = http.createServer((req, res) => {
    let b = ""
    req.on("data", (c) => (b += c))
    req.on("end", () => { hits.push(b); res.writeHead(200); res.end("ok") })
  })
  await new Promise((r) => wsrv.listen(0, "127.0.0.1", r))
  const wport = wsrv.address().port
  const P_HOOK = await mkProc(`p2hook_${TS}`, [
    approvalNode("ap", "审批", MANAGER),
    { id: "hook", type: "webhook", name: "回调", url: `http://127.0.0.1:${wport}/wf-hook` },
  ])
  const t = `webhook-${TS}`
  const inst = await startInst(P_HOOK, t)
  check("p2 WEBHOOK 前经理待办出现(不阻塞)", !!(await findTodo(manager.token, t)))
  const mt = await findTodo(manager.token, t)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
  const got = await waitFor(async () => hits.length > 0, 6000, 500)
  check("p2 WEBHOOK 异步投递到外部URL", got, `hits=${hits.length}`)
  check("p2 WEBHOOK 载荷含 procInstId+title", got && hits.some((h) => h.includes("procInstId") && h.includes(t)), hits[0] ?? "")
  check("p2 WEBHOOK 后流程结束→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  wsrv.close()
}

// --- 流程监控（管理员）：总览 + 节点瓶颈 ---
{
  const ov = await call(admin.token, "GET", "/api/wf/monitor/overview")
  check("p2 监控总览(admin)调通", ov.body?.code === 0 && typeof ov.body.data?.total === "number"
    && typeof ov.body.data?.running === "number" && Array.isArray(ov.body.data?.byDef), JSON.stringify(ov.body?.data && { total: ov.body.data.total, running: ov.body.data.running, byDef: ov.body.data.byDef?.length }))
  const ovDeny = await call(zhangsan.token, "GET", "/api/wf/monitor/overview")
  check("p2 监控总览非管理员→403", ovDeny.status === 403)
  const bn = await call(admin.token, "GET", "/api/wf/monitor/bottleneck")
  check("p2 节点瓶颈分析(admin)调通", bn.body?.code === 0 && Array.isArray(bn.body.data)
    && bn.body.data.every((x) => typeof x.avgDurationMs === "number" && typeof x.count === "number"), `len=${(bn.body?.data ?? []).length}`)
  const bnDeny = await call(zhangsan.token, "GET", "/api/wf/monitor/bottleneck")
  check("p2 节点瓶颈非管理员→403", bnDeny.status === 403)
}

/* ---------- 18. 工作流 P3 批次1：结构（子流程/定时/触发/节点表单权限） ---------- */
// 子流程被调流程需先部署
const P3_SUB_CHILD = await mkProc(`p3subchild_${TS}`, [approvalNode("cap", "子审批", LISI)])

// --- 子流程 同步 CallActivity：父→子→回父，subInstances 联动 ---
{
  const P_SUB = await mkProc(`p3subparent_${TS}`, [
    approvalNode("pa", "父审批", MANAGER),
    { id: "sub", type: "subprocess", name: "报销子流程", defCode: P3_SUB_CHILD, async: false },
    approvalNode("pb", "父终审", MANAGER),
  ])
  const t = `子流程同步-${TS}`
  const inst = await startInst(P_SUB, t)
  const pa = await findTodo(manager.token, t)
  check("p3 子流程父节点待办", !!pa)
  if (pa) await call(manager.token, "POST", `/api/wf/tasks/${pa.taskId}/approve`, {})
  const cap = await findTodoByNode(lisi.token, "子审批")
  check("p3 同步子流程启动:子任务到达李四", !!cap, JSON.stringify(cap))
  const det1 = await call(zhangsan.token, "GET", `/api/wf/instances/${inst.id}`)
  check("p3 详情 subInstances 含运行中子流程", (det1.body?.data?.subInstances ?? []).some((s) => s.bizStatus === "RUNNING"), JSON.stringify(det1.body?.data?.subInstances))
  check("p3 子流程期间父流程仍RUNNING(同步等待)", (await bizStatus(zhangsan.token, inst.id)) === "RUNNING")
  if (cap) await call(lisi.token, "POST", `/api/wf/tasks/${cap.taskId}/approve`, {})
  const pb = await findTodo(manager.token, t)
  check("p3 子流程结束父流程回跳终审", !!pb)
  if (pb) await call(manager.token, "POST", `/api/wf/tasks/${pb.taskId}/approve`, {})
  check("p3 子流程父子联动走通→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 子流程 异步：并行旁路，主线不阻塞 ---
{
  const P_ASYNC = await mkProc(`p3async_${TS}`, [
    { id: "asub", type: "subprocess", name: "异步子流程", defCode: P3_SUB_CHILD, async: true },
    approvalNode("mainAp", "主线审批", MANAGER),
  ])
  const t = `子流程异步-${TS}`
  const inst = await startInst(P_ASYNC, t)
  const mainAp = await findTodo(manager.token, t)
  const cap = await findTodoByNode(lisi.token, "子审批")
  check("p3 异步子流程:主线不阻塞(经理待办)+子流程并行(李四待办)", !!mainAp && !!cap, JSON.stringify({ mainAp: !!mainAp, cap: !!cap }))
  if (cap) await call(lisi.token, "POST", `/api/wf/tasks/${cap.taskId}/approve`, {})
  if (mainAp) await call(manager.token, "POST", `/api/wf/tasks/${mainAp.taskId}/approve`, {})
  check("p3 异步子流程双线完成→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 定时 timer：intermediateCatchEvent + AsyncExecutor ---
{
  const P_TIMER = await mkProc(`p3timer_${TS}`, [
    { id: "tm", type: "timer", name: "等待", mode: "duration", value: "PT3S" },
    approvalNode("afterTimer", "定时后审批", MANAGER),
  ])
  const t = `定时-${TS}`
  const inst = await startInst(P_TIMER, t)
  check("p3 定时节点等待中(经理暂无待办)", !(await findTodo(manager.token, t)))
  const fired = await waitFor(async () => !!(await findTodo(manager.token, t)), 25000, 1500)
  check("p3 定时到期后进入下一节点(经理待办出现)", fired)
  const mt = await findTodo(manager.token, t)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
  check("p3 定时流程走通→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 触发 trigger：IMMEDIATE serviceTask→注册触发器 ---
{
  const P_TRG = await mkProc(`p3trigger_${TS}`, [
    { id: "trg", type: "trigger", name: "触发器", triggerType: "IMMEDIATE", handler: "wfEchoTrigger", config: { var: "trgFlag" } },
    approvalNode("afterTrg", "触发后审批", MANAGER),
  ])
  const t = `触发-${TS}`
  const inst = await startInst(P_TRG, t)
  const mt = await findTodo(manager.token, t)
  check("p3 触发节点执行后进入下一节点", !!mt)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
  check("p3 触发流程走通→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 节点表单权限：详情按当前节点返回 formPerms ---
{
  const P_PERMS = await mkProc(`p3perms_${TS}`, [{
    id: "ap", type: "approval", name: "权限审批",
    assigneeRules: [{ type: "ORG", refs: [orgUser(MANAGER)] }], multiMode: "ANY", emptyStrategy: "TO_ADMIN",
    formPerms: { days: "EDIT", reason: "READ", salary: "HIDDEN" },
  }])
  const t = `节点表单权限-${TS}`
  const inst = await startInst(P_PERMS, t)
  const det = await call(manager.token, "GET", `/api/wf/instances/${inst.id}`)
  const perms = det.body?.data?.nodeFormPerms ?? {}
  check("p3 详情按当前节点返回 formPerms", perms.days === "EDIT" && perms.reason === "READ" && perms.salary === "HIDDEN", JSON.stringify(perms))
  const mt = await findTodo(manager.token, t)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

/* ---------- 19. 工作流 P3 批次2：治理（唤醒/穿越时空/预测/印章） ---------- */
// --- 流程预测：静态 DFS + 条件离线求值 + 预计审批人 ---
const P_PREDICT = await mkProc(`p3predict_${TS}`, [
  approvalNode("m1", "初审", MANAGER),
  { id: "cond", type: "condition", name: "金额判断", branches: [
    { id: "big", name: "大额", conditions: [{ field: "amount", operator: ">", value: 1000 }], steps: [approvalNode("boss", "老板审批", LISI)] },
    { id: "d", name: "默认", default: true, steps: [] },
  ] },
])
{
  const tBig = `预测大额-${TS}`
  const instBig = await startInst(P_PREDICT, tBig, { amount: 5000 })
  const predBig = await call(zhangsan.token, "POST", `/api/wf/instances/${instBig.id}/predict`)
  check("p3 预测:大额路径含老板审批", (predBig.body?.data?.path ?? []).some((n) => n.nodeName === "老板审批"), JSON.stringify(predBig.body?.data?.path))
  check("p3 预测:审批节点带预计审批人", (predBig.body?.data?.path ?? []).some((n) => (n.assignees ?? []).length > 0))
  const tSmall = `预测小额-${TS}`
  const instSmall = await startInst(P_PREDICT, tSmall, { amount: 100 })
  const predSmall = await call(zhangsan.token, "POST", `/api/wf/instances/${instSmall.id}/predict`)
  check("p3 预测:小额路径不含老板审批(条件离线求值)", !(predSmall.body?.data?.path ?? []).some((n) => n.nodeName === "老板审批"), JSON.stringify(predSmall.body?.data?.path))
  for (const ttl of [tBig, tSmall]) { const mt = await findTodo(manager.token, ttl); if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {}) }
  // 大额单据清理老板审批
  const bt = await findTodo(lisi.token, tBig); if (bt) await call(lisi.token, "POST", `/api/wf/tasks/${bt.taskId}/approve`, {})
}

// --- 离线预测覆盖新版二维来源：FUTURE 节点 {kind:ACCOUNT, source:FORM_FIELD} 必须能离线预测出人 ---
// 回归防护：resolveOffline 曾只按 type/kind 分发，新形状 {kind:ACCOUNT, source:FORM_FIELD} 会落到
// ACCOUNT/refs 分支预测为空（老形状 {kind:FORM_FIELD} 才从 values 读取）。修复后 resolveOffline 与
// evalRule 共用来源优先分发，FORM_FIELD 从离线表单值求值，故未来节点预计审批人应非空。
{
  const P_PRED_SRC = await mkProc(`p3predsrc_${TS}`, [
    approvalNode("m1", "初审经理", MANAGER),
    {
      id: "fut", type: "approval", name: "表单指定审(来源FORM_FIELD)",
      assigneeRules: [{ kind: "ACCOUNT", source: "FORM_FIELD", field: "approver" }],
      multiMode: "ANY", emptyStrategy: "TO_ADMIN",
    },
  ])
  const t = `预测来源FORM_FIELD-${TS}`
  const inst = await startInst(P_PRED_SRC, t, { approver: LISI })
  const pred = await call(zhangsan.token, "POST", `/api/wf/instances/${inst.id}/predict`)
  const futNode = (pred.body?.data?.path ?? []).find((n) => n.nodeId === "fut")
  check(
    "p3 预测:新版二维来源 FORM_FIELD 未来节点预计审批人非空(离线来源分发回归)",
    !!futNode && (futNode.assignees ?? []).length > 0,
    JSON.stringify(pred.body?.data?.path),
  )
  // 清理：走完流程
  const mt = await findTodo(manager.token, t); if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
  const lt = await findTodo(lisi.token, t); if (lt) await call(lisi.token, "POST", `/api/wf/tasks/${lt.taskId}/approve`, {})
}

// --- 穿越时空：bizTime 业务时间 ---
{
  const t = `穿越时空-${TS}`
  const st = await call(zhangsan.token, "POST", "/api/wf/instances", { defCode: P_SINGLE, title: t, formData: { note: "补审" }, bizTime: "2025-01-15" })
  check("p3 穿越时空发起成功", st.body?.code === 0, JSON.stringify(st.body))
  const det = await call(zhangsan.token, "GET", `/api/wf/instances/${st.body.data.id}`)
  check("p3 穿越时空业务时间记录展示", (det.body?.data?.bizTime ?? "").startsWith("2025-01-15"), det.body?.data?.bizTime)
  const mt = await findTodo(manager.token, t)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

// --- 唤醒：已结束实例按快照重建并定位重审 ---
{
  const P_RES = await mkProc(`p3res_${TS}`, [approvalNode("rap", "唤醒审批", MANAGER)])
  const t = `唤醒-${TS}`
  const inst = await startInst(P_RES, t)
  const mt = await findTodo(manager.token, t)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
  check("p3 唤醒前实例已结束APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  const det0 = await call(zhangsan.token, "GET", `/api/wf/instances/${inst.id}`)
  check("p3 已结束实例 resurrectable=true", det0.body?.data?.resurrectable === true)
  const rs = await call(admin.token, "POST", `/api/wf/instances/${inst.id}/resurrect`, { nodeId: "rap", comment: "重新审批" })
  check("p3 唤醒成功→RUNNING(重建定位)", rs.body?.code === 0 && rs.body.data?.bizStatus === "RUNNING", JSON.stringify(rs.body))
  const mt2 = await findTodo(manager.token, t)
  check("p3 唤醒后经理重新待办", !!mt2)
  if (mt2) await call(manager.token, "POST", `/api/wf/tasks/${mt2.taskId}/approve`, {})
  check("p3 唤醒后重审走通→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 印章管理 CRUD ---
{
  const cr = await call(admin.token, "POST", "/api/wf/seals", { name: `公章-${TS}`, imageFileId: null, enabled: true })
  check("p3 印章创建", cr.body?.code === 0 && cr.body.data?.id, JSON.stringify(cr.body))
  const sid = cr.body?.data?.id
  const ls = await call(admin.token, "GET", "/api/wf/seals")
  check("p3 印章列表含新章", (ls.body?.data ?? []).some((s) => s.id === sid))
  const crDeny = await call(zhangsan.token, "POST", "/api/wf/seals", { name: "x" })
  check("p3 无权限建印章→403", crDeny.status === 403)
  const del = await call(admin.token, "DELETE", `/api/wf/seals/${sid}`)
  check("p3 印章删除", del.body?.code === 0)
}

/* ---------- 20. 工作流 P3 批次3：智能（AI 审批节点 / 动态构建 ad-hoc） ---------- */
// --- AI 审批节点：无 key 降级模拟，actor=AI，意见明示「AI模拟」 ---
{
  const P_AI = await mkProc(`p3ai_${TS}`, [
    { id: "aiap", type: "ai", name: "AI审批", model: "gpt-4o-mini", systemPrompt: "审批请假", formContext: ["days"], outputMap: { approve: "aiApproved" } },
  ])
  const t = `AI审批-${TS}`
  const inst = await startInst(P_AI, t, { days: 2 })
  check("p3 AI节点模拟审批走通→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED", await bizStatus(zhangsan.token, inst.id))
  const det = await call(zhangsan.token, "GET", `/api/wf/instances/${inst.id}`)
  const aiOp = (det.body?.data?.timeline ?? []).find((x) => x.action === "AI_APPROVE")
  check("p3 AI审批记录 actor=AI", !!aiOp && aiOp.actorName === "AI", JSON.stringify(aiOp))
  check("p3 AI审批意见明示「AI模拟」", !!aiOp && (aiOp.comment ?? "").includes("AI模拟"), aiOp?.comment)
}

// --- 动态构建 ad-hoc 任务：不体现流程图，服务层管理，不阻塞主流程 ---
{
  const t = `动态构建-${TS}`
  const inst = await startInst(P_SINGLE, t)
  const ad = await call(admin.token, "POST", `/api/wf/instances/${inst.id}/adhoc-task`, { name: "临时核查", assignees: [orgUser(LISI)] })
  check("p3 动态构建 ad-hoc 任务成功", ad.body?.code === 0, JSON.stringify(ad.body))
  const at = await findTodoByNode(lisi.token, "临时核查")
  check("p3 ad-hoc 任务到达李四(不体现流程图)", !!at, JSON.stringify(at))
  if (at) await call(lisi.token, "POST", `/api/wf/tasks/${at.taskId}/complete-adhoc`, { comment: "核查完成" })
  const mt = await findTodo(manager.token, t)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
  check("p3 ad-hoc 不阻塞主流程→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

/* ---------- 关联表单记录端点（relation 控件数据源 type=form） ---------- */
{
  // leave_approval 流程绑定 form_code=leave，前面已发起多条请假实例
  const rec = await call(zhangsan.token, "GET", "/api/wf/form-defs/leave/records?pageNum=1&pageSize=50")
  const list = rec.body?.data?.list ?? []
  check("wf 关联表单记录端点返回请假实例", rec.body?.code === 0 && list.length > 0, JSON.stringify(rec.body?.code))
  check(
    "wf 关联记录含 value/label（存储展示分离）",
    list.length > 0 && list.every((r) => r.value && r.label),
    JSON.stringify(list[0] ?? {}),
  )
  // 未被任何流程使用的表单 → 空页（优雅空态）
  const empty = await call(zhangsan.token, "GET", "/api/wf/form-defs/__none__/records")
  check("wf 未绑定流程的表单返回空页", empty.body?.code === 0 && (empty.body?.data?.list ?? []).length === 0)
}

/* ---------- P1-C：自定义表单流程（formType=CUSTOM 发起/详情运行时） ---------- */
{
  const customCode = `custom_form_${TS}`
  const create = await call(admin.token, "POST", "/api/wf/process-defs", {
    defCode: customCode,
    name: "自定义表单流程",
    category: "测试",
    designerType: "DINGTALK",
    designerJson: JSON.stringify({
      // 顶层 flowConfig 应写入 process 扩展元素 oa:flowConfig
      flowConfig: { operations: { cancel: true, terminate: true } },
      nodes: [
        {
          id: "n1",
          type: "approval",
          name: "审批",
          assigneeRules: [{ type: "INITIATOR" }],
          allowedOps: ["approve", "reject"],
          handleOptions: { historyFirst: true, includeSelf: true },
        },
      ],
    }),
    formType: "CUSTOM",
    formSubmitPath: "/flow/custom/create",
    formViewPath: "/flow/custom/view",
    flowConfig: JSON.stringify({ operations: { cancel: true } }),
  })
  check("p1c 创建 CUSTOM 表单流程", create.body?.code === 0, JSON.stringify(create.body))
  check(
    "p1c 定义返回 formType/paths",
    create.body?.data?.formType === "CUSTOM" &&
      create.body?.data?.formSubmitPath === "/flow/custom/create" &&
      create.body?.data?.formViewPath === "/flow/custom/view",
    JSON.stringify(create.body?.data),
  )
  const pub = await call(admin.token, "POST", `/api/wf/process-defs/${create.body.data.id}/publish`)
  check("p1c 发布 CUSTOM 流程(含 nodeConfig/flowConfig 转换)", pub.body?.code === 0, JSON.stringify(pub.body))
  // BPMN 应含节点配置 + 流程级 flowConfig 扩展元素
  const pubXml = pub.body?.data?.bpmnXml ?? ""
  check("p1c BPMN 含 oa:flowConfig(流程级)", pubXml.includes("flowConfig"), String(pubXml.length))
  check("p1c BPMN 含 oa:handleOptions(节点级)",
    pubXml.includes("handleOptions"), String(pubXml.length))

  // startable 返回 formType + 自定义路径
  const startableC = await call(zhangsan.token, "GET", "/api/wf/startable")
  const cCard = (startableC.body?.data ?? []).find((s) => s.defCode === customCode)
  check(
    "p1c startable 返回 formType=CUSTOM + submit/view 路径",
    !!cCard && cCard.formType === "CUSTOM" &&
      cCard.formSubmitPath === "/flow/custom/create" && cCard.formViewPath === "/flow/custom/view",
    JSON.stringify(cCard),
  )

  // 发起：CUSTOM 表单 formData 由自定义页面提交，后端照存不做动态 schema 校验
  const startC = await call(zhangsan.token, "POST", "/api/wf/instances", {
    defCode: customCode,
    title: `自定义表单发起-${TS}`,
    formData: { customField: "abc", amount: 999 },
  })
  check("p1c 发起 CUSTOM 表单流程(照存 formData)", startC.body?.code === 0, JSON.stringify(startC.body))
  const iid = startC.body?.data?.id
  const detC = await call(zhangsan.token, "GET", `/api/wf/instances/${iid}`)
  check(
    "p1c 详情返回 formType=CUSTOM + formViewPath",
    detC.body?.data?.formType === "CUSTOM" && detC.body?.data?.formViewPath === "/flow/custom/view",
    JSON.stringify({ formType: detC.body?.data?.formType, formViewPath: detC.body?.data?.formViewPath }),
  )
}

/* ---------- P2/P3 配套：属性面板深化的配置读取 ---------- */
// 辅助：创建并发布带 flowConfig 的 DINGTALK 流程定义
async function mkProcFull(code, designer, extra = {}) {
  const c = await call(admin.token, "POST", "/api/wf/process-defs", {
    defCode: code, name: code, designerType: "DINGTALK", designerJson: JSON.stringify(designer), ...extra,
  })
  const pub = await call(admin.token, "POST", `/api/wf/process-defs/${c.body?.data?.id}/publish`)
  check(`p2p3 发布流程 ${code}`, pub.body?.code === 0, JSON.stringify(pub.body))
  return code
}

// --- 办理人新类型：source=RELATED_TO_APPLICANT（申请人 / 申请人部门主管） ---
{
  const P_APPLICANT = await mkProc(`p2src_applicant_${TS}`, [{
    id: "ap", type: "approval", name: "申请人本人审",
    assigneeRules: [{ kind: "ACCOUNT", source: "RELATED_TO_APPLICANT", sourceValue: "APPLICANT" }],
    multiMode: "ANY", emptyStrategy: "TO_ADMIN",
  }])
  const t = `来源申请人-${TS}`
  const inst = await startInst(P_APPLICANT, t)
  const zt = await findTodo(zhangsan.token, t)
  check("p2 办理人 source=APPLICANT 解析为发起人本人", !!zt, JSON.stringify(zt))
  if (zt) await call(zhangsan.token, "POST", `/api/wf/tasks/${zt.taskId}/approve`, {})

  const P_LEADER = await mkProc(`p2src_leader_${TS}`, [{
    id: "ap", type: "approval", name: "申请人主管审",
    assigneeRules: [{ source: "RELATED_TO_APPLICANT", sourceValue: "APPLICANT_DEPT_LEADER" }],
    multiMode: "ANY", emptyStrategy: "TO_ADMIN",
  }])
  const t2 = `来源主管-${TS}`
  const inst2 = await startInst(P_LEADER, t2)
  const mt = await findTodo(manager.token, t2)
  check("p2 办理人 source=APPLICANT_DEPT_LEADER 解析为部门主管(王经理)", !!mt, JSON.stringify(mt))
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

// --- 办理选项 candidate → 认领（等价 CLAIM） ---
{
  const P_CAND = await mkProc(`p2cand_${TS}`, [{
    id: "ap", type: "approval", name: "候选认领审",
    assigneeRules: [{ type: "ORG", refs: [orgUser(MANAGER), orgUser(LISI)] }],
    handleOptions: { candidate: true },
  }])
  const t = `候选-${TS}`
  const inst = await startInst(P_CAND, t)
  const mt = await findTodo(manager.token, t)
  check("p2 handleOptions.candidate 任务入池待认领(groupClaim=true)", !!mt && mt.groupClaim === true, JSON.stringify(mt))
  check("p2 candidate 李四也可见(候选)", !!(await findTodo(lisi.token, t)))
  if (mt) {
    await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/claim`)
    const mtC = await findTodo(manager.token, t)
    if (mtC) await call(manager.token, "POST", `/api/wf/tasks/${mtC.taskId}/approve`, {})
  }
}

// --- 办理选项 autoSkip：审批人=发起人本人自动跳过（集合空 → 节点自动通过） ---
{
  const P_SKIP = await mkProc(`p2skip_${TS}`, [{
    id: "ap", type: "approval", name: "自动跳过审",
    assigneeRules: [{ type: "INITIATOR" }], multiMode: "ANY", emptyStrategy: "AUTO_PASS",
    handleOptions: { autoSkip: true },
  }])
  const t = `自动跳过-${TS}`
  const inst = await startInst(P_SKIP, t)
  check("p2 autoSkip 发起人自审自动跳过→无待办", !(await findTodo(zhangsan.token, t)))
  check("p2 autoSkip 节点跳过后流程直接结束→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

// --- 节点事件 NOTIFY：任务创建触发通知目标人 ---
{
  const P_EVT = await mkProc(`p2evt_${TS}`, [{
    id: "ap", type: "approval", name: "事件通知审",
    assigneeRules: [{ type: "ORG", refs: [orgUser(MANAGER)] }], multiMode: "ANY", emptyStrategy: "TO_ADMIN",
    events: [{ trigger: "TASK_AFTER_CREATED", action: "NOTIFY", notify: { to: [orgUser(LISI)], template: `节点创建事件通知-${TS}` } }],
  }])
  const t = `节点事件-${TS}`
  const inst = await startInst(P_EVT, t)
  const lisiNotifies = await call(lisi.token, "GET", "/api/wf/notifies?pageNum=1&pageSize=100")
  const hit = (lisiNotifies.body?.data?.list ?? []).some((n) => (n.content ?? "").includes(`节点创建事件通知-${TS}`))
  check("p3 节点事件 NOTIFY 触发(李四收到事件通知)", hit, JSON.stringify((lisiNotifies.body?.data?.list ?? []).slice(0, 3)))
  const mt = await findTodo(manager.token, t)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

// --- 审批意见必填 commentRequired ---
{
  const P_CR = await mkProc(`p2cr_${TS}`, [{
    id: "ap", type: "approval", name: "必填意见审",
    assigneeRules: [{ type: "ORG", refs: [orgUser(MANAGER)] }], multiMode: "ANY", emptyStrategy: "TO_ADMIN",
    commentRequired: true,
  }])
  const t = `必填意见-${TS}`
  const inst = await startInst(P_CR, t)
  const mt = await findTodo(manager.token, t)
  const noComment = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
  check("p2 commentRequired 无意见审批→400", noComment.body?.code === 400, JSON.stringify(noComment.body))
  const withComment = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, { comment: "同意" })
  check("p2 commentRequired 填意见后审批通过", withComment.body?.code === 0)
}

// --- 办理选项 + 审核菜单透传详情（nodeHandleOptions / auditMenu） ---
{
  const P_MENU = await mkProc(`p2menu_${TS}`, [{
    id: "ap", type: "approval", name: "菜单选项审",
    assigneeRules: [{ type: "ORG", refs: [orgUser(MANAGER)] }], multiMode: "ANY", emptyStrategy: "TO_ADMIN",
    handleOptions: { historyFirst: true, includeSelf: true, accountChecked: true, limitRange: true },
    auditMenu: { special: "JUMP_NODE", targetNodeId: "ap" },
  }])
  const t = `菜单透传-${TS}`
  const inst = await startInst(P_MENU, t)
  const mt = await findTodo(manager.token, t)
  const det = await call(manager.token, "GET", `/api/wf/instances/${inst.id}`)
  check("p2 详情透传 nodeHandleOptions(historyFirst/accountChecked)",
    det.body?.data?.nodeHandleOptions?.historyFirst === true && det.body?.data?.nodeHandleOptions?.accountChecked === true,
    JSON.stringify(det.body?.data?.nodeHandleOptions))
  check("p2 详情透传 auditMenu(JUMP/RETURN 声明)",
    det.body?.data?.auditMenu?.special === "JUMP_NODE", JSON.stringify(det.body?.data?.auditMenu))
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

// --- 流程高级：taskTitle fx 模板插值表单字段 ---
{
  const ttCode = `p3title_${TS}`
  await mkProcFull(ttCode,
    { flowConfig: { start: { taskTitle: "{申请人}的请假${days}天" } }, nodes: [approvalNode("ap", "审批", MANAGER)] },
    { flowConfig: JSON.stringify({ start: { taskTitle: "{申请人}的请假${days}天" } }) })
  const st = await call(zhangsan.token, "POST", "/api/wf/instances", { defCode: ttCode, formData: { days: 5 } })
  const title = st.body?.data?.title
  check("p3 taskTitle fx 插值表单字段生成实例标题", title?.includes("张三") && title?.includes("5天"), title)
  const mt = await findTodo(manager.token, title)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

// --- 流程高级：taskTitle fx 多占位符 + 中文 literal 边界（{申请人}的事假${days}天，三段中文夹两占位）---
{
  const ttCode = `p3title2_${TS}`
  const tpl = "{申请人}的事假${days}天(共${days}天)"
  await mkProcFull(ttCode,
    { flowConfig: { start: { taskTitle: tpl } }, nodes: [approvalNode("ap", "审批", MANAGER)] },
    { flowConfig: JSON.stringify({ start: { taskTitle: tpl } }) })
  const st = await call(zhangsan.token, "POST", "/api/wf/instances", { defCode: ttCode, formData: { days: 3 } })
  const title = st.body?.data?.title
  // 修复前：中文夹多占位时 ${days} 偶发插值为空（"张三的事假天"）；修复后每处 ${days} 均插值为 3
  check(
    "p3 taskTitle fx 多占位+中文正确插值",
    title === "张三的事假3天(共3天)",
    title,
  )
  const mt = await findTodo(manager.token, title)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

// --- 流程高级：flowConfig.variables 发起注入流程变量（供条件路由） ---
{
  const varCode = `p3var_${TS}`
  await mkProcFull(varCode,
    {
      flowConfig: { variables: [{ name: "vamount", type: "number", defaultValue: 500 }] },
      nodes: [{
        id: "c", type: "condition", name: "金额判断",
        branches: [
          { id: "b1", name: "大额", conditions: [{ field: "vamount", operator: ">", value: 100 }], steps: [approvalNode("na", "大额审", MANAGER)] },
          { id: "bd", name: "默认", default: true, steps: [] },
        ],
      }],
    },
    { flowConfig: JSON.stringify({ variables: [{ name: "vamount", type: "number", defaultValue: 500 }] }) })
  const t = `流程变量-${TS}`
  // 发起不带 vamount 表单值 → 仅靠注入的默认变量 500 命中大额分支
  const st = await call(zhangsan.token, "POST", "/api/wf/instances", { defCode: varCode, title: t, formData: {} })
  check("p3 flowConfig.variables 发起注入(条件用注入变量路由)", st.body?.code === 0, JSON.stringify(st.body))
  const mt = await findTodo(manager.token, t)
  check("p3 注入变量 vamount=500 命中大额分支→经理待办", !!mt, JSON.stringify(mt))
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
}

/* ---------- 21. 流程设计器后端校准（办理人精简+FORMULA / 票签按比例 / 并行 / 包容 / 自动通过·拒绝） ---------- */
{
  const ADMIN = uidByName.admin

  // --- A. 自定义公式 FORMULA：IF(days>3, USER(admin), USER(manager)) 按表单分流 ---
  const P_FORMULA = await mkProc(`calibformula_${TS}`, [{
    id: "fx", type: "approval", name: "公式办理人",
    assigneeRules: [{ kind: "FORMULA", formula: `IF(days>3, USER(${ADMIN}), USER(${MANAGER}))` }],
    multiMode: "ANY", emptyStrategy: "TO_ADMIN",
  }])
  {
    const t = `公式大额-${TS}`
    await startInst(P_FORMULA, t, { days: 5 })
    check("calib FORMULA days>3 → admin 待办(非经理)", !!(await findTodo(admin.token, t)) && !(await findTodo(manager.token, t)))
  }
  {
    const t = `公式小额-${TS}`
    await startInst(P_FORMULA, t, { days: 2 })
    check("calib FORMULA days<=3 → 经理待办(非admin)", !!(await findTodo(manager.token, t)) && !(await findTodo(admin.token, t)))
  }

  // --- C. 票签按比例（无权重，每人等权）：3人阈值0.5，2/3通过、1/3不通过 ---
  {
    const P_VOTE2 = await mkProc(`calibvote_${TS}`, [{
      id: "vote", type: "approval", name: "按比例票签",
      assigneeRules: [{ kind: "ACCOUNT", refs: [orgUser(MANAGER), orgUser(ZS), orgUser(LISI)] }],
      multiMode: "VOTE", voteConfig: { threshold: 0.5 }, emptyStrategy: "TO_ADMIN",
    }])
    const t = `按比例票签-${TS}`
    const inst = await startInst(P_VOTE2, t)
    check("calib 票签三人皆待办", !!(await findTodo(manager.token, t)) && !!(await findTodo(zhangsan.token, t)) && !!(await findTodo(lisi.token, t)))
    const mt = await findTodo(manager.token, t)
    await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, { comment: "赞成1" })
    check("calib 票签 1/3 未过阈值(仍RUNNING)", (await bizStatus(zhangsan.token, inst.id)) === "RUNNING")
    const zt = await findTodo(zhangsan.token, t)
    await call(zhangsan.token, "POST", `/api/wf/tasks/${zt.taskId}/approve`, { comment: "赞成2" })
    check("calib 票签 2/3 过阈值→提前完成APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
    check("calib 票签过阈值后李四剩余票被收敛", !(await findTodo(lisi.token, t)))
  }

  // --- D1. 并行分支 parallel：两路都激活，全汇聚才继续 ---
  {
    const P_PAR = await mkProc(`calibpar_${TS}`, [{
      id: "par", type: "parallel", name: "并行会办", branches: [
        { steps: [approvalNode("pa", "并行A经理", MANAGER)] },
        { steps: [approvalNode("pb", "并行B李四", LISI)] },
      ],
    }])
    const t = `并行-${TS}`
    const inst = await startInst(P_PAR, t)
    const na = await findTodo(manager.token, t)
    const nb = await findTodo(lisi.token, t)
    check("calib 并行两路都激活(经理+李四待办)", !!na && !!nb, JSON.stringify({ na: !!na, nb: !!nb }))
    if (na) await call(manager.token, "POST", `/api/wf/tasks/${na.taskId}/approve`, {})
    check("calib 并行一路完成仍RUNNING(等另一路)", (await bizStatus(zhangsan.token, inst.id)) === "RUNNING")
    if (nb) await call(lisi.token, "POST", `/api/wf/tasks/${nb.taskId}/approve`, {})
    check("calib 并行两路汇聚→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  }

  // --- D2. 包容分支 type=inclusive（新别名）：多条件命中多路 ---
  {
    const P_INC2 = await mkProc(`calibinc_${TS}`, [{
      id: "inc", type: "inclusive", name: "包容(type别名)", branches: [
        { name: "大额", conditions: [{ field: "amount", operator: ">", value: 100 }], steps: [approvalNode("ia", "大额审", MANAGER)] },
        { name: "加急", conditions: [{ field: "urgent", operator: "==", value: true }], steps: [approvalNode("ib", "加急审", LISI)] },
        { name: "默认", default: true, steps: [] },
      ],
    }])
    const t = `包容别名-${TS}`
    const inst = await startInst(P_INC2, t, { amount: 200, urgent: true })
    const ia = await findTodo(manager.token, t)
    const ib = await findTodo(lisi.token, t)
    check("calib type=inclusive 两路并行(经理+李四)", !!ia && !!ib, JSON.stringify({ ia: !!ia, ib: !!ib }))
    if (ia) await call(manager.token, "POST", `/api/wf/tasks/${ia.taskId}/approve`, {})
    if (ib) await call(lisi.token, "POST", `/api/wf/tasks/${ib.taskId}/approve`, {})
    check("calib type=inclusive 两路汇聚→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  }

  // --- D3. 自动通过 autoApprove：到达即自动记录并放行到后续审批 ---
  {
    const P_AA = await mkProc(`calibautoapp_${TS}`, [
      { id: "aa", type: "autoApprove", name: "自动通过" },
      approvalNode("after", "后置经理", MANAGER),
    ])
    const t = `自动通过-${TS}`
    const inst = await startInst(P_AA, t)
    const mt = await findTodo(manager.token, t)
    check("calib autoApprove 自动流转到后置经理待办", !!mt)
    const det = await call(zhangsan.token, "GET", `/api/wf/instances/${inst.id}`)
    check("calib autoApprove 时间线含 AUTO_APPROVE", (det.body?.data?.timeline ?? []).some((x) => x.action === "AUTO_APPROVE"))
    if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
    check("calib autoApprove 后置审批走通→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  }

  // --- D4. 自动拒绝 autoReject：经理审后进入自动拒绝→实例终止为 REJECTED ---
  {
    const P_AR = await mkProc(`calibautorej_${TS}`, [
      approvalNode("pre", "前置经理", MANAGER),
      { id: "ar", type: "autoReject", name: "自动拒绝" },
    ])
    const t = `自动拒绝-${TS}`
    const inst = await startInst(P_AR, t)
    const mt = await findTodo(manager.token, t)
    check("calib autoReject 前置经理待办出现", !!mt)
    if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
    check("calib autoReject 到达即终止实例为 REJECTED", (await bizStatus(zhangsan.token, inst.id)) === "REJECTED")
    const det = await call(zhangsan.token, "GET", `/api/wf/instances/${inst.id}`)
    check("calib autoReject 时间线含 AUTO_REJECT", (det.body?.data?.timeline ?? []).some((x) => x.action === "AUTO_REJECT"))
  }
}

/* ---------- 空壳精简修复：POST岗位 / start.scope / operations 开关 / BLOCK / allowedOps ---------- */
{
  // --- 修复1：POST 岗位办理人解析（postName→岗位→任职用户；此前只遍历 refs 解析 0 人）---
  {
    const posts = await call(admin.token, "GET", "/api/system/posts?pageNum=1&pageSize=100")
    const postWithUsers = (posts.body?.data?.list ?? []).find((p) => (p.userCount ?? 0) > 0)
    check("fix POST 存在有任职用户的岗位", !!postWithUsers, JSON.stringify(posts.body?.data?.list))
    if (postWithUsers) {
      const P_POST = await mkProc(`fixpost_${TS}`, [{
        id: "ap", type: "approval", name: "岗位审批",
        assigneeRules: [{ type: "POST", postName: postWithUsers.name }],
        multiMode: "ANY", emptyStrategy: "AUTO_PASS",
      }])
      const t = `岗位解析-${TS}`
      const inst = await startInst(P_POST, t)
      const det = await call(zhangsan.token, "GET", `/api/wf/instances/${inst.id}`)
      const assignees = (det.body?.data?.currentNodes ?? []).flatMap((n) => n.assignees ?? [])
      // POST 解析出人 → 节点有活动办理人且实例 RUNNING（若解析 0 人则 AUTO_PASS 直接 APPROVED）
      check("fix POST 岗位解析出办理人(节点未空过, RUNNING)",
        det.body?.data?.bizStatus === "RUNNING" && assignees.length > 0,
        JSON.stringify({ status: det.body?.data?.bizStatus, assignees: assignees.length }))
      await call(admin.token, "POST", `/api/wf/instances/${inst.id}/terminate`, { comment: "清理" })
    }
  }

  // --- 修复2：start.scope 发起权限（scope 内可见可发起；scope 外不可见 + 发起 403）---
  {
    const scopeCode = `fixscope_${TS}`
    const c = await call(admin.token, "POST", "/api/wf/process-defs", {
      defCode: scopeCode, name: scopeCode, designerType: "DINGTALK",
      designerJson: JSON.stringify({
        flowConfig: { start: { scope: [{ kind: "USER", id: MANAGER }] } },
        nodes: [approvalNode("ap", "审批", MANAGER)],
      }),
    })
    await call(admin.token, "POST", `/api/wf/process-defs/${c.body?.data?.id}/publish`)
    const mgrStartable = await call(manager.token, "GET", "/api/wf/startable")
    const zsStartable = await call(zhangsan.token, "GET", "/api/wf/startable")
    check("fix scope 范围内(manager)可见受限流程",
      (mgrStartable.body?.data ?? []).some((s) => s.defCode === scopeCode))
    check("fix scope 范围外(zhangsan)不可见受限流程",
      !(zsStartable.body?.data ?? []).some((s) => s.defCode === scopeCode))
    const zsStart = await call(zhangsan.token, "POST", "/api/wf/instances",
      { defCode: scopeCode, title: `scope外-${TS}`, formData: {} })
    check("fix scope 范围外发起 → 403", zsStart.body?.code === 403, JSON.stringify(zsStart.body))
    const mgrStart = await call(manager.token, "POST", "/api/wf/instances",
      { defCode: scopeCode, title: `scope内-${TS}`, formData: {} })
    check("fix scope 范围内发起成功", mgrStart.body?.code === 0, JSON.stringify(mgrStart.body))
    if (mgrStart.body?.data?.id) {
      await call(admin.token, "POST", `/api/wf/instances/${mgrStart.body.data.id}/terminate`, { comment: "清理" })
    }
  }

  // --- 修复3：flowConfig.operations 开关（cancel/terminate/urge 关闭 → 不可用/403）---
  {
    const opCode = `fixops_${TS}`
    const c = await call(admin.token, "POST", "/api/wf/process-defs", {
      defCode: opCode, name: opCode, designerType: "DINGTALK",
      designerJson: JSON.stringify({
        flowConfig: { operations: { cancel: false, terminate: false, urge: false } },
        nodes: [approvalNode("ap", "审批", MANAGER)],
      }),
    })
    await call(admin.token, "POST", `/api/wf/process-defs/${c.body?.data?.id}/publish`)
    const t = `操作开关-${TS}`
    const inst = await startInst(opCode, t)
    const det = await call(zhangsan.token, "GET", `/api/wf/instances/${inst.id}`)
    check("fix operations.cancel=false → 详情 canCancel=false",
      det.body?.data?.canCancel === false, JSON.stringify(det.body?.data?.canCancel))
    const cancelR = await call(zhangsan.token, "POST", `/api/wf/instances/${inst.id}/cancel`)
    check("fix operations.cancel=false → 撤销端点 403", cancelR.body?.code === 403, JSON.stringify(cancelR.body))
    const termR = await call(admin.token, "POST", `/api/wf/instances/${inst.id}/terminate`, { comment: "x" })
    check("fix operations.terminate=false → 终止端点 403", termR.body?.code === 403, JSON.stringify(termR.body))
    const urgeR = await call(admin.token, "POST", `/api/wf/instances/${inst.id}/urge`, { comment: "x" })
    check("fix operations.urge=false → 催办端点 403", urgeR.body?.code === 403, JSON.stringify(urgeR.body))
    // 清理：terminate 被关闭，改由办理人驳回退回结束
    const mt = await findTodo(manager.token, t)
    if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/reject`, { comment: "清理", target: "START" })
  }

  // --- 修复4：emptyStrategy=BLOCK 真阻塞（发起失败），区别 TO_ADMIN 静默转管理员 ---
  {
    const P_BLOCK = await mkProc(`fixblock_${TS}`, [{
      id: "ap", type: "approval", name: "空审批人BLOCK",
      assigneeRules: [{ type: "ACCOUNT", refs: [] }], multiMode: "ANY", emptyStrategy: "BLOCK",
    }])
    const blockStart = await call(zhangsan.token, "POST", "/api/wf/instances",
      { defCode: P_BLOCK, title: `BLOCK-${TS}`, formData: {} })
    check("fix emptyStrategy=BLOCK 审批人空 → 发起被阻塞(失败)",
      blockStart.body?.code !== 0, JSON.stringify(blockStart.body))

    const P_TOADMIN = await mkProc(`fixtoadmin_${TS}`, [{
      id: "ap", type: "approval", name: "空审批人TOADMIN",
      assigneeRules: [{ type: "ACCOUNT", refs: [] }], multiMode: "ANY", emptyStrategy: "TO_ADMIN",
    }])
    const adminStart = await call(zhangsan.token, "POST", "/api/wf/instances",
      { defCode: P_TOADMIN, title: `TOADMIN-${TS}`, formData: {} })
    check("fix emptyStrategy=TO_ADMIN 审批人空 → 转管理员(RUNNING, 对照 BLOCK)",
      adminStart.body?.code === 0 && adminStart.body?.data?.bizStatus === "RUNNING",
      JSON.stringify(adminStart.body?.data?.bizStatus))
    const at = await findTodo(admin.token, `TOADMIN-${TS}`)
    if (at) await call(admin.token, "POST", `/api/wf/tasks/${at.taskId}/approve`, { comment: "清理" })
  }

  // --- 修复5：allowedOps 服务端强制（白名单外操作 403，白名单内放行）---
  {
    const P_OPS = await mkProc(`fixallowops_${TS}`, [{
      id: "ap", type: "approval", name: "受限操作审批",
      assigneeRules: [{ type: "ORG", refs: [orgUser(MANAGER)] }],
      multiMode: "ANY", emptyStrategy: "TO_ADMIN", allowedOps: ["approve"],
    }])
    const t = `白名单-${TS}`
    const inst = await startInst(P_OPS, t)
    const mt = await findTodo(manager.token, t)
    check("fix allowedOps 生成待办", !!mt)
    if (mt) {
      const transR = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/transfer`,
        { user: orgUser(LISI), comment: "转办" })
      check("fix allowedOps 白名单外 transfer → 403", transR.body?.code === 403, JSON.stringify(transR.body))
      const rejR = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/reject`,
        { comment: "驳回", target: "START" })
      check("fix allowedOps 白名单外 reject → 403", rejR.body?.code === 403, JSON.stringify(rejR.body))
      const appR = await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, { comment: "白名单内同意" })
      check("fix allowedOps 白名单内 approve → 成功", appR.body?.code === 0, JSON.stringify(appR.body))
    }
    check("fix allowedOps approve 后实例 APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  }
}

/* ---------- assignee-model-2d：Task1(前端二维模型)+Task2(后端来源优先解析) 新来源端到端 ---------- */
{
  // --- NODE_HANDLER：C 节点办理人 = A 节点(已完成)的办理人本人（新增 HistoryService 查询） ---
  // 三节点 A(王五)->B(经理，独立审批过渡)->C(NODE_HANDLER fromNodeId=a)：
  // A/B 分处两次独立的 approve 请求(两个独立事务)，A 的历史任务在 C 求值时已在更早、已提交的事务中落库，
  // 是 NODE_HANDLER 的正常/典型用法(引用一个更早的节点，而非严格意义上"上一个节点")。
  {
    const P_NH = await mkProc(`assignee2d_nh_${TS}`, [
      approvalNode("a", "A节点固定王五", WANGWU),
      approvalNode("b", "B节点固定经理(过渡)", MANAGER),
      {
        id: "c", type: "approval", name: "C节点跨节点办理人",
        assigneeRules: [{ kind: "ACCOUNT", source: "NODE_HANDLER", fromNodeId: "a", takeLeader: false }],
        multiMode: "ANY", emptyStrategy: "TO_ADMIN",
      },
    ])
    const t = `NODE_HANDLER-${TS}`
    const inst = await startInst(P_NH, t)
    const taskA = await findTodo(wangwu.token, t)
    check("assignee2d NODE_HANDLER A节点(固定王五)待办出现", !!taskA, JSON.stringify(taskA))
    if (taskA) await call(wangwu.token, "POST", `/api/wf/tasks/${taskA.taskId}/approve`, { comment: "A通过" })

    const taskB = await findTodo(manager.token, t)
    check("assignee2d NODE_HANDLER B节点(固定经理)待办出现", !!taskB, JSON.stringify(taskB))
    if (taskB) await call(manager.token, "POST", `/api/wf/tasks/${taskB.taskId}/approve`, { comment: "B通过" })

    const detC = await call(zhangsan.token, "GET", `/api/wf/instances/${inst.id}`)
    check(
      "assignee2d NODE_HANDLER C节点当前办理人=A节点办理人(王五)",
      (detC.body?.data?.currentNodes ?? []).some(
        (n) => n.nodeId === "c" && (n.assignees ?? []).some((a) => String(a.userId) === String(WANGWU)),
      ),
      JSON.stringify(detC.body?.data?.currentNodes),
    )
    // 待办也应落在王五名下：若 NODE_HANDLER 解析失效(空集合)，emptyStrategy=TO_ADMIN 会把任务转给 admin，而非王五
    const taskC = await findTodo(wangwu.token, t)
    check("assignee2d NODE_HANDLER C节点待办出现在王五名下(而非兜底管理员)", !!taskC, JSON.stringify(taskC))
    if (taskC) await call(wangwu.token, "POST", `/api/wf/tasks/${taskC.taskId}/approve`, { comment: "C通过" })
    check("assignee2d NODE_HANDLER 全流程通过", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  }

  // --- VARIABLE：办理人取自流程变量（flowConfig.variables 注入，与表单字段同路径但走独立 varName） ---
  {
    const varCode = `assignee2d_var_${TS}`
    const flowConfig = { variables: [{ name: "assigneeVar", type: "number", defaultValue: LISI }] }
    await mkProcFull(varCode,
      {
        flowConfig,
        nodes: [{
          id: "ap", type: "approval", name: "变量办理人审",
          assigneeRules: [{ kind: "ACCOUNT", source: "VARIABLE", varName: "assigneeVar" }],
          multiMode: "ANY", emptyStrategy: "TO_ADMIN",
        }],
      },
      { flowConfig: JSON.stringify(flowConfig) })
    const t = `VARIABLE-${TS}`
    const st = await call(zhangsan.token, "POST", "/api/wf/instances", { defCode: varCode, title: t, formData: {} })
    check("assignee2d VARIABLE 发起成功", st.body?.code === 0, JSON.stringify(st.body))
    const iid = st.body?.data?.id
    const det = await call(zhangsan.token, "GET", `/api/wf/instances/${iid}`)
    check(
      "assignee2d VARIABLE 办理人解析为变量值对应用户(李四)",
      (det.body?.data?.currentNodes ?? []).some(
        (n) => n.nodeId === "ap" && (n.assignees ?? []).some((a) => String(a.userId) === String(LISI)),
      ),
      JSON.stringify(det.body?.data?.currentNodes),
    )
    // 待办也应落在李四名下：若 VARIABLE 解析失效(空集合)，emptyStrategy=TO_ADMIN 会把任务转给 admin，而非李四
    const mt = await findTodo(lisi.token, t)
    check("assignee2d VARIABLE 待办出现在李四名下(而非兜底管理员)", !!mt, JSON.stringify(mt))
    if (mt) await call(lisi.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, { comment: "李四同意" })
    check("assignee2d VARIABLE 全流程通过", (await bizStatus(zhangsan.token, iid)) === "APPROVED")
  }

  // --- Task 4 bug 修复验证：PREV_HANDLER 同事务顺序流(A→B，一次 approve 请求内直接推进到 B) ---
  // 修复前：taskService.complete(A) 在同一事务内同步推进流程并对 B 求值 assigneeRules，
  // 此时 A 的 HistoricTaskInstance 尚未在本事务提交/可见，PREV_HANDLER 走 HistoryService 查询会查到空集合，
  // 导致 emptyStrategy=TO_ADMIN 误把 B 落到 admin，而非真正的上一个办理人(王五)。
  // 修复后：WfTaskService 在 complete() 前把完成人写入 __lastHandler 流程变量，AssigneeResolver 优先读取该变量。
  {
    const P_PH = await mkProc(`assignee2d_ph_${TS}`, [
      approvalNode("a", "A节点固定王五", WANGWU),
      {
        id: "b", type: "approval", name: "B节点与上个办理人相关",
        assigneeRules: [{ kind: "ACCOUNT", source: "PREV_HANDLER" }],
        multiMode: "ANY", emptyStrategy: "TO_ADMIN",
      },
    ])
    const t = `PREV_HANDLER-${TS}`
    const inst = await startInst(P_PH, t)
    const taskA = await findTodo(wangwu.token, t)
    check("assignee2d PREV_HANDLER A节点(固定王五)待办出现", !!taskA, JSON.stringify(taskA))
    if (taskA) await call(wangwu.token, "POST", `/api/wf/tasks/${taskA.taskId}/approve`, { comment: "A通过" })

    const detB = await call(zhangsan.token, "GET", `/api/wf/instances/${inst.id}`)
    check(
      "assignee2d PREV_HANDLER B节点当前办理人=A节点办理人(王五)",
      (detB.body?.data?.currentNodes ?? []).some(
        (n) => n.nodeId === "b" && (n.assignees ?? []).some((a) => String(a.userId) === String(WANGWU)),
      ),
      JSON.stringify(detB.body?.data?.currentNodes),
    )
    // 待办应落在王五名下；修复前该节点因同事务查询不到 A 的历史任务而空集合 → 误落 admin，此断言检查具体 userId 而非仅“有待办”
    const taskB = await findTodo(wangwu.token, t)
    check("assignee2d PREV_HANDLER B节点待办出现在王五名下(而非兜底管理员，验证同事务顺序流修复)", !!taskB, JSON.stringify(taskB))
    check("assignee2d PREV_HANDLER B节点待办未误落管理员", !(await findTodo(admin.token, t)))
    if (taskB) await call(wangwu.token, "POST", `/api/wf/tasks/${taskB.taskId}/approve`, { comment: "B通过" })
    check("assignee2d PREV_HANDLER 全流程通过", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  }

  // --- Task 4 bug 修复验证：NODE_HANDLER 引用紧邻前驱节点(fromNodeId=同一 approve 请求内刚完成的上一节点) ---
  // 与上面 Task 3 已有的 NODE_HANDLER 用例不同：那里 fromNodeId 指向的节点在更早、已提交的独立事务中完成，
  // 本用例的 fromNodeId="a" 恰是当前这次 approve 请求同事务内刚完成的节点，是修复前会失败的场景。
  {
    const P_NHI = await mkProc(`assignee2d_nhi_${TS}`, [
      approvalNode("a", "A节点固定王五", WANGWU),
      {
        id: "b", type: "approval", name: "B节点与指定节点(紧邻前驱)办理人相关",
        assigneeRules: [{ kind: "ACCOUNT", source: "NODE_HANDLER", fromNodeId: "a", takeLeader: false }],
        multiMode: "ANY", emptyStrategy: "TO_ADMIN",
      },
    ])
    const t = `NODE_HANDLER_IMM-${TS}`
    const inst = await startInst(P_NHI, t)
    const taskA = await findTodo(wangwu.token, t)
    check("assignee2d NODE_HANDLER(紧邻前驱) A节点(固定王五)待办出现", !!taskA, JSON.stringify(taskA))
    if (taskA) await call(wangwu.token, "POST", `/api/wf/tasks/${taskA.taskId}/approve`, { comment: "A通过" })

    const detB = await call(zhangsan.token, "GET", `/api/wf/instances/${inst.id}`)
    check(
      "assignee2d NODE_HANDLER(紧邻前驱) B节点当前办理人=A节点办理人(王五)",
      (detB.body?.data?.currentNodes ?? []).some(
        (n) => n.nodeId === "b" && (n.assignees ?? []).some((a) => String(a.userId) === String(WANGWU)),
      ),
      JSON.stringify(detB.body?.data?.currentNodes),
    )
    const taskB = await findTodo(wangwu.token, t)
    check("assignee2d NODE_HANDLER(紧邻前驱) B节点待办出现在王五名下(而非兜底管理员，验证同事务修复)", !!taskB, JSON.stringify(taskB))
    if (taskB) await call(wangwu.token, "POST", `/api/wf/tasks/${taskB.taskId}/approve`, { comment: "B通过" })
    check("assignee2d NODE_HANDLER(紧邻前驱) 全流程通过", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  }
}

/* ---------- Task 2：BPMN 设计器 oa:assigneeRules 运行时真解析（回归 Task 1 隐藏 bug）---------- */
// 背景：BPMN 设计器此前把办理人等配置整体写作单块 oa:NodeConfig JSON body，运行时 AssigneeResolver
// 从不读取该元素 —— 任何"BPMN 原生"定义（designerType=BPMN）的办理人恒空，静默兜底 admin，从未被发现。
// Task 1 已把 BPMN 设计器改为写逐个规范元素（oa:assigneeRules/oa:multiMode/oa:emptyStrategy 等，
// 与 JsonToBpmnConverter 写出的格式、AssigneeResolver 读取的格式三方一致）。本用例验证修复后
// **designerType:BPMN** 的定义在运行时确实按 oa:assigneeRules 解析出指定办理人。
// 拿合法 bpmnXml 的方式：先建 DINGTALK 底稿→发布(后端 JsonToBpmnConverter 转换生成含 oa:assigneeRules
// + BPMNDI 的 bpmnXml)→原地 PUT 把 designerType 改成 BPMN 并落库该 bpmnXml(PUT 为纯字段覆盖，
// 不做二次转换)→重新发布(BPMN 分支按原样部署 bpmnXml，不再经 JSON 转换，即"BPMN 原生"执行路径)。
{
  const bpmnCode = `bpmn_assignee_${TS}`
  const dingC = await call(admin.token, "POST", "/api/wf/process-defs", {
    defCode: bpmnCode, name: "BPMN办理人真解析验证", designerType: "DINGTALK",
    designerJson: JSON.stringify({
      nodes: [
        {
          id: "ap", type: "approval", name: "固定王五审批",
          assigneeRules: [{ kind: "ACCOUNT", source: "FIXED", refs: [orgUser(WANGWU)] }],
          multiMode: "ANY", emptyStrategy: "TO_ADMIN",
        },
      ],
    }),
  })
  check("bpmn2e 创建 DINGTALK 底稿", dingC.body?.code === 0 && !!dingC.body?.data?.id, JSON.stringify(dingC.body))
  const defId = dingC.body?.data?.id
  const pub1 = await call(admin.token, "POST", `/api/wf/process-defs/${defId}/publish`)
  const bpmnXml = pub1.body?.data?.bpmnXml ?? ""
  check(
    "bpmn2e 转换器产出含 oa:assigneeRules 的合法 bpmnXml",
    pub1.body?.code === 0 && bpmnXml.includes("oa:assigneeRules") && bpmnXml.includes("<process"),
    String(bpmnXml.length),
  )

  // 原地切换为 BPMN 类型，落库同一份 bpmnXml（PUT 纯字段覆盖，不做 JSON→BPMN 转换）
  const toBpmn = await call(admin.token, "PUT", `/api/wf/process-defs/${defId}`, {
    defCode: bpmnCode, name: "BPMN办理人真解析验证", designerType: "BPMN", bpmnXml,
  })
  check("bpmn2e 原地切换 designerType=BPMN", toBpmn.body?.code === 0, JSON.stringify(toBpmn.body))
  // BPMN 分支发布：按原样部署 bpmnXml，不再经 JSON 转换 —— 这才是本用例要验证的"BPMN 原生可执行"路径
  const pub2 = await call(admin.token, "POST", `/api/wf/process-defs/${defId}/publish`)
  check(
    "bpmn2e BPMN 类型定义发布成功(原样部署，非二次转换)",
    pub2.body?.code === 0 && pub2.body?.data?.designerType === "BPMN",
    JSON.stringify(pub2.body),
  )

  const t = `BPMN真解析-${TS}`
  const inst = await startInst(bpmnCode, t)
  check("bpmn2e 发起 BPMN 原生定义成功", !!inst?.id, JSON.stringify(inst))
  // 关键断言：BPMN 定义 oa:assigneeRules 应被运行时解析出固定办理人(王五)，而非落入 admin 兜底
  // （若 Task1 修复未生效或回归，运行时读不到 oa:assigneeRules → emptyStrategy=TO_ADMIN 落 admin(1) → 本断言必失败）
  check(
    "bpmn2e BPMN 定义 oa:assigneeRules 应被运行时解析（当前办理人=王五，非 admin 兜底）",
    (inst?.currentNodes ?? []).some((n) => (n.assignees ?? []).some((a) => String(a.userId) === String(WANGWU))),
    JSON.stringify(inst?.currentNodes),
  )
  const taskWangwu = await findTodo(wangwu.token, t)
  check("bpmn2e 王五名下出现该待办(真实办理人，非仅解析结果字段)", !!taskWangwu, JSON.stringify(taskWangwu))
  check("bpmn2e admin 名下未出现该待办(反证兜底未被误触发)", !(await findTodo(admin.token, t)))
  if (taskWangwu) await call(wangwu.token, "POST", `/api/wf/tasks/${taskWangwu.taskId}/approve`, { comment: "王五通过" })
  check("bpmn2e 全流程通过", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
}

/* ---------- 21. 工程化批次断言（Q-03）：B-11 唤醒权限 / B-12 随机重置密码 / B-13 CORS ---------- */

// --- B-11：唤醒操作补权限 —— zhangsan 对已结束实例唤醒→403，admin 调→成功 ---
{
  const P = await mkProc(`b11res_${TS}`, [approvalNode("rap", "B11审批", MANAGER)])
  const t = `B11唤醒权限-${TS}`
  const inst = await startInst(P, t)
  const mt = await findTodo(manager.token, t)
  if (mt) await call(manager.token, "POST", `/api/wf/tasks/${mt.taskId}/approve`, {})
  check("B-11 前置:实例已结束APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED")
  const deny = await call(zhangsan.token, "POST", `/api/wf/instances/${inst.id}/resurrect`, { nodeId: "rap", comment: "越权唤醒" })
  check("B-11 zhangsan 唤醒已结束实例→403", deny.status === 403, JSON.stringify(deny.body))
  const ok = await call(admin.token, "POST", `/api/wf/instances/${inst.id}/resurrect`, { nodeId: "rap", comment: "管理员唤醒" })
  check("B-11 admin 唤醒→成功(RUNNING)", ok.body?.code === 0 && ok.body.data?.bizStatus === "RUNNING", JSON.stringify(ok.body))
  const mt2 = await findTodo(manager.token, t)
  if (mt2) await call(manager.token, "POST", `/api/wf/tasks/${mt2.taskId}/approve`, {})
}

// --- B-12：密码重置去掉固定 admin123，返回 12 位随机明文；新旧密码登录行为正确 ---
{
  const uname = `b12user_${TS}`
  const nu = await call(admin.token, "POST", "/api/system/users", {
    username: uname, name: "B12用户", phone: "13800000001", password: "admin123", deptId, postId, roleIds: [roleId],
  })
  check("B-12 创建目标用户", nu.body?.code === 0, JSON.stringify(nu.body))
  const uid = nu.body?.data?.id ?? nu.body?.data
  const rp = await call(admin.token, "POST", `/api/system/users/${uid}/reset-password`)
  const newPwd = rp.body?.data
  check(
    "B-12 重置密码返回新明文(非空/≠admin123/长度12)",
    rp.body?.code === 0 && typeof newPwd === "string" && newPwd.length === 12 && newPwd !== "admin123",
    JSON.stringify(rp.body),
  )
  const loginNew = await call(null, "POST", "/api/auth/login", { username: uname, password: newPwd })
  check("B-12 用返回的新密码登录成功", loginNew.body?.code === 0 && !!loginNew.body?.data?.token, JSON.stringify(loginNew.body))
  const loginOld = await call(null, "POST", "/api/auth/login", { username: uname, password: "admin123" })
  check("B-12 用旧密码 admin123 登录失败", loginOld.body?.code !== 0, JSON.stringify(loginOld.body))
  const adminSelf = await call(null, "POST", "/api/auth/login", { username: "admin", password: "admin123" })
  check("B-12 admin 本人仍能用 admin123 登录(重置仅作用于目标用户)", adminSelf.body?.code === 0 && !!adminSelf.body?.data?.token)
  await call(admin.token, "DELETE", `/api/system/users/${uid}`)
}

// --- B-13：CORS 可配置化 —— 带 Origin 的 OPTIONS 预检返回 allow-origin + allow-credentials:true ---
{
  const preflight = await fetch(`${BASE}/api/auth/login`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  })
  const acao = preflight.headers.get("access-control-allow-origin")
  const acac = preflight.headers.get("access-control-allow-credentials")
  check("B-13 CORS 预检回显 allow-origin=localhost:5173", acao === "http://localhost:5173", `acao=${acao} status=${preflight.status}`)
  check("B-13 CORS 预检 allow-credentials=true", acac === "true", `acac=${acac}`)
}

/* ---------- 22. 图直译工作流（N-B-01~04）：新 react-flow 设计器 GraphToBpmnConverter 直译 ---------- */
// 覆盖：图直译部署+排它网关结构化条件路由 / 并行网关 fork-join / Aviator 高级公式条件+expression/eval /
//       脚本节点(serviceTask impl:script)+test-run / .bpmn 往返(export→import) / 表单字段清单端点。
// 沿用 call()/check() 与既有账号（admin 部署、zhangsan 发起）；helper mkProc/startInst/findTodo/bizStatus 复用上方定义。

// 辅助：图直译部署（需 wf:def:edit，用 admin），返回原始响应
async function graphDeploy(key, name, model, formCode) {
  return call(admin.token, "POST", "/api/wf/models/graph/deploy", { key, name, ...(formCode ? { formCode } : {}), model })
}
// 辅助：取实例 highlight.completed（含已完成节点 + 边 id）
async function hlCompleted(token, iid) {
  return (await call(token, "GET", `/api/wf/instances/${iid}`)).body?.data?.highlight?.completed ?? []
}

// --- N-B-01：图直译部署 + 排它网关结构化条件（days>3 大额 / 默认 terminate end）+ 条件路由 ---
{
  const key = `graph_cond_${TS}`
  const model = {
    schemaVersion: 1, key, name: "图直译条件路由",
    nodes: [
      { id: "start", type: "startEvent", name: "发起", position: { x: 80, y: 100 } },
      { id: "approve", type: "userTask", name: "审批人", position: { x: 220, y: 90 }, props: { assigneeRules: [{ type: "INITIATOR" }], multiMode: "ANY", emptyStrategy: "TO_ADMIN" } },
      { id: "gw", type: "exclusiveGateway", name: "天数判断", position: { x: 380, y: 100 } },
      { id: "endBig", type: "endEvent", name: "大额结束", position: { x: 520, y: 60 } },
      { id: "endDef", type: "endEvent", name: "默认结束", position: { x: 520, y: 160 }, terminate: true },
    ],
    edges: [
      { id: "e1", source: "start", target: "approve" },
      { id: "e2", source: "approve", target: "gw" },
      { id: "eBig", source: "gw", target: "endBig", condition: { logic: "AND", items: [{ field: "days", operator: "gt", value: "3" }] } },
      { id: "eDef", source: "gw", target: "endDef", isDefault: true },
    ],
  }
  const dep = await graphDeploy(key, "图直译条件路由", model)
  check("N-B-01 图直译部署→PUBLISHED", dep.body?.code === 0 && dep.body.data?.status === "PUBLISHED", JSON.stringify(dep.body?.data ?? dep.body))
  check("N-B-01 processDefinitionKey==key(BPMN id==def_code)", dep.body?.data?.processDefinitionKey === key, dep.body?.data?.processDefinitionKey)
  check("N-B-01 出现在可发起列表", ((await call(zhangsan.token, "GET", "/api/wf/startable")).body?.data ?? []).some((s) => s.defCode === key))
  // days=5 → 审批通过 → 走大额分支 eBig/endBig
  const tBig = `图直译大额-${TS}`
  const iBig = await startInst(key, tBig, { days: 5 })
  check("N-B-01 days=5 发起→RUNNING 当前节点=审批人", iBig?.bizStatus === "RUNNING" && (iBig?.currentNodes ?? []).some((n) => n.nodeName === "审批人"), JSON.stringify(iBig?.currentNodes))
  const taskBig = await findTodo(zhangsan.token, tBig)
  check("N-B-01 发起人(INITIATOR)拿到审批待办", !!taskBig)
  if (taskBig) await call(zhangsan.token, "POST", `/api/wf/tasks/${taskBig.taskId}/approve`, { comment: "大额通过" })
  check("N-B-01 days=5 审批后→APPROVED", (await bizStatus(zhangsan.token, iBig.id)) === "APPROVED", await bizStatus(zhangsan.token, iBig.id))
  const hlBig = await hlCompleted(zhangsan.token, iBig.id)
  check("N-B-01 days=5 高亮走大额(endBig)不走默认(endDef)", hlBig.includes("endBig") && !hlBig.includes("endDef"), JSON.stringify(hlBig))
  // days=1 → 审批通过 → 走默认分支 eDef/endDef(terminate)
  const tDef = `图直译默认-${TS}`
  const iDef = await startInst(key, tDef, { days: 1 })
  const taskDef = await findTodo(zhangsan.token, tDef)
  check("N-B-01 days=1 发起人待办", !!taskDef)
  if (taskDef) await call(zhangsan.token, "POST", `/api/wf/tasks/${taskDef.taskId}/approve`, { comment: "默认通过" })
  check("N-B-01 days=1 审批后→APPROVED", (await bizStatus(zhangsan.token, iDef.id)) === "APPROVED", await bizStatus(zhangsan.token, iDef.id))
  const hlDef = await hlCompleted(zhangsan.token, iDef.id)
  check("N-B-01 days=1 高亮走默认(endDef)不走大额(endBig)", hlDef.includes("endDef") && !hlDef.includes("endBig"), JSON.stringify(hlDef))
}

// --- N-B-02：并行网关 fork→两审批→join（并发两当前节点，都审批后→APPROVED） ---
{
  const key = `graph_par_${TS}`
  const model = {
    schemaVersion: 1, key, name: "并行网关演示",
    nodes: [
      { id: "start", type: "startEvent", name: "发起", position: { x: 60, y: 120 } },
      { id: "fork", type: "parallelGateway", name: "并行分叉", position: { x: 180, y: 120 } },
      { id: "a", type: "userTask", name: "并行审批A", position: { x: 300, y: 60 }, props: { assigneeRules: [{ type: "INITIATOR" }], multiMode: "ANY", emptyStrategy: "TO_ADMIN" } },
      { id: "b", type: "userTask", name: "并行审批B", position: { x: 300, y: 180 }, props: { assigneeRules: [{ type: "INITIATOR" }], multiMode: "ANY", emptyStrategy: "TO_ADMIN" } },
      { id: "join", type: "parallelGateway", name: "并行合流", position: { x: 440, y: 120 } },
      { id: "end", type: "endEvent", name: "结束", position: { x: 560, y: 120 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "fork" },
      { id: "e2", source: "fork", target: "a" }, { id: "e3", source: "fork", target: "b" },
      { id: "e4", source: "a", target: "join" }, { id: "e5", source: "b", target: "join" },
      { id: "e6", source: "join", target: "end" },
    ],
  }
  const dep = await graphDeploy(key, "并行网关演示", model)
  check("N-B-02 并行流部署→PUBLISHED", dep.body?.code === 0 && dep.body.data?.status === "PUBLISHED", JSON.stringify(dep.body?.data ?? dep.body))
  const t = `图直译并行-${TS}`
  const inst = await startInst(key, t, {})
  const cur = inst?.currentNodes ?? []
  check("N-B-02 发起→RUNNING", inst?.bizStatus === "RUNNING", inst?.bizStatus)
  check("N-B-02 并行产生两个并发当前节点(A,B)", cur.length === 2 && cur.some((n) => n.nodeName === "并行审批A") && cur.some((n) => n.nodeName === "并行审批B"), JSON.stringify(cur.map((n) => n.nodeName)))
  // 审批两个并发任务
  for (let round = 0; round < 3; round++) {
    const list = ((await call(zhangsan.token, "GET", "/api/wf/tasks/todo?pageNum=1&pageSize=100")).body?.data?.list ?? []).filter((tk) => tk.instanceTitle === t)
    if (!list.length) break
    for (const tk of list) await call(zhangsan.token, "POST", `/api/wf/tasks/${tk.taskId}/approve`, { comment: "并行通过" })
  }
  check("N-B-02 两审批完成后→APPROVED", (await bizStatus(zhangsan.token, inst.id)) === "APPROVED", await bizStatus(zhangsan.token, inst.id))
  const hl = await hlCompleted(zhangsan.token, inst.id)
  check("N-B-02 高亮含 fork/join/两审批", ["fork", "join", "a", "b"].every((x) => hl.includes(x)), JSON.stringify(hl))
}

// --- N-B-03：Aviator 高级公式条件（边 expression:"amount>1000"）+ expression/eval 端点 ---
{
  const key = `graph_expr_${TS}`
  const model = {
    schemaVersion: 1, key, name: "高级公式演示",
    nodes: [
      { id: "start", type: "startEvent", name: "发起", position: { x: 60, y: 100 } },
      { id: "gw", type: "exclusiveGateway", name: "金额判断", position: { x: 200, y: 100 } },
      { id: "endBig", type: "endEvent", name: "大额结束", position: { x: 360, y: 60 } },
      { id: "endDef", type: "endEvent", name: "默认结束", position: { x: 360, y: 160 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "gw" },
      { id: "eBig", source: "gw", target: "endBig", expression: "amount>1000" },
      { id: "eDef", source: "gw", target: "endDef", isDefault: true },
    ],
  }
  const dep = await graphDeploy(key, "高级公式演示", model)
  check("N-B-03 高级条件流部署→PUBLISHED", dep.body?.code === 0 && dep.body.data?.status === "PUBLISHED", JSON.stringify(dep.body?.data ?? dep.body))
  // amount=2000 → Aviator 命中 expression 走 eBig
  const i1 = await startInst(key, `高级大额-${TS}`, { amount: 2000 })
  const c1 = await hlCompleted(zhangsan.token, i1.id)
  check("N-B-03 amount=2000→Aviator 命中走 eBig/endBig", c1.includes("eBig") && c1.includes("endBig") && !c1.includes("eDef"), JSON.stringify(c1))
  // amount=500 → 走默认 eDef
  const i2 = await startInst(key, `高级小额-${TS}`, { amount: 500 })
  const c2 = await hlCompleted(zhangsan.token, i2.id)
  check("N-B-03 amount=500→走默认 eDef/endDef", c2.includes("eDef") && c2.includes("endDef") && !c2.includes("eBig"), JSON.stringify(c2))
  // expression/eval：内置算术 + 自定义函数 workDays + 沙箱拒 new
  const fArith = await call(admin.token, "POST", "/api/wf/expression/eval", { expr: "2 * (3 + 4)" })
  check("N-B-03 eval 内置算术 2*(3+4)→14", fArith.body?.code === 0 && Number(fArith.body?.data) === 14, JSON.stringify(fArith.body))
  const fWork = await call(admin.token, "POST", "/api/wf/expression/eval", { expr: "workDays('2026-07-06','2026-07-10')" })
  check("N-B-03 eval 自定义函数 workDays(周一~周五)→5", fWork.body?.code === 0 && Number(fWork.body?.data) === 5, JSON.stringify(fWork.body))
  const fCtx = await call(admin.token, "POST", "/api/wf/expression/eval", { expr: "amount > 1000", context: { amount: 2000 }, asBoolean: true })
  check("N-B-03 eval 带上下文布尔求值 amount>1000→true", fCtx.body?.code === 0 && fCtx.body?.data === true, JSON.stringify(fCtx.body))
  const fNew = await call(admin.token, "POST", "/api/wf/expression/eval", { expr: "new java.io.File('x')" })
  check("N-B-03 eval 沙箱拒 new(非法表达式→失败)", fNew.body?.code !== 0, JSON.stringify(fNew.body))
}

// --- N-B-04：脚本节点 serviceTask{impl:script} groovy 写 vars → 下游网关路由 + test-run ---
{
  const key = `graph_script_${TS}`
  const GROOVY = "vars.put('total', (vars.get('price') as int) * (vars.get('qty') as int)); log.info('script total=' + vars.get('total')); return vars.get('total')"
  const model = {
    schemaVersion: 1, key, name: "脚本节点演示",
    nodes: [
      { id: "start", type: "startEvent", name: "发起", position: { x: 40, y: 100 } },
      { id: "script", type: "serviceTask", name: "计算金额", position: { x: 160, y: 90 }, service: { impl: "script" }, script: { lang: "groovy", code: GROOVY } },
      { id: "gw", type: "exclusiveGateway", name: "金额判断", position: { x: 320, y: 100 } },
      { id: "endBig", type: "endEvent", name: "大额", position: { x: 460, y: 60 } },
      { id: "endDef", type: "endEvent", name: "默认", position: { x: 460, y: 160 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "script" },
      { id: "e2", source: "script", target: "gw" },
      { id: "eBig", source: "gw", target: "endBig", expression: "total>1000" },
      { id: "eDef", source: "gw", target: "endDef", isDefault: true },
    ],
  }
  const dep = await graphDeploy(key, "脚本节点演示", model)
  check("N-B-04 脚本流部署→PUBLISHED", dep.body?.code === 0 && dep.body.data?.status === "PUBLISHED", JSON.stringify(dep.body?.data ?? dep.body))
  // price*qty=2000 → 脚本写 total=2000 → 网关 total>1000 → endBig
  const i1 = await startInst(key, `脚本大额-${TS}`, { price: 200, qty: 10 })
  const c1 = await hlCompleted(zhangsan.token, i1.id)
  check("N-B-04 脚本执行写 vars→total=2000→走 endBig", c1.includes("script") && c1.includes("eBig") && c1.includes("endBig"), JSON.stringify(c1))
  // price*qty=50 → total=50 → 默认
  const i2 = await startInst(key, `脚本小额-${TS}`, { price: 5, qty: 10 })
  const c2 = await hlCompleted(zhangsan.token, i2.id)
  check("N-B-04 脚本 total=50→走默认 endDef", c2.includes("script") && c2.includes("eDef") && c2.includes("endDef"), JSON.stringify(c2))
  // test-run 端点：groovy / js 成功 + 非管理员 403
  const trG = await call(admin.token, "POST", "/api/wf/script/test-run", { lang: "groovy", code: "vars.put('x', 6*7); return spring.has('wfScriptDelegate')", sampleVars: {} })
  check("N-B-04 test-run groovy 成功+vars 回传 x=42", trG.body?.code === 0 && trG.body.data?.success === true && trG.body.data?.vars?.x === 42, JSON.stringify(trG.body?.data))
  const trJ = await call(admin.token, "POST", "/api/wf/script/test-run", { lang: "js", code: "vars.put('y', 3+4); vars.get('y')", sampleVars: {} })
  check("N-B-04 test-run js(GraalJS) 成功", trJ.body?.code === 0 && trJ.body.data?.success === true, JSON.stringify(trJ.body?.data))
  const trDeny = await call(zhangsan.token, "POST", "/api/wf/script/test-run", { lang: "groovy", code: "return 1", sampleVars: {} })
  check("N-B-04 非管理员(zhangsan) test-run→403", trDeny.status === 403, `status=${trDeny.status}`)
}

// --- N-B-05：.bpmn 往返（deploy→GET bpmn 非空 XML→POST import 结构还原、warnings 空） ---
{
  const key = `graph_rt_${TS}`
  const model = {
    schemaVersion: 1, key, name: "往返演示",
    nodes: [
      { id: "start", type: "startEvent", name: "发起", position: { x: 60, y: 100 } },
      { id: "ap", type: "userTask", name: "审批", position: { x: 200, y: 90 }, props: { assigneeRules: [{ type: "INITIATOR" }], multiMode: "ANY", emptyStrategy: "TO_ADMIN" } },
      { id: "gw", type: "exclusiveGateway", name: "判断", position: { x: 360, y: 100 } },
      { id: "endBig", type: "endEvent", name: "大", position: { x: 500, y: 60 } },
      { id: "endDef", type: "endEvent", name: "默认", position: { x: 500, y: 160 }, terminate: true },
    ],
    edges: [
      { id: "e1", source: "start", target: "ap" },
      { id: "e2", source: "ap", target: "gw" },
      { id: "e3", source: "gw", target: "endBig", condition: { logic: "AND", items: [{ field: "days", operator: "gt", value: "3" }] } },
      { id: "e4", source: "gw", target: "endDef", isDefault: true },
    ],
  }
  const dep = await graphDeploy(key, "往返演示", model)
  const mid = dep.body?.data?.id
  check("N-B-05 往返流部署→PUBLISHED", dep.body?.code === 0 && dep.body.data?.status === "PUBLISHED", `id=${mid}`)
  // GET bpmn → 非空 XML
  const exp = await call(admin.token, "GET", `/api/wf/models/${mid}/bpmn`)
  const xml = exp.body?.data
  check("N-B-05 导出 .bpmn 非空 XML", exp.body?.code === 0 && typeof xml === "string" && xml.includes("<") && xml.length > 100, `len=${xml?.length ?? 0}`)
  check("N-B-05 导出含 BPMNDiagram+oa:扩展+conditionExpression", !!xml && xml.includes("BPMNDiagram") && xml.includes("oa:") && xml.includes("conditionExpression"))
  // POST import（原始 xml）→ ProcessModel 结构还原
  const impRes = await fetch(`${BASE}/api/wf/models/import`, { method: "POST", headers: { "Content-Type": "application/xml", Authorization: `Bearer ${admin.token}` }, body: xml ?? "" })
  const imp = await impRes.json().catch(() => null)
  const m = imp?.data?.model
  check("N-B-05 导入→ProcessModel(nodes/edges)", imp?.code === 0 && Array.isArray(m?.nodes) && Array.isArray(m?.edges), `code=${imp?.code}`)
  check("N-B-05 节点数还原=5 边数=4", m?.nodes?.length === 5 && m?.edges?.length === 4, `nodes=${m?.nodes?.length} edges=${m?.edges?.length}`)
  const types = (m?.nodes ?? []).map((n) => n.type).sort()
  check("N-B-05 节点类型还原", JSON.stringify(types) === JSON.stringify(["endEvent", "endEvent", "exclusiveGateway", "startEvent", "userTask"]), JSON.stringify(types))
  check("N-B-05 terminate end 还原", (m?.nodes ?? []).some((n) => n.type === "endEvent" && n.terminate))
  const e3 = (m?.edges ?? []).find((e) => e.condition)
  check("N-B-05 结构化条件还原(operator 名形 gt)", e3?.condition?.items?.[0]?.operator === "gt", JSON.stringify(e3?.condition))
  check("N-B-05 默认分支还原(isDefault)", (m?.edges ?? []).some((e) => e.isDefault))
  check("N-B-05 坐标从 DI 还原(position.x)", (m?.nodes ?? []).every((n) => n.position && typeof n.position.x === "number"))
  check("N-B-05 warnings 为空", Array.isArray(imp?.data?.warnings) && imp.data.warnings.length === 0, JSON.stringify(imp?.data?.warnings))
}

// --- N-B-06：表单字段清单（GET /forms/leave/fields ONLINE 5 字段 / 不存在→404 / 未登录→401） ---
{
  const ff = await call(admin.token, "GET", "/api/wf/forms/leave/fields")
  const mf = ff.body?.data
  check("N-B-06 leave 字段清单 code=0 formType=ONLINE", ff.body?.code === 0 && mf?.formType === "ONLINE" && mf?.formKey === "leave", JSON.stringify({ code: ff.body?.code, formType: mf?.formType, formKey: mf?.formKey }))
  check("N-B-06 leave ONLINE 解析出 5 个字段", Array.isArray(mf?.fields) && mf.fields.length === 5, JSON.stringify((mf?.fields ?? []).map((f) => f.key)))
  const ffMiss = await call(admin.token, "GET", `/api/wf/forms/nonexistent_${TS}/fields`)
  check("N-B-06 不存在 formKey→404", ffMiss.body?.code === 404, JSON.stringify(ffMiss.body))
  const ffAnon = await call(null, "GET", "/api/wf/forms/leave/fields")
  check("N-B-06 未登录→401", ffAnon.status === 401, `status=${ffAnon.status}`)
}

/* ---------- 汇总 ---------- */
cleanupTestData() // 跑完自动清理测试数据，避免污染流程定义/待办列表
console.log(`\n==> 通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) {
  console.log("失败项：\n - " + failures.join("\n - "))
  process.exit(1)
}
console.log("全部通过 ✅")

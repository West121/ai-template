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
    // 编排（V25）冒烟数据
    "DELETE FROM orch_exec_node; DELETE FROM orch_exec; DELETE FROM orch_flow_version;",
    "DELETE FROM ai_chat_message; DELETE FROM ai_chat_session;",
    "DELETE FROM oa_bizdoc; DELETE FROM oa_bizdoc_print_tpl; DELETE FROM oa_bizdoc_def WHERE code LIKE 'smoke_bd%';",
    "DELETE FROM orch_flow WHERE code LIKE 'smoke_orch%'; DELETE FROM orch_credential WHERE name LIKE '冒烟%';",
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
const pdefs = await call(admin.token, "GET", "/api/wf/process-defs?keyword=gw_&pageNum=1&pageSize=50")
const pdCodes = new Set((pdefs.body?.data?.list ?? []).map((p) => p.defCode))
check("公文流程进入流程定义列表(gw_send/gw_recv)", pdCodes.has("gw_send") && pdCodes.has("gw_recv"), [...pdCodes].join(","))

// CODE 表单字段识别：gw_send 字段清单含 needCountersign（驱动会签网关条件），不再 404
const gwSendFields = await call(admin.token, "GET", "/api/wf/forms/gw_send/fields")
const gwSendKeys = (gwSendFields.body?.data?.fields ?? []).map((f) => f.key)
check("gw_send CODE 字段清单(formType=CODE, 含 needCountersign/docType)",
  gwSendFields.body?.data?.formType === "CODE" && gwSendKeys.includes("needCountersign") && gwSendKeys.includes("docType"),
  JSON.stringify({ t: gwSendFields.body?.data?.formType, keys: gwSendKeys }))
const gwSendDocType = (gwSendFields.body?.data?.fields ?? []).find((f) => f.key === "docType")
check("gw_send docType 带 select options(供条件运算)", (gwSendDocType?.options ?? []).length >= 5, JSON.stringify(gwSendDocType?.options?.slice(0, 2)))
const gwRecvFields = await call(admin.token, "GET", "/api/wf/forms/gw_recv/fields")
check("gw_recv CODE 字段清单(含 needCirculate)",
  gwRecvFields.body?.data?.formType === "CODE" && (gwRecvFields.body?.data?.fields ?? []).some((f) => f.key === "needCirculate"))
// CODE 表单列表（绑定 UI 下拉）
const codeForms = await call(admin.token, "GET", "/api/wf/forms/code")
check("CODE 表单列表含 gw_send(fieldCount≥10)/gw_recv",
  (codeForms.body?.data ?? []).some((f) => f.formKey === "gw_send" && f.fieldCount >= 10) &&
    (codeForms.body?.data ?? []).some((f) => f.formKey === "gw_recv"),
  JSON.stringify(codeForms.body?.data))
// 流程定义并入 CODE：startable 认 CODE + submitPath
const gwStartable = await call(admin.token, "GET", "/api/wf/startable")
const gwSendCard = (gwStartable.body?.data ?? []).find((p) => p.defCode === "gw_send")
check("startable gw_send formType=CODE + submitPath",
  gwSendCard?.formType === "CODE" && gwSendCard?.formSubmitPath === "/document/send?new=1", JSON.stringify(gwSendCard))

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
check("发文拟稿 headerType 默认 RED", drA.body?.data?.headerType === "RED", drA.body?.data?.headerType)
// 白头（PLAIN）发文：headerType 落库 + render 无红头三件套 + 带 .gw-typearea--plain 标记
const drPlain = await call(admin.token, "POST", "/api/office/doc/send/draft", {
  title: "白头普通文件测试", headerType: "PLAIN", issuingOrg: "星辰科技有限公司", content: "普通文件正文。",
})
check("白头拟稿 headerType=PLAIN 落库", drPlain.body?.data?.headerType === "PLAIN", drPlain.body?.data?.headerType)
const rPlain = await call(admin.token, "POST", `/api/office/doc/${drPlain.body?.data?.id}/render`)
const plainHtml = rPlain.body?.data?.html ?? ""
check("白头 render 无红头三件套 + 有 gw-typearea--plain",
  plainHtml.includes("gw-typearea--plain") && !plainHtml.includes("gw-header") &&
    !plainHtml.includes("gw-red-line") && !plainHtml.includes("gw-docnum") &&
    plainHtml.includes("gw-title") && plainHtml.includes("gw-body"),
  plainHtml.slice(0, 100))
// 流程图高亮（节点 id 原值：completed 含 start/review，active 含当前核稿）
const hlDraft = drA.body?.data?.highlight
check("发文详情返回 highlight(completed 含 start, active 含 review)",
  !!hlDraft && Array.isArray(hlDraft.completed) && Array.isArray(hlDraft.active) &&
    hlDraft.completed.includes("start") && hlDraft.active.includes("review") && !hlDraft.active.includes("start"),
  JSON.stringify(hlDraft))
// 流程预测（核稿阶段）：后续应含 签发/用印/成文 + 预计办理人
const predDraft = await call(admin.token, "POST", `/api/office/doc/${aId}/predict`)
const predNodeIds = (predDraft.body?.data?.path ?? []).map((n) => n.nodeId)
check("发文预测(核稿阶段)后续含 签发/用印/成文节点",
  predNodeIds.includes("issue") && predNodeIds.includes("seal") && predNodeIds.includes("publish") && !predNodeIds.includes("review"),
  JSON.stringify(predNodeIds))
const predIssue = (predDraft.body?.data?.path ?? []).find((n) => n.nodeId === "issue")
check("发文预测 签发预计办理人=王经理(按 assigneeRules 取人)", (predIssue?.assignees ?? []).some((a) => a.name === "王经理"), JSON.stringify(predIssue?.assignees))
// 一等 wf 实例：起单即注册 wf_instance_ext → 我发起/实例详情/流程监控可见
const gwMy = await call(admin.token, "GET", "/api/wf/instances/my?pageNum=1&pageSize=50")
const gwMyRow = (gwMy.body?.data?.list ?? []).find((r) => r.title === "冒烟测试发文A：情况通报")
check("公文实例进「我发起」(defCode=gw_send,RUNNING,发起人)", gwMyRow?.defCode === "gw_send" && gwMyRow?.bizStatus === "RUNNING" && !!gwMyRow?.initiatorName, JSON.stringify(gwMyRow))
if (gwMyRow) {
  const gwInstDet = await call(admin.token, "GET", `/api/wf/instances/${gwMyRow.id}`)
  check("公文 wf 实例详情可打开(不再404)+formViewPath 解析为办文单",
    gwInstDet.body?.code === 0 && gwInstDet.body?.data?.formViewPath === `/document/send/${aId}` && gwInstDet.body?.data?.formType === "CODE",
    JSON.stringify({ code: gwInstDet.body?.code, vp: gwInstDet.body?.data?.formViewPath, ft: gwInstDet.body?.data?.formType }))
}
const gwMon = await call(admin.token, "GET", "/api/wf/monitor/overview")
check("流程监控统计含公文实例(byDef 含 gw_send)", (gwMon.body?.data?.byDef ?? []).some((d) => d.defCode === "gw_send" && d.count >= 1), JSON.stringify(gwMon.body?.data?.byDef))
const rvA = await call(admin.token, "POST", `/api/office/doc/${aId}/opinion`, { decision: "APPROVE", opinion: "核稿通过" })
check("核稿后=签发, 办理人=部门经理(单位领导,id 2)≠发起人(admin,id 1)", rvA.body?.data?.currentTask?.taskKey === "issue" && rvA.body?.data?.currentTask?.assignee === "2", JSON.stringify(rvA.body?.data?.currentTask))
const gwMgrTodo = await call(manager.token, "GET", "/api/wf/tasks/todo?pageNum=1&pageSize=100")
const gwSignTask = (gwMgrTodo.body?.data?.list ?? []).find((t) => t.nodeName === "签发")
check("非发起人(王经理)待办含签发任务", !!gwSignTask, (gwMgrTodo.body?.data?.list ?? []).map((t) => t.nodeName).join(","))
check("公文任务在通用待办显示流程名/标题/发起人(非空)",
  !!gwSignTask && gwSignTask.defName === "发文办理单" && gwSignTask.instanceTitle === "冒烟测试发文A：情况通报" && !!gwSignTask.initiatorName,
  JSON.stringify({ defName: gwSignTask?.defName, title: gwSignTask?.instanceTitle, initiator: gwSignTask?.initiatorName }))
check("公文待办 viewPath 指向办文单(/document/send/{docId})", gwSignTask?.viewPath === `/document/send/${aId}`, gwSignTask?.viewPath)
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
check("render 返回 .gw-* 片段(RED 含 gw-header/gw-red-line)", html.includes("gw-typearea") && html.includes("gw-header") && html.includes("gw-red-line") && !html.includes("gw-typearea--plain"), html.slice(0, 60))
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
// 办结/成文后流程结束：highlight.active 空、completed 覆盖全程(含 publish)
const hlDone = arch.body?.data?.highlight
check("成文后 highlight active 空 + completed 含 publish", !!hlDone && (hlDone.active?.length ?? 0) === 0 && hlDone.completed.includes("publish"), JSON.stringify(hlDone))
// 流程已结束的预测：path 空 + note
const predDone = await call(admin.token, "POST", `/api/office/doc/${a.id}/predict`)
check("办结后预测 path 空 + note(流程已结束)", (predDone.body?.data?.path?.length ?? -1) === 0 && !!predDone.body?.data?.note, JSON.stringify(predDone.body?.data))
// 办结后 wf_instance_ext biz_status 同步（PROCESS_COMPLETED 监听）
const gwMyDone = await call(admin.token, "GET", "/api/wf/instances/my?pageNum=1&pageSize=50")
const gwMyDoneRow = (gwMyDone.body?.data?.list ?? []).find((r) => r.title === "冒烟测试发文A：情况通报")
check("成文后「我发起」实例 bizStatus 同步 APPROVED", gwMyDoneRow?.bizStatus === "APPROVED" && !!gwMyDoneRow?.endedAt, JSON.stringify({ s: gwMyDoneRow?.bizStatus, e: !!gwMyDoneRow?.endedAt }))
// 「已办」有记录且带 viewPath（admin 办过核稿等环节）
const gwDone = await call(admin.token, "GET", "/api/wf/tasks/done?pageNum=1&pageSize=50")
const gwDoneRow = (gwDone.body?.data?.list ?? []).find((t) => t.viewPath === `/document/send/${aId}`)
check("「已办」公文任务带 viewPath(跳办文单) + 标题", !!gwDoneRow && gwDoneRow.instanceTitle === "冒烟测试发文A：情况通报", JSON.stringify({ vp: gwDoneRow?.viewPath, t: gwDoneRow?.instanceTitle }))
// 已办页签接口 /instances/done-by-me：200 + 列表（缺 wf_instance_ext 行回退历史，绝不 404 整列表），公文行带 viewPath
const doneByMe = await call(admin.token, "GET", "/api/wf/instances/done-by-me?pageNum=1&pageSize=100")
check("done-by-me 返回 200+列表(不再404)", doneByMe.status === 200 && doneByMe.body?.code === 0 && Array.isArray(doneByMe.body?.data?.list), JSON.stringify({ status: doneByMe.status, code: doneByMe.body?.code }))
const dbmGw = (doneByMe.body?.data?.list ?? []).find((t) => t.viewPath === `/document/send/${aId}`)
check("done-by-me 公文行带 viewPath+标题+defName", !!dbmGw && dbmGw.instanceTitle === "冒烟测试发文A：情况通报" && dbmGw.defName === "发文办理单", JSON.stringify({ vp: dbmGw?.viewPath, t: dbmGw?.instanceTitle, d: dbmGw?.defName }))

// —— 文号防跳：连续两次占号序号 +1 ——
const b = await draftAndIssue("冒烟测试发文B：工作安排")
check("文号防跳(第二次序号 = 第一次 +1)", seqOf(b.issued?.data?.code) === seqOf(a.issued?.data?.code) + 1, `${a.issued?.data?.code} → ${b.issued?.data?.code}`)

// —— 台账连续可查 ——
const ledger = await call(admin.token, "GET", `/api/office/doc/ledger?year=${new Date().getFullYear()}&pageNum=1&pageSize=100`)
const lrows = ledger.body?.data?.list ?? []
check("文号台账含本轮两条占号记录(OCCUPIED)", [a.issued?.data?.code, b.issued?.data?.code].every((n) => lrows.some((r) => r.docNumber === n && r.status === "OCCUPIED")), String(lrows.length))
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
check("普通流程待办 viewPath 为 null(不回归)", taskA ? (taskA.viewPath === null || taskA.viewPath === undefined) : true, JSON.stringify(taskA?.viewPath))
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
    "p1c 定义返回 formType/paths(旧 CUSTOM 归一读为 CODE)",
    create.body?.data?.formType === "CODE" &&
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
    "p1c startable 返回 formType=CODE + submit/view 路径",
    !!cCard && cCard.formType === "CODE" &&
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
    "p1c 详情返回 formType=CODE + formViewPath",
    detC.body?.data?.formType === "CODE" && detC.body?.data?.formViewPath === "/flow/custom/view",
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

/* ---------- 编排（V25 自动化逻辑编排：编译/手动触发/节点留痕/条件走支/脚本/LLM 假端点/重试/起审批流） ---------- */
{
  // 本地 HTTP sink：http 节点目标 + OpenAI-compatible 假端点（可控验证请求与解析）
  const { createServer } = await import("node:http")
  const llmReqs = []
  const agentReqs = []
  const botReqs = []
  let flakyCount = 0
  const sink = createServer((req, res) => {
    let body = ""
    req.on("data", (d) => (body += d))
    req.on("end", () => {
      if (req.url === "/data") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ total: 42, list: [1, 2, 3] }))
      } else if (req.url === "/small") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ total: 1, list: [] }))
      } else if (req.url === "/fail") {
        res.writeHead(500, { "Content-Type": "text/plain" })
        res.end("boom")
      } else if (req.url === "/v1/chat/completions") {
        llmReqs.push(JSON.parse(body || "{}"))
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ choices: [{ message: { content: '{"level":"HIGH","score":42}' } }] }))
      } else if (req.url === "/agent/v1/chat/completions") {
        // agent 假端点：无 tool 消息 → 回 tool_calls；有 tool 消息 → 回最终答案
        const reqBody = JSON.parse(body || "{}")
        agentReqs.push(reqBody)
        const hasToolMsg = (reqBody.messages ?? []).some((m) => m.role === "tool")
        res.writeHead(200, { "Content-Type": "application/json" })
        if (!hasToolMsg) {
          res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "getUser", arguments: '{"id":3}' } }] } }] }))
        } else {
          const toolContent = (reqBody.messages ?? []).find((m) => m.role === "tool")?.content ?? ""
          res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: `用户是${JSON.parse(toolContent).name}` } }] }))
        }
      } else if (req.url === "/ai/v1/chat/completions") {
        // AI 助手假端点：按用户消息脚本化回复（识别关键词→调工具→final）
        const reqBody = JSON.parse(body || "{}")
        const msgs = reqBody.messages ?? []
        const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? ""
        const hasTool = msgs.some((m) => m.role === "tool")
        res.writeHead(200, { "Content-Type": "application/json" })
        if (!hasTool) {
          let tool = null
          if (lastUser.includes("待办")) tool = { name: "query_todo", arguments: "{}" }
          else if (lastUser.includes("请假") && lastUser.includes("发起")) tool = { name: "start_approval", arguments: '{"defCode":"leave_approval"}' }
          else if (lastUser.includes("统计") || lastUser.includes("报表")) tool = { name: "stats_report", arguments: '{"module":"approval","dimension":"status"}' }
          else if (lastUser.includes("急")) tool = { name: "query_urgent", arguments: "{}" }
          else if (lastUser.includes("同意") && lastUser.includes("任务")) tool = { name: "approve_task", arguments: '{"taskId":"' + (lastUser.match(/任务(\S+)/)?.[1] ?? "x") + '","decision":"APPROVE"}' }
          else if (lastUser.includes("日程")) tool = { name: "create_schedule", arguments: JSON.stringify({ title: `AI冒烟日程${TS}`, date: "2026-08-01", type: "OTHER" }) }
          else if (lastUser.includes("公文")) tool = { name: "query_documents", arguments: "{}" }
          if (tool) {
            res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: tool }] } }] }))
            return
          }
          res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "你好，我是星辰 OA 智能助手，可以帮你查待办、发起审批、出报表。" } }] }))
        } else {
          res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "已为你处理，见下方卡片。" } }] }))
        }
      } else if (req.url.startsWith("/dingtalk") || req.url.startsWith("/feishu")) {
        botReqs.push({ url: req.url, body: JSON.parse(body || "{}") })
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(req.url.startsWith("/dingtalk") ? { errcode: 0, errmsg: "ok" } : { code: 0, msg: "success" }))
      } else if (req.url.startsWith("/user")) {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ name: "张三", id: 3 }))
      } else if (req.url === "/flaky") {
        flakyCount++
        if (flakyCount <= 1) {
          res.writeHead(500, { "Content-Type": "text/plain" })
          res.end("flaky boom")
        } else {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ total: 9 }))
        }
      } else {
        res.writeHead(404)
        res.end()
      }
    })
  })
  await new Promise((r) => sink.listen(0, "127.0.0.1", r))
  sink.unref()
  const SINK = `http://127.0.0.1:${sink.address().port}`

  const waitExec = async (execId, timeoutMs = 30000) => {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      const d = await call(admin.token, "GET", `/api/orch/execs/${execId}`)
      if (d.body?.data?.exec?.status && d.body.data.exec.status !== "RUNNING") return d.body.data
      await new Promise((r) => setTimeout(r, 400))
    }
    return (await call(admin.token, "GET", `/api/orch/execs/${execId}`)).body?.data
  }

  // 凭据（LLM，key 加密只写）
  const cred = await call(admin.token, "POST", "/api/orch/credentials", {
    name: "冒烟LLM", type: "LLM", baseUrl: `${SINK}/v1`, apiKey: "sk-smoke-test", model: "fake-model",
  })
  check("orch 凭据创建(hasKey,不回显)", cred.body?.code === 0 && cred.body.data?.hasKey === true && cred.body.data?.apiKey === undefined, JSON.stringify(cred.body?.data))
  const credId = cred.body?.data?.id

  // 主流（对齐疾风演示形状）：trigger → http → condition → llm → notify → end；默认支 → end
  const mainModel = {
    schemaVersion: 1, key: `smoke_orch_main_${TS}`, name: "冒烟编排主流",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "n1", type: "http", name: "拉取", config: { method: "GET", url: "{{payload.url}}", saveAs: "fetch" } },
      { id: "c1", type: "condition", name: "量级判断", config: {} },
      { id: "ai1", type: "llm", name: "AI评估", config: { credentialId: credId, outputMode: "JSON", userPrompt: "评估总量 {{outputs.n1.body.total}}，输出 level", saveAs: "ai" } },
      { id: "nt1", type: "notify", name: "通知", config: { recipients: [{ kind: "USER", id: 1 }], title: "编排通知:{{vars.ai.level}}", content: "总量 {{outputs.n1.body.total}}" } },
      { id: "e1", type: "end", name: "结束", config: { output: "vars.ai.level" } },
      { id: "e2", type: "end", name: "小量结束", config: { output: "'SMALL'" } },
    ],
    edges: [
      { id: "ed1", source: "t1", target: "n1" },
      { id: "ed2", source: "n1", target: "c1" },
      { id: "ed3", source: "c1", target: "ai1", condition: { expression: "outputs.n1.body.total > 10" } },
      { id: "ed4", source: "c1", target: "e2", isDefault: true },
      { id: "ed5", source: "ai1", target: "nt1" },
      { id: "ed6", source: "nt1", target: "e1" },
    ],
  }
  const flowCreate = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_main_${TS}`, name: "冒烟编排主流", designerJson: JSON.stringify(mainModel) })
  check("orch 建流(带 webhookToken)", flowCreate.body?.code === 0 && !!flowCreate.body.data?.webhookToken, JSON.stringify(flowCreate.body))
  const flowId = flowCreate.body?.data?.id
  const pub = await call(admin.token, "POST", `/api/orch/flows/${flowId}/publish`)
  check("orch 发布(编译 EL, version=1)", pub.body?.code === 0 && pub.body.data?.version === 1, JSON.stringify({ v: pub.body?.data?.version, m: pub.body?.message }))
  await call(admin.token, "POST", `/api/orch/flows/${flowId}/enable`, { enabled: true })
  const byCode = await call(admin.token, "GET", `/api/orch/flows/smoke_orch_main_${TS}`)
  check("orch 按 code 取详情(id+code+designerJson+token)", byCode.body?.code === 0 && byCode.body.data?.id === flowId && !!byCode.body.data?.designerJson && !!byCode.body.data?.webhookToken)

  // 走 llm 分支（total=42 > 10）
  const run1 = await call(admin.token, "POST", `/api/orch/flows/${flowId}/run`, { url: `${SINK}/data` })
  check("orch 手动 run 返回 execId", run1.body?.code === 0 && !!run1.body.data?.execId, JSON.stringify(run1.body))
  const exec1 = await waitExec(run1.body?.data?.execId)
  check("orch 主流 exec SUCCESS + result=HIGH", exec1?.exec?.status === "SUCCESS" && exec1?.exec?.result === "HIGH", JSON.stringify({ s: exec1?.exec?.status, r: exec1?.exec?.result, e: exec1?.exec?.error }))
  const nodeIds1 = (exec1?.nodes ?? []).map((n) => n.nodeId)
  check("orch 节点留痕(http/condition/llm/notify/end 全 SUCCESS)",
    ["n1", "c1", "ai1", "nt1", "e1"].every((k) => nodeIds1.includes(k)) && (exec1?.nodes ?? []).every((n) => n.status === "SUCCESS"),
    JSON.stringify((exec1?.nodes ?? []).map((n) => `${n.nodeId}:${n.status}`)))
  check("orch LLM 假端点收到 OpenAI 形请求(model+messages)", llmReqs.length === 1 && llmReqs[0].model === "fake-model" && Array.isArray(llmReqs[0].messages), JSON.stringify(llmReqs[0]?.model))
  const llmNode = (exec1?.nodes ?? []).find((n) => n.nodeId === "ai1")
  check("orch LLM JSON 输出解析入 outputs", (llmNode?.output ?? "").includes('"level"'), llmNode?.output)

  // 默认支（total=1）：不走 llm
  const run2 = await call(admin.token, "POST", `/api/orch/flows/${flowId}/run`, { url: `${SINK}/small` })
  const exec2 = await waitExec(run2.body?.data?.execId)
  const nodeIds2 = (exec2?.nodes ?? []).map((n) => n.nodeId)
  check("orch 条件默认支(不走 llm, result=SMALL)", exec2?.exec?.status === "SUCCESS" && exec2?.exec?.result === "SMALL" && !nodeIds2.includes("ai1"), JSON.stringify({ r: exec2?.exec?.result, nodes: nodeIds2 }))

  // 脚本 + dataMap 流
  const scriptModel = {
    schemaVersion: 1, key: `smoke_orch_script_${TS}`, name: "冒烟编排脚本",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "s1", type: "script", name: "脚本", config: { lang: "groovy", code: "vars.x = 41 + 1; return vars.x" } },
      { id: "d1", type: "dataMap", name: "映射", config: { assignments: [{ target: "y", expr: "vars.x * 2" }] } },
      { id: "e1", type: "end", name: "结束", config: { output: "vars.y" } },
    ],
    edges: [
      { id: "ed1", source: "t1", target: "s1" },
      { id: "ed2", source: "s1", target: "d1" },
      { id: "ed3", source: "d1", target: "e1" },
    ],
  }
  const sf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_script_${TS}`, name: "冒烟编排脚本", designerJson: JSON.stringify(scriptModel) })
  await call(admin.token, "POST", `/api/orch/flows/${sf.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${sf.body?.data?.id}/enable`, { enabled: true })
  const run3 = await call(admin.token, "POST", `/api/orch/flows/${sf.body?.data?.id}/run`, {})
  const exec3 = await waitExec(run3.body?.data?.execId)
  check("orch 脚本+dataMap 流 SUCCESS(result=84)", exec3?.exec?.status === "SUCCESS" && String(exec3?.exec?.result) === "84", JSON.stringify({ s: exec3?.exec?.status, r: exec3?.exec?.result, e: exec3?.exec?.error }))

  // 失败重试 + onError=CONTINUE
  const retryModel = {
    schemaVersion: 1, key: `smoke_orch_retry_${TS}`, name: "冒烟编排重试",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "h1", type: "http", name: "必败", config: { method: "GET", url: `${SINK}/fail`, retry: { times: 1, intervalMs: 50 }, onError: "CONTINUE" } },
      { id: "e1", type: "end", name: "结束", config: { output: "'done'" } },
    ],
    edges: [
      { id: "ed1", source: "t1", target: "h1" },
      { id: "ed2", source: "h1", target: "e1" },
    ],
  }
  const rf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_retry_${TS}`, name: "冒烟编排重试", designerJson: JSON.stringify(retryModel) })
  await call(admin.token, "POST", `/api/orch/flows/${rf.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${rf.body?.data?.id}/enable`, { enabled: true })
  const run4 = await call(admin.token, "POST", `/api/orch/flows/${rf.body?.data?.id}/run`, {})
  const exec4 = await waitExec(run4.body?.data?.execId)
  const failNode = (exec4?.nodes ?? []).find((n) => n.nodeId === "h1")
  check("orch 重试(attempts=2)+onError=CONTINUE(整流 SUCCESS)", exec4?.exec?.status === "SUCCESS" && failNode?.status === "FAILED" && failNode?.attempts === 2, JSON.stringify({ s: exec4?.exec?.status, n: failNode?.status, a: failNode?.attempts }))

  // 起审批流节点：真实起 wf 实例（__wfRegister → wf_instance_ext 一等可见）
  const approvalModel = {
    schemaVersion: 1, key: `smoke_orch_approval_${TS}`, name: "冒烟编排起审批",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "a1", type: "startApproval", name: "起审批", config: { defCode: "leave_approval", title: "编排请假-{{payload.days}}天", formData: { leaveType: "ANNUAL", days: "{{payload.days}}", reason: "编排自动发起" }, initiatorId: 3 } },
      { id: "e1", type: "end", name: "结束", config: { output: "outputs.a1.procInstId" } },
    ],
    edges: [
      { id: "ed1", source: "t1", target: "a1" },
      { id: "ed2", source: "a1", target: "e1" },
    ],
  }
  const af = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_approval_${TS}`, name: "冒烟编排起审批", designerJson: JSON.stringify(approvalModel) })
  await call(admin.token, "POST", `/api/orch/flows/${af.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${af.body?.data?.id}/enable`, { enabled: true })
  const run5 = await call(admin.token, "POST", `/api/orch/flows/${af.body?.data?.id}/run`, { days: 2 })
  const exec5 = await waitExec(run5.body?.data?.execId)
  check("orch 起审批流 SUCCESS(返回 procInstId)", exec5?.exec?.status === "SUCCESS" && (exec5?.exec?.result ?? "").length > 10, JSON.stringify({ s: exec5?.exec?.status, e: exec5?.exec?.error }))
  const zsMy = await call(zhangsan.token, "GET", "/api/wf/instances/my?pageNum=1&pageSize=20")
  check("orch 起的审批实例注册为一等 wf 实例(张三我发起可见)", (zsMy.body?.data?.list ?? []).some((r) => r.title === "编排请假-2天"), JSON.stringify((zsMy.body?.data?.list ?? []).map((r) => r.title).slice(0, 5)))

  // 校验拦截：无默认支的 condition 发布报错
  const badModel = { ...mainModel, key: `smoke_orch_bad_${TS}`, edges: mainModel.edges.map((e) => (e.id === "ed4" ? { ...e, isDefault: false } : e)) }
  const bf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_bad_${TS}`, name: "坏流", designerJson: JSON.stringify(badModel) })
  const badPub = await call(admin.token, "POST", `/api/orch/flows/${bf.body?.data?.id}/publish`)
  check("orch 校验:condition 无默认支发布 400", badPub.body?.code === 400 && (badPub.body?.message ?? "").includes("默认支"), JSON.stringify(badPub.body?.message))

  // 重跑 + 权限 + 分页
  const rerun = await call(admin.token, "POST", `/api/orch/execs/${run1.body?.data?.execId}/rerun`)
  const execR = await waitExec(rerun.body?.data?.execId)
  check("orch 重跑(同 payload 新流水 SUCCESS)", execR?.exec?.status === "SUCCESS", JSON.stringify(execR?.exec?.status))
  const denyRun = await call(zhangsan.token, "POST", `/api/orch/flows/${flowId}/run`, {})
  check("orch zhangsan run → 403", denyRun.status === 403, `status=${denyRun.status}`)
  const execPage = await call(admin.token, "GET", `/api/orch/execs?flowId=${flowId}&pageNum=1&pageSize=10`)
  check("orch exec 分页(标准 PageResult)", execPage.body?.code === 0 && (execPage.body?.data?.total ?? 0) >= 3 && Array.isArray(execPage.body?.data?.list))

  /* ---- 第二批：parallel / loop / onError=BRANCH / webhook / cron / event / keyword ---- */

  // parallel(WHEN)：OPEN 两支 dataMap → JOIN → end(vars.a + vars.b)
  const parModel = {
    schemaVersion: 1, key: `smoke_orch_par_${TS}`, name: "冒烟编排并行",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "p1", type: "parallel", name: "开叉", config: { mode: "OPEN" } },
      { id: "da", type: "dataMap", name: "支A", config: { assignments: [{ target: "a", expr: "1" }] } },
      { id: "db", type: "dataMap", name: "支B", config: { assignments: [{ target: "b", expr: "2" }] } },
      { id: "p2", type: "parallel", name: "汇合", config: { mode: "JOIN" } },
      { id: "e1", type: "end", name: "结束", config: { output: "vars.a + vars.b" } },
    ],
    edges: [
      { id: "pe1", source: "t1", target: "p1" },
      { id: "pe2", source: "p1", target: "da" },
      { id: "pe3", source: "p1", target: "db" },
      { id: "pe4", source: "da", target: "p2" },
      { id: "pe5", source: "db", target: "p2" },
      { id: "pe6", source: "p2", target: "e1" },
    ],
  }
  const pf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_par_${TS}`, name: "冒烟编排并行", designerJson: JSON.stringify(parModel) })
  const pfPub = await call(admin.token, "POST", `/api/orch/flows/${pf.body?.data?.id}/publish`)
  check("orch parallel 发布(WHEN 编译)", pfPub.body?.code === 0, JSON.stringify(pfPub.body?.message))
  await call(admin.token, "POST", `/api/orch/flows/${pf.body?.data?.id}/enable`, {})
  const runP = await call(admin.token, "POST", `/api/orch/flows/${pf.body?.data?.id}/run`, {})
  const execP = await waitExec(runP.body?.data?.execId)
  const pNodes = (execP?.nodes ?? []).map((n) => n.nodeId)
  check("orch parallel 两支都执行(result=3)", execP?.exec?.status === "SUCCESS" && String(execP?.exec?.result) === "3" && pNodes.includes("da") && pNodes.includes("db"), JSON.stringify({ r: execP?.exec?.result, n: pNodes, e: execP?.exec?.error }))

  // loop(ITERATOR)：遍历 payload.items=[1,2,3] 求和
  const loopModel = {
    schemaVersion: 1, key: `smoke_orch_loop_${TS}`, name: "冒烟编排循环",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "d0", type: "dataMap", name: "初始化", config: { assignments: [{ target: "sum", expr: "0" }] } },
      { id: "lp", type: "loop", name: "循环", config: { collection: "payload.items", itemVar: "it", maxIterations: 100 } },
      { id: "db", type: "dataMap", name: "累加", config: { assignments: [{ target: "sum", expr: "vars.sum + vars.it" }] } },
      { id: "e1", type: "end", name: "结束", config: { output: "vars.sum" } },
    ],
    edges: [
      { id: "le1", source: "t1", target: "d0" },
      { id: "le2", source: "d0", target: "lp" },
      { id: "le3", source: "lp", target: "db", loopBody: true },
      { id: "le4", source: "lp", target: "e1" },
    ],
  }
  const lf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_loop_${TS}`, name: "冒烟编排循环", designerJson: JSON.stringify(loopModel) })
  await call(admin.token, "POST", `/api/orch/flows/${lf.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${lf.body?.data?.id}/enable`, {})
  const runL = await call(admin.token, "POST", `/api/orch/flows/${lf.body?.data?.id}/run`, { items: [1, 2, 3] })
  const execL = await waitExec(runL.body?.data?.execId)
  const bodyRuns = (execL?.nodes ?? []).filter((n) => n.nodeId === "db").length
  check("orch loop 遍历3项(sum=6, 体节点3次留痕)", execL?.exec?.status === "SUCCESS" && String(execL?.exec?.result) === "6" && bodyRuns === 3, JSON.stringify({ r: execL?.exec?.result, runs: bodyRuns, e: execL?.exec?.error }))

  // onError=BRANCH：http /fail 失败走失败支
  const brModel = {
    schemaVersion: 1, key: `smoke_orch_branch_${TS}`, name: "冒烟编排失败支",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "h1", type: "http", name: "必败", config: { method: "GET", url: `${SINK}/fail`, onError: "BRANCH" } },
      { id: "e1", type: "end", name: "成功支", config: { output: "'ok'" } },
      { id: "eb", type: "dataMap", name: "失败处理", config: { assignments: [{ target: "handled", expr: "vars.__lastError" }] } },
      { id: "e2", type: "end", name: "失败支", config: { output: "'error-branch'" } },
    ],
    edges: [
      { id: "be1", source: "t1", target: "h1" },
      { id: "be2", source: "h1", target: "e1" },
      { id: "be3", source: "h1", target: "eb", errorBranch: true },
      { id: "be4", source: "eb", target: "e2" },
    ],
  }
  const brf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_branch_${TS}`, name: "冒烟编排失败支", designerJson: JSON.stringify(brModel) })
  const brPub = await call(admin.token, "POST", `/api/orch/flows/${brf.body?.data?.id}/publish`)
  check("orch BRANCH 发布(errorRouter 编译)", brPub.body?.code === 0, JSON.stringify(brPub.body?.message))
  await call(admin.token, "POST", `/api/orch/flows/${brf.body?.data?.id}/enable`, {})
  const runB = await call(admin.token, "POST", `/api/orch/flows/${brf.body?.data?.id}/run`, {})
  const execB = await waitExec(runB.body?.data?.execId)
  const bNodes = (execB?.nodes ?? []).map((n) => n.nodeId)
  check("orch onError=BRANCH 失败走失败支(result=error-branch)", execB?.exec?.status === "SUCCESS" && execB?.exec?.result === "error-branch" && bNodes.includes("eb") && !bNodes.includes("e1"), JSON.stringify({ r: execB?.exec?.result, n: bNodes, e: execB?.exec?.error }))

  // webhook 入站：免登录 token 触发
  const whModel = {
    schemaVersion: 1, key: `smoke_orch_wh_${TS}`, name: "冒烟编排Webhook",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "WEBHOOK" } },
      { id: "d1", type: "dataMap", name: "取值", config: { assignments: [{ target: "who", expr: "payload.who" }] } },
      { id: "e1", type: "end", name: "结束", config: { output: "vars.who" } },
    ],
    edges: [
      { id: "we1", source: "t1", target: "d1" },
      { id: "we2", source: "d1", target: "e1" },
    ],
  }
  const whf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_wh_${TS}`, name: "冒烟编排Webhook", designerJson: JSON.stringify(whModel) })
  await call(admin.token, "POST", `/api/orch/flows/${whf.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${whf.body?.data?.id}/enable`, {})
  const whToken = (await call(admin.token, "GET", `/api/orch/flows/smoke_orch_wh_${TS}`)).body?.data?.webhookToken
  const hook = await call(null, "POST", `/api/orch/hooks/${whToken}`, { who: "外部系统" })
  check("orch webhook 免登录触发返回 execId", hook.status === 200 && hook.body?.code === 0 && !!hook.body?.data?.execId, JSON.stringify({ s: hook.status, b: hook.body }))
  const execW = await waitExec(hook.body?.data?.execId)
  check("orch webhook 触发真实执行(result=外部系统,kind=WEBHOOK)", execW?.exec?.status === "SUCCESS" && execW?.exec?.result === "外部系统" && execW?.exec?.triggerKind === "WEBHOOK", JSON.stringify({ r: execW?.exec?.result, k: execW?.exec?.triggerKind }))
  const hookBad = await call(null, "POST", "/api/orch/hooks/no-such-token", {})
  check("orch webhook 无效 token → 404", hookBad.body?.code === 404, JSON.stringify(hookBad.body?.code))

  // cron：短周期(每2秒)注册 → 等一跳产生 CRON 流水；坏表达式发布 400
  const cronModel = {
    schemaVersion: 1, key: `smoke_orch_cron_${TS}`, name: "冒烟编排定时",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "CRON", cron: "*/2 * * * * *" } },
      { id: "e1", type: "end", name: "结束", config: { output: "'tick'" } },
    ],
    edges: [{ id: "ce1", source: "t1", target: "e1" }],
  }
  const cf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_cron_${TS}`, name: "冒烟编排定时", designerJson: JSON.stringify(cronModel) })
  await call(admin.token, "POST", `/api/orch/flows/${cf.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${cf.body?.data?.id}/enable`, {})
  let cronExec = null
  for (let i = 0; i < 20 && !cronExec; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const page = await call(admin.token, "GET", `/api/orch/execs?flowId=${cf.body?.data?.id}&pageNum=1&pageSize=5`)
    cronExec = (page.body?.data?.list ?? []).find((e) => e.triggerKind === "CRON")
  }
  await call(admin.token, "POST", `/api/orch/flows/${cf.body?.data?.id}/enable`, { enabled: false }) // 立即停表
  check("orch CRON 注册并触发(2s 周期一跳,kind=CRON)", !!cronExec, JSON.stringify(cronExec?.triggerKind))
  const badCron = { ...cronModel, key: `smoke_orch_cronbad_${TS}`, nodes: cronModel.nodes.map((n) => (n.id === "t1" ? { ...n, config: { triggerType: "CRON", cron: "not-a-cron" } } : n)) }
  const bcf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_cronbad_${TS}`, name: "坏cron", designerJson: JSON.stringify(badCron) })
  const bcPub = await call(admin.token, "POST", `/api/orch/flows/${bcf.body?.data?.id}/publish`)
  check("orch 坏 cron 表达式发布 400", bcPub.body?.code === 400 && (bcPub.body?.message ?? "").includes("cron"), JSON.stringify(bcPub.body?.message))

  // 事件桥：订阅 WF/INSTANCE_COMPLETED(leave_approval) → 起审批办完 → 编排被触发
  const evModel = {
    schemaVersion: 1, key: `smoke_orch_event_${TS}`, name: "冒烟编排事件",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "EVENT", event: { source: "WF", type: "INSTANCE_COMPLETED", defCode: "leave_approval" } } },
      { id: "e1", type: "end", name: "结束", config: { output: "payload.title" } },
    ],
    edges: [{ id: "ee1", source: "t1", target: "e1" }],
  }
  const ef = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_event_${TS}`, name: "冒烟编排事件", designerJson: JSON.stringify(evModel) })
  await call(admin.token, "POST", `/api/orch/flows/${ef.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${ef.body?.data?.id}/enable`, {})
  const evInst = await startInst("leave_approval", `事件桥请假-${TS}`, { leaveType: "ANNUAL", days: 2, reason: "事件桥测试" })
  const evTask = await findTodo(manager.token, `事件桥请假-${TS}`)
  if (evTask) await call(manager.token, "POST", `/api/wf/tasks/${evTask.taskId}/approve`, { comment: "过" })
  let evExec = null
  for (let i = 0; i < 20 && !evExec; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const page = await call(admin.token, "GET", `/api/orch/execs?flowId=${ef.body?.data?.id}&pageNum=1&pageSize=5`)
    evExec = (page.body?.data?.list ?? []).find((e) => e.triggerKind === "EVENT" && e.status !== "RUNNING")
  }
  check("orch 事件桥:审批办完触发编排(payload 含 procInstId,result=标题)", !!evExec && evExec.status === "SUCCESS" && (evExec.payload ?? "").includes("procInstId") && evExec.result === `事件桥请假-${TS}`, JSON.stringify({ s: evExec?.status, r: evExec?.result }))
  await call(admin.token, "POST", `/api/orch/flows/${ef.body?.data?.id}/enable`, { enabled: false })

  // keyword：我发起/已办/待办 模糊过滤
  const kwMy = await call(zhangsan.token, "GET", encodeURI(`/api/wf/instances/my?keyword=事件桥请假&pageNum=1&pageSize=20`))
  check("keyword 我发起过滤(全部命中)", kwMy.body?.code === 0 && (kwMy.body?.data?.list ?? []).length >= 1 && (kwMy.body?.data?.list ?? []).every((r) => (r.title ?? "").includes("事件桥请假")), JSON.stringify(kwMy.body?.data?.total))
  const kwMyMiss = await call(zhangsan.token, "GET", "/api/wf/instances/my?keyword=zzz_no_such_kw&pageNum=1&pageSize=20")
  check("keyword 我发起无命中 total=0", kwMyMiss.body?.code === 0 && kwMyMiss.body?.data?.total === 0)
  const kwDone = await call(admin.token, "GET", encodeURI(`/api/wf/instances/done-by-me?keyword=情况通报&pageNum=1&pageSize=20`))
  check("keyword 已办过滤(标题命中)", kwDone.body?.code === 0 && (kwDone.body?.data?.list ?? []).every((t) => `${t.instanceTitle}${t.defName}${t.nodeName}`.includes("情况通报")), JSON.stringify(kwDone.body?.data?.total))
  const kwTodo = await call(manager.token, "GET", "/api/wf/tasks/todo?keyword=zzz_no_such_kw&pageNum=1&pageSize=20")
  check("keyword 待办无命中 total=0(接口不报错)", kwTodo.body?.code === 0 && kwTodo.body?.data?.total === 0)
  // 公文归档卷宗年度筛(archived_at)
  const kwArch = await call(admin.token, "GET", `/api/office/doc/archive?year=${new Date().getFullYear()}&pageNum=1&pageSize=10`)
  check("公文归档 year 参数(按 archived_at 年度)生效", kwArch.body?.code === 0 && (kwArch.body?.data?.total ?? 0) >= 1, JSON.stringify(kwArch.body?.data?.total))
  const kwArchMiss = await call(admin.token, "GET", "/api/office/doc/archive?year=1999&pageNum=1&pageSize=10")
  check("公文归档 year=1999 无命中", kwArchMiss.body?.code === 0 && kwArchMiss.body?.data?.total === 0, JSON.stringify(kwArchMiss.body?.data?.total))

  /* ---- 批3：agent 工具循环 / wait 挂起恢复 / wait 超时 / 失败续跑 / webhook 同步 respond ---- */

  // agent：两步 function-calling 循环（假端点回 tool_calls → 工具 HTTP → final）
  const agentCred = await call(admin.token, "POST", "/api/orch/credentials", {
    name: "冒烟AgentLLM", type: "LLM", baseUrl: `${SINK}/agent/v1`, apiKey: "sk-agent", model: "fake-agent",
  })
  const agentModel = {
    schemaVersion: 1, key: `smoke_orch_agent_${TS}`, name: "冒烟编排Agent",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "ag1", type: "agent", name: "查询助手", config: {
        credentialId: agentCred.body?.data?.id, userPrompt: "查用户 {{payload.uid}} 的姓名", maxSteps: 5, saveAs: "agent",
        tools: [{ name: "getUser", description: "按 id 查用户", params: [{ name: "id", type: "number", description: "用户id", required: true }],
          impl: { kind: "HTTP", method: "GET", url: `${SINK}/user?id={{args.id}}` } }],
      } },
      { id: "e1", type: "end", name: "结束", config: { output: "vars.agent.result" } },
    ],
    edges: [
      { id: "ae1", source: "t1", target: "ag1" },
      { id: "ae2", source: "ag1", target: "e1" },
    ],
  }
  const agf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_agent_${TS}`, name: "冒烟编排Agent", designerJson: JSON.stringify(agentModel) })
  await call(admin.token, "POST", `/api/orch/flows/${agf.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${agf.body?.data?.id}/enable`, {})
  const runAg = await call(admin.token, "POST", `/api/orch/flows/${agf.body?.data?.id}/run`, { uid: 3 })
  const execAg = await waitExec(runAg.body?.data?.execId)
  check("orch agent 两步工具循环(result=用户是张三)", execAg?.exec?.status === "SUCCESS" && execAg?.exec?.result === "用户是张三", JSON.stringify({ s: execAg?.exec?.status, r: execAg?.exec?.result, e: execAg?.exec?.error }))
  const agNode = (execAg?.nodes ?? []).find((n) => n.nodeId === "ag1")
  check("orch agent steps 明细留痕(getUser+args)", (agNode?.output ?? "").includes('"tool":"getUser"') && (agNode?.output ?? "").includes('"steps"'), (agNode?.output ?? "").slice(0, 150))
  check("orch agent 假端点收到两轮请求(第二轮带 tool 消息)", agentReqs.length === 2 && (agentReqs[1].messages ?? []).some((m) => m.role === "tool"), String(agentReqs.length))

  // wait：挂起 → resume 带 body → SUCCESS
  const waitModel = {
    schemaVersion: 1, key: `smoke_orch_wait_${TS}`, name: "冒烟编排等待",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "d0", type: "dataMap", name: "前段", config: { assignments: [{ target: "pre", expr: "'before-wait'" }] } },
      { id: "w1", type: "wait", name: "等回调", config: { saveAs: "cb", timeoutMs: 60000 } },
      { id: "e1", type: "end", name: "结束", config: { output: "vars.cb.answer" } },
    ],
    edges: [
      { id: "we1", source: "t1", target: "d0" },
      { id: "we2", source: "d0", target: "w1" },
      { id: "we3", source: "w1", target: "e1" },
    ],
  }
  const wf2 = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_wait_${TS}`, name: "冒烟编排等待", designerJson: JSON.stringify(waitModel) })
  await call(admin.token, "POST", `/api/orch/flows/${wf2.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${wf2.body?.data?.id}/enable`, {})
  const runW = await call(admin.token, "POST", `/api/orch/flows/${wf2.body?.data?.id}/run`, {})
  let waitingExec = null
  for (let i = 0; i < 15 && !waitingExec; i++) {
    await new Promise((r) => setTimeout(r, 400))
    const d = await call(admin.token, "GET", `/api/orch/execs/${runW.body?.data?.execId}`)
    if (d.body?.data?.exec?.status === "WAITING") waitingExec = d.body.data
  }
  check("orch wait 挂起(WAITING+resumeToken)", !!waitingExec && !!waitingExec.exec.resumeToken, JSON.stringify(waitingExec?.exec?.status))
  const resumeResp = await call(null, "POST", `/api/orch/resume/${waitingExec?.exec?.resumeToken}`, { answer: "42" })
  check("orch resume 免登录恢复返回 execId", resumeResp.status === 200 && resumeResp.body?.code === 0, JSON.stringify(resumeResp.body))
  const execWDone = await waitExec(runW.body?.data?.execId)
  check("orch wait 恢复后续段执行(result=42,segment=1)", execWDone?.exec?.status === "SUCCESS" && execWDone?.exec?.result === "42" && execWDone?.exec?.currentSegment === 1, JSON.stringify({ s: execWDone?.exec?.status, r: execWDone?.exec?.result, seg: execWDone?.exec?.currentSegment }))
  const wNode = (execWDone?.nodes ?? []).find((n) => n.nodeId === "w1")
  check("orch wait 节点留痕收口 SUCCESS", wNode?.status === "SUCCESS", wNode?.status)

  // wait 超时（短 timeout → FAILED）
  const waitTimeoutModel = { ...waitModel, key: `smoke_orch_waitto_${TS}`,
    nodes: waitModel.nodes.map((n) => (n.id === "w1" ? { ...n, config: { saveAs: "cb", timeoutMs: 1500 } } : n)) }
  const wtf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_waitto_${TS}`, name: "冒烟等待超时", designerJson: JSON.stringify(waitTimeoutModel) })
  await call(admin.token, "POST", `/api/orch/flows/${wtf.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${wtf.body?.data?.id}/enable`, {})
  const runWT = await call(admin.token, "POST", `/api/orch/flows/${wtf.body?.data?.id}/run`, {})
  let wtExec = null
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const d = await call(admin.token, "GET", `/api/orch/execs/${runWT.body?.data?.execId}`)
    if (d.body?.data?.exec?.status === "FAILED") { wtExec = d.body.data; break }
  }
  check("orch wait 超时 FAILED(error=wait timeout)", !!wtExec && (wtExec.exec.error ?? "").includes("wait timeout"), JSON.stringify(wtExec?.exec?.error))

  // 失败续跑：flaky 首败(FAILED) → resume-from-failure 复用父上下文从失败节点续跑 SUCCESS
  const flakyModel = {
    schemaVersion: 1, key: `smoke_orch_flaky_${TS}`, name: "冒烟编排续跑",
    nodes: [
      { id: "d1", type: "dataMap", name: "前置", config: { assignments: [{ target: "a", expr: "1" }] } },
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "h1", type: "http", name: "flaky", config: { method: "GET", url: `${SINK}/flaky` } },
      { id: "e1", type: "end", name: "结束", config: { output: "vars.a + outputs.h1.body.total" } },
    ],
    edges: [
      { id: "fe1", source: "t1", target: "d1" },
      { id: "fe2", source: "d1", target: "h1" },
      { id: "fe3", source: "h1", target: "e1" },
    ],
  }
  const ff2 = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_flaky_${TS}`, name: "冒烟编排续跑", designerJson: JSON.stringify(flakyModel) })
  await call(admin.token, "POST", `/api/orch/flows/${ff2.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${ff2.body?.data?.id}/enable`, {})
  const runF = await call(admin.token, "POST", `/api/orch/flows/${ff2.body?.data?.id}/run`, {})
  const execF = await waitExec(runF.body?.data?.execId)
  check("orch flaky 首跑 FAILED(h1)", execF?.exec?.status === "FAILED", JSON.stringify(execF?.exec?.status))
  const rff = await call(admin.token, "POST", `/api/orch/execs/${runF.body?.data?.execId}/resume-from-failure`)
  check("orch resume-from-failure 返回新 execId", rff.body?.code === 0 && !!rff.body?.data?.execId, JSON.stringify(rff.body))
  const execRF = await waitExec(rff.body?.data?.execId)
  const rfNodes = (execRF?.nodes ?? []).map((n) => n.nodeId)
  check("orch 续跑复用父上下文(result=10=vars.a(父)+total,从 h1 起跑不含 d1)",
    execRF?.exec?.status === "SUCCESS" && String(execRF?.exec?.result) === "10" && rfNodes.includes("h1") && !rfNodes.includes("d1") && execRF?.exec?.parentExecId === runF.body?.data?.execId,
    JSON.stringify({ s: execRF?.exec?.status, r: execRF?.exec?.result, n: rfNodes, p: execRF?.exec?.parentExecId }))

  // webhook 同步响应（respond 节点）
  const respModel = {
    schemaVersion: 1, key: `smoke_orch_resp_${TS}`, name: "冒烟编排同步响应",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "WEBHOOK" } },
      { id: "d1", type: "dataMap", name: "取值", config: { assignments: [{ target: "msg", expr: "payload.q" }] } },
      { id: "r1", type: "respond", name: "响应", config: { status: 200, body: '{"echo":"{{vars.msg}}"}' } },
      { id: "e1", type: "end", name: "结束", config: { output: "vars.msg" } },
    ],
    edges: [
      { id: "re1", source: "t1", target: "d1" },
      { id: "re2", source: "d1", target: "r1" },
      { id: "re3", source: "r1", target: "e1" },
    ],
  }
  const rpf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_resp_${TS}`, name: "冒烟编排同步响应", designerJson: JSON.stringify(respModel) })
  await call(admin.token, "POST", `/api/orch/flows/${rpf.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${rpf.body?.data?.id}/enable`, {})
  const rpToken = (await call(admin.token, "GET", `/api/orch/flows/smoke_orch_resp_${TS}`)).body?.data?.webhookToken
  const syncResp = await call(null, "POST", `/api/orch/hooks/${rpToken}`, { q: "hi" })
  check("orch webhook 同步拿到 respond body(echo=hi,非信封)", syncResp.status === 200 && syncResp.body?.echo === "hi", JSON.stringify(syncResp.body))
  // 非 webhook 触发带 respond：等价 dataMap 不报错
  const runResp = await call(admin.token, "POST", `/api/orch/flows/${rpf.body?.data?.id}/run`, { q: "manual" })
  const execResp = await waitExec(runResp.body?.data?.execId)
  check("orch 非 webhook 触发带 respond 不报错(SUCCESS)", execResp?.exec?.status === "SUCCESS" && execResp?.exec?.result === "manual", JSON.stringify({ s: execResp?.exec?.status, r: execResp?.exec?.result }))

  // 校验：wait 在 loop 体内发布 400
  const badWaitModel = {
    schemaVersion: 1, key: `smoke_orch_badwait_${TS}`, name: "坏wait",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "lp", type: "loop", name: "循环", config: { collection: "payload.items", itemVar: "it" } },
      { id: "w1", type: "wait", name: "体内等待", config: { saveAs: "cb" } },
      { id: "dx", type: "dataMap", name: "体尾", config: { assignments: [] } },
      { id: "e1", type: "end", name: "结束", config: {} },
    ],
    edges: [
      { id: "bw1", source: "t1", target: "lp" },
      { id: "bw2", source: "lp", target: "w1", loopBody: true },
      { id: "bw3", source: "w1", target: "dx" },
      { id: "bw4", source: "lp", target: "e1" },
    ],
  }
  const bwf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_badwait_${TS}`, name: "坏wait", designerJson: JSON.stringify(badWaitModel) })
  const bwPub = await call(admin.token, "POST", `/api/orch/flows/${bwf.body?.data?.id}/publish`)
  check("orch wait 在 loop 体内发布 400", bwPub.body?.code === 400 && (bwPub.body?.message ?? "").includes("wait"), JSON.stringify(bwPub.body?.message))

  /* ---- 批4：dingtalkBot / feishuBot / dbQuery 连接器 + 版本历史/回滚 ---- */

  // 钉钉+飞书机器人（sink 假 webhook：钉钉验加签参数、飞书验 body 签名字段）
  const botModel = {
    schemaVersion: 1, key: `smoke_orch_bot_${TS}`, name: "冒烟编排机器人",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "dd", type: "dingtalkBot", name: "钉钉", config: { url: `${SINK}/dingtalk`, secret: "SECtest", msgType: "markdown", title: "告警", content: "级别 {{payload.level}}" } },
      { id: "fs", type: "feishuBot", name: "飞书", config: { url: `${SINK}/feishu`, secret: "fstest", msgType: "text", content: "飞书通知 {{payload.level}}" } },
      { id: "e1", type: "end", name: "结束", config: { output: "'sent'" } },
    ],
    edges: [
      { id: "bo1", source: "t1", target: "dd" },
      { id: "bo2", source: "dd", target: "fs" },
      { id: "bo3", source: "fs", target: "e1" },
    ],
  }
  const botf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_bot_${TS}`, name: "冒烟编排机器人", designerJson: JSON.stringify(botModel) })
  await call(admin.token, "POST", `/api/orch/flows/${botf.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${botf.body?.data?.id}/enable`, {})
  const runBot = await call(admin.token, "POST", `/api/orch/flows/${botf.body?.data?.id}/run`, { level: "P1" })
  const execBot = await waitExec(runBot.body?.data?.execId)
  const ddReq = botReqs.find((r) => r.url.startsWith("/dingtalk"))
  const fsReq = botReqs.find((r) => r.url.startsWith("/feishu"))
  check("orch dingtalkBot 发送(加签参数+markdown 渲染)", execBot?.exec?.status === "SUCCESS" && !!ddReq && ddReq.url.includes("timestamp=") && ddReq.url.includes("sign=") && ddReq.body?.msgtype === "markdown" && (ddReq.body?.markdown?.text ?? "").includes("P1"), JSON.stringify({ s: execBot?.exec?.status, u: ddReq?.url?.slice(0, 60) }))
  check("orch feishuBot 发送(body 带 timestamp/sign+text 渲染)", !!fsReq && !!fsReq.body?.timestamp && !!fsReq.body?.sign && (fsReq.body?.content?.text ?? "").includes("P1"), JSON.stringify(fsReq?.body?.msg_type))

  // dbQuery：本应用库只读 select-only
  const dbModel = {
    schemaVersion: 1, key: `smoke_orch_db_${TS}`, name: "冒烟编排查询",
    nodes: [
      { id: "t1", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "q1", type: "dbQuery", name: "查用户", config: { sql: "select id, username from sys_user where id <= ? order by id", params: ["payload.maxId"], saveAs: "users" } },
      { id: "e1", type: "end", name: "结束", config: { output: "vars.users.count" } },
    ],
    edges: [
      { id: "dq1", source: "t1", target: "q1" },
      { id: "dq2", source: "q1", target: "e1" },
    ],
  }
  const dbf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_db_${TS}`, name: "冒烟编排查询", designerJson: JSON.stringify(dbModel) })
  await call(admin.token, "POST", `/api/orch/flows/${dbf.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${dbf.body?.data?.id}/enable`, {})
  const runDb = await call(admin.token, "POST", `/api/orch/flows/${dbf.body?.data?.id}/run`, { maxId: 2 })
  const execDb = await waitExec(runDb.body?.data?.execId)
  const dbNode = (execDb?.nodes ?? []).find((n) => n.nodeId === "q1")
  check("orch dbQuery 本库只读查询(count=2,rows 带 username)", execDb?.exec?.status === "SUCCESS" && String(execDb?.exec?.result) === "2" && (dbNode?.output ?? "").includes("admin"), JSON.stringify({ s: execDb?.exec?.status, r: execDb?.exec?.result, e: execDb?.exec?.error }))
  // select-only 硬校验：delete 语句节点失败
  const dbBadModel = { ...dbModel, key: `smoke_orch_dbbad_${TS}`,
    nodes: dbModel.nodes.map((n) => (n.id === "q1" ? { ...n, config: { sql: "delete from sys_user where id = 999", saveAs: "x" } } : n)) }
  const dbbf = await call(admin.token, "POST", "/api/orch/flows", { code: `smoke_orch_dbbad_${TS}`, name: "坏查询", designerJson: JSON.stringify(dbBadModel) })
  await call(admin.token, "POST", `/api/orch/flows/${dbbf.body?.data?.id}/publish`)
  await call(admin.token, "POST", `/api/orch/flows/${dbbf.body?.data?.id}/enable`, {})
  const runDbBad = await call(admin.token, "POST", `/api/orch/flows/${dbbf.body?.data?.id}/run`, {})
  const execDbBad = await waitExec(runDbBad.body?.data?.execId)
  check("orch dbQuery select-only 硬校验(delete → FAILED)", execDbBad?.exec?.status === "FAILED" && (execDbBad?.exec?.error ?? "").includes("SELECT"), JSON.stringify(execDbBad?.exec?.error))

  // 版本历史 + 回滚：v1 → 改图发布 v2 → 回滚 v1 → 产生 v3(内容=v1)
  const verList1 = await call(admin.token, "GET", `/api/orch/flows/${dbf.body?.data?.id}/versions`)
  check("orch 版本历史(发布即快照,v1 在列)", verList1.body?.code === 0 && (verList1.body?.data ?? []).some((v) => v.version === 1), JSON.stringify((verList1.body?.data ?? []).map((v) => v.version)))
  const dbModelV2 = { ...dbModel, nodes: dbModel.nodes.map((n) => (n.id === "e1" ? { ...n, config: { output: "'v2'" } } : n)) }
  await call(admin.token, "PUT", `/api/orch/flows/${dbf.body?.data?.id}`, { designerJson: JSON.stringify(dbModelV2) })
  await call(admin.token, "POST", `/api/orch/flows/${dbf.body?.data?.id}/publish`)
  const verDetail1 = await call(admin.token, "GET", `/api/orch/flows/${dbf.body?.data?.id}/versions/1`)
  check("orch 版本详情(v1 designerJson 保留原 output)", (verDetail1.body?.data?.designerJson ?? "").includes("vars.users.count"), null)
  const rollback = await call(admin.token, "POST", `/api/orch/flows/${dbf.body?.data?.id}/versions/1/rollback`)
  check("orch 回滚 v1(重新发布产生 v3)", rollback.body?.code === 0 && rollback.body?.data?.version === 3 && (rollback.body?.data?.designerJson ?? "").includes("vars.users.count"), JSON.stringify(rollback.body?.data?.version))
  const verList2 = await call(admin.token, "GET", `/api/orch/flows/${dbf.body?.data?.id}/versions`)
  check("orch 版本列表 v1/v2/v3 齐全", [1, 2, 3].every((v) => (verList2.body?.data ?? []).some((x) => x.version === v)), JSON.stringify((verList2.body?.data ?? []).map((v) => v.version)))

  /* ---- AI 智能助手（V28）：chat/工具/confirm 二段式/会话隔离/急事/报表 ---- */

  // 系统默认 LLM 凭据（AiChatService.defaultCredential 取第一条 LLM 型；用 AI 假端点）
  const aiCred = await call(admin.token, "POST", "/api/orch/credentials", {
    name: "冒烟助手LLM", type: "LLM", baseUrl: `${SINK}/ai/v1`, apiKey: "sk-ai", model: "fake-ai",
  })
  check("ai 助手 LLM 凭据创建", aiCred.body?.code === 0 && !!aiCred.body?.data?.id)

  // 基础问答（无工具）
  const chat1 = await call(admin.token, "POST", "/api/ai/chat", { message: "你好" })
  const s1 = chat1.body?.data
  check("ai chat 基础问答(新会话+ASSISTANT 回复)", chat1.body?.code === 0 && !!s1?.sessionId && s1?.messages?.[0]?.role === "ASSISTANT" && (s1?.messages?.[0]?.content ?? "").length > 0, JSON.stringify(s1?.messages?.[0]?.content))
  const sessionId = s1?.sessionId

  // 工具调用：查待办 → list 卡
  const chat2 = await call(admin.token, "POST", "/api/ai/chat", { sessionId, message: "帮我查下待办" })
  const cards2 = chat2.body?.data?.messages?.[0]?.cards ?? []
  check("ai query_todo 工具产 list 卡", cards2.some((c) => c.type === "list" && (c.title ?? "").includes("待办")), JSON.stringify(cards2.map((c) => c.type)))

  // 报表：stats_report → chart 卡
  const chat3 = await call(admin.token, "POST", "/api/ai/chat", { sessionId, message: "本月审批量统计" })
  const chartCard = (chat3.body?.data?.messages?.[0]?.cards ?? []).find((c) => c.type === "chart")
  check("ai stats_report 工具产 chart 卡(pie+series)", !!chartCard && chartCard.chartType === "pie" && Array.isArray(chartCard.series), JSON.stringify(chartCard?.chartType))

  // 急事
  const chat4 = await call(admin.token, "POST", "/api/ai/chat", { sessionId, message: "我现在有什么急事" })
  const urgentCard = (chat4.body?.data?.messages?.[0]?.cards ?? []).find((c) => c.type === "list")
  check("ai query_urgent 产急事 list 卡", !!urgentCard && (urgentCard.title ?? "").includes("急事"), JSON.stringify(urgentCard?.title))

  // 发起审批 → form 卡
  const chat5 = await call(admin.token, "POST", "/api/ai/chat", { sessionId, message: "我要发起请假申请" })
  const formCard = (chat5.body?.data?.messages?.[0]?.cards ?? []).find((c) => c.type === "form")
  check("ai start_approval 产 form 卡(defCode+formType)", !!formCard && formCard.defCode === "leave_approval" && !!formCard.formType, JSON.stringify({ d: formCard?.defCode, t: formCard?.formType }))

  // confirm 二段式：建日程 → confirm 卡 → 不确认不生效 + 确认生效 + 一次性
  const chat6 = await call(admin.token, "POST", "/api/ai/chat", { sessionId, message: "帮我建个日程" })
  const confirmCard = (chat6.body?.data?.messages?.[0]?.cards ?? []).find((c) => c.type === "confirm")
  check("ai create_schedule 产 confirm 卡(actionId+summary+danger 语义)", !!confirmCard && !!confirmCard.actionId && confirmCard.danger === false && !!confirmCard.summary, JSON.stringify({ a: !!confirmCard?.actionId }))
  // 不存在 actionId → 410
  const badConfirm = await call(admin.token, "POST", "/api/ai/confirm", { actionId: "nonexistent_action_id" })
  check("ai confirm 不存在 actionId → 410", badConfirm.body?.code === 410, JSON.stringify(badConfirm.body?.code))
  // 确认前：日程未创建
  const schedBefore = await call(admin.token, "GET", "/api/office/schedules?month=2026-08")
  const hadBefore = (schedBefore.body?.data ?? []).some((x) => x.title === `AI冒烟日程${TS}`)
  check("ai confirm 前变更未生效", !hadBefore)
  // 确认执行 → 生效
  const doConfirm = await call(admin.token, "POST", "/api/ai/confirm", { actionId: confirmCard?.actionId })
  check("ai confirm 确认执行成功", doConfirm.body?.code === 0 && doConfirm.body?.data?.success === true, JSON.stringify(doConfirm.body?.data))
  const schedAfter = await call(admin.token, "GET", "/api/office/schedules?month=2026-08")
  check("ai confirm 后日程真实创建(变更生效)", (schedAfter.body?.data ?? []).some((x) => x.title === `AI冒烟日程${TS}`))
  const reConfirm = await call(admin.token, "POST", "/api/ai/confirm", { actionId: confirmCard?.actionId })
  check("ai confirm 二次确认 → 410(一次性消费)", reConfirm.body?.code === 410, JSON.stringify(reConfirm.body?.code))

  // 会话隔离：zhangsan 读 admin 会话 → 403
  const zsRead = await call(zhangsan.token, "GET", `/api/ai/sessions/${sessionId}/messages`)
  check("ai 会话隔离(B 读 A 会话 → 403)", zsRead.body?.code === 403, JSON.stringify(zsRead.body?.code))
  const zsChat = await call(zhangsan.token, "POST", "/api/ai/chat", { sessionId, message: "偷看" })
  check("ai 会话隔离(B 在 A 会话发消息 → 403)", zsChat.body?.code === 403, JSON.stringify(zsChat.body?.code))

  // 会话列表 + 消息分页 + 删除
  const sessList = await call(admin.token, "GET", "/api/ai/sessions")
  check("ai 会话列表含本会话", (sessList.body?.data ?? []).some((x) => x.id === sessionId))
  const msgs = await call(admin.token, "GET", `/api/ai/sessions/${sessionId}/messages?pageNum=1&pageSize=100`)
  check("ai 消息分页(含 USER/ASSISTANT)", msgs.body?.code === 0 && (msgs.body?.data?.list ?? []).some((m) => m.role === "USER") && (msgs.body?.data?.list ?? []).some((m) => m.role === "ASSISTANT"))
  const delSess = await call(admin.token, "DELETE", `/api/ai/sessions/${sessionId}`)
  check("ai 删除会话", delSess.body?.code === 0)
  const afterDel = await call(admin.token, "GET", `/api/ai/sessions/${sessionId}/messages`)
  check("ai 删除后会话 404", afterDel.body?.code === 404, JSON.stringify(afterDel.body?.code))

  // 工具权限：zhangsan（无 office:doc:send）问发文——工具经底层权限，助手礼貌处理不 500
  const zsChat2 = await call(zhangsan.token, "POST", "/api/ai/chat", { message: "查下公文列表" })
  check("ai zhangsan 对话正常(工具带其数据权限,不 500)", zsChat2.body?.code === 0 && zsChat2.body?.data?.messages?.[0]?.role === "ASSISTANT", JSON.stringify(zsChat2.body?.code))

  sink.close()
}

/* ---------- 单据管理 BizDoc（V29：定义/状态机/事件回写/套打数据/数据权限） ---------- */
{
  const bdWait = async (id, want, timeoutMs = 15000) => {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      const d = await call(admin.token, "GET", `/api/bizdoc/docs/${id}`)
      if (d.body?.data?.status === want) return d.body.data
      await new Promise((r) => setTimeout(r, 400))
    }
    return (await call(admin.token, "GET", `/api/bizdoc/docs/${id}`)).body?.data
  }
  const ruleId = (await call(admin.token, "GET", "/api/office/doc/number/rules")).body?.data?.[0]?.id

  // 1. 纯台账定义（无流程 + 编号规则）：发布校验 + 提交即生效 + 占号格式
  const defA = await call(admin.token, "POST", "/api/bizdoc/defs", {
    code: `smoke_bd_plain_${TS}`, name: "冒烟登记单", formType: "ONLINE", formCode: "leave", numberRuleId: ruleId,
    listConfig: { columns: [{ field: "leaveType", label: "类型" }, { field: "days", label: "天数" }], filters: [{ field: "leaveType", label: "类型", type: "select" }] },
  })
  check("bizdoc 定义创建", defA.body?.code === 0 && defA.body?.data?.status === "DRAFT", JSON.stringify(defA.body?.message))
  const badPub = await call(admin.token, "POST", "/api/bizdoc/defs", { code: `smoke_bd_bad_${TS}`, name: "坏定义", formCode: "no_such_form" })
  const badPubResp = await call(admin.token, "POST", `/api/bizdoc/defs/${badPub.body?.data?.id}/publish`)
  check("bizdoc 发布校验(表单不存在 400)", badPubResp.body?.code === 400, JSON.stringify(badPubResp.body?.message))
  const badColDef = await call(admin.token, "POST", "/api/bizdoc/defs", {
    code: `smoke_bd_badcol_${TS}`, name: "坏列", formType: "ONLINE", formCode: "leave",
    listConfig: { columns: [{ field: "no_such_field", label: "x" }] },
  })
  const badColPub = await call(admin.token, "POST", `/api/bizdoc/defs/${badColDef.body?.data?.id}/publish`)
  check("bizdoc 发布校验(台账列不在表单清单 400)", badColPub.body?.code === 400 && (badColPub.body?.message ?? "").includes("清单"), JSON.stringify(badColPub.body?.message))
  await call(admin.token, "POST", `/api/bizdoc/defs/${defA.body?.data?.id}/publish`)
  const defAGet = await call(admin.token, "GET", `/api/bizdoc/defs/smoke_bd_plain_${TS}`)
  check("bizdoc 定义按 code 取(已发布)", defAGet.body?.data?.status === "PUBLISHED")

  const docA = await call(admin.token, "POST", "/api/bizdoc/docs", {
    defCode: `smoke_bd_plain_${TS}`, formData: { leaveType: "ANNUAL", days: 2, reason: "冒烟" },
  })
  check("bizdoc 创建草稿(标题缺省=定义名+创建人)", docA.body?.code === 0 && docA.body?.data?.status === "DRAFT" && (docA.body?.data?.title ?? "").includes("冒烟登记单"), JSON.stringify(docA.body?.data?.title))
  const subA = await call(admin.token, "POST", `/api/bizdoc/docs/${docA.body?.data?.id}/submit`)
  check("bizdoc 无流程提交即生效+占号〔〕格式", subA.body?.data?.status === "EFFECTIVE" && /〔\d{4}〕\d+号$/.test(subA.body?.data?.docNo ?? ""), JSON.stringify({ s: subA.body?.data?.status, n: subA.body?.data?.docNo }))
  const subA2 = await call(admin.token, "POST", `/api/bizdoc/docs/${docA.body?.data?.id}/submit`)
  check("bizdoc 生效单据重复提交被拒", subA2.body?.code === 400)

  // 台账 filters（form_data 字段过滤）
  const ledgerHit = await call(admin.token, "GET", `/api/bizdoc/docs?defCode=smoke_bd_plain_${TS}&filters=${encodeURIComponent('{"leaveType":"ANNUAL"}')}`)
  check("bizdoc 台账 filters 命中(fields 平铺)", (ledgerHit.body?.data?.list ?? []).length === 1 && ledgerHit.body?.data?.list?.[0]?.fields?.leaveType === "ANNUAL", JSON.stringify(ledgerHit.body?.data?.total))
  const ledgerMiss = await call(admin.token, "GET", `/api/bizdoc/docs?defCode=smoke_bd_plain_${TS}&filters=${encodeURIComponent('{"leaveType":"SICK"}')}`)
  check("bizdoc 台账 filters 无命中", ledgerMiss.body?.data?.total === 0)

  // 作废：EFFECTIVE→VOID + 单号台账 VOID 不回收
  const voidA = await call(admin.token, "POST", `/api/bizdoc/docs/${docA.body?.data?.id}/void`)
  check("bizdoc 作废(VOID)", voidA.body?.data?.status === "VOID")
  const ledgerVoid = await call(admin.token, "GET", `/api/office/doc/ledger?keyword=${encodeURIComponent("BIZDOC:")}&pageNum=1&pageSize=10`)
  check("bizdoc 单号台账置 VOID 不回收", (ledgerVoid.body?.data?.list ?? []).some((l) => l.status === "VOID"), JSON.stringify(ledgerVoid.body?.data?.total))

  // 2. 绑流程定义：提交→APPROVING→审批通过→EFFECTIVE(事件回写)
  const defB = await call(admin.token, "POST", "/api/bizdoc/defs", {
    code: `smoke_bd_flow_${TS}`, name: "冒烟审批单", formType: "ONLINE", formCode: "leave", wfDefCode: "leave_approval",
    listConfig: { columns: [{ field: "days", label: "天数" }] },
  })
  await call(admin.token, "POST", `/api/bizdoc/defs/${defB.body?.data?.id}/publish`)
  const docB = await call(zhangsan.token, "POST", "/api/bizdoc/docs", {
    defCode: `smoke_bd_flow_${TS}`, title: `冒烟审批单B-${TS}`, formData: { leaveType: "ANNUAL", days: 2, reason: "走流程" },
  })
  const subB = await call(zhangsan.token, "POST", `/api/bizdoc/docs/${docB.body?.data?.id}/submit`)
  check("bizdoc 绑流程提交→APPROVING(一等实例)", subB.body?.data?.status === "APPROVING" && !!subB.body?.data?.processInstanceId, JSON.stringify(subB.body?.data?.status))
  const bdTaskB = await findTodo(manager.token, `冒烟审批单B-${TS}`)
  check("bizdoc 审批任务落经理待办", !!bdTaskB)
  if (bdTaskB) await call(manager.token, "POST", `/api/wf/tasks/${bdTaskB.taskId}/approve`, { comment: "过" })
  const docBDone = await bdWait(docB.body?.data?.id, "EFFECTIVE")
  check("bizdoc 审批通过→EFFECTIVE(事件回写)", docBDone?.status === "EFFECTIVE", JSON.stringify(docBDone?.status))
  // §9.3 打印数据审批记录区：绑流程单据 print data 含 _approvals（办理记录，与时间线同源）
  await call(admin.token, "POST", `/api/bizdoc/defs/${defB.body?.data?.id}/print-tpls`, {
    name: "审批单模板", paper: "A4", content: { schemaVersion: 2, paper: "A4", elements: [] },
  })
  const printB = await call(admin.token, "GET", `/api/bizdoc/docs/${docB.body?.data?.id}/print`)
  const approvalsB = printB.body?.data?.data?._approvals ?? []
  check("bizdoc print data 含 _approvals(办理记录,assigneeName 非空)",
    approvalsB.length >= 1 && !!approvalsB[0].assigneeName && !!approvalsB[0].nodeName && !!approvalsB[0].time,
    JSON.stringify(approvalsB))

  // 3. 驳回→REJECTED 可改再提
  const docC = await call(zhangsan.token, "POST", "/api/bizdoc/docs", {
    defCode: `smoke_bd_flow_${TS}`, title: `冒烟审批单C-${TS}`, formData: { leaveType: "ANNUAL", days: 2, reason: "待驳回" },
  })
  await call(zhangsan.token, "POST", `/api/bizdoc/docs/${docC.body?.data?.id}/submit`)
  const bdTaskC = await findTodo(manager.token, `冒烟审批单C-${TS}`)
  if (bdTaskC) await call(manager.token, "POST", `/api/wf/tasks/${bdTaskC.taskId}/reject`, { comment: "资料不足", target: "START" })
  const docCRej = await bdWait(docC.body?.data?.id, "REJECTED")
  check("bizdoc 驳回→REJECTED(事件回写)", docCRej?.status === "REJECTED", JSON.stringify(docCRej?.status))
  const updC = await call(zhangsan.token, "PUT", `/api/bizdoc/docs/${docC.body?.data?.id}`, { formData: { leaveType: "ANNUAL", days: 1, reason: "已补充" } })
  check("bizdoc REJECTED 可改", updC.body?.code === 0)
  const resubC = await call(zhangsan.token, "POST", `/api/bizdoc/docs/${docC.body?.data?.id}/submit`)
  check("bizdoc 改后重提→APPROVING(新实例)", resubC.body?.data?.status === "APPROVING" && resubC.body?.data?.processInstanceId !== docCRej?.processInstanceId)

  // 4. 打印模板 + 打印数据
  const tpl = await call(admin.token, "POST", `/api/bizdoc/defs/${defA.body?.data?.id}/print-tpls`, {
    name: "默认模板", paper: "A4", landscape: false,
    content: { schemaVersion: 1, paper: "A4", landscape: false, margin: [10, 10, 10, 10], elements: [
      { id: "e1", type: "label", x: 80, y: 12, w: 50, h: 8, text: "冒烟登记单", style: { fontSize: 16, bold: true, align: "center" } },
      { id: "e2", type: "field", x: 25, y: 30, w: 60, h: 7, field: "leaveType", label: "类型:" },
      { id: "e3", type: "sysfield", x: 150, y: 30, w: 50, h: 7, field: "docNo", label: "单号:" },
      { id: "e4", type: "qrcode", x: 180, y: 8, w: 20, h: 20, value: "{{docNo}}" },
    ] },
  })
  check("bizdoc 打印模板创建(首个自动默认)", tpl.body?.code === 0 && tpl.body?.data?.isDefault === true)
  const printData = await call(admin.token, "GET", `/api/bizdoc/docs/${docA.body?.data?.id}/print`)
  check("bizdoc 打印数据(tpl+data 系统字段+fields label 映射)",
    printData.body?.code === 0 && printData.body?.data?.tpl?.content?.elements?.length === 4 &&
      !!printData.body?.data?.data?.docNo && printData.body?.data?.data?.status === "VOID" &&
      (printData.body?.data?.fields ?? []).some((f) => f.key === "leaveType"),
    JSON.stringify({ n: printData.body?.data?.data?.docNo, st: printData.body?.data?.data?.status }))

  // 5. 权限 + submitPath 契约（CODE 定义带发起路径）
  const zsDef = await call(zhangsan.token, "POST", "/api/bizdoc/defs", { code: `smoke_bd_deny_${TS}`, name: "越权" })
  check("bizdoc zhangsan 建定义 → 403(bizdoc:def:write)", zsDef.status === 403, `status=${zsDef.status}`)
  const codeDef = await call(admin.token, "POST", "/api/bizdoc/defs", {
    code: `smoke_bd_code_${TS}`, name: "冒烟CODE单", formType: "CODE", formCode: "gw_send", submitPath: "/document/send?new=1",
  })
  check("bizdoc CODE 定义回传 submitPath(疾风批A契约)", codeDef.body?.code === 0 && codeDef.body?.data?.submitPath === "/document/send?new=1", JSON.stringify(codeDef.body?.data?.submitPath))

  // 6. 数据权限：zhangsan(SELF) 看不到 admin 的单据
  const zsLedger = await call(zhangsan.token, "GET", `/api/bizdoc/docs?defCode=smoke_bd_plain_${TS}`)
  check("bizdoc 数据权限(zhangsan 看不到 admin 单据)", zsLedger.body?.code === 0 && zsLedger.body?.data?.total === 0, JSON.stringify(zsLedger.body?.data?.total))

  // 7. §10 范式修正二：INLINE 单据自带表单设计
  const inlineDef = await call(admin.token, "POST", "/api/bizdoc/defs", {
    code: `smoke_bd_inline_${TS}`, name: "冒烟内置表单单", formType: "INLINE",
    formSchema: { widgets: [
      { key: "amount", label: "金额", type: "number", required: true },
      { key: "memo", label: "备注", type: "textarea" },
    ] },
    listConfig: { columns: [{ field: "amount", label: "金额" }] },
  })
  check("bizdoc INLINE 定义创建(回传 formSchema)", inlineDef.body?.code === 0 && (inlineDef.body?.data?.formSchema?.widgets ?? []).length === 2, JSON.stringify(inlineDef.body?.data?.formType))
  const inlinePub = await call(admin.token, "POST", `/api/bizdoc/defs/${inlineDef.body?.data?.id}/publish`)
  check("bizdoc INLINE 发布(私有 schema 校验通过)", inlinePub.body?.code === 0, JSON.stringify(inlinePub.body?.message))
  const inlineDoc = await call(admin.token, "POST", "/api/bizdoc/docs", {
    defCode: `smoke_bd_inline_${TS}`, formData: { amount: 5, memo: "内置表单" },
  })
  const inlineSub = await call(admin.token, "POST", `/api/bizdoc/docs/${inlineDoc.body?.data?.id}/submit`)
  check("bizdoc INLINE 单据提交生效", inlineSub.body?.data?.status === "EFFECTIVE", JSON.stringify(inlineSub.body?.data?.status))
  // bizdoc:{code} 统一字段清单（流程设计器条件/取人识别单据字段）
  const bdManifest = await call(admin.token, "GET", `/api/wf/forms/bizdoc:smoke_bd_inline_${TS}/fields`)
  check("bizdoc:{code} manifest 返回字段(formType=BIZDOC,含 amount)",
    bdManifest.body?.code === 0 && bdManifest.body?.data?.formType === "BIZDOC" &&
      (bdManifest.body?.data?.fields ?? []).some((f) => f.key === "amount"),
    JSON.stringify({ t: bdManifest.body?.data?.formType, keys: (bdManifest.body?.data?.fields ?? []).map((f) => f.key) }))
  // INLINE 无 schema 发布 400；字段 key 重复发布 400
  const inlineBad = await call(admin.token, "POST", "/api/bizdoc/defs", { code: `smoke_bd_noschema_${TS}`, name: "无schema", formType: "INLINE" })
  const inlineBadPub = await call(admin.token, "POST", `/api/bizdoc/defs/${inlineBad.body?.data?.id}/publish`)
  check("bizdoc INLINE 无 schema 发布 400", inlineBadPub.body?.code === 400 && (inlineBadPub.body?.message ?? "").includes("form_schema"), JSON.stringify(inlineBadPub.body?.message))
  const inlineDup = await call(admin.token, "POST", "/api/bizdoc/defs", {
    code: `smoke_bd_dup_${TS}`, name: "重复key", formType: "INLINE",
    formSchema: { widgets: [{ key: "a", label: "A", type: "input" }, { key: "a", label: "A2", type: "input" }] },
  })
  const inlineDupPub = await call(admin.token, "POST", `/api/bizdoc/defs/${inlineDup.body?.data?.id}/publish`)
  check("bizdoc INLINE 字段 key 重复发布 400", inlineDupPub.body?.code === 400 && (inlineDupPub.body?.message ?? "").includes("重复"), JSON.stringify(inlineDupPub.body?.message))
  // 存量 CODE 定义不回归：CODE 定义可发布（gw_send 为已登记 CODE 表单）
  const codePub = await call(admin.token, "POST", `/api/bizdoc/defs/${codeDef.body?.data?.id}/publish`)
  check("bizdoc CODE 定义发布不回归", codePub.body?.code === 0, JSON.stringify(codePub.body?.message))
}

/* ---------- 汇总 ---------- */
cleanupTestData() // 跑完自动清理测试数据，避免污染流程定义/待办列表
console.log(`\n==> 通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) {
  console.log("失败项：\n - " + failures.join("\n - "))
  process.exit(1)
}
console.log("全部通过 ✅")

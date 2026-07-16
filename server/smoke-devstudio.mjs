#!/usr/bin/env node
/**
 * Dev Studio 统一资产门面专项冒烟（node >= 18，`node smoke-devstudio.mjs`，需应用跑在 :8081）。
 *
 * 覆盖（批W1 验收单）：四类 GET 树含各资产 / GET 内容 / PUT 存草稿（乐观锁冲突 409）/
 * publish 生效（ORCH 编译、PROCESS 干跑+部署、FORM 新版、TPL version+1）/ versions 落快照（actor=USER）/
 * rollback（ORCH+FORM+PROCESS+BIZDOC_TPL 全部经快照覆盖+重走发布链）/ 无权 403 /
 * PROCESS 写坏 JSON publish → 400 拒且不落坏定义（防坏 designerJson 阻塞启动的硬线）。
 *
 * 自清：只创建/删除 devsmoke_* 前缀资产（含 Flowable 部署残留），不碰共享表——
 * 与 OA_SMOKE_KEEP=1 的保数据口径兼容，可随时对在用环境跑。
 */
import { execFileSync } from "node:child_process"

const BASE = process.env.OA_BASE ?? "http://localhost:8081"
const PG = process.env.OA_PG_CONTAINER ?? "oa-postgres"

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
    /* 非 JSON */
  }
  return { status: res.status, body: json }
}

async function login(username, password = "admin123") {
  const { body } = await call(null, "POST", "/api/auth/login", { username, password })
  check(`login ${username}`, body?.code === 0 && body.data?.token, JSON.stringify(body))
  return body.data
}

/** devsmoke_* 自清（前置防残留 + 收尾）：只删本脚本自己的资产行 + 对应 Flowable 部署。 */
function cleanup(tag) {
  const sql = [
    "DELETE FROM dev_asset_version WHERE code LIKE 'devsmoke%';",
    "DELETE FROM orch_flow_version WHERE flow_id IN (SELECT id FROM orch_flow WHERE code LIKE 'devsmoke%');",
    "DELETE FROM orch_flow WHERE code LIKE 'devsmoke%';",
    "DELETE FROM wf_process_ext WHERE def_code LIKE 'devsmoke%';",
    "DELETE FROM wf_form_def WHERE code LIKE 'devsmoke%';",
    "DELETE FROM oa_bizdoc_print_tpl WHERE code LIKE 'devsmoke%';",
    // Flowable 部署残留（publish 产生）：procdef → bytearray → deployment
    "DELETE FROM act_re_procdef WHERE key_ LIKE 'devsmoke%';",
    "DELETE FROM act_ge_bytearray WHERE deployment_id_ IN (SELECT id_ FROM act_re_deployment WHERE key_ LIKE 'devsmoke%');",
    "DELETE FROM act_re_deployment WHERE key_ LIKE 'devsmoke%';",
  ].join(" ")
  try {
    execFileSync("docker", ["exec", PG, "psql", "-U", "oa", "-d", "oa_platform", "-c", sql], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    console.log(`🧹 devsmoke_* 已清理（${tag}）`)
  } catch (e) {
    const detail = (e?.stderr?.toString().trim() || e?.message || "docker/psql 不可用").split("\n").slice(-2).join(" ")
    console.warn(`⚠️  devsmoke_* 清理失败（${tag}）：${detail}`)
  }
}

const orchModel = (title) =>
  JSON.stringify({
    schemaVersion: 1,
    name: "Dev冒烟编排",
    nodes: [
      { id: "trigger", type: "trigger", name: "触发", config: { triggerType: "MANUAL" } },
      { id: "n1", type: "notify", name: "通知", config: { recipients: [], title, content: title } },
      { id: "end", type: "end", name: "结束", config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "n1" },
      { id: "e2", source: "n1", target: "end" },
    ],
  })

const ORCH_A = orchModel("A")
const ORCH_B = orchModel("B")
const PROC_V1 = '{"nodes":[]}'
const PROC_V2 = '{"nodes":[],"remark":"devsmoke v2"}'
const PROC_BAD = '{"nodes":['
const FORM_S2 = '{"widgets":[{"key":"a","label":"A","type":"input"},{"key":"b","label":"B","type":"number"}]}'
const FORM_S3 = '{"widgets":[{"key":"a","label":"A2","type":"input"}]}'
const TPL_V1 = { schemaVersion: 2, page: { size: "A4", landscape: false }, blocks: [{ id: "b1", type: "title", text: "T1" }] }
const TPL_V2 = { schemaVersion: 2, page: { size: "A4", landscape: false }, blocks: [{ id: "b1", type: "title", text: "T2" }] }

console.log(`==> Dev Studio 冒烟 ${BASE}`)
cleanup("前置")

const admin = await login("admin")
const zhangsan = await login("zhangsan")
const A = admin.token

/* ---------- 1. 建四类原生测试资产 ---------- */
let orchFlowId = null
{
  const r1 = await call(A, "POST", "/api/orch/flows", { code: "devsmoke_orch", name: "Dev冒烟编排", designerJson: ORCH_A })
  check("建 ORCH devsmoke_orch", r1.body?.code === 0, JSON.stringify(r1.body))
  orchFlowId = r1.body?.data?.id
  const r2 = await call(A, "POST", "/api/wf/process-defs", {
    defCode: "devsmoke_proc", name: "Dev冒烟流程", designerType: "DINGTALK", designerJson: PROC_V1,
  })
  check("建 PROCESS devsmoke_proc", r2.body?.code === 0, JSON.stringify(r2.body))
  const r3 = await call(A, "POST", "/api/wf/form-defs", {
    code: "devsmoke_form", name: "Dev冒烟表单", schemaJson: '{"widgets":[{"key":"a","label":"A","type":"input"}]}',
  })
  check("建 FORM devsmoke_form", r3.body?.code === 0, JSON.stringify(r3.body))
  const r4 = await call(A, "POST", "/api/bizdoc/tpls", {
    code: "devsmoke_tpl", name: "Dev冒烟模板", bindType: "FORM", bindCode: "devsmoke_form", content: TPL_V1,
  })
  check("建 BIZDOC_TPL devsmoke_tpl", r4.body?.code === 0, JSON.stringify(r4.body))
}

/* ---------- 2. GET 树：四类各含测试资产 ---------- */
{
  const r = await call(A, "GET", "/api/dev-studio/assets")
  const list = Array.isArray(r.body?.data) ? r.body.data : []
  check("GET 树返回数组", r.body?.code === 0 && list.length >= 4, `len=${list.length}`)
  for (const [type, code] of [["ORCH", "devsmoke_orch"], ["PROCESS", "devsmoke_proc"], ["FORM", "devsmoke_form"], ["BIZDOC_TPL", "devsmoke_tpl"]]) {
    const hit = list.find((n) => n.type === type && n.code === code)
    check(`树含 ${type}/${code}`, !!hit && typeof hit.name === "string" && typeof hit.status === "string", JSON.stringify(hit))
  }
}

/* ---------- 3. GET 内容：content/version(快照=0)/meta ---------- */
{
  const o = await call(A, "GET", "/api/dev-studio/assets/ORCH/devsmoke_orch")
  check("ORCH 内容+快照 v0", o.body?.code === 0 && o.body.data?.content === ORCH_A && o.body.data?.version === 0, JSON.stringify(o.body?.data?.version))
  check("ORCH meta.nativeVersion=0", o.body?.data?.meta?.nativeVersion === 0)
  const p = await call(A, "GET", "/api/dev-studio/assets/PROCESS/devsmoke_proc")
  check("PROCESS 内容(designerJson)", p.body?.code === 0 && p.body.data?.content === PROC_V1 && p.body.data?.meta?.designerType === "DINGTALK")
  const f = await call(A, "GET", "/api/dev-studio/assets/FORM/devsmoke_form")
  check("FORM 内容+native v1 DRAFT", f.body?.code === 0 && f.body.data?.meta?.nativeVersion === 1 && f.body.data?.meta?.status === "DRAFT")
  const t = await call(A, "GET", "/api/dev-studio/assets/BIZDOC_TPL/devsmoke_tpl")
  check("TPL 内容+bindType", t.body?.code === 0 && t.body.data?.meta?.bindType === "FORM" && JSON.parse(t.body.data?.content ?? "{}").blocks?.length === 1)
  const bad = await call(A, "GET", "/api/dev-studio/assets/FOO/x")
  check("未知类型 400", bad.body?.code === 400, JSON.stringify(bad.body))
}

/* ---------- 4. ORCH：存草稿 → 乐观锁 409 → 发布(编译) ---------- */
{
  const s1 = await call(A, "PUT", "/api/dev-studio/assets/ORCH/devsmoke_orch", { content: ORCH_A, baseVersion: 0 })
  check("ORCH 存草稿 → 快照 v1", s1.body?.code === 0 && s1.body.data?.version === 1, JSON.stringify(s1.body))
  check("ORCH 草稿不生效(native v0)", s1.body?.data?.meta?.nativeVersion === 0 && s1.body.data.meta.status === "DRAFT")
  const conflict = await call(A, "PUT", "/api/dev-studio/assets/ORCH/devsmoke_orch", { content: ORCH_B, baseVersion: 0 })
  check("ORCH baseVersion 冲突 409", conflict.body?.code === 409, JSON.stringify(conflict.body))
  const s2 = await call(A, "PUT", "/api/dev-studio/assets/ORCH/devsmoke_orch", { content: ORCH_B, baseVersion: 1, publish: true })
  check("ORCH 发布 → 快照 v2 + EL 编译 + native v1", s2.body?.code === 0 && s2.body.data?.version === 2 && s2.body.data?.meta?.nativeVersion === 1 && s2.body.data?.meta?.status === "PUBLISHED", JSON.stringify(s2.body))
  const native = await call(A, "GET", "/api/orch/flows/devsmoke_orch")
  check("ORCH 原生端点确认 version=1", native.body?.code === 0 && native.body.data?.version === 1)
  // 启用 → 树状态 ENABLED（前端渲「已启用」）
  const en = await call(A, "POST", `/api/orch/flows/${orchFlowId}/enable`, { enabled: true })
  check("ORCH 启用", en.body?.code === 0, JSON.stringify(en.body))
  const tree = await call(A, "GET", "/api/dev-studio/assets")
  const node = (tree.body?.data ?? []).find((n) => n.type === "ORCH" && n.code === "devsmoke_orch")
  check("ORCH 树状态=ENABLED", node?.status === "ENABLED", JSON.stringify(node))
}

/* ---------- 5. PROCESS：存草稿 → 坏 JSON 干跑 400 拒 → 发布(部署) ---------- */
{
  const s1 = await call(A, "PUT", "/api/dev-studio/assets/PROCESS/devsmoke_proc", { content: PROC_V2, baseVersion: 0 })
  check("PROCESS 存草稿 → 快照 v1", s1.body?.code === 0 && s1.body.data?.version === 1, JSON.stringify(s1.body))
  const bad = await call(A, "PUT", "/api/dev-studio/assets/PROCESS/devsmoke_proc", { content: PROC_BAD, baseVersion: 1, publish: true })
  check("PROCESS 坏 JSON publish → 400(干跑拒)", bad.body?.code === 400 && String(bad.body?.message ?? "").includes("干跑"), JSON.stringify(bad.body))
  const after = await call(A, "GET", "/api/dev-studio/assets/PROCESS/devsmoke_proc")
  check("PROCESS 坏内容未落库(仍为上个好草稿)", after.body?.data?.content === PROC_V2)
  const vAfterBad = await call(A, "GET", "/api/dev-studio/assets/PROCESS/devsmoke_proc/versions")
  check("PROCESS 拒绝写不落快照", (vAfterBad.body?.data ?? []).length === 1, `len=${(vAfterBad.body?.data ?? []).length}`)
  const nativeStill = await call(A, "GET", "/api/wf/process-defs/devsmoke_proc/latest")
  check("PROCESS 原生仍 DRAFT 未误部署", nativeStill.body?.code === 0 && nativeStill.body.data?.status === "DRAFT")
  const s2 = await call(A, "PUT", "/api/dev-studio/assets/PROCESS/devsmoke_proc", { content: PROC_V2, baseVersion: 1, publish: true })
  check("PROCESS 发布 → 部署成功", s2.body?.code === 0 && s2.body.data?.version === 2 && s2.body.data?.meta?.status === "PUBLISHED" && !!s2.body.data?.meta?.processDefinitionId, JSON.stringify(s2.body))
  const nativePub = await call(A, "GET", "/api/wf/process-defs/devsmoke_proc/latest")
  check("PROCESS 原生确认 PUBLISHED", nativePub.body?.data?.status === "PUBLISHED")
}

/* ---------- 6. FORM：DRAFT 就地存 → 发布冻结 → 再存=新版本(latest 指针位移提示) ---------- */
{
  const s1 = await call(A, "PUT", "/api/dev-studio/assets/FORM/devsmoke_form", { content: FORM_S2, baseVersion: 0 })
  check("FORM 存草稿(latest DRAFT 就地改)", s1.body?.code === 0 && s1.body.data?.version === 1 && s1.body.data?.meta?.latestPointerChanged === false && s1.body.data?.meta?.nativeVersion === 1, JSON.stringify(s1.body))
  const s2 = await call(A, "PUT", "/api/dev-studio/assets/FORM/devsmoke_form", { content: FORM_S2, baseVersion: 1, publish: true })
  check("FORM 发布 → v1 PUBLISHED", s2.body?.code === 0 && s2.body.data?.meta?.status === "PUBLISHED")
  const s3 = await call(A, "PUT", "/api/dev-studio/assets/FORM/devsmoke_form", { content: FORM_S3, baseVersion: 2 })
  check("FORM 已发布再存 → 新版本 DRAFT + latestPointerChanged", s3.body?.code === 0 && s3.body.data?.meta?.nativeVersion === 2 && s3.body.data?.meta?.status === "DRAFT" && s3.body.data?.meta?.latestPointerChanged === true, JSON.stringify(s3.body))
}

/* ---------- 7. BIZDOC_TPL：发布 = PUBLISHED + version+1 ---------- */
{
  const s1 = await call(A, "PUT", "/api/dev-studio/assets/BIZDOC_TPL/devsmoke_tpl", { content: JSON.stringify(TPL_V2), baseVersion: 0, publish: true })
  check("TPL 发布 → native version+1=1 PUBLISHED", s1.body?.code === 0 && s1.body.data?.version === 1 && s1.body.data?.meta?.nativeVersion === 1 && s1.body.data?.meta?.status === "PUBLISHED", JSON.stringify(s1.body))
  const t = await call(A, "GET", "/api/dev-studio/assets/BIZDOC_TPL/devsmoke_tpl")
  check("TPL 内容已更新", JSON.parse(t.body?.data?.content ?? "{}").blocks?.[0]?.text === "T2")
}

/* ---------- 8. versions：统一快照表 + actor=USER ---------- */
{
  const v = await call(A, "GET", "/api/dev-studio/assets/ORCH/devsmoke_orch/versions")
  const list = v.body?.data ?? []
  check("ORCH versions=2 条快照", v.body?.code === 0 && list.length === 2, `len=${list.length}`)
  check("快照字段 versionNo/actor=USER/actorName/summary",
    list.every((x) => typeof x.versionNo === "number" && x.actor === "USER" && typeof x.actorName === "string")
      && list[0]?.summary === "发布" && list[1]?.summary === "保存草稿", JSON.stringify(list))
  const d = await call(A, "GET", "/api/dev-studio/assets/ORCH/devsmoke_orch/versions/1")
  check("快照详情含 versionNo+content(=v1 原文)", d.body?.code === 0 && d.body.data?.versionNo === 1 && d.body.data?.content === ORCH_A)
}

/* ---------- 9. rollback：四类全走 快照覆盖 + 重走发布链 ---------- */
{
  const ro = await call(A, "POST", "/api/dev-studio/assets/ORCH/devsmoke_orch/rollback", { versionNo: 1 })
  check("ORCH 回滚 v1 → 新快照 v3 + native v2", ro.body?.code === 0 && ro.body.data?.version === 3 && ro.body.data?.meta?.nativeVersion === 2, JSON.stringify(ro.body))
  const oc = await call(A, "GET", "/api/dev-studio/assets/ORCH/devsmoke_orch")
  check("ORCH 回滚后内容=v1 原文", oc.body?.data?.content === ORCH_A)
  const ov = await call(A, "GET", "/api/dev-studio/assets/ORCH/devsmoke_orch/versions")
  check("ORCH 回滚落快照(summary=回滚自 v1)", (ov.body?.data ?? [])[0]?.summary === "回滚自 v1")

  const rp = await call(A, "POST", "/api/dev-studio/assets/PROCESS/devsmoke_proc/rollback", { versionNo: 1 })
  check("PROCESS 回滚 → 重部署 native v2", rp.body?.code === 0 && rp.body.data?.version === 3 && rp.body.data?.meta?.status === "PUBLISHED" && rp.body.data?.meta?.nativeVersion === 2, JSON.stringify(rp.body))

  const rf = await call(A, "POST", "/api/dev-studio/assets/FORM/devsmoke_form/rollback", { versionNo: 1 })
  check("FORM 回滚 → 旧 schema 落 latest 并发布", rf.body?.code === 0 && rf.body.data?.version === 4 && rf.body.data?.meta?.status === "PUBLISHED", JSON.stringify(rf.body))
  const fc = await call(A, "GET", "/api/dev-studio/assets/FORM/devsmoke_form")
  check("FORM 回滚后内容=v1 快照", fc.body?.data?.content === FORM_S2)

  // TPL 用旧字段 {version} 走一次（RollbackRequest 兼容位）
  const rt = await call(A, "POST", "/api/dev-studio/assets/BIZDOC_TPL/devsmoke_tpl/rollback", { version: 1 })
  check("TPL 回滚(兼容 version 字段) → native version+1=2", rt.body?.code === 0 && rt.body.data?.version === 2 && rt.body.data?.meta?.nativeVersion === 2 && rt.body.data?.meta?.tplId, JSON.stringify(rt.body))
}

/* ---------- 10. 权限门：无 dev:studio:* → 403 ---------- */
{
  const g = await call(zhangsan.token, "GET", "/api/dev-studio/assets")
  check("zhangsan GET 树 403", g.status === 403 || g.body?.code === 403, `status=${g.status}`)
  const p = await call(zhangsan.token, "PUT", "/api/dev-studio/assets/FORM/devsmoke_form", { content: FORM_S2 })
  check("zhangsan PUT 403", p.status === 403 || p.body?.code === 403, `status=${p.status}`)
  const r = await call(zhangsan.token, "POST", "/api/dev-studio/assets/FORM/devsmoke_form/rollback", { version: 1 })
  check("zhangsan rollback 403", r.status === 403 || r.body?.code === 403, `status=${r.status}`)
}

cleanup("收尾")

console.log(`\n==> Dev Studio 冒烟完成：通过 ${passed}，失败 ${failed}`)
if (failed > 0) {
  console.error("失败用例：\n" + failures.map((f) => `  - ${f}`).join("\n"))
  process.exit(1)
}

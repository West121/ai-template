// DP1b 数据权限性能压测 harness（独立于 smoke）。
// 用法：node server/perf-dp1b.mjs   （可选 env：PERF_DEPTS=2000 PERF_ROWS=1000000 PERF_ITERS=30 OA_BASE=...）
// 流程：seed 大规模部门树 + 目标表 → 以 DEPT_AND_CHILD 用户按权限过滤查询计时(P50/P95/max) → EXPLAIN → 自清。
// 数据尾部务必删除（try/finally），别把百万行留库。
import { execFileSync } from "node:child_process"

const BASE = process.env.OA_BASE ?? "http://localhost:8081"
const N = Number(process.env.PERF_DEPTS ?? 2000) // 子部门数（子树 = N+1，>1000 触发 = ANY(array) 路径）
const M = Number(process.env.PERF_ROWS ?? 1000000) // 目标表行数
const ITERS = Number(process.env.PERF_ITERS ?? 30)
const PG = process.env.OA_PG_CONTAINER ?? "oa-postgres"

const psql = (q) => execFileSync("docker", ["exec", PG, "psql", "-U", "oa", "-d", "oa_platform", "-t", "-A", "-c", q],
  { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).toString().trim()
const call = async (token, method, path, body) => {
  const res = await fetch(BASE + path, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))]

console.log(`==> DP1b 压测 ${BASE}  depts=${N} rows=${M} iters=${ITERS}`)
const admin = (await call(null, "POST", "/api/auth/login", { username: "admin", password: "admin123" })).body?.data
if (!admin?.token) { console.error("admin 登录失败，确保 :8081 已起"); process.exit(1) }
const T = admin.token

const baseDeptId = Number(psql("SELECT COALESCE(max(id),0) FROM sys_dept"))
let rootId, perfUserId, perfRoleId
try {
  // 1) 造根部门 R（API 维护 path），N 个子部门（psql 批量 + 回填 path），M 行审批（dept 均匀分布于子部门）
  rootId = (await call(T, "POST", "/api/system/depts", { name: "PERF_ROOT", parentId: 1 })).body?.data?.id
  const rootPath = `/1/${rootId}/`
  console.log(`seed: root dept ${rootId} path=${rootPath} ...`)
  psql(`INSERT INTO sys_dept (name, parent_id, ancestors, path, enabled) SELECT 'PERF_'||g, ${rootId}, '0,1,${rootId}', '/', true FROM generate_series(1, ${N}) g`)
  psql(`UPDATE sys_dept SET path = '${rootPath}'||id||'/' WHERE parent_id=${rootId} AND path='/'`)
  const firstChild = Number(psql(`SELECT min(id) FROM sys_dept WHERE parent_id=${rootId}`))
  console.log(`seed: ${N} child depts [${firstChild}..${firstChild + N - 1}], inserting ${M} rows ...`)
  const t0 = performance.now()
  psql(`INSERT INTO oa_approval (title, type, applicant, status, dept_id, applicant_id, version) SELECT 'PERF', 'OTHER', 'perf', 'PENDING', ${firstChild} + (g % ${N}), 1, 0 FROM generate_series(1, ${M}) g`)
  psql(`ANALYZE oa_approval; ANALYZE sys_dept;`)
  console.log(`seed: 完成，用时 ${((performance.now() - t0) / 1000).toFixed(1)}s`)

  // 2) 造 DEPT_AND_CHILD 用户（在 R 下），登录 → 其数据范围 = R 子树（N+1 部门，走物化路径索引 + = ANY(array)）
  const r = await call(T, "POST", "/api/system/roles", { code: `PERF_R_${Date.now()}`, name: "PERF角色", dataScope: "DEPT_AND_CHILD" })
  perfRoleId = r.body?.data?.id
  await call(T, "PUT", `/api/system/roles/${perfRoleId}/permissions`, { permissionIds: [1, 2, 3] })
  const postId = (await call(T, "GET", "/api/system/posts?pageNum=1&pageSize=1")).body?.data?.list?.[0]?.id
  perfUserId = (await call(T, "POST", "/api/system/users", { username: `perfu_${Date.now()}`, name: "perfu", password: "admin123", deptId: rootId, postId, roleIds: [perfRoleId] })).body?.data?.id
  const perfTok = (await call(null, "POST", "/api/auth/login", { username: (await call(T, "GET", `/api/system/users/${perfUserId}`)).body?.data?.username, password: "admin123" })).body?.data?.token

  // 3) 计时：按权限过滤的分页查询（COUNT + 首页）；含权限装配(每请求 path 索引子树) + dept_id = ANY(array)
  const q = "/api/office/approvals?pageNum=1&pageSize=10"
  for (let i = 0; i < 5; i++) await call(perfTok, "GET", q) // warmup
  const first = await call(perfTok, "GET", q)
  const total = first.body?.data?.total
  const samples = []
  for (let i = 0; i < ITERS; i++) {
    const s = performance.now()
    await call(perfTok, "GET", q)
    samples.push(performance.now() - s)
  }
  const subtreeSize = N + 1
  console.log("\n==== 结果 ====")
  console.log(`子树部门数=${subtreeSize}（${subtreeSize > 1000 ? "> 阈值 1000 → 走 = ANY(array)" : "≤ 阈值 → IN"}）`)
  console.log(`正确性：过滤后 total=${total}（期望=${M}，${total === M ? "✓ 一致" : "✗ 不一致！"}）`)
  console.log(`端点 P50=${pct(samples, 50).toFixed(1)}ms  P95=${pct(samples, 95).toFixed(1)}ms  max=${Math.max(...samples).toFixed(1)}ms（n=${ITERS}）`)
  // 4) EXPLAIN：证明 dept_id 索引 + 无递归
  const explain = psql(`EXPLAIN (ANALYZE, TIMING ON, BUFFERS OFF) SELECT count(*) FROM oa_approval WHERE dept_id = ANY(ARRAY(SELECT id FROM sys_dept WHERE path LIKE '${rootPath}%'))`)
  console.log("\n---- EXPLAIN ANALYZE (count by dept_id = ANY(subtree)) ----")
  console.log(explain.split("\n").slice(0, 12).join("\n"))
} finally {
  // 5) 自清（务必删百万行）
  console.log("\n清理 seed 数据 ...")
  if (perfUserId) await call(T, "POST", "/api/system/users/batch-delete", { ids: [perfUserId] })
  const delA = psql(`DELETE FROM oa_approval WHERE dept_id > ${baseDeptId}`)
  psql(`DELETE FROM sys_dept WHERE id > ${baseDeptId}`)
  if (perfRoleId) await call(T, "DELETE", `/api/system/roles/${perfRoleId}`)
  psql(`ANALYZE oa_approval`)
  console.log(`清理完成（删审批 ${delA}，删部门 id>${baseDeptId}）`)
}

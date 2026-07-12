/**
 * 知识库批1 —— API 层（mock-first；磐石批1真实端点已上 :8081，本层与其对齐）。
 *
 * 降级约定（同 gongwen/mock.ts）：offline 或 NetworkError → 内存 mock 顶住并回 `demo=true`；
 * 真实 ApiError（403 无权 / 400 业务）照常抛，页面友好提示。端点就绪后 demo 恒 false，自然切真实。
 *
 * ── 已对齐磐石批1后端契约（/api/kb，列表裸数组，{code,message,data}）─────────────
 *  空间   GET /spaces（仅可见）· GET /spaces/{id} · POST /spaces · PUT /spaces/{id} · DELETE /spaces/{id}（级联）
 *         SpaceResponse{ id,name,code,visibility,ownerId,ownerName,myRole(ADMIN|EDITOR|VIEWER|null),memberCount,docCount }
 *  成员   GET /spaces/{id}/members · POST /spaces/{id}/members（含 role，upsert）· DELETE /spaces/{id}/members/{memberId}
 *  文档树 GET /docs/tree?spaceId= → DocTreeNode{ id,parentId,type,title,sort,status,version,children[] }
 *  文档   GET /docs/{id} → DocDetail{ …,contentJson(JsonNode),contentText,tags[] }
 *         POST /docs（建 FOLDER/DOC）· PUT /docs/{id}（改标题/移动 parentId=0→根,null→不改/排序）· DELETE /docs/{id}（级联）
 *         PUT /docs/{id}/content{ contentJson,contentText }（版本自增）· POST /docs/{id}/publish|archive
 *  标签   GET /tags · POST /tags · DELETE /tags/{id}；文档标签 GET|POST /docs/{id}/tags · DELETE /docs/{id}/tags/{tagId}
 *  权限   myRole 驱动前端（VIEWER 只读 / EDITOR 可编 / ADMIN 可管）；非成员 PRIVATE 空间不返回 + 详情 403。
 *  content：content_json 后端只存不解析（TipTap JSON），content_text 由前端 editor 文本抽取附带（批2 检索用）。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { api, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import { stripHtml } from "@/components/rich-text"
import { htmlToJson } from "./content-codec"
import { buildDocTree } from "./tree"
import { roleOf, visibleSpaces } from "./permissions"
import { buildSnippet } from "./search-util"
import { buildAssistText, type AssistAction } from "./assist-util"
import type {
  KbComment,
  KbDoc,
  KbDocDetail,
  KbDocStatus,
  KbDocType,
  KbDocVersion,
  KbMatchedBy,
  KbMemberRole,
  KbPrincipalType,
  KbSpace,
  KbSpaceMember,
  KbTag,
  KbTreeNode,
  KbUserCtx,
  KbVersionContent,
  KbVisibility,
  RelatedDoc,
  SearchHit,
} from "./types"

const KB = "/api/kb"

/* --------------------------- 演示数据（会话内可变） --------------------------- */

let seq = 5000
const nid = () => ++seq
const nowIso = () => new Date().toISOString().slice(0, 19)

const SPACES: KbSpace[] = [
  { id: 101, name: "产品研发知识库", code: "PRD", description: "需求规范、技术方案、评审纪要与研发规约。", icon: "🚀", visibility: "PUBLIC", ownerId: 1, ownerName: "系统管理员", memberCount: 3, docCount: 5, sort: 1, createdAt: "2026-06-01T09:00:00" },
  { id: 102, name: "人力资源制度库", code: "HR", description: "员工手册、考勤制度、薪酬福利与入离职流程。", icon: "📗", visibility: "INTERNAL", ownerId: 2, ownerName: "李经理", memberCount: 2, docCount: 3, sort: 2, createdAt: "2026-06-03T10:30:00" },
  { id: 103, name: "董事会决策库", code: "BOARD", description: "董事会决议、战略规划（仅授权成员可见）。", icon: "🔒", visibility: "PRIVATE", ownerId: 2, ownerName: "李经理", memberCount: 2, docCount: 2, sort: 3, createdAt: "2026-06-10T14:00:00" },
]

const MEMBERS: KbSpaceMember[] = [
  { id: 201, spaceId: 101, principalType: "USER", principalId: 1, principalName: "系统管理员", role: "ADMIN" },
  { id: 202, spaceId: 101, principalType: "USER", principalId: 3, principalName: "张三", role: "EDITOR" },
  { id: 203, spaceId: 101, principalType: "DEPT", principalId: 10, principalName: "产品研发部", role: "VIEWER" },
  { id: 204, spaceId: 102, principalType: "USER", principalId: 2, principalName: "李经理", role: "ADMIN" },
  { id: 205, spaceId: 102, principalType: "ROLE", principalId: 5, principalName: "全体员工", role: "VIEWER" },
  { id: 206, spaceId: 103, principalType: "USER", principalId: 2, principalName: "李经理", role: "ADMIN" },
  { id: 207, spaceId: 103, principalType: "USER", principalId: 1, principalName: "系统管理员", role: "EDITOR" },
]

const DOCS: KbDoc[] = [
  d(301, 101, null, "FOLDER", "研发规范", 1),
  d(302, 101, 301, "DOC", "代码提交规约", 1, "PUBLISHED", "约定 commit message、分支模型与评审流程。"),
  d(303, 101, 301, "DOC", "接口设计规范", 2, "PUBLISHED"),
  d(304, 101, null, "FOLDER", "技术方案", 2),
  d(305, 101, 304, "DOC", "知识库架构方案", 1, "DRAFT", "分层：知识组织 / AI 能力 / 检索 / 协作。"),
  d(311, 102, null, "DOC", "员工手册", 1, "PUBLISHED"),
  d(312, 102, null, "FOLDER", "考勤制度", 2),
  d(313, 102, 312, "DOC", "请假与加班规定", 1, "PUBLISHED"),
  d(321, 103, null, "DOC", "2026 战略规划", 1, "DRAFT"),
  d(322, 103, null, "DOC", "董事会决议汇编", 2, "PUBLISHED"),
]
function d(id: number, spaceId: number, parentId: number | null, type: KbDocType, title: string, sort: number, status: KbDocStatus = "PUBLISHED", summary?: string): KbDoc {
  return { id, spaceId, parentId, type, title, sort, status, summary, creatorId: 1, updaterId: 1, updaterName: "系统管理员", version: 1, createdAt: "2026-06-12T09:00:00", updatedAt: "2026-07-01T15:20:00" }
}

const SEED_HTML: Record<number, string> = {
  302: "<h2>代码提交规约</h2><p>为保证协作质量，所有提交遵循以下约定：</p><ul><li>commit message 用 <code>type(scope): 描述</code>；</li><li>功能分支从 main 切出，合并前须过 CI 四门；</li><li>评审至少一名 reviewer 通过。</li></ul>",
  303: "<h2>接口设计规范</h2><p>统一响应封套 <code>{code,message,data}</code>，分页用 pageNum/pageSize。</p>",
  305: "<h2>知识库架构方案（草稿）</h2><p>四层：知识组织、AI 能力、检索、协作。</p><blockquote>批1 先落知识组织 + 文档基础。</blockquote>",
  311: "<h2>员工手册</h2><p>欢迎加入星辰科技。本手册涵盖公司文化、行为准则与基础制度。</p>",
  313: "<h2>请假与加班规定</h2><p>请假经直属主管审批；加班须提前申请，按制度折算调休或加班费。</p>",
  321: "<h2>2026 战略规划（草稿）</h2><p>聚焦 AI 驱动的企业协作平台：知识、流程、数据。</p>",
  322: "<h2>董事会决议汇编</h2><p>收录本年度历次董事会决议要点。</p>",
}
/** 正文存储（会话内可变），懒从 SEED_HTML 生成 contentJson */
const CONTENTS: Record<number, { contentJson: unknown; contentText: string }> = {}
function getContent(docId: number): { contentJson: unknown; contentText: string } {
  if (CONTENTS[docId]) return CONTENTS[docId]
  const html = SEED_HTML[docId] ?? ""
  return { contentJson: htmlToJson(html), contentText: stripHtml(html) }
}

const TAGS: KbTag[] = [
  { id: 401, name: "规范", color: "#0ea5e9" },
  { id: 402, name: "架构", color: "#8b5cf6" },
  { id: 403, name: "制度", color: "#10b981" },
]

/** 版本历史（会话内可变），键=docId；VERSION_SNAP 键=`${docId}:${version}` */
const VERSIONS: Record<number, KbDocVersion[]> = {
  302: [
    { id: 501, docId: 302, version: 1, editorId: 1, editorName: "系统管理员", note: "初稿", createdAt: "2026-06-12T09:00:00" },
    { id: 502, docId: 302, version: 2, editorId: 3, editorName: "张三", note: "补充评审流程", createdAt: "2026-06-20T14:30:00" },
  ],
  305: [{ id: 503, docId: 305, version: 1, editorId: 1, editorName: "系统管理员", note: "架构初稿", createdAt: "2026-06-15T10:00:00" }],
}
const VERSION_SNAP: Record<string, { contentJson: unknown; contentText: string }> = {
  "302:1": { contentJson: htmlToJson("<h2>代码提交规约</h2><p>初版：约定 commit message 与分支模型。</p>"), contentText: "代码提交规约\n初版：约定 commit message 与分支模型。" },
}
function versionsOf(docId: number): KbDocVersion[] {
  return VERSIONS[docId] ?? []
}
/** 保存/回滚时记录一个版本快照 */
function recordVersion(doc: KbDoc, contentJson: unknown, contentText: string, note?: string) {
  const list = VERSIONS[doc.id] ?? (VERSIONS[doc.id] = [])
  list.push({ id: nid(), docId: doc.id, version: doc.version, editorId: currentKbCtx().userId ?? 1, editorName: useAuthStore.getState().user?.name ?? "我", note, createdAt: nowIso() })
  VERSION_SNAP[`${doc.id}:${doc.version}`] = { contentJson, contentText }
}

/** 评论（会话内可变） */
const COMMENTS: KbComment[] = [
  { id: 601, docId: 302, parentId: null, userId: 2, userName: "李经理", content: "分支模型这段建议再举个例子。", createdAt: "2026-06-21T09:10:00" },
  { id: 602, docId: 302, parentId: 601, userId: 3, userName: "张三", content: "@李经理 好的，我补一个 feature 分支的示例。", createdAt: "2026-06-21T09:40:00" },
  { id: 603, docId: 302, parentId: null, userId: 1, userName: "系统管理员", content: "整体不错，已同意发布。", createdAt: "2026-06-22T16:00:00" },
]
const commentsOf = (docId: number) => COMMENTS.filter((c) => c.docId === docId)

const membersOf = (spaceId: number) => MEMBERS.filter((m) => m.spaceId === spaceId)

/* --------------------------- demo 判定 + 包装 --------------------------- */

export interface KbResult<T> {
  data: T
  demo: boolean
}

async function withMock<T>(fn: () => Promise<T>, mock: () => T): Promise<KbResult<T>> {
  if (useAuthStore.getState().offline) return { data: mock(), demo: true }
  try {
    return { data: await fn(), demo: false }
  } catch (err) {
    if (err instanceof NetworkError) return { data: mock(), demo: true }
    throw err
  }
}

/** 列表归一：接受 T[] 或 {list:T[]}，garbage → []（防白屏第 2 层） */
function normList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === "object" && Array.isArray((raw as { list?: unknown }).list)) return (raw as { list: T[] }).list
  return []
}

/** 目录树归一：递归确保 children 为数组（后端已回嵌套树；防脏数据） */
function normTree(nodes: unknown): KbTreeNode[] {
  if (!Array.isArray(nodes)) return []
  return nodes.map((n) => {
    const node = n as KbTreeNode
    return { ...node, children: normTree((node as { children?: unknown }).children) }
  })
}

/** 当前用户权限上下文（offline=演示放开） */
export function currentKbCtx(): KbUserCtx {
  const s = useAuthStore.getState()
  const deptIds = [...new Set(s.assignments.map((a) => a.deptId).filter((x): x is number => typeof x === "number"))]
  return { userId: s.userId, deptIds, roleIds: [], offline: s.offline }
}

/* =============================== 空间 =============================== */

export function fetchSpaces(): Promise<KbResult<KbSpace[]>> {
  const ctx = currentKbCtx()
  return withMock(
    () => api<KbSpace[]>(`${KB}/spaces`).then(normList<KbSpace>),
    () => visibleSpaces(SPACES, membersOf, ctx).map((s) => ({ ...s, myRole: roleOf(s, membersOf(s.id), ctx) })),
  )
}

export function fetchSpace(id: number): Promise<KbResult<KbSpace | null>> {
  const ctx = currentKbCtx()
  return withMock(
    () => api<KbSpace>(`${KB}/spaces/${id}`),
    () => {
      const s = SPACES.find((x) => x.id === id)
      return s ? { ...s, myRole: roleOf(s, membersOf(s.id), ctx) } : null
    },
  )
}

export interface CreateSpaceInput {
  name: string
  code?: string
  description?: string
  icon?: string
  visibility: KbVisibility
}

export function createSpace(input: CreateSpaceInput): Promise<KbResult<KbSpace>> {
  return withMock(
    () => api<KbSpace>(`${KB}/spaces`, { method: "POST", body: JSON.stringify(input) }),
    () => {
      const ownerId = currentKbCtx().userId ?? 1
      const ownerName = useAuthStore.getState().user?.name ?? "我"
      const space: KbSpace = {
        id: nid(), name: input.name, code: input.code || input.name.slice(0, 8).toUpperCase(),
        description: input.description, icon: input.icon || "📁", visibility: input.visibility,
        ownerId, ownerName, myRole: "ADMIN", memberCount: 1, docCount: 0, sort: SPACES.length + 1, createdAt: nowIso(),
      }
      SPACES.push(space)
      MEMBERS.push({ id: nid(), spaceId: space.id, principalType: "USER", principalId: ownerId, principalName: ownerName, role: "ADMIN" })
      return space
    },
  )
}

export function updateSpace(id: number, patch: Partial<CreateSpaceInput>): Promise<KbResult<KbSpace | null>> {
  return withMock(
    () => api<KbSpace>(`${KB}/spaces/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
    () => {
      const s = SPACES.find((x) => x.id === id)
      if (s) Object.assign(s, patch)
      return s ?? null
    },
  )
}

export function deleteSpace(id: number): Promise<KbResult<boolean>> {
  return withMock(
    () => api<void>(`${KB}/spaces/${id}`, { method: "DELETE" }).then(() => true),
    () => {
      const i = SPACES.findIndex((x) => x.id === id)
      if (i >= 0) SPACES.splice(i, 1)
      return true
    },
  )
}

/* =============================== 成员 =============================== */

export function fetchMembers(spaceId: number): Promise<KbResult<KbSpaceMember[]>> {
  return withMock(
    () => api<KbSpaceMember[]>(`${KB}/spaces/${spaceId}/members`).then(normList<KbSpaceMember>),
    () => membersOf(spaceId),
  )
}

export interface AddMemberInput {
  principalType: KbPrincipalType
  principalId: number
  principalName: string
  role: KbMemberRole
}

/** 新增/更新成员（POST upsert：同 principal 存在则改角色；后端回单个 member，归一成数组） */
export function upsertMember(spaceId: number, input: AddMemberInput): Promise<KbResult<KbSpaceMember[]>> {
  return withMock(
    () => api<KbSpaceMember | KbSpaceMember[]>(`${KB}/spaces/${spaceId}/members`, { method: "POST", body: JSON.stringify(input) }).then((m) => (Array.isArray(m) ? m : m ? [m] : [])),
    () => {
      const existing = MEMBERS.find((m) => m.spaceId === spaceId && m.principalType === input.principalType && m.principalId === input.principalId)
      if (existing) existing.role = input.role
      else MEMBERS.push({ id: nid(), spaceId, ...input })
      const s = SPACES.find((x) => x.id === spaceId)
      if (s) s.memberCount = membersOf(spaceId).length
      return membersOf(spaceId)
    },
  )
}

export function removeMember(spaceId: number, memberId: number): Promise<KbResult<boolean>> {
  return withMock(
    () => api<void>(`${KB}/spaces/${spaceId}/members/${memberId}`, { method: "DELETE" }).then(() => true),
    () => {
      const i = MEMBERS.findIndex((x) => x.id === memberId)
      if (i >= 0) MEMBERS.splice(i, 1)
      const s = SPACES.find((x) => x.id === spaceId)
      if (s) s.memberCount = membersOf(spaceId).length
      return true
    },
  )
}

/* =============================== 文档树 =============================== */

export function fetchDocTree(spaceId: number): Promise<KbResult<KbTreeNode[]>> {
  return withMock(
    () => api<KbTreeNode[]>(`${KB}/docs/tree?spaceId=${spaceId}`).then(normTree),
    () => buildDocTree(DOCS.filter((x) => x.spaceId === spaceId)),
  )
}

export function fetchDoc(docId: number): Promise<KbResult<KbDocDetail | null>> {
  return withMock(
    () => api<KbDocDetail>(`${KB}/docs/${docId}`),
    () => {
      const doc = DOCS.find((x) => x.id === docId)
      if (!doc) return null
      const c = getContent(docId)
      return { ...doc, contentJson: c.contentJson, contentText: c.contentText, tags: [] }
    },
  )
}

export interface CreateDocInput {
  parentId: number | null
  type: KbDocType
  title: string
}

export function createDoc(spaceId: number, input: CreateDocInput): Promise<KbResult<KbDoc>> {
  return withMock(
    () => api<KbDoc>(`${KB}/docs`, { method: "POST", body: JSON.stringify({ spaceId, ...input }) }),
    () => {
      const siblings = DOCS.filter((x) => x.spaceId === spaceId && x.parentId === input.parentId)
      const uid = currentKbCtx().userId ?? 1
      const doc: KbDoc = {
        id: nid(), spaceId, parentId: input.parentId, type: input.type,
        title: input.title || (input.type === "FOLDER" ? "新建目录" : "无标题文档"),
        sort: siblings.length + 1, status: "DRAFT", creatorId: uid, updaterId: uid,
        updaterName: useAuthStore.getState().user?.name ?? "我", version: 1, createdAt: nowIso(), updatedAt: nowIso(),
      }
      DOCS.push(doc)
      if (input.type === "DOC") CONTENTS[doc.id] = { contentJson: htmlToJson(""), contentText: "" }
      return doc
    },
  )
}

export interface UpdateDocInput {
  title?: string
  /** 移动：0=移到空间根，null/undefined=不改父级 */
  parentId?: number | null
  sort?: number
}

export function updateDoc(id: number, patch: UpdateDocInput): Promise<KbResult<KbDoc | null>> {
  return withMock(
    () => api<KbDoc>(`${KB}/docs/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
    () => {
      const doc = DOCS.find((x) => x.id === id)
      if (doc) {
        if (patch.title !== undefined) doc.title = patch.title
        if (patch.parentId !== undefined && patch.parentId !== null) doc.parentId = patch.parentId === 0 ? null : patch.parentId
        if (patch.sort !== undefined) doc.sort = patch.sort
        doc.updatedAt = nowIso()
      }
      return doc ?? null
    },
  )
}

export function deleteDoc(id: number): Promise<KbResult<boolean>> {
  return withMock(
    () => api<void>(`${KB}/docs/${id}`, { method: "DELETE" }).then(() => true),
    () => {
      const toDelete = new Set<number>([id])
      let grew = true
      while (grew) {
        grew = false
        for (const doc of DOCS) {
          if (doc.parentId != null && toDelete.has(doc.parentId) && !toDelete.has(doc.id)) {
            toDelete.add(doc.id)
            grew = true
          }
        }
      }
      for (let i = DOCS.length - 1; i >= 0; i--) {
        if (toDelete.has(DOCS[i].id)) {
          delete CONTENTS[DOCS[i].id]
          DOCS.splice(i, 1)
        }
      }
      return true
    },
  )
}

export function setDocStatus(id: number, action: "publish" | "archive"): Promise<KbResult<KbDoc | null>> {
  return withMock(
    () => api<KbDoc>(`${KB}/docs/${id}/${action}`, { method: "POST" }),
    () => {
      const doc = DOCS.find((x) => x.id === id)
      if (doc) {
        doc.status = action === "publish" ? "PUBLISHED" : "ARCHIVED"
        doc.updatedAt = nowIso()
      }
      return doc ?? null
    },
  )
}

/* =============================== 正文 =============================== */

export interface SaveContentInput {
  contentJson: unknown
  contentText: string
}

export function saveDocContent(docId: number, input: SaveContentInput): Promise<KbResult<KbDoc | null>> {
  return withMock(
    () => api<KbDoc>(`${KB}/docs/${docId}/content`, { method: "PUT", body: JSON.stringify(input) }),
    () => {
      CONTENTS[docId] = { contentJson: input.contentJson, contentText: input.contentText }
      const doc = DOCS.find((x) => x.id === docId)
      if (doc) {
        doc.version += 1
        doc.updatedAt = nowIso()
        doc.updaterName = useAuthStore.getState().user?.name ?? "我"
        recordVersion(doc, input.contentJson, input.contentText)
      }
      return doc ?? null
    },
  )
}

/* =============================== 标签（批1 基础） =============================== */

export function fetchTags(): Promise<KbResult<KbTag[]>> {
  return withMock(
    () => api<KbTag[]>(`${KB}/tags`).then(normList<KbTag>),
    () => TAGS,
  )
}

/* =============================== 批2：检索 / 推荐（§9） =============================== */

export interface SearchReq {
  q: string
  spaceId?: number
  pageNum?: number
  pageSize?: number
}

/** 混合检索（§9.1）。真实端点后端做语义+全文；mock 走标题/正文 ILIKE，仅可见空间。 */
export function searchKb(req: SearchReq): Promise<KbResult<PageResult<SearchHit>>> {
  const pageNum = req.pageNum ?? 1
  const pageSize = req.pageSize ?? 10
  return withMock(
    () => api<PageResult<SearchHit>>(`${KB}/search`, { method: "POST", body: JSON.stringify({ ...req, pageNum, pageSize }) }),
    () => {
      const ctx = currentKbCtx()
      const visIds = new Set(visibleSpaces(SPACES, membersOf, ctx).map((s) => s.id))
      const ql = req.q.trim().toLowerCase()
      const hits: SearchHit[] = DOCS.filter((doc) => doc.type === "DOC" && visIds.has(doc.spaceId) && (req.spaceId == null || doc.spaceId === req.spaceId))
        .map((doc): SearchHit | null => {
          const text = getContent(doc.id).contentText || ""
          const inTitle = doc.title.toLowerCase().includes(ql)
          const inBody = text.toLowerCase().includes(ql)
          if (ql && !inTitle && !inBody) return null
          const sp = SPACES.find((s) => s.id === doc.spaceId)
          const matchedBy: KbMatchedBy = inTitle && inBody ? "hybrid" : inBody ? "fulltext" : "vector"
          const score = (inTitle ? 2 : 0) + (inBody ? 1 : 0) + 0.1
          return { docId: doc.id, title: doc.title, spaceId: doc.spaceId, spaceName: sp?.name ?? "", snippet: buildSnippet(text || doc.title, req.q), score, matchedBy }
        })
        .filter((h): h is SearchHit => h !== null)
        .sort((a, b) => b.score - a.score)
      return { list: hits.slice((pageNum - 1) * pageSize, pageNum * pageSize), total: hits.length, pageNum, pageSize }
    },
  )
}

/* =============================== 批3：AI 写作辅助（§3.2，SSE 流式） =============================== */

export interface AssistReq {
  action: AssistAction
  selectedText?: string
  docContext?: string
  docId?: number
}
export interface AssistHandlers {
  onDelta: (chunk: string) => void
  onDone: (full: string) => void
  onError: (msg: string) => void
}

/** 演示流式：把整段文本切块，定时逐块回调，返回取消函数。 */
function mockAssist(req: AssistReq, h: AssistHandlers): () => void {
  const full = buildAssistText(req.action, req.selectedText, req.docContext)
  const chunks: string[] = []
  for (let i = 0; i < full.length; i += 4) chunks.push(full.slice(i, i + 4))
  let idx = 0
  let acc = ""
  const timer = setInterval(() => {
    if (idx >= chunks.length) {
      clearInterval(timer)
      h.onDone(acc)
      return
    }
    acc += chunks[idx]
    h.onDelta(chunks[idx])
    idx += 1
  }, 12)
  return () => clearInterval(timer)
}

/**
 * AI 写作辅助流（§3.2）：POST /api/kb/ai/assist（SSE，text.delta 增量）。返回取消函数。
 * offline / 后端未就绪(网络失败/404/非事件流) → 降级为演示流式，始终可用。
 */
export function assistStream(req: AssistReq, h: AssistHandlers): () => void {
  if (useAuthStore.getState().offline) return mockAssist(req, h)

  const controller = new AbortController()
  let cancelled = false
  void (async () => {
    let res: Response
    try {
      const { token } = useAuthStore.getState()
      res = await fetch(`${KB}/ai/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(req),
        signal: controller.signal,
      })
    } catch {
      if (!cancelled) mockAssist(req, h) // 网络不通 → 演示降级
      return
    }
    const ct = res.headers.get("content-type") ?? ""
    if (res.status === 404 || !res.ok || !ct.includes("text/event-stream") || !res.body) {
      if (!cancelled) mockAssist(req, h)
      return
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    let acc = ""
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const blocks = buf.split("\n\n")
        buf = blocks.pop() ?? ""
        for (const block of blocks) {
          const line = block.split("\n").find((l) => l.startsWith("data:"))
          if (!line) continue
          const data = line.slice(5).trim()
          if (!data || data === "[DONE]") continue
          let text = ""
          try {
            const j = JSON.parse(data) as { text?: string; delta?: string }
            text = typeof j.text === "string" ? j.text : typeof j.delta === "string" ? j.delta : ""
          } catch {
            text = data
          }
          if (text) {
            acc += text
            h.onDelta(text)
          }
        }
      }
      if (!cancelled) h.onDone(acc)
    } catch {
      if (!cancelled) h.onError("AI 生成失败，请重试")
    }
  })()

  return () => {
    cancelled = true
    controller.abort()
  }
}

/** 相关推荐（§9.2）：排除自身、仅可见空间、相似降序。mock 用同空间其它文档。 */
export function fetchRelated(docId: number, topN = 5): Promise<KbResult<RelatedDoc[]>> {
  return withMock(
    () => api<RelatedDoc[]>(`${KB}/docs/${docId}/related?topN=${topN}`).then(normList<RelatedDoc>),
    () => {
      const self = DOCS.find((d) => d.id === docId)
      if (!self) return []
      const ctx = currentKbCtx()
      const visIds = new Set(visibleSpaces(SPACES, membersOf, ctx).map((s) => s.id))
      return DOCS.filter((d) => d.type === "DOC" && d.id !== docId && visIds.has(d.spaceId))
        .map((d, i): RelatedDoc => {
          const sp = SPACES.find((s) => s.id === d.spaceId)
          // 同空间更相关
          const base = d.spaceId === self.spaceId ? 0.95 : 0.6
          return { docId: d.id, title: d.title, spaceId: d.spaceId, spaceName: sp?.name ?? "", score: Math.max(0.3, base - i * 0.08) }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, topN)
    },
  )
}

/* =============================== 批4a：版本历史 =============================== */

export function fetchVersions(docId: number): Promise<KbResult<KbDocVersion[]>> {
  return withMock(
    () => api<KbDocVersion[]>(`${KB}/docs/${docId}/versions`).then(normList<KbDocVersion>),
    () => [...versionsOf(docId)].sort((a, b) => b.version - a.version),
  )
}

export function fetchVersionContent(docId: number, version: number): Promise<KbResult<KbVersionContent>> {
  return withMock(
    () => api<KbVersionContent>(`${KB}/docs/${docId}/versions/${version}`),
    () => {
      const snap = VERSION_SNAP[`${docId}:${version}`]
      if (snap) return { version, contentJson: snap.contentJson, contentText: snap.contentText }
      // 无快照（如最新版）→ 回当前正文
      const c = getContent(docId)
      return { version, contentJson: c.contentJson, contentText: c.contentText }
    },
  )
}

/** 回滚到指定版本：以该版本正文另存为新版本（不销毁历史） */
export function rollbackDoc(docId: number, version: number): Promise<KbResult<KbDoc | null>> {
  return withMock(
    () => api<KbDoc>(`${KB}/docs/${docId}/rollback/${version}`, { method: "POST" }),
    () => {
      const snap = VERSION_SNAP[`${docId}:${version}`] ?? getContent(docId)
      const doc = DOCS.find((x) => x.id === docId)
      if (doc) {
        CONTENTS[docId] = { contentJson: snap.contentJson, contentText: snap.contentText }
        doc.version += 1
        doc.updatedAt = nowIso()
        doc.updaterName = useAuthStore.getState().user?.name ?? "我"
        recordVersion(doc, snap.contentJson, snap.contentText, `回滚自 v${version}`)
      }
      return doc ?? null
    },
  )
}

/* =============================== 批4a：评论 =============================== */

export function fetchComments(docId: number): Promise<KbResult<KbComment[]>> {
  return withMock(
    () => api<KbComment[]>(`${KB}/docs/${docId}/comments`).then(normList<KbComment>),
    () => commentsOf(docId),
  )
}

export interface PostCommentInput {
  content: string
  parentId?: number | null
  anchor?: string | null
}

export function postComment(docId: number, input: PostCommentInput): Promise<KbResult<KbComment>> {
  return withMock(
    () => api<KbComment>(`${KB}/docs/${docId}/comments`, { method: "POST", body: JSON.stringify(input) }),
    () => {
      const uid = currentKbCtx().userId ?? 1
      const c: KbComment = {
        id: nid(),
        docId,
        parentId: input.parentId ?? null,
        userId: uid,
        userName: useAuthStore.getState().user?.name ?? "我",
        content: input.content,
        anchor: input.anchor ?? null,
        createdAt: nowIso(),
      }
      COMMENTS.push(c)
      return c
    },
  )
}

export function deleteComment(commentId: number): Promise<KbResult<boolean>> {
  return withMock(
    () => api<void>(`${KB}/comments/${commentId}`, { method: "DELETE" }).then(() => true),
    () => {
      const i = COMMENTS.findIndex((c) => c.id === commentId)
      if (i >= 0) COMMENTS.splice(i, 1)
      return true
    },
  )
}

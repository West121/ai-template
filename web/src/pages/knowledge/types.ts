/**
 * 知识库（批1：知识组织 + 文档基础）领域模型。
 * 对齐 docs/design/ai-knowledge-base.md §2 + 磐石批1后端契约（表前缀 kb_）。批1 不含 AI/检索/协作。
 *
 * 后端契约要点：
 *  - 响应 {code,message,data}，列表为裸数组。
 *  - SpaceResponse 带 `myRole`（后端按当前用户算，驱动前端读写权限），非成员 PRIVATE 空间不返回 / 详情 403。
 *  - 文档树 GET /api/kb/docs/tree?spaceId= 直接回 DocTreeNode 嵌套树；文档详情 GET /api/kb/docs/{id} 带
 *    contentJson(TipTap JSON,后端只存不解析) + contentText + tags。正文前端复用 rich-text(HTML)，
 *    在 content-codec 做 HTML↔JSON 转换。
 */

export type KbVisibility = "PUBLIC" | "INTERNAL" | "PRIVATE"
export type KbMemberRole = "VIEWER" | "EDITOR" | "ADMIN"
export type KbPrincipalType = "USER" | "DEPT" | "ROLE"
export type KbDocType = "FOLDER" | "DOC"
export type KbDocStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED"

/** 知识空间（SpaceResponse） */
export interface KbSpace {
  id: number
  name: string
  code: string
  description?: string
  /** 图标：emoji（批1）；后端 SpaceResponse 可能不含，缺省用 📁 */
  icon?: string
  visibility: KbVisibility
  ownerId: number
  ownerName?: string
  /** 后端按当前用户算的角色（驱动前端读写）；null=非成员（仅按可见性只读或不可见） */
  myRole?: KbMemberRole | null
  memberCount: number
  docCount?: number
  sort?: number
  createdAt?: string
}

/** 空间成员权限（kb_space_member）：空间级 RBAC */
export interface KbSpaceMember {
  id: number
  spaceId: number
  principalType: KbPrincipalType
  principalId: number
  principalName: string
  role: KbMemberRole
}

/** 文档 / 目录节点（kb_doc）基础字段 */
export interface KbDoc {
  id: number
  spaceId: number
  parentId: number | null
  type: KbDocType
  title: string
  sort: number
  summary?: string
  status: KbDocStatus
  creatorId?: number
  updaterId?: number
  updaterName?: string
  version: number
  createdAt?: string
  updatedAt?: string
}

/** 目录树节点（GET /docs/tree 的 DocTreeNode；children 嵌套） */
export interface KbTreeNode {
  id: number
  parentId: number | null
  spaceId?: number
  type: KbDocType
  title: string
  sort: number
  status: KbDocStatus
  version: number
  summary?: string
  updatedAt?: string
  children: KbTreeNode[]
}

/** 标签（kb_tag，批1 展示/手动，AI 自动标签在批3） */
export interface KbTag {
  id: number
  name: string
  color?: string
}

/** 文档详情（GET /docs/{id}）：元信息 + 正文 JSON + 标签 */
export interface KbDocDetail extends KbDoc {
  /** TipTap JSON（后端原样存储）；编辑器 HTML 由 content-codec 互转 */
  contentJson: unknown
  contentText: string
  tags: KbTag[]
}

/** 权限判定上下文（当前用户），offline=演示放开 */
export interface KbUserCtx {
  userId: number | null
  deptIds: number[]
  roleIds: number[]
  offline: boolean
}

export const VISIBILITY_META: Record<KbVisibility, { label: string; className: string }> = {
  PUBLIC: { label: "公开", className: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
  INTERNAL: { label: "内部", className: "border-sky-500/40 text-sky-600 dark:text-sky-400" },
  PRIVATE: { label: "私有", className: "border-amber-500/40 text-amber-600 dark:text-amber-400" },
}

export const ROLE_META: Record<KbMemberRole, { label: string; className: string }> = {
  VIEWER: { label: "只读", className: "text-muted-foreground" },
  EDITOR: { label: "编辑", className: "text-sky-600 dark:text-sky-400" },
  ADMIN: { label: "管理", className: "text-primary" },
}

export const DOC_STATUS_META: Record<KbDocStatus, { label: string; className: string }> = {
  DRAFT: { label: "草稿", className: "border-amber-500/40 text-amber-600 dark:text-amber-400" },
  PUBLISHED: { label: "已发布", className: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
  ARCHIVED: { label: "已归档", className: "border-muted-foreground/30 text-muted-foreground" },
}

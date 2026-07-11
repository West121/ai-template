/**
 * FeatureRouteRegistry（V2 批C，§10.2 受控导航 / 附2 第 7 条）：
 * featureCode → { path, params } 单文件映射，**由 menu.ts 生成全量**（不破坏全站「path 即唯一键」
 * 约定：featureCode = path 段大写下划线，与后端 ai_feature_catalog 种子同一约定，校验脚本防漂移）；
 * 另补菜单外的参数详情页与批A/mock 的语义别名。未知 code / 缺参 → null（渲染降级，不执行任意 URL）。
 */
import { flattenMenu } from "@/config/menu"

export interface FeatureRoute {
  /** 站内路径模板，`{param}` 占位 */
  path: string
  /** 必填路径参数名 */
  params?: string[]
  /** 展示名（来自菜单 title） */
  title?: string
}

/** path → featureCode（与后端种子同约定：去首斜杠，`/`與`-` 转 `_`，大写） */
export function featureCodeOf(path: string): string {
  return path.replace(/^\//, "").replace(/[/-]/g, "_").toUpperCase()
}

/** 菜单外的参数详情页（App.tsx 路由，menu 不含） */
const DETAIL_ROUTES: Record<string, FeatureRoute> = {
  WORKFLOW_INSTANCE_DETAIL: { path: "/workflow/instances/{instanceId}", params: ["instanceId"], title: "流程实例详情" },
  DOCUMENT_SEND_DETAIL: { path: "/document/send/{id}", params: ["id"], title: "发文办理单" },
  DOCUMENT_RECEIVE_DETAIL: { path: "/document/receive/{id}", params: ["id"], title: "收文办理单" },
  BIZDOC_RUN: { path: "/bizdoc/run/{defCode}", params: ["defCode"], title: "单据台账" },
}

/** 语义别名（批A/mock 使用过的编码）→ 规范码 */
const ALIASES: Record<string, string> = {
  WF_MY_TODO: "WORKFLOW_TASKS",
  WF_TASK_DETAIL: "WORKFLOW_TASKS",
  WF_START: "WORKFLOW_START",
  WF_MONITOR: "WORKFLOW_MONITOR",
  WF_INSTANCE_DETAIL: "WORKFLOW_INSTANCE_DETAIL",
  DOC_SEND: "DOCUMENT_SEND",
  DOC_RECEIVE: "DOCUMENT_RECEIVE",
  MEETING_LIST: "MEETING_MY",
  BIZDOC_CENTER: "BIZDOC_CENTER",
}

/** 全量注册表：菜单叶子（外链/分组跳过）+ 详情页 */
export const FEATURE_REGISTRY: Record<string, FeatureRoute> = (() => {
  const reg: Record<string, FeatureRoute> = {}
  for (const item of flattenMenu()) {
    if (item.children?.length) continue // 分组不注册（导航去叶子）
    if (!item.path.startsWith("/")) continue // 外链（xxl-job 控制台等）不进受控导航
    reg[featureCodeOf(item.path)] = { path: item.path, title: item.title }
  }
  Object.assign(reg, DETAIL_ROUTES)
  return reg
})()

/** featureCode（含别名）→ 站内路径；未知 code / 缺参 → null */
export function resolveFeature(featureCode: string | undefined, routeParams?: Record<string, unknown>): string | null {
  if (!featureCode) return null
  const route = FEATURE_REGISTRY[ALIASES[featureCode] ?? featureCode]
  if (!route) return null
  let missing = false
  const path = route.path.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = routeParams?.[key]
    if (v == null || v === "") {
      missing = true
      return ""
    }
    return encodeURIComponent(String(v))
  })
  return missing ? null : path
}

/**
 * 反查：当前路由 pathname → featureCode（pageContext 采集用）。
 * 精确命中 → 参数模板命中 → 最长前缀回退（如 /workflow/defs/xxx/design → WORKFLOW_DEFS）；拿不到回 null。
 */
export function featureCodeFromPath(pathname: string): string | null {
  const clean = pathname.split("?")[0].replace(/\/+$/, "") || "/"
  const entries = Object.entries(FEATURE_REGISTRY)
  for (const [code, r] of entries) {
    if (!r.path.includes("{") && r.path === clean) return code
  }
  for (const [code, r] of entries) {
    if (!r.path.includes("{")) continue
    const re = new RegExp(`^${r.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{\w+\\\}/g, "[^/]+")}$`)
    if (re.test(clean)) return code
  }
  let best: string | null = null
  let bestLen = 0
  for (const [code, r] of entries) {
    if (r.path.includes("{")) continue
    if (clean.startsWith(`${r.path}/`) && r.path.length > bestLen) {
      best = code
      bestLen = r.path.length
    }
  }
  return best
}

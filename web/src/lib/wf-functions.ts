/**
 * 后端公式函数注册表接入（`GET /api/wf/expression/functions`）。
 *
 * 磐石已把取人公式接入后端 `@FormulaFunction` 注册表，函数列表端点返回内置
 * 取人/逻辑/比较项 + 运行时注册的 **CUSTOM** 扩展函数（如 workDays / deptLeader /
 * dictLabel，随业务自动增长）。本模块负责：
 *  - **进程内缓存**：一次会话只拉一次（含失败降级结果），避免每次开弹窗都请求；
 *  - **优雅降级**：离线 / 请求失败时返回空扩展列表，两个公式编辑器仍用内置函数，不报错不阻塞；
 *  - 把 CUSTOM 元数据适配成编辑器统一的 `FnDoc`，供函数面板展示 + CodeMirror 自动补全复用。
 *
 * 两套公式编辑器（取人 `FormulaEditor` / 计算·条件 `FormulaDesigner`）共享同一批 CUSTOM 函数。
 */
import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import type { FnDoc } from "@/lib/formula-highlight"

/** 后端公式函数元数据（与 server FnMeta 记录对齐）。 */
export interface FnMeta {
  name: string
  signature: string
  /** ASSIGNEE(取人) / LOGIC(逻辑) / COMPARE(比较) / VALUE(操作数) / CUSTOM(后端扩展)——未知值容错保留 */
  category: string
  description: string
}

const ENDPOINT = "/api/wf/expression/functions"

/** CUSTOM 分类标识：后端 `@FormulaFunction` 扩展函数。 */
export const CUSTOM_CATEGORY = "CUSTOM"

/**
 * 进程内缓存：整会话只拉一次。缓存的是**已 catch 的 Promise**——即便请求失败也解析为
 * `[]`（优雅降级），故 `getExpressionFunctions()` 永不 reject，调用方可安全 `.then`。
 */
let cache: Promise<FnMeta[]> | null = null

/** 取后端公式函数全集（会话内缓存 + 失败降级为 `[]`）。 */
export function getExpressionFunctions(): Promise<FnMeta[]> {
  if (!cache) {
    // 离线 / 后端未启动（NetworkError）/ 权限或业务错误（ApiError）一律降级为空扩展列表。
    cache = api<FnMeta[]>(ENDPOINT).catch(() => [])
  }
  return cache
}

/** 仅测试用：清空进程内缓存。 */
export function resetExpressionFunctionsCache(): void {
  cache = null
}

/** 抽取 CUSTOM 扩展函数（过滤分类 + 按 name 去重，保持后端返回顺序）。 */
export function pickCustomFunctions(all: readonly FnMeta[]): FnMeta[] {
  const seen = new Set<string>()
  const out: FnMeta[] = []
  for (const fn of all) {
    if (fn.category !== CUSTOM_CATEGORY) continue
    if (seen.has(fn.name)) continue
    seen.add(fn.name)
    out.push(fn)
  }
  return out
}

/**
 * 把 CUSTOM 扩展函数适配成编辑器统一的 `FnDoc`。
 * @param custom        CUSTOM 函数元数据
 * @param categoryTitle 函数面板分类标题（如「扩展函数」）
 * @param backendNote   追加到说明末尾的标注（计算公式传「后端函数，前端不预览」；取人不传）
 */
export function customFnDocs(
  custom: readonly FnMeta[],
  categoryTitle: string,
  backendNote?: string,
): FnDoc[] {
  return custom.map((fn) => ({
    name: fn.name,
    // 「插 name( 模板」——补全 / 点击插入后光标落到第一个参数
    insertTemplate: `${fn.name}(`,
    signature: fn.signature,
    category: categoryTitle,
    description: backendNote ? `${fn.description}（${backendNote}）` : fn.description,
    example: fn.signature,
  }))
}

/**
 * 表达式是否引用了 `names` 中的任一函数（形如 `NAME(`）。
 * 供计算/条件公式对 CUSTOM 函数容错：命中则跳过前端预览、交由后端求值。
 */
export function referencesFunction(expr: string, names: ReadonlySet<string>): boolean {
  if (names.size === 0) return false
  const callRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(expr))) {
    if (names.has(m[1])) return true
  }
  return false
}

/**
 * React hook：加载 CUSTOM 扩展函数（读进程缓存，会话内只请求一次；失败降级为 `[]`）。
 * 组件用它把后端扩展函数合并进函数面板 + 自动补全，纯内置行为不受影响。
 */
export function useCustomFunctions(): FnMeta[] {
  const [custom, setCustom] = useState<FnMeta[]>([])
  useEffect(() => {
    let alive = true
    void getExpressionFunctions().then((all) => {
      if (alive) setCustom(pickCustomFunctions(all))
    })
    return () => {
      alive = false
    }
  }, [])
  return custom
}

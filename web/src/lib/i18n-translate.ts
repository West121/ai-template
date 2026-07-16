/**
 * AI 一键翻译（i18n M1，docs/design/i18n.md §3.5 + 主控拍板④，磐石端点并行，mock 先行）。
 *
 * ── 契约（钉死，给磐石）────────────────────────────────────────────────
 *  POST /api/ai/translate                          【system:i18n:translate，V53 授 ADMIN】
 *  请求 {
 *    texts: string[]                // 待译中文原文（前端去重、单请求 ≤50 条分片）
 *    targetLocales: string[]        // ["en","zh-TW","th","ja"] 子集（白名单校验）
 *    sourceLocale?: "zh-CN"         // 默认 zh-CN
 *    context?: string               // 领域提示（如 "OA 审批表单字段名，简短名词"）
 *  }
 *  响应 data（拍板④定稿：按 locale 键、数组与 texts 同序等长）：
 *    { translations: { en?: string[], "zh-TW"?: string[], th?: string[], ja?: string[] } }
 *  归一化对丹青稿早期形状（{translations:{<text>:{<locale>:string}}}）向后容错。
 *  FAST 模型档；无副作用可重试；错误走信封（400 参数/白名单，403 权限门）。
 * ──────────────────────────────────────────────────────────────────────
 *
 * 降级（红线 6）：offline / NetworkError / 端点未实现(404) → mock 伪译文
 * （`[EN] 原文` 形态，demo:true 供 UI 标注），不阻断人工手填；真实 4xx/5xx 照抛。
 */
import { api, ApiError, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import type { Locale } from "@/stores/app-store"

/** 可作为翻译目标的四语（zh-CN 是源语言，不可为目标） */
export type TargetLocale = Exclude<Locale, "zh-CN">
export const TARGET_LOCALES: TargetLocale[] = ["en", "zh-TW", "th", "ja"]

/** 单次请求条数上限（拍板④），超出由前端分片 */
export const TRANSLATE_BATCH_LIMIT = 50

/** 归一化结果：原文 → { locale → 译文 } */
export interface TranslateOutcome {
  byText: Record<string, Partial<Record<TargetLocale, string>>>
  demo: boolean
}

const MOCK_TAG: Record<TargetLocale, string> = { en: "[EN]", "zh-TW": "[繁]", th: "[TH]", ja: "[JA]" }

function mockTranslate(texts: string[], targets: TargetLocale[]): Record<string, Partial<Record<TargetLocale, string>>> {
  const byText: Record<string, Partial<Record<TargetLocale, string>>> = {}
  for (const text of texts) {
    const entry: Partial<Record<TargetLocale, string>> = {}
    for (const t of targets) entry[t] = `${MOCK_TAG[t]} ${text}`
    byText[text] = entry
  }
  return byText
}

/** 响应容错归一：主形状 {locale:[...]}（拍板④）；兼容 {text:{locale:val}} 早期稿；垃圾 → {} */
function normalizeTranslations(
  raw: unknown,
  texts: string[],
  targets: TargetLocale[],
): Record<string, Partial<Record<TargetLocale, string>>> {
  const byText: Record<string, Partial<Record<TargetLocale, string>>> = {}
  const translations = (raw as { translations?: unknown } | null)?.translations
  if (!translations || typeof translations !== "object") return byText
  const map = translations as Record<string, unknown>
  for (const target of targets) {
    const arr = map[target]
    if (Array.isArray(arr)) {
      arr.forEach((v, i) => {
        const text = texts[i]
        if (text != null && typeof v === "string" && v.trim()) {
          ;(byText[text] ??= {})[target] = v
        }
      })
    }
  }
  if (Object.keys(byText).length > 0) return byText
  // 兼容早期稿形状 {<text>: {<locale>: string}}
  for (const text of texts) {
    const entry = map[text]
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      for (const target of targets) {
        const v = (entry as Record<string, unknown>)[target]
        if (typeof v === "string" && v.trim()) (byText[text] ??= {})[target] = v
      }
    }
  }
  return byText
}

/** 批量翻译（自动去重 + 分片 ≤50/次）；失败降级见文件头注释 */
export async function aiTranslate(
  texts: string[],
  targetLocales: TargetLocale[] = TARGET_LOCALES,
  context?: string,
): Promise<TranslateOutcome> {
  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))]
  const targets = targetLocales.filter((t): t is TargetLocale => TARGET_LOCALES.includes(t))
  if (unique.length === 0 || targets.length === 0) return { byText: {}, demo: false }
  if (useAuthStore.getState().offline) return { byText: mockTranslate(unique, targets), demo: true }

  const byText: Record<string, Partial<Record<TargetLocale, string>>> = {}
  for (let i = 0; i < unique.length; i += TRANSLATE_BATCH_LIMIT) {
    const slice = unique.slice(i, i + TRANSLATE_BATCH_LIMIT)
    try {
      const data = await api<unknown>("/api/ai/translate", {
        method: "POST",
        body: JSON.stringify({ texts: slice, targetLocales: targets, sourceLocale: "zh-CN", context }),
      })
      Object.assign(byText, normalizeTranslations(data, slice, targets))
    } catch (err) {
      // 端点未上线(404)/网络不通 → mock 伪译文（demo）；真实业务错照抛（红线 6）
      if (err instanceof NetworkError || (err instanceof ApiError && err.code === 404)) {
        return { byText: { ...byText, ...mockTranslate(unique.slice(i), targets) }, demo: true }
      }
      throw err
    }
  }
  return { byText, demo: false }
}

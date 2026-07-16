/**
 * i18n 初始化（多语言 M1，docs/design/i18n.md §3.1 + 主控拍板⑧）。
 *
 * 方案：react-i18next + **中文即 key** —— `t("保存")`，zh-CN 不建资源文件（空 bundle），
 * i18next 命不中即回退 key 本身 = 中文原文；其余四语（en/zh-TW/th/ja）扁平 JSON 懒加载。
 * 回退链（红线：绝不空白/[missing]）：当前 locale 译文 → 中文原文 key。
 *
 * 联动：本模块订阅 app-store.locale（单一真源，持久化）——切换时懒加载语言包 +
 * i18next.changeLanguage + document.documentElement.lang。app-store 不反向依赖本模块（避免环）。
 *
 * 红线（§五）：
 *  - keySeparator/nsSeparator 必须 false：key 是整句中文（可含 `:`/`.`），不得被当层级切开。
 *  - 语言包 import() 失败 → 留在当前语言 + toast，不白屏。
 */
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { toast } from "sonner"
import { useAppStore, type Locale } from "@/stores/app-store"

/** 非中文语言包加载器（显式映射保证 vite 静态可分析，各自成 chunk） */
const BUNDLE_LOADERS: Partial<Record<Locale, () => Promise<{ default: Record<string, string> }>>> = {
  en: () => import("@/locales/en.json"),
  "zh-TW": () => import("@/locales/zh-TW.json"),
  th: () => import("@/locales/th.json"),
  ja: () => import("@/locales/ja.json"),
}

const loadedBundles = new Set<Locale>(["zh-CN"])

void i18n.use(initReactI18next).init({
  lng: useAppStore.getState().locale,
  fallbackLng: "zh-CN", // zh-CN bundle 为空 → 命不中回 key（=中文原文）
  resources: { "zh-CN": { translation: {} } },
  keySeparator: false, // 整句中文 key，禁用层级分隔
  nsSeparator: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false }, // React 自带转义
})

/**
 * 切换语言：懒加载语言包（一次）→ changeLanguage → <html lang>。
 * 语言包加载失败：toast 并留在当前语言（红线 3，不白屏）。
 */
export async function applyLocale(locale: Locale): Promise<void> {
  if (!loadedBundles.has(locale)) {
    const load = BUNDLE_LOADERS[locale]
    if (load) {
      try {
        const mod = await load()
        i18n.addResourceBundle(locale, "translation", mod.default, true, true)
        loadedBundles.add(locale)
      } catch {
        toast.error("语言包加载失败，界面保持当前语言")
        return
      }
    }
  }
  await i18n.changeLanguage(locale)
  if (typeof document !== "undefined") document.documentElement.lang = locale
}

// app-store.locale 单一真源：任何入口（顶栏切换器 / 设置抽屉）setLocale 即联动
useAppStore.subscribe((state, prev) => {
  if (state.locale !== prev.locale) void applyLocale(state.locale)
})

// 首屏：持久化的非中文 locale 需异步补载语言包（加载前 t() 回退中文，不空白）
const initialLocale = useAppStore.getState().locale
if (initialLocale !== "zh-CN") void applyLocale(initialLocale)

export default i18n

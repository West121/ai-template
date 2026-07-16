/**
 * 日期本地化统一出口（多语言 M1，主控拍板①：date-fns 非 dayjs——五语 locale 内置零新增依赖）。
 *
 * 页面格式化日期一律走 formatDate/formatDateTime（或自取 dateFnsLocaleOf 传给 date-fns），
 * 不要新增裸 toLocaleString / 硬编码中文星期。存量 4 处 toLocaleString 在 M2/M3 逐页迁移。
 */
import { format } from "date-fns"
import { enUS, ja, th, zhCN, zhTW } from "date-fns/locale"
import type { Locale as DateFnsLocale } from "date-fns"
import { useAppStore, type Locale } from "@/stores/app-store"

const DATE_FNS_LOCALES: Record<Locale, DateFnsLocale> = {
  "zh-CN": zhCN,
  en: enUS,
  "zh-TW": zhTW,
  th,
  ja,
}

/** 当前（或指定）界面语言对应的 date-fns locale */
export function dateFnsLocaleOf(locale?: Locale): DateFnsLocale {
  return DATE_FNS_LOCALES[locale ?? useAppStore.getState().locale] ?? zhCN
}

/** 按当前界面语言格式化日期（默认 yyyy-MM-dd；含 EEEE/MMM 等词法 token 时随语言变化） */
export function formatDate(date: Date | number | string, fmt = "yyyy-MM-dd", locale?: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date
  try {
    return format(d, fmt, { locale: dateFnsLocaleOf(locale) })
  } catch {
    return "" // 非法日期不抛（防白屏），调用方自兜底
  }
}

/** 按当前界面语言格式化日期时间（默认 yyyy-MM-dd HH:mm） */
export function formatDateTime(date: Date | number | string, fmt = "yyyy-MM-dd HH:mm", locale?: Locale): string {
  return formatDate(date, fmt, locale)
}

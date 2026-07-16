/**
 * 动态数据 label 多语言取值（多语言 M1，docs/design/i18n.md §二/§3.2 + 主控拍板③⑧）。
 *
 * 模型：用户配置数据（表单字段 label / 表单标题 / 将来菜单外的节点名、字典等）旁挂
 * `labelI18n?: Partial<Record<Locale, string>>` —— **不存 zh-CN**（label 字段即简中源），
 * 只承载 en/zh-TW/th/ja。现有 schema 无此键 → 全回退中文，零迁移。
 *
 * 红线（§五）：pickLabel 是唯一取值出口——空串/非字符串/labelI18n 非对象（数组/字符串/null）
 * 一律回退中文原文；渲染端永不直接 `labelI18n[locale]` 取值。绝不出现空白/[missing]。
 */
import { useAppStore, type Locale } from "@/stores/app-store"
import type { FormWidget } from "@/types/workflow"

/** 当前界面语言（hook；非组件场景用 useAppStore.getState().locale） */
export function useLocale(): Locale {
  return useAppStore((s) => s.locale)
}

/**
 * 回退链取 label：locale 译文 → 中文原文 fallback。
 * zh-CN 恒取源 label；labelI18n 非对象 / 值非字符串 / 空白串一律回退。
 */
export function pickLabel(labelI18n: unknown, locale: Locale, fallback: string): string {
  if (locale === "zh-CN") return fallback
  if (!labelI18n || typeof labelI18n !== "object" || Array.isArray(labelI18n)) return fallback
  const v = (labelI18n as Record<string, unknown>)[locale]
  return typeof v === "string" && v.trim() ? v : fallback
}

/**
 * 把 widget 树按 locale 物化 label（递归 children）。
 * zh-CN 或无任何 labelI18n 时**原引用返回**——缺省渲染与现状逐字节相同（M1 兼容红线）。
 */
export function localizeWidgets(widgets: FormWidget[], locale: Locale): FormWidget[] {
  if (locale === "zh-CN" || !Array.isArray(widgets)) return widgets
  if (!treeHasI18n(widgets)) return widgets
  return widgets.map((w) => localizeOne(w, locale))
}

function treeHasI18n(widgets: FormWidget[]): boolean {
  for (const w of widgets) {
    if (w?.labelI18n) return true
    if (Array.isArray(w?.children) && treeHasI18n(w.children)) return true
  }
  return false
}

function localizeOne(w: FormWidget, locale: Locale): FormWidget {
  const label = pickLabel(w.labelI18n, locale, w.label)
  const children = Array.isArray(w.children) ? w.children.map((c) => localizeOne(c, locale)) : w.children
  if (label === w.label && children === w.children) return w
  return { ...w, label, children }
}

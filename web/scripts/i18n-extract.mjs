#!/usr/bin/env node
/**
 * i18n 静态 key 抽取（i18n M1，docs/design/i18n.md §3.1 + 主控拍板⑤：自研，不用 i18next-parser）。
 *
 * 扫 web/src 下（跳过 test/demo/mock，拍板⑥）所有 t("…") / t('…') / i18n.t("…") 调用，
 * 以整句中文为 key 去重汇总，合并进 src/locales/{en,zh-TW,th,ja}.json：
 *  - 新 key 以空串占位（待 AI 初稿/人工补翻，运行时空串自动回退中文）；
 *  - 已有译文保留不动；json 中已不再被引用的 key 保留（可能来自动态拼接，人工清理）。
 *
 * 用法：node scripts/i18n-extract.mjs [--dry]
 * AI 初稿（dev-time）：把输出的新 key 批量喂 POST /api/ai/translate（≤50 条/次）后回填 json。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = join(ROOT, "src")
const LOCALES_DIR = join(SRC, "locales")
const TARGET_LOCALES = ["en", "zh-TW", "th", "ja"]
const DRY = process.argv.includes("--dry")

/** 拍板⑥豁免：demo 页与离线假数据不译；test 不扫 */
const SKIP_RE = /(\.test\.|\.spec\.|[\\/]demo[\\/]|mock\.ts$|[\\/]locales[\\/])/

/** t("…") / t('…') / i18n.t("…")——key 为整句原文（含 {{插值}}），不跨行 */
const CALL_RE = /(?:^|[^\w.])(?:i18n\.)?t\(\s*(["'])((?:\\.|(?!\1)[^\\\n])+)\1/g

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full
  }
}

/**
 * 动态 key 源（第二遍）：渲染处是 t(x.label)/t(map[k]) 这类**动态 key**，第一遍的字面量
 * 扫描抓不到——其 label 数据表在下列文件里（菜单 title / 枚举→中文映射 / 常量 label 表）。
 * 对这些文件收集**全部中文字符串字面量**为 key（过收集的多余 key 只是闲置，不影响运行时）。
 */
const DYNAMIC_LABEL_FILES = [
  "config/menu.ts",
  "types/workflow.ts",
  "components/layout/header.tsx",
  "components/layout/settings-drawer.tsx",
  "components/layout/tabs-bar.tsx",
  "components/org-picker.tsx",
  "components/file-uploader.tsx",
  "components/data-table/data-table-advanced-filter.tsx",
  "components/wf-op-dialogs.tsx",
  "pages/dashboard/index.tsx",
  "pages/dashboard/use-dashboard-data.ts",
  "pages/workflow/tasks.tsx",
  "pages/workflow/todo.tsx",
  "pages/workflow/done.tsx",
  "pages/workflow/mine.tsx",
  "pages/workflow/instance-detail.tsx",
  "pages/workflow/start.tsx",
  "pages/approval/shared.tsx",
  "pages/approval/create.tsx",
]
const CN_LITERAL_RE = /(["'])((?:\\.|(?!\1)[^\\\n])*[一-鿿](?:\\.|(?!\1)[^\\\n])*)\1/g

const keys = new Set()
let scanned = 0
for (const file of walk(SRC)) {
  if (SKIP_RE.test(file)) continue
  scanned++
  const text = readFileSync(file, "utf8")
  for (const m of text.matchAll(CALL_RE)) {
    const key = m[2].replace(/\\(["'\\])/g, "$1")
    if (key.trim()) keys.add(key)
  }
}
let dynCount = 0
for (const rel of DYNAMIC_LABEL_FILES) {
  const text = readFileSync(join(SRC, rel), "utf8")
  for (const m of text.matchAll(CN_LITERAL_RE)) {
    const key = m[2].replace(/\\(["'\\])/g, "$1")
    if (key.trim() && !keys.has(key)) {
      keys.add(key)
      dynCount++
    }
  }
}

console.log(`扫描 ${scanned} 个文件，抽取 t() 字面量 + 动态 label 源新增 ${dynCount} 个，共 ${keys.size} 个 key`)

for (const locale of TARGET_LOCALES) {
  const file = join(LOCALES_DIR, `${locale}.json`)
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  let added = 0
  for (const key of keys) {
    if (!(key in existing)) {
      existing[key] = "" // 空串占位：运行时 returnEmptyString:false → 回退中文 key
      added++
    }
  }
  const sorted = Object.fromEntries(Object.entries(existing).sort(([a], [b]) => a.localeCompare(b, "zh-CN")))
  if (!DRY) writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n", "utf8")
  console.log(`${relative(ROOT, file)}: +${added} 新 key（共 ${Object.keys(sorted).length}）${DRY ? "（dry-run 未写入）" : ""}`)
}

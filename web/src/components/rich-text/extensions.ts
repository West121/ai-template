/**
 * 富文本能力（feature）→ TipTap extension 组装工厂。
 *
 * 纯逻辑、无 React 依赖，可在 node 环境单测（见 extensions.test.ts）。
 * preset 是 feature 集合的别名（契约 §2）：
 *  - minimal ：加粗 斜体 下划线 删除线 · 有序/无序列表 · 撤销重做（意见/评论）
 *  - standard：minimal + 标题(H2/H3) 引用 行内代码 链接 分隔线 · 对齐 · 高亮 · 清除格式（公文正文/公告）
 *  - full    ：standard + 表格 · 图片 · 任务列表 · 上下标 · 文字颜色（知识文档/示例页）
 *
 * 装配约定：StarterKit 3.27.3 自带 bold/italic/underline/strike/lists/heading/blockquote/code/
 * hr/link/undoRedo…，按 feature 关闭未启用项；starter-kit 之外的能力按需引入独立扩展
 * （table/image/task-list/text-align/highlight/text-style+color/sub/sup，均 3.27.3，不与 starter-kit 重复）。
 * `clearFormat` 是纯工具栏命令（clearNodes+unsetAllMarks），无对应扩展。
 */
import type { AnyExtension } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { CharacterCount, Placeholder } from "@tiptap/extensions"
import { Highlight } from "@tiptap/extension-highlight"
import { Image } from "@tiptap/extension-image"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { Subscript } from "@tiptap/extension-subscript"
import { Superscript } from "@tiptap/extension-superscript"
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table"
import { TextAlign } from "@tiptap/extension-text-align"
import { Color, TextStyle } from "@tiptap/extension-text-style"

/** 可启用的富文本能力（工具栏按钮与扩展装配都由它驱动） */
export type RichTextFeature =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "bulletList"
  | "orderedList"
  | "undoRedo"
  | "heading" // H2/H3
  | "blockquote"
  | "code" // 行内代码
  | "link"
  | "horizontalRule"
  | "align"
  | "highlight"
  | "clearFormat" // 仅工具栏命令，无扩展
  | "table"
  | "image"
  | "taskList"
  | "subsup"
  | "color"

export type RichTextPreset = "minimal" | "standard" | "full"

const MINIMAL: RichTextFeature[] = [
  "bold",
  "italic",
  "underline",
  "strike",
  "bulletList",
  "orderedList",
  "undoRedo",
]

const STANDARD: RichTextFeature[] = [
  ...MINIMAL,
  "heading",
  "blockquote",
  "code",
  "link",
  "horizontalRule",
  "align",
  "highlight",
  "clearFormat",
]

const FULL: RichTextFeature[] = [...STANDARD, "table", "image", "taskList", "subsup", "color"]

/** preset → feature 集合（导出供工具栏/单测使用） */
export const PRESET_FEATURES: Record<RichTextPreset, RichTextFeature[]> = {
  minimal: MINIMAL,
  standard: STANDARD,
  full: FULL,
}

export interface BuildExtensionsOptions {
  placeholder?: string
  /** 字数上限（CharacterCount 硬限制，超出无法继续输入） */
  maxLength?: number
}

/**
 * 按启用能力组装 TipTap 扩展数组。
 * Placeholder / CharacterCount 恒装（占位符与字数统计是编辑器基础设施）。
 */
export function buildExtensions(
  features: RichTextFeature[],
  opts: BuildExtensionsOptions = {},
): AnyExtension[] {
  const has = (f: RichTextFeature) => features.includes(f)
  const hasAnyList = has("bulletList") || has("orderedList")

  const extensions: AnyExtension[] = [
    StarterKit.configure({
      bold: has("bold") ? undefined : false,
      italic: has("italic") ? undefined : false,
      underline: has("underline") ? undefined : false,
      strike: has("strike") ? undefined : false,
      bulletList: has("bulletList") ? undefined : false,
      orderedList: has("orderedList") ? undefined : false,
      listItem: hasAnyList ? undefined : false,
      listKeymap: hasAnyList ? undefined : false,
      undoRedo: has("undoRedo") ? undefined : false,
      heading: has("heading") ? { levels: [2, 3] } : false,
      blockquote: has("blockquote") ? undefined : false,
      code: has("code") ? undefined : false,
      // 代码块超出契约能力清单，恒关（行内代码由 code 承担）
      codeBlock: false,
      horizontalRule: has("horizontalRule") ? undefined : false,
      link: has("link") ? { openOnClick: false } : false,
    }),
    Placeholder.configure({ placeholder: opts.placeholder ?? "" }),
    CharacterCount.configure({ limit: opts.maxLength }),
  ]

  if (has("align")) {
    extensions.push(TextAlign.configure({ types: ["paragraph", "heading"] }))
  }
  if (has("highlight")) {
    extensions.push(Highlight)
  }
  if (has("color")) {
    extensions.push(TextStyle, Color)
  }
  if (has("table")) {
    extensions.push(Table.configure({ resizable: false }), TableRow, TableHeader, TableCell)
  }
  if (has("image")) {
    extensions.push(Image)
  }
  if (has("taskList")) {
    extensions.push(TaskList, TaskItem.configure({ nested: true }))
  }
  if (has("subsup")) {
    extensions.push(Subscript, Superscript)
  }

  return extensions
}

/** 解析 preset / features 入参：features 优先，否则取 preset（缺省 standard） */
export function resolveFeatures(
  preset?: RichTextPreset,
  features?: RichTextFeature[],
): RichTextFeature[] {
  if (features && features.length > 0) return features
  return PRESET_FEATURES[preset ?? "standard"]
}

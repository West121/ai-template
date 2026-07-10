/**
 * 通用富文本组件体系（契约 docs/design/rich-text-component.md）。
 *
 * - RichTextEditor：受控编辑器（preset minimal/standard/full 或 features 定制）
 * - RichTextViewer：富文本 HTML 唯一渲染出口（内部 sanitize + prose）
 * - stripHtml / isEmptyHtml / normalizeRichText：纯文本摘要 / 空文档归一
 * - PRESET_FEATURES / buildExtensions：能力集与扩展装配（高级定制/单测）
 */
export { RichTextEditor, type RichTextEditorProps } from "./editor"
export { RichTextViewer } from "./viewer"
export { stripHtml, isEmptyHtml, normalizeRichText } from "./strip-html"
export {
  PRESET_FEATURES,
  buildExtensions,
  resolveFeatures,
  type RichTextFeature,
  type RichTextPreset,
} from "./extensions"

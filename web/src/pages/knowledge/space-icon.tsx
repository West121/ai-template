/**
 * 知识空间图标容错渲染。
 *
 * 空间 icon 模型是 emoji（新建弹窗只输入 emoji），但历史种子数据里存过 lucide 组件名
 * （如 "BookOpen"/"Boxes"）。若直接把字符串塞进文本节点，lucide 名会被当字面文本渲染出来。
 * 这里统一容错：lucide 名 → 对应图标组件（未知名 → 兜底文件夹）；emoji/其它文本 → 原样；空 → 📁。
 */
import { Archive, BookOpen, Boxes, Briefcase, Building2, FileText, Folder, FolderOpen, Library, Lock, NotebookPen, Package, Rocket, Users, type LucideIcon } from "lucide-react"

/** 常见空间图标（历史种子/可能的 lucide 命名）→ 组件 */
const LUCIDE_MAP: Record<string, LucideIcon> = {
  BookOpen,
  Boxes,
  Briefcase,
  Building2,
  Building: Building2,
  FileText,
  Folder,
  FolderOpen,
  Library,
  Lock,
  NotebookPen,
  Package,
  Rocket,
  Users,
  Archive,
}

/** 纯 ASCII 标识符（≥2 位、字母开头）视为 lucide 组件名，而非 emoji */
const isLucideName = (s: string) => /^[A-Za-z][A-Za-z0-9]+$/.test(s)

/**
 * @param icon 空间 icon 字段（emoji 或 lucide 名，可空）
 * @param size lucide 图标尺寸类（emoji 不用，走 emojiClassName / 父级 text-*）
 * @param emojiClassName emoji 文本的额外类（如 text-xl）
 */
export function SpaceIcon({ icon, size = "size-6", emojiClassName }: { icon?: string | null; size?: string; emojiClassName?: string }) {
  const v = (icon ?? "").trim()
  if (v && isLucideName(v)) {
    const Ic = LUCIDE_MAP[v] ?? Folder
    return <Ic className={size} aria-hidden />
  }
  return <span className={emojiClassName}>{v || "📁"}</span>
}

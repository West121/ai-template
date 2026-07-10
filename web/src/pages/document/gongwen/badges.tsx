/**
 * 编辑 UI / 列表 / 台账用彩色徽标（跟随主题，非公文纸内的黑体标注）。
 * 视觉规范见 docs/design/gongwen-format-spec.md §8。
 */
import { ArrowUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { SECRET_META, URGENCY_META, statusMeta, type GwDirection } from "./types"

export function SecretBadge({ secret }: { secret: string }) {
  const meta = SECRET_META[secret] ?? SECRET_META.PUBLIC
  const star = secret === "SECRET" || secret === "CONFIDENTIAL" ? "★" : ""
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
      {star}
    </Badge>
  )
}

export function UrgencyBadge({ urgency }: { urgency: string }) {
  if (!urgency || urgency === "NORMAL") {
    return <span className="text-xs text-muted-foreground">普通</span>
  }
  const meta = URGENCY_META[urgency] ?? URGENCY_META.NORMAL
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  )
}

/** 文种徽标（低饱和中性蓝；上行文加 ↑ 提示） */
export function DocTypeBadge({ docType }: { docType: string }) {
  const upward = docType === "请示" || docType === "报告"
  return (
    <Badge variant="outline" className="gap-0.5 border-blue-500/30 bg-blue-500/10 text-blue-600">
      {upward && <ArrowUp className="size-3" />}
      {docType}
    </Badge>
  )
}

export function GwStatusBadge({ direction, status }: { direction: GwDirection; status: string }) {
  const meta = statusMeta(direction, status)
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  )
}

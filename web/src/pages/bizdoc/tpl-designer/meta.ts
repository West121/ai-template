/** 块类型元数据与 DnD 常量（独立文件，避免与组件混导出破坏 Fast Refresh） */
import type { LucideIcon } from "lucide-react"
import {
  AlignVerticalSpaceAround,
  Columns2,
  Grid3x3,
  Heading1,
  Image,
  Info,
  ListOrdered,
  Minus,
  QrCode,
  ScanBarcode,
  Stamp,
  Table2,
  TextCursorInput,
  Type,
} from "lucide-react"
import type { BdBlockType } from "@/components/bizdoc/model-v2"

export const BLOCK_META: Record<BdBlockType, { label: string; icon: LucideIcon }> = {
  row: { label: "行容器", icon: Columns2 },
  title: { label: "文档标题", icon: Heading1 },
  docInfo: { label: "单据信息", icon: Info },
  infoTable: { label: "智能表格", icon: Grid3x3 },
  labelField: { label: "标签字段", icon: TextCursorInput },
  text: { label: "智能文本", icon: Type },
  detailTable: { label: "明细表格", icon: ListOrdered },
  approvalTable: { label: "审批区域", icon: Table2 },
  signature: { label: "签章", icon: Stamp },
  qrcode: { label: "二维码", icon: QrCode },
  barcode: { label: "条形码", icon: ScanBarcode },
  image: { label: "图片", icon: Image },
  divider: { label: "分割线", icon: Minus },
  spacer: { label: "空白间距", icon: AlignVerticalSpaceAround },
}

export const DND_NEW = "application/x-bd-new"
export const DND_MOVE = "application/x-bd-move"

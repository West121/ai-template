/**
 * 公文列表/台账共用：后端未连接演示提示条 + 筛选栏（密级/紧急/文种/状态/日期）。
 */
import { CloudOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DOC_TYPES,
  RECV_STATUS_META,
  SEND_STATUS_META,
  type GwDirection,
} from "./types"

/** 后端未连接时的演示数据提示（不阻断，页面照常用 mock 呈现） */
export function DemoBanner() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
      <CloudOff className="size-4 shrink-0" />
      <span>
        后端未连接，当前为<strong>演示数据</strong>。启动 server/ 并接入 /api/office/doc 后自动切换为真实公文数据（办文流转、文号占号、红头 render）。
      </span>
    </div>
  )
}

export interface GwFilterState {
  secret: string
  urgency: string
  docType: string
  status: string
  dateFrom: string
  dateTo: string
}

export const EMPTY_FILTER: GwFilterState = {
  secret: "all",
  urgency: "all",
  docType: "all",
  status: "all",
  dateFrom: "",
  dateTo: "",
}

export function GwFilterBar({
  direction,
  value,
  onChange,
}: {
  direction: GwDirection
  value: GwFilterState
  onChange: (next: GwFilterState) => void
}) {
  const statusMap = direction === "SEND" ? SEND_STATUS_META : RECV_STATUS_META
  const set = (patch: Partial<GwFilterState>) => onChange({ ...value, ...patch })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value.secret} onValueChange={(v) => set({ secret: v })}>
        <SelectTrigger size="sm" className="h-8 w-24 text-sm">
          <SelectValue placeholder="密级" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部密级</SelectItem>
          <SelectItem value="PUBLIC">公开</SelectItem>
          <SelectItem value="INTERNAL">内部</SelectItem>
          <SelectItem value="SECRET">秘密</SelectItem>
          <SelectItem value="CONFIDENTIAL">机密</SelectItem>
        </SelectContent>
      </Select>

      <Select value={value.urgency} onValueChange={(v) => set({ urgency: v })}>
        <SelectTrigger size="sm" className="h-8 w-24 text-sm">
          <SelectValue placeholder="紧急" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部缓急</SelectItem>
          <SelectItem value="NORMAL">普通</SelectItem>
          <SelectItem value="URGENT">加急</SelectItem>
          <SelectItem value="EXTRA">特急</SelectItem>
        </SelectContent>
      </Select>

      <Select value={value.docType} onValueChange={(v) => set({ docType: v })}>
        <SelectTrigger size="sm" className="h-8 w-24 text-sm">
          <SelectValue placeholder="文种" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部文种</SelectItem>
          {DOC_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={value.status} onValueChange={(v) => set({ status: v })}>
        <SelectTrigger size="sm" className="h-8 w-28 text-sm">
          <SelectValue placeholder="状态" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          {Object.entries(statusMap).map(([k, m]) => (
            <SelectItem key={k} value={k}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="date"
        value={value.dateFrom}
        onChange={(e) => set({ dateFrom: e.target.value })}
        className="h-8 w-36 text-sm"
        title="起始日期"
      />
      <span className="text-xs text-muted-foreground">至</span>
      <Input
        type="date"
        value={value.dateTo}
        onChange={(e) => set({ dateTo: e.target.value })}
        className="h-8 w-36 text-sm"
        title="结束日期"
      />
    </div>
  )
}

/** 把筛选栏状态映射为 fetchDocList 查询参数（all/空 → undefined） */
export function toListQuery(direction: GwDirection, f: GwFilterState) {
  return {
    direction,
    secret: f.secret === "all" ? undefined : f.secret,
    urgency: f.urgency === "all" ? undefined : f.urgency,
    docType: f.docType === "all" ? undefined : f.docType,
    status: f.status === "all" ? undefined : f.status,
    dateFrom: f.dateFrom || undefined,
    dateTo: f.dateTo || undefined,
  }
}

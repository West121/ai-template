/**
 * 公文列表/台账 筛选状态与查询映射（纯逻辑，无组件）。
 * 从 shared.tsx 拆出，使 shared.tsx 只导出组件 —— 满足 react-refresh only-export-components。
 */
import type { GwDirection } from "./types"

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

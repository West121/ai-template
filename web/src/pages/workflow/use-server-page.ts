/**
 * 「我的审批」各 Tab 共用的服务端分页 hook。
 *
 * 背景：todo/done/cc/mine/draft 原先都是一次 `pageNum=1&pageSize=100` 拉全量 + DataTable 本地分页，
 * 数据一多（160+ 实例）分页即废。本 hook 接 DataTable 的 `serverPagination` 受控模式：
 *  - pageIndex 0-based（DataTable 约定）↔ 后端 pageNum 1-based（+1 换算）。
 *  - 翻页/改 pageSize 触发重拉；total 驱动页数。
 *  - 刷新/办理后保持当前页；**越界自动回退最后一页**（如末页最后一条办理完）。
 *  - offline → "network" 降级；切换身份（activeAssignmentId）回第一页重拉。
 *
 * 注意：todo/done-by-me/my/cc/drafts 后端均**无 keyword 参数**（见 WfTaskController/InstanceController），
 * 故不接 serverSearch，各 Tab 保留 DataTable 本地 quick search（只对当前页生效）。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

export interface ServerPage<T> {
  rows: T[]
  total: number
  loading: boolean
  loadError: string | null
  /** 0-based（DataTable serverPagination 约定） */
  pageIndex: number
  pageSize: number
  /** 接 DataTable serverPagination.onPaginationChange */
  onPaginationChange: (pageIndex: number, pageSize: number) => void
  /** 重拉当前页（刷新 / 办理后调用；越界自动回退最后一页） */
  reload: () => void
}

export function useServerPage<T>(
  /** 构造请求 URL；pageNum 为 1-based */
  buildUrl: (pageNum: number, pageSize: number) => string,
  opts?: {
    initialPageSize?: number
    /** 每次成功拉取回调（如 todo 用 page.total 上报徽标） */
    onPage?: (page: PageResult<T>) => void
  },
): ServerPage<T> {
  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)
  const [rows, setRows] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(opts?.initialPageSize ?? 10)

  // 回调/URL 构造走 ref：调用方每次渲染新建闭包也不触发重拉
  const onPageRef = useRef(opts?.onPage)
  onPageRef.current = opts?.onPage
  const buildUrlRef = useRef(buildUrl)
  buildUrlRef.current = buildUrl
  // 竞态守卫：只应用最后一次请求的结果
  const seqRef = useRef(0)

  const load = useCallback(async (pi: number, ps: number) => {
    const seq = ++seqRef.current
    setLoading(true)
    setLoadError(null)
    try {
      let page = await api<PageResult<T>>(buildUrlRef.current(pi + 1, ps))
      // 越界回退：当前页为空但仍有数据（如末页最后一条被办理掉）→ 拉最后一页
      if (page.list.length === 0 && page.total > 0 && pi > 0) {
        const last = Math.max(0, Math.ceil(page.total / ps) - 1)
        if (last !== pi) {
          page = await api<PageResult<T>>(buildUrlRef.current(last + 1, ps))
          if (seq === seqRef.current) setPageIndex(last)
        }
      }
      if (seq !== seqRef.current) return
      setRows(page.list)
      setTotal(page.total)
      onPageRef.current?.(page)
    } catch (err) {
      if (seq !== seqRef.current) return
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [])

  // 切换身份：数据权限变化，回第一页
  const assignRef = useRef(activeAssignmentId)
  useEffect(() => {
    if (assignRef.current !== activeAssignmentId) {
      assignRef.current = activeAssignmentId
      setPageIndex(0)
    }
  }, [activeAssignmentId])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load(pageIndex, pageSize)
  }, [load, offline, activeAssignmentId, pageIndex, pageSize])

  const onPaginationChange = useCallback((pi: number, ps: number) => {
    setPageIndex(pi)
    setPageSize(ps)
  }, [])

  const reload = useCallback(() => void load(pageIndex, pageSize), [load, pageIndex, pageSize])

  return { rows, total, loading, loadError, pageIndex, pageSize, onPaginationChange, reload }
}

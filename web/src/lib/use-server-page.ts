/**
 * 服务端分页通用 hook（DataTable serverPagination/serverSearch 受控模式的取数侧）。
 *
 * 始于「我的审批」各 Tab（原 pages/workflow/use-server-page.ts），泛化后供公文列表/台账、
 * 流程监控等所有真分页列表复用：
 *  - pageIndex 0-based（DataTable 约定）↔ 后端 pageNum 1-based（+1 换算）。
 *  - 翻页/改 pageSize 触发重拉；total 驱动页数；**越界自动回退最后一页**（末页最后一条被办掉/删掉）。
 *  - `resetKey` 变化（筛选/关键词变了）→ 回第一页重拉；切换身份（activeAssignmentId）同。
 *  - 取数源二选一：返回 URL 字符串（内部 api<PageResult>）或直接返回 Promise<PageResult>
 *    （如公文 mock 层 withMock 降级——offline 也要出 mock 数据时配 `offlineFetch: true`）。
 *  - 竞态守卫：只应用最后一次请求结果。
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

/** 取数源：返回 URL（内部走 api）或直接返回 PageResult（自带降级/mock 的取数层） */
export type ServerPageSource<T> = (pageNum: number, pageSize: number) => string | Promise<PageResult<T>>

export function useServerPage<T>(
  source: ServerPageSource<T>,
  opts?: {
    initialPageSize?: number
    /** 每次成功拉取回调（如 todo 用 page.total 上报徽标） */
    onPage?: (page: PageResult<T>) => void
    /** 筛选/关键词等外部条件的指纹：变化即回第一页重拉 */
    resetKey?: string | number
    /** true=offline 也调用 source（取数层自带 mock 降级，如公文 withMock）；默认 offline 直接报 network */
    offlineFetch?: boolean
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

  // 回调/取数源走 ref：调用方每次渲染新建闭包也不触发重拉；load 始终用最新闭包
  const onPageRef = useRef(opts?.onPage)
  onPageRef.current = opts?.onPage
  const sourceRef = useRef(source)
  sourceRef.current = source
  // 竞态守卫：只应用最后一次请求的结果
  const seqRef = useRef(0)

  const fetchPage = useCallback(async (pageNum: number, size: number): Promise<PageResult<T>> => {
    const r = sourceRef.current(pageNum, size)
    return typeof r === "string" ? api<PageResult<T>>(r) : r
  }, [])

  const load = useCallback(
    async (pi: number, ps: number) => {
      const seq = ++seqRef.current
      setLoading(true)
      setLoadError(null)
      try {
        let page = await fetchPage(pi + 1, ps)
        // 越界回退：当前页为空但仍有数据 → 拉最后一页
        if (page.list.length === 0 && page.total > 0 && pi > 0) {
          const last = Math.max(0, Math.ceil(page.total / ps) - 1)
          if (last !== pi) {
            page = await fetchPage(last + 1, ps)
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
    },
    [fetchPage],
  )

  // 切换身份 / resetKey 变化：回第一页
  const assignRef = useRef(activeAssignmentId)
  const resetRef = useRef(opts?.resetKey)
  useEffect(() => {
    if (assignRef.current !== activeAssignmentId) {
      assignRef.current = activeAssignmentId
      setPageIndex(0)
    }
  }, [activeAssignmentId])
  const resetKey = opts?.resetKey
  useEffect(() => {
    if (resetRef.current !== resetKey) {
      resetRef.current = resetKey
      setPageIndex(0)
    }
  }, [resetKey])

  const offlineFetch = opts?.offlineFetch ?? false
  useEffect(() => {
    if (offline && !offlineFetch) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load(pageIndex, pageSize)
  }, [load, offline, offlineFetch, activeAssignmentId, pageIndex, pageSize, resetKey])

  const onPaginationChange = useCallback((pi: number, ps: number) => {
    setPageIndex(pi)
    setPageSize(ps)
  }, [])

  const reload = useCallback(() => void load(pageIndex, pageSize), [load, pageIndex, pageSize])

  return { rows, total, loading, loadError, pageIndex, pageSize, onPaginationChange, reload }
}

/** 关键词防抖（serverSearch 输入 → 查询指纹），默认 300ms */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

import { useCallback, useEffect, useRef, useState } from "react"
import type { DependencyList, Dispatch, SetStateAction } from "react"
import { ApiError, NetworkError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

/**
 * 统一的「加载 / 离线降级 / 错误」三态数据 hook。
 *
 * 取代各页面手写的 `data/loading/loadError` + `instanceof NetworkError` + `setLoading`
 * 样板（原本 35 个页面重复）。内部读取 auth-store 的 `offline`（离线演示模式）短路为
 * 网络降级态；请求抛 `NetworkError` → `offline`，抛 `ApiError`/其它 `Error` → `error`。
 *
 * 返回值配合 `<OfflineFallback>` / `<ErrorState>` 两个共享组件即可覆盖全部降级 UI。
 *
 * ── 页面迁移步骤（照此把剩余页面从手写样板迁到本 hook）────────────────────────
 * 1. 删除 `const [data,setData]=useState()` / `[loading,setLoading]` / `[loadError,setLoadError]`
 *    三组 state，以及页面里的 `const offline = useAuthStore((s)=>s.offline)`（hook 内部已读）。
 * 2. 把原来的 `load = useCallback(async()=>{ setLoading(true); try{ setData(await api(...)) }
 *    catch(...) finally{...} }, [deps])` + 紧随其后的 `useEffect(()=>{ if(offline){...} else load() },
 *    [load, offline, ...])` 整体替换为：
 *      const { data, loading, error, offline, reload, setData } =
 *        useApiData<T>(() => api<T>(`...${filterA}...`), [filterA, filterB])
 *    —— fetcher 里直接闭包引用筛选/月份等状态；把它们列进第二个参数 deps（就是原来 load 的依赖）。
 * 3. 离线卡片 `loadError === "network"` 分支 → `<OfflineFallback description="…" onRetry={reload} />`。
 * 4. 错误卡片 `loadError`（其它）分支 → `<ErrorState message={error} onRetry={reload} />`。
 * 5. 数据为可空：`data` 类型是 `T | null`，列表页用 `const rows = data ?? []`。
 * 6. 操作后刷新：原来的 `void load()` → `reload()`；乐观更新用返回的 `setData`（如
 *    `setData((prev) => prev ? prev.map(...) : prev)`）。
 * 7. 页面描述文案里原来的 `offline || loadError === "network"` 判断 → 直接用返回的 `offline`。
 * ───────────────────────────────────────────────────────────────────────────
 */
export interface UseApiDataResult<T> {
  /** 成功加载的数据；尚未加载或加载失败时为 null */
  data: T | null
  /** 请求进行中 */
  loading: boolean
  /** 业务/HTTP 错误消息（非网络层）；无错误时为 null */
  error: string | null
  /** 离线降级态：auth-store 处于离线演示模式，或请求抛出 NetworkError（后端未连接） */
  offline: boolean
  /** 手动重试（重新执行 fetcher） */
  reload: () => void
  /** 直接改写数据（乐观更新用） */
  setData: Dispatch<SetStateAction<T | null>>
}

export function useApiData<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList = [],
): UseApiDataResult<T> {
  const authOffline = useAuthStore((s) => s.offline)
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [networkDown, setNetworkDown] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  // 保持 fetcher 最新引用，避免把每次渲染新建的闭包塞进依赖数组
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const reload = useCallback(() => setReloadTick((n) => n + 1), [])

  useEffect(() => {
    // 离线（auth-store 演示模式）直接短路为网络降级态，不发请求
    if (authOffline) {
      setLoading(false)
      setError(null)
      setNetworkDown(true)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    setNetworkDown(false)
    void fetcherRef
      .current()
      .then((result) => {
        if (alive) setData(result)
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (err instanceof NetworkError) setNetworkDown(true)
        else if (err instanceof ApiError) setError(err.message)
        else setError(err instanceof Error ? err.message : "加载失败")
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // fetcher 经 ref 读取最新值；真实依赖由调用方通过 deps 声明（筛选/月份等）。
    // reloadTick 驱动手动重试，authOffline 驱动离线态切换。deps 展开是自定义 hook
    // 转发依赖的既定写法，oxlint 无法静态分析，故此处冻结依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authOffline, reloadTick, ...deps])

  return { data, loading, error, offline: networkDown, reload, setData }
}

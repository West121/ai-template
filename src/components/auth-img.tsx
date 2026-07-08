import { useEffect, useState } from "react"
import { useAuthStore } from "@/stores/auth-store"

/**
 * 带鉴权的图片：需 Bearer token 的 /api 图片（文件管理、印章、表单 image 控件预览等）
 * 直接 <img src> 无法带 Authorization，会 401/占位。此组件先 fetch（带 token）拿 blob，
 * 再 URL.createObjectURL 本地引用；组件卸载或 src 变更时 revoke，避免内存泄漏。
 *
 * 绝对外链 / dataURL / blob 直接使用；fetch 失败回退直连（可能匿名可访问）。
 */
export function AuthImg({
  src,
  alt,
  className,
  fallback,
}: {
  src: string
  alt: string
  className?: string
  /** 加载中/失败时的占位内容（默认渲染 alt 首字） */
  fallback?: React.ReactNode
}) {
  const token = useAuthStore((s) => s.token)
  const offline = useAuthStore((s) => s.offline)
  const [resolved, setResolved] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    // 绝对外链或 dataURL 直接用
    if (!src || /^(https?:|data:|blob:)/.test(src)) {
      setResolved(src)
      return
    }
    let revoked: string | null = null
    let aborted = false
    void (async () => {
      try {
        const res = await fetch(src, {
          headers: token && !offline ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        if (aborted) return
        revoked = URL.createObjectURL(blob)
        setResolved(revoked)
      } catch {
        if (!aborted) {
          setResolved(src) // 回退直连（可能匿名可访问）
        }
      }
    })()
    return () => {
      aborted = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [src, token, offline])

  if (failed || !resolved) {
    return (
      <div className={className} aria-label={alt} title={alt}>
        {fallback ?? (
          <span className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
            {alt?.[0] ?? "图"}
          </span>
        )}
      </div>
    )
  }
  return <img src={resolved} alt={alt} className={className} onError={() => setFailed(true)} />
}

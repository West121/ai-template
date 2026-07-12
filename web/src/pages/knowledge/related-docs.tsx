/**
 * 相关文档侧栏/底部区（§9.2）：GET /docs/{id}/related → 相似文档，点击跳转。
 * 空数组 / 403 / 非 DOC 一律不渲染（容错，不占位）。防白屏：调用方再包 ErrorBoundary。
 */
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FileText, Sparkles } from "lucide-react"
import { fetchRelated } from "./mock"
import type { RelatedDoc } from "./types"

export function RelatedDocs({ docId }: { docId: number | null }) {
  const navigate = useNavigate()
  const [items, setItems] = useState<RelatedDoc[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (docId == null) {
      setItems([])
      return
    }
    let alive = true
    setLoading(true)
    fetchRelated(docId, 5)
      .then((r) => {
        if (alive) setItems(Array.isArray(r.data) ? r.data : [])
      })
      .catch(() => {
        if (alive) setItems([]) // 403 / 空 容错：静默隐藏
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [docId])

  if (docId == null || loading || items.length === 0) return null

  return (
    <div className="rounded-xl border bg-card p-3.5">
      <div className="mb-2.5 flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="size-4 text-primary" /> 相关文档
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((r) => (
          <button
            key={r.docId}
            type="button"
            onClick={() => navigate(`/knowledge/${r.spaceId}?doc=${r.docId}`)}
            className="flex items-start gap-2 rounded-md border px-2.5 py-2 text-left hover:bg-accent"
          >
            <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate text-sm">{r.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">{r.spaceName}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

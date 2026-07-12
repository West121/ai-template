/**
 * 知识库搜索弹窗（§9.1）：关键词 → POST /api/kb/search 结果列表（title/spaceName/snippet 高亮/matchedBy/score）。
 * 点击结果跳 /knowledge/{spaceId}?doc={docId}。分页；空数组容错。snippet 含 <mark>，经 sanitizeHtml 后注入。
 * spaceId 传入=限定单空间，缺省=全库（仅可见空间由后端/mock 过滤）。
 */
import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, Search } from "lucide-react"
import { sanitizeHtml } from "@/lib/sanitize"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { searchKb } from "./mock"
import { MATCHED_BY_META, type SearchHit } from "./types"

const PAGE_SIZE = 8

export function KbSearchDialog({
  open,
  onOpenChange,
  spaceId,
  spaceName,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  spaceId?: number
  spaceName?: string
}) {
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const run = useCallback(
    (query: string, page: number) => {
      if (!query.trim()) {
        setHits([])
        setTotal(0)
        setSearched(false)
        return
      }
      setLoading(true)
      searchKb({ q: query.trim(), spaceId, pageNum: page, pageSize: PAGE_SIZE })
        .then((r) => {
          const d = r.data
          setHits(Array.isArray(d?.list) ? d.list : [])
          setTotal(d?.total ?? 0)
          setSearched(true)
        })
        .catch(() => {
          setHits([])
          setTotal(0)
          setSearched(true)
        })
        .finally(() => setLoading(false))
    },
    [spaceId],
  )

  // 输入防抖
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setPageNum(1)
      run(q, 1)
    }, 300)
    return () => clearTimeout(t)
  }, [q, open, run])

  // 打开重置
  useEffect(() => {
    if (open) {
      setQ("")
      setHits([])
      setTotal(0)
      setPageNum(1)
      setSearched(false)
    }
  }, [open])

  const openHit = (h: SearchHit) => {
    onOpenChange(false)
    navigate(`/knowledge/${h.spaceId}?doc=${h.docId}`)
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const goto = (p: number) => {
    setPageNum(p)
    run(q, p)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>搜索知识库{spaceName ? ` · ${spaceName}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入关键词搜索文档标题与正文…" className="pl-8" aria-label="搜索关键词" />
        </div>
        <div className="max-h-[50vh] min-h-[8rem] space-y-1.5 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">
              <Loader2 className="mx-auto size-4 animate-spin" />
            </div>
          ) : !searched ? (
            <div className="py-8 text-center text-sm text-muted-foreground">输入关键词开始搜索</div>
          ) : hits.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">未找到匹配「{q.trim()}」的文档</div>
          ) : (
            hits.map((h) => (
              <button key={h.docId} type="button" onClick={() => openHit(h)} className="block w-full rounded-md border px-3 py-2 text-left hover:bg-accent">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{h.title}</span>
                  {MATCHED_BY_META[h.matchedBy] && (
                    <Badge variant="outline" className={cn("h-4 shrink-0 px-1 text-[10px]", MATCHED_BY_META[h.matchedBy].className)}>
                      {MATCHED_BY_META[h.matchedBy].label}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{h.spaceName}</div>
                {h.snippet && (
                  <p
                    className="mt-1 line-clamp-2 text-xs text-muted-foreground [&_mark]:rounded [&_mark]:bg-primary/20 [&_mark]:px-0.5 [&_mark]:text-foreground"
                    // eslint-disable-next-line react/no-danger — snippet 经 sanitizeHtml 净化（仅保留 <mark> 等安全标签）
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(h.snippet) }}
                  />
                )}
              </button>
            ))
          )}
        </div>
        {searched && total > PAGE_SIZE && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>共 {total} 条</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7" disabled={pageNum <= 1} onClick={() => goto(pageNum - 1)}>
                上一页
              </Button>
              <span>
                {pageNum}/{pages}
              </span>
              <Button variant="outline" size="sm" className="h-7" disabled={pageNum >= pages} onClick={() => goto(pageNum + 1)}>
                下一页
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

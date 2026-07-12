/**
 * 知识库空间列表页（/knowledge）：可见空间卡片网格 + 新建空间。
 * 数据经 mock（后端 /api/kb/spaces 仅回可见空间）；offline/未连后端 → 演示数据 + 提示条。
 */
import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FileText, Plus, Search, Users } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorBoundary } from "@/components/error-boundary"
import { fetchSpaces } from "./mock"
import { KbDemoBanner } from "./kb-ui"
import { KbSearchDialog } from "./kb-search"
import { SpaceDialog } from "./space-dialog"
import { VISIBILITY_META, type KbSpace } from "./types"

export default function KnowledgeSpaceListPage() {
  const navigate = useNavigate()
  const [spaces, setSpaces] = useState<KbSpace[]>([])
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetchSpaces()
      .then((r) => {
        setSpaces(Array.isArray(r.data) ? r.data : [])
        setDemo(r.demo)
      })
      .catch(() => setSpaces([]))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  return (
    <div className="space-y-4">
      <PageHeader
        title="知识库"
        description="企业知识空间：建库、分权、沉淀文档。"
        actions={
          <>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSearchOpen(true)}>
              <Search className="size-4" /> 搜索
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" /> 新建空间
            </Button>
          </>
        }
      />
      {demo && <KbDemoBanner />}
      <ErrorBoundary label="kb-space-list">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : spaces.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
              <FileText className="size-8 opacity-40" />
              还没有你可见的知识空间
              <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
                <Plus className="size-4" /> 新建空间
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {spaces.map((s) => (
              <button key={s.id} type="button" onClick={() => navigate(`/knowledge/${s.id}`)} className="text-left">
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start gap-3">
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-2xl">{s.icon || "📁"}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-semibold">{s.name}</h3>
                          {VISIBILITY_META[s.visibility] && (
                            <Badge variant="outline" className={VISIBILITY_META[s.visibility].className}>
                              {VISIBILITY_META[s.visibility].label}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.description || "暂无描述"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="size-3.5" /> {s.memberCount ?? 0} 成员
                      </span>
                      <span className="flex items-center gap-1">
                        <FileText className="size-3.5" /> {s.docCount ?? 0} 文档
                      </span>
                      {s.ownerName && <span className="ml-auto truncate">负责人 {s.ownerName}</span>}
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        )}
      </ErrorBoundary>
      <SpaceDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={() => load()} />
      <KbSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}

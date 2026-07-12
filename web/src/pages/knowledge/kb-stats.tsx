/**
 * 知识库统计概览（批5 集成收尾）：可见空间/文档/可编空间/标签 计数 + 最近更新文档。
 * mock 先行（磐石批5 GET /api/kb/stats 随后）；空/失败静默隐藏（防白屏，不占位）。
 */
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FileText, FolderOpen, PencilLine, Tag } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { fetchKbStats } from "./mock"
import type { KbStats } from "./types"

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
      <div className="min-w-0">
        <div className="text-lg font-semibold tabular-nums leading-none">{value}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  )
}

export function KbStatsOverview() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<KbStats | null>(null)

  useEffect(() => {
    let alive = true
    fetchKbStats()
      .then((r) => alive && setStats(r.data))
      .catch(() => alive && setStats(null))
    return () => {
      alive = false
    }
  }, [])

  if (!stats) return null

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
        <StatTile icon={<FolderOpen className="size-4.5" />} label="知识空间" value={stats.spaceCount} />
        <StatTile icon={<FileText className="size-4.5" />} label="文档" value={stats.docCount} />
        <StatTile icon={<PencilLine className="size-4.5" />} label="可编辑空间" value={stats.editableSpaceCount} />
        <StatTile icon={<Tag className="size-4.5" />} label="标签" value={stats.tagCount} />
      </div>
      {stats.recentDocs.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">最近更新</div>
            <ul className="space-y-0.5">
              {stats.recentDocs.map((d) => (
                <li key={d.docId}>
                  <button
                    type="button"
                    onClick={() => navigate(`/knowledge/${d.spaceId}?doc=${d.docId}`)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent"
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    <span className="shrink-0 truncate text-[11px] text-muted-foreground">{d.spaceName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

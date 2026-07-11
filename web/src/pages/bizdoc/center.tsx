/**
 * 单据中心（丹青 §4.1）：已发布定义入口卡片墙 → 各自运行时台账 /bizdoc/run/:defCode。
 * 按 category 分组；offline/未就绪走 mock 演示定义。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Car, ChevronRight, FileSpreadsheet, Receipt, type LucideIcon } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuthStore } from "@/stores/auth-store"
import { DemoBanner } from "@/pages/document/gongwen/shared"
import { fetchDefs, type BizDocDef } from "./mock"

const ICONS: Record<string, LucideIcon> = { receipt: Receipt, car: Car }

export default function BizdocCenterPage() {
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const [defs, setDefs] = useState<BizDocDef[]>([])
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchDefs()
      setDefs(res.data.filter((d) => d.status === "PUBLISHED"))
      setDemo(res.demo)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, offline])

  const groups = useMemo(() => {
    const map = new Map<string, BizDocDef[]>()
    for (const d of defs) {
      const cat = d.category?.trim() || "通用"
      map.set(cat, [...(map.get(cat) ?? []), d])
    }
    return [...map.entries()]
  }, [defs])

  return (
    <div className="space-y-4">
      <PageHeader title="单据中心" description="在线定义的业务单据：填单、送审、编号、打印，一站办理" />
      {demo && <DemoBanner />}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : defs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <FileSpreadsheet className="size-8 opacity-40" />
          <p className="text-sm">暂无可用单据，请联系管理员发布</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([cat, list]) => (
            <section key={cat}>
              <div className="mb-2.5 text-xs font-medium text-muted-foreground">{cat}</div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {list.map((def) => {
                  const Icon = ICONS[def.icon ?? ""] ?? FileSpreadsheet
                  return (
                    <button
                      key={def.code}
                      type="button"
                      onClick={() => navigate(`/bizdoc/run/${def.code}`)}
                      className="group flex items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium group-hover:text-primary">{def.name}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{def.remark || def.category || "通用"}</p>
                        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {def.wfDefCode && (
                            <Badge variant="outline" className="h-4.5 px-1.5 text-[10px]">
                              审批流
                            </Badge>
                          )}
                          {def.numberRuleId != null && (
                            <Badge variant="outline" className="h-4.5 px-1.5 text-[10px]">
                              自动编号
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

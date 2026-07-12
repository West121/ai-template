/**
 * 工作台入口（变薄的路由层）：读 app-store 的 dashboardStyle → 渲染风格A「经典」或风格B「聚焦」。
 * 右上角放 A/B 切换器（持久化）。两个风格各自包 ErrorBoundary，坏数据只局部降级不白屏。
 */
import { LayoutGrid, Sparkles } from "lucide-react"
import { ErrorBoundary } from "@/components/error-boundary"
import { cn } from "@/lib/utils"
import { useAppStore, type DashboardStyle } from "@/stores/app-store"
import { DashboardClassic } from "./dashboard-classic"
import { DashboardFocus } from "./dashboard-focus"

const OPTIONS: { key: DashboardStyle; label: string; icon: typeof LayoutGrid }[] = [
  { key: "classic", label: "经典", icon: LayoutGrid },
  { key: "focus", label: "聚焦", icon: Sparkles },
]

function StyleSwitcher() {
  const style = useAppStore((s) => s.dashboardStyle)
  const setStyle = useAppStore((s) => s.setDashboardStyle)
  return (
    <div className="inline-flex items-center gap-1 rounded-full border bg-muted/40 p-1" role="tablist" aria-label="工作台风格切换">
      {OPTIONS.map((opt) => {
        const active = style === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setStyle(opt.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <opt.icon className="size-3.5" />
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export default function DashboardPage() {
  const style = useAppStore((s) => s.dashboardStyle)
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <StyleSwitcher />
      </div>
      {/* key 随风格切换强制重挂，避免两套结构状态串味；各自 ErrorBoundary 局部兜底 */}
      <ErrorBoundary key={style} label={`dashboard-${style}`}>
        {style === "focus" ? <DashboardFocus /> : <DashboardClassic />}
      </ErrorBoundary>
    </div>
  )
}

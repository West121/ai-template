import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

export function Logo({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  return (
    <div className={cn("flex h-14 shrink-0 items-center gap-2.5 px-4", className)}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Sparkles className="size-4.5" />
      </div>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[15px] font-semibold tracking-wide">企业开发平台</div>
          <div className="truncate text-[10px] text-muted-foreground">企业协同办公平台</div>
        </div>
      )}
    </div>
  )
}

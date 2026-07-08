import { useLocation, useNavigate } from "react-router-dom"
import { ChevronDown } from "lucide-react"
import { openMenuItem, type MenuItem } from "@/config/menu"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useBadgeStore } from "@/stores/badge-store"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function resolveBadge(badges: Record<string, number | undefined>, item: MenuItem): number | undefined {
  const value = badges[item.path] ?? item.badge
  return value && value > 0 ? value : undefined
}

function DropdownItems({ items, onNavigate }: { items: MenuItem[]; onNavigate: (path: string) => void }) {
  const { pathname } = useLocation()
  const badges = useBadgeStore((s) => s.badges)
  return (
    <>
      {items.map((item) =>
        item.children?.length ? (
          <DropdownMenuSub key={item.path}>
            <DropdownMenuSubTrigger className="gap-2">
              {item.icon && <item.icon className="size-4 text-muted-foreground" />}
              {item.title}
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownItems items={item.children} onNavigate={onNavigate} />
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem
            key={item.path}
            className={cn("gap-2", pathname === item.path && "bg-accent text-primary")}
            onClick={() => openMenuItem(item, onNavigate)}
          >
            {item.icon && <item.icon className="size-4 text-muted-foreground" />}
            {item.title}
            {resolveBadge(badges, item) != null && (
              <Badge variant="destructive" className="ml-auto h-4 min-w-4 rounded-full px-1 text-[10px]">
                {resolveBadge(badges, item)}
              </Badge>
            )}
          </DropdownMenuItem>
        ),
      )}
    </>
  )
}

interface HorizontalMenuProps {
  items: MenuItem[]
  /** 混合布局下只做一级切换，不弹下拉 */
  rootOnly?: boolean
  onRootChange?: (item: MenuItem) => void
}

export function HorizontalMenu({ items, rootOnly, onRootChange }: HorizontalMenuProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const badges = useBadgeStore((s) => s.badges)

  return (
    <nav className="flex h-full items-center gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = pathname === item.path || pathname.startsWith(item.path + "/")
        const baseClass = cn(
          "relative flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
          active
            ? "bg-primary/10 font-medium text-primary"
            : "text-foreground/70 hover:bg-accent hover:text-accent-foreground",
        )

        if (!item.children?.length || rootOnly) {
          return (
            <button
              key={item.path}
              type="button"
              className={baseClass}
              onClick={() => {
                if (rootOnly && item.children?.length) {
                  onRootChange?.(item)
                } else {
                  openMenuItem(item, navigate)
                }
              }}
            >
              {item.icon && <item.icon className="size-4" />}
              {item.title}
              {resolveBadge(badges, item) != null && (
                <Badge variant="destructive" className="h-4 min-w-4 rounded-full px-1 text-[10px]">
                  {resolveBadge(badges, item)}
                </Badge>
              )}
            </button>
          )
        }

        return (
          <DropdownMenu key={item.path}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={baseClass}>
                {item.icon && <item.icon className="size-4" />}
                {item.title}
                {resolveBadge(badges, item) != null && (
                  <Badge variant="destructive" className="h-4 min-w-4 rounded-full px-1 text-[10px]">
                    {resolveBadge(badges, item)}
                  </Badge>
                )}
                <ChevronDown className="size-3.5 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownItems items={item.children} onNavigate={navigate} />
            </DropdownMenuContent>
          </DropdownMenu>
        )
      })}
    </nav>
  )
}

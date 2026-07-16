import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import type { MenuItem } from "@/config/menu"
import { findMenuChain, openMenuItem } from "@/config/menu"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAppStore } from "@/stores/app-store"
import { useBadgeStore } from "@/stores/badge-store"

interface SidebarMenuProps {
  items: MenuItem[]
  collapsed?: boolean
}

/** 动态徽标（如真实待办数）优先于 menu.ts 的静态配置；0 视为隐藏 */
function resolveBadge(badges: Record<string, number | undefined>, item: MenuItem): number | undefined {
  const value = badges[item.path] ?? item.badge
  return value && value > 0 ? value : undefined
}

function isActive(pathname: string, item: MenuItem): boolean {
  return pathname === item.path || pathname.startsWith(item.path + "/")
}

/** 折叠态下的子菜单（递归 DropdownMenuSub） */
function CollapsedSubMenu({ items, onNavigate }: { items: MenuItem[]; onNavigate: (path: string) => void }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const badges = useBadgeStore((s) => s.badges)
  return (
    <>
      {items.map((item) =>
        item.children?.length ? (
          <DropdownMenuSub key={item.path}>
            <DropdownMenuSubTrigger className="gap-2">
              {item.icon && <item.icon className="size-4 text-muted-foreground" />}
              {t(item.title)}
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <CollapsedSubMenu items={item.children} onNavigate={onNavigate} />
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
            {t(item.title)}
            {resolveBadge(badges, item) != null && (
              <Badge className="ml-auto h-4 min-w-4 rounded-full px-1 text-[10px]">
                {resolveBadge(badges, item)}
              </Badge>
            )}
          </DropdownMenuItem>
        ),
      )}
    </>
  )
}

/** 展开态下的菜单节点（递归 Collapsible 风格） */
function ExpandedMenuItem({
  item,
  level,
  openKeys,
  onToggle,
  onNavigate,
}: {
  item: MenuItem
  level: number
  openKeys: string[]
  onToggle: (item: MenuItem, level: number) => void
  onNavigate: (path: string) => void
}) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const active = isActive(pathname, item)
  const hasChildren = !!item.children?.length
  const open = openKeys.includes(item.path)
  const paddingLeft = 12 + level * 16
  const badges = useBadgeStore((s) => s.badges)
  const badge = resolveBadge(badges, item)

  if (!hasChildren) {
    return (
      <button
        type="button"
        onClick={() => openMenuItem(item, onNavigate)}
        style={{ paddingLeft }}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md py-2 pr-3 text-sm transition-colors",
          pathname === item.path
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        {item.icon && <item.icon className="size-4 shrink-0" />}
        {/* 膨胀红线：英/泰译文可能超宽——truncate + title 悬停可读全文 */}
        <span className="flex-1 truncate text-left" title={t(item.title)}>{t(item.title)}</span>
        {badge != null && (
          <Badge
            variant={pathname === item.path ? "secondary" : "destructive"}
            className="h-4.5 min-w-4.5 rounded-full px-1.5 text-[10px]"
          >
            {badge}
          </Badge>
        )}
      </button>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(item, level)}
        style={{ paddingLeft }}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md py-2 pr-3 text-sm transition-colors",
          active
            ? "font-medium text-primary"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        {item.icon && <item.icon className="size-4 shrink-0" />}
        {/* 膨胀红线：英/泰译文可能超宽——truncate + title 悬停可读全文 */}
        <span className="flex-1 truncate text-left" title={t(item.title)}>{t(item.title)}</span>
        {badge != null && (
          <Badge variant="destructive" className="h-4.5 min-w-4.5 rounded-full px-1.5 text-[10px]">
            {badge}
          </Badge>
        )}
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 pt-0.5">
            {item.children!.map((child) => (
              <ExpandedMenuItem
                key={child.path}
                item={child}
                level={level + 1}
                openKeys={openKeys}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SidebarMenu({ items, collapsed }: SidebarMenuProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const accordionMenu = useAppStore((s) => s.accordionMenu)
  const allBadges = useBadgeStore((s) => s.badges)
  const [openKeys, setOpenKeys] = useState<string[]>([])

  // 路由变化时自动展开当前路径所在的菜单链
  useEffect(() => {
    const chain = findMenuChain(pathname)
      .filter((m) => m.children?.length)
      .map((m) => m.path)
    setOpenKeys((prev) => Array.from(new Set([...prev, ...chain])))
  }, [pathname])

  const handleToggle = (item: MenuItem, level: number) => {
    setOpenKeys((prev) => {
      if (prev.includes(item.path)) return prev.filter((k) => k !== item.path)
      if (!accordionMenu) return [...prev, item.path]
      // 手风琴：关闭同级其他菜单（同级 = 相同层级下的兄弟节点）
      const siblings = (level === 0 ? items : findSiblings(items, item, level)) ?? []
      const siblingKeys = siblings.map((s) => s.path)
      return [...prev.filter((k) => !siblingKeys.includes(k)), item.path]
    })
  }

  if (collapsed) {
    return (
      <nav className="flex flex-col items-center gap-1 px-2 py-2">
        {items.map((item) => {
          const active = isActive(pathname, item)
          const badge = resolveBadge(allBadges, item)
          if (!item.children?.length) {
            return (
              <Tooltip key={item.path} delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => openMenuItem(item, navigate)}
                    className={cn(
                      "relative flex size-10 items-center justify-center rounded-md transition-colors",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent",
                    )}
                  >
                    {item.icon && <item.icon className="size-4.5" />}
                    {badge != null && (
                      <span className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t(item.title)}</TooltipContent>
              </Tooltip>
            )
          }
          return (
            <DropdownMenu key={item.path}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "relative flex size-10 items-center justify-center rounded-md transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent",
                  )}
                >
                  {item.icon && <item.icon className="size-4.5" />}
                  {badge != null && (
                    <span className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="min-w-40">
                <DropdownMenuLabel>{t(item.title)}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <CollapsedSubMenu items={item.children} onNavigate={navigate} />
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}
      </nav>
    )
  }

  return (
    <nav className="space-y-0.5 px-2 py-2">
      {items.map((item) => (
        <ExpandedMenuItem
          key={item.path}
          item={item}
          level={0}
          openKeys={openKeys}
          onToggle={handleToggle}
          onNavigate={navigate}
        />
      ))}
    </nav>
  )
}

/** 查找某节点的同级兄弟列表 */
function findSiblings(items: MenuItem[], target: MenuItem, level: number, current = 0): MenuItem[] | null {
  if (current === level) {
    return items.some((i) => i.path === target.path) ? items : null
  }
  for (const item of items) {
    if (item.children) {
      const found = findSiblings(item.children, target, level, current + 1)
      if (found) return found
    }
  }
  return null
}

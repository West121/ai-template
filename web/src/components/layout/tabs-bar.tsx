import { Fragment } from "react"
import { useTranslation } from "react-i18next"
import { useLocation, useNavigate } from "react-router-dom"
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronDown,
  CircleX,
  Pin,
  PinOff,
  RotateCw,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAppStore } from "@/stores/app-store"
import { useTabsStore, type TabItem } from "@/stores/tabs-store"
import { useUiStore } from "@/stores/ui-store"

export function TabsBar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const tabs = useTabsStore((s) => s.tabs)
  const tabStyle = useAppStore((s) => s.tabStyle)
  const refreshPage = useUiStore((s) => s.refreshPage)
  const chrome = tabStyle === "chrome"

  /** 批量关闭后如果当前页被关掉，跳到 fallback */
  const ensureActive = (fallback?: string) => {
    const remaining = useTabsStore.getState().tabs
    if (!remaining.some((t) => t.key === pathname)) {
      navigate(fallback ?? remaining[remaining.length - 1]?.key ?? "/dashboard")
    }
  }

  const closeTab = (tab: TabItem) => {
    const list = useTabsStore.getState().tabs
    const index = list.findIndex((t) => t.key === tab.key)
    useTabsStore.getState().closeTab(tab.key)
    if (tab.key === pathname) {
      const remaining = useTabsStore.getState().tabs
      const next = remaining[Math.min(index, remaining.length - 1)]
      navigate(next?.key ?? "/dashboard")
    }
  }

  const actions = (tab: TabItem) => ({
    refresh: () => {
      if (tab.key !== pathname) navigate(tab.key)
      refreshPage()
    },
    pin: () => useTabsStore.getState().togglePin(tab.key),
    close: () => closeTab(tab),
    closeOthers: () => {
      useTabsStore.getState().closeOthers(tab.key)
      ensureActive(tab.key)
    },
    closeLeft: () => {
      useTabsStore.getState().closeLeft(tab.key)
      ensureActive(tab.key)
    },
    closeRight: () => {
      useTabsStore.getState().closeRight(tab.key)
      ensureActive(tab.key)
    },
    closeAll: () => {
      useTabsStore.getState().closeAll()
      ensureActive()
    },
  })

  return (
    <div
      className={cn(
        "flex shrink-0 gap-1 px-2",
        chrome
          ? "h-9 items-end bg-primary/5 dark:bg-primary/10"
          : "h-10 items-center border-b bg-card/60",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          chrome ? "items-end gap-0 pl-3 pr-1" : "items-center gap-1 py-1.5",
        )}
      >
        {tabs.map((tab, index) => {
          const active = tab.key === pathname
          const a = actions(tab)
          // 谷歌风格：相邻标签之间的分隔线（紧挨激活标签的两侧不显示）
          const showDivider =
            chrome && index > 0 && !active && tabs[index - 1].key !== pathname
          return (
            <Fragment key={tab.key}>
              {showDivider && (
                <span aria-hidden className="z-0 h-4 w-px shrink-0 self-center bg-foreground/25" />
              )}
              <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  role="tab"
                  tabIndex={0}
                  onClick={() => navigate(tab.key)}
                  onKeyDown={(e) => e.key === "Enter" && navigate(tab.key)}
                  onAuxClick={(e) => {
                    // 鼠标中键关闭
                    if (e.button === 1 && !tab.pinned) closeTab(tab)
                  }}
                  className={cn(
                    "group flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-xs",
                    chrome
                      ? cn(
                          "relative h-8 rounded-t-[8px] px-3 transition-colors",
                          active
                            ? "chrome-tab-active z-10 font-medium text-foreground"
                            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                        )
                      : cn(
                          "h-7 rounded-md border px-2.5 transition-colors",
                          active
                            ? "border-primary/30 bg-primary/10 font-medium text-primary"
                            : "border-transparent bg-muted/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        ),
                  )}
                >
                  {tab.pinned && <Pin className="size-3 shrink-0 opacity-70" />}
                  <span className={cn("truncate", chrome ? "max-w-36" : "max-w-32")}>
                    {t(tab.title)}
                  </span>
                  {!tab.pinned && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(tab)
                      }}
                      className={cn(
                        "flex shrink-0 items-center justify-center rounded-full transition-colors hover:bg-foreground/10",
                        chrome ? "size-4" : "size-3.5",
                        active ? "opacity-70" : "opacity-0 group-hover:opacity-70",
                      )}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-40">
                <ContextMenuItem onClick={a.refresh}>
                  <RotateCw className="size-4" /> {t("重新加载")}
                </ContextMenuItem>
                <ContextMenuItem onClick={a.pin}>
                  {tab.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                  {tab.pinned ? t("取消固定") : t("固定标签")}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem disabled={tab.pinned} onClick={a.close}>
                  <X className="size-4" /> {t("关闭标签")}
                </ContextMenuItem>
                <ContextMenuItem onClick={a.closeLeft}>
                  <ArrowLeftToLine className="size-4" /> {t("关闭左侧")}
                </ContextMenuItem>
                <ContextMenuItem onClick={a.closeRight}>
                  <ArrowRightToLine className="size-4" /> {t("关闭右侧")}
                </ContextMenuItem>
                <ContextMenuItem onClick={a.closeOthers}>
                  <CircleX className="size-4" /> {t("关闭其他")}
                </ContextMenuItem>
                <ContextMenuItem onClick={a.closeAll}>
                  <CircleX className="size-4" /> {t("关闭全部")}
                </ContextMenuItem>
              </ContextMenuContent>
              </ContextMenu>
            </Fragment>
          )
        })}
      </div>
      <Button variant="ghost" size="icon" className="size-7 shrink-0 self-center" onClick={refreshPage}>
        <RotateCw className="size-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7 shrink-0 self-center">
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem
            onClick={() => {
              useTabsStore.getState().closeOthers(pathname)
              ensureActive(pathname)
            }}
          >
            <CircleX className="size-4" /> {t("关闭其他")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              useTabsStore.getState().closeAll()
              ensureActive()
            }}
          >
            <CircleX className="size-4" /> {t("关闭全部")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

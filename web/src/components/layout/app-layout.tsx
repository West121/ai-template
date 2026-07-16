import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { ErrorBoundary } from "@/components/error-boundary"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { filterMenu, findMenuByPath, findRootMenu, menuTree, type MenuItem } from "@/config/menu"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAppStore } from "@/stores/app-store"
import { useAuthStore } from "@/stores/auth-store"
import { useBadgeStore } from "@/stores/badge-store"
import { useTabsStore } from "@/stores/tabs-store"
import { useUiStore } from "@/stores/ui-store"
import { Breadcrumbs } from "./breadcrumbs"
import { GlobalSearch } from "./global-search"
import { Header } from "./header"
import { HorizontalMenu } from "./horizontal-menu"
import { Logo } from "./logo"
import { SettingsDrawer } from "./settings-drawer"
import { SidebarMenu } from "./sidebar-menu"
import { AiAssistant } from "@/components/ai-chat/assistant"
import { TabsBar } from "./tabs-bar"

/** 找到菜单项下第一个叶子节点 */
function firstLeaf(item: MenuItem): MenuItem {
  return item.children?.length ? firstLeaf(item.children[0]) : item
}

function CollapseButton() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  return (
    <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={toggleSidebar}>
      {collapsed ? <PanelLeftOpen className="size-4.5" /> : <PanelLeftClose className="size-4.5" />}
    </Button>
  )
}

function Sidebar({ items, showLogo }: { items: MenuItem[]; showLogo?: boolean }) {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200",
        collapsed ? "w-14" : "w-56",
      )}
    >
      {showLogo && <Logo collapsed={collapsed} className="border-b border-sidebar-border" />}
      <ScrollArea className="min-h-0 flex-1">
        <SidebarMenu items={items} collapsed={collapsed} />
      </ScrollArea>
    </aside>
  )
}

function Footer() {
  const { t } = useTranslation()
  return (
    <footer className="flex h-9 shrink-0 items-center justify-center border-t bg-card text-xs text-muted-foreground">
      Copyright © 2026 {t("企业开发平台")} · {t("企业协同办公平台")}
    </footer>
  )
}

export function AppLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const layout = useAppStore((s) => s.layout)
  const showTabs = useAppStore((s) => s.showTabs)
  const showBreadcrumb = useAppStore((s) => s.showBreadcrumb)
  const showFooter = useAppStore((s) => s.showFooter)
  const contentCompact = useAppStore((s) => s.contentCompact)
  const refreshKey = useUiStore((s) => s.refreshKey)
  const addTab = useTabsStore((s) => s.addTab)

  // 路由变化 → 打开/激活对应标签页
  useEffect(() => {
    const item = findMenuByPath(pathname)
    if (item && !item.children?.length) {
      addTab({ key: pathname, title: item.title })
    }
  }, [pathname, addTab])

  // 真实待办数 → 「我的审批」菜单徽标（登录/切换身份后刷新；离线演示模式跳过，走静态 mock 徽标）
  const token = useAuthStore((s) => s.token)
  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)
  const setBadge = useBadgeStore((s) => s.setBadge)

  // 启动时刷新会话（权限/任职有后端变更时自动同步，无需重新登录）
  const refreshMe = useAuthStore((s) => s.refreshMe)
  useEffect(() => {
    void refreshMe()
  }, [refreshMe])
  useEffect(() => {
    if (!token || offline) return
    let cancelled = false
    api<{ total: number }>("/api/wf/tasks/todo?pageNum=1&pageSize=1")
      .then((page) => {
        if (cancelled) return
        setBadge("/workflow/tasks", page.total)
      })
      .catch(() => {})
    // 公告未读角标:真实未读数(0/失败→不显示);进入公告页后由页内同步下调
    api<number>("/api/office/announcements/unread-count")
      .then((n) => {
        if (cancelled) return
        setBadge("/announcement", typeof n === "number" && n > 0 ? n : undefined)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [token, offline, activeAssignmentId, setBadge])

  // 菜单级权限过滤（perm 字段，拍板⑤）：随权限动态计算；离线 permissions=null 全放行
  const permissions = useAuthStore((s) => s.permissions)
  const navTree = useMemo(() => filterMenu(menuTree, permissions), [permissions])

  const activeRoot = findRootMenu(pathname)
  const mixedSideItems = layout === "mixed" ? (activeRoot?.children ?? []) : []

  const content = (
    <>
      {showTabs && <TabsBar />}
      <main key={refreshKey} className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("p-4 md:p-5", contentCompact && "mx-auto max-w-[1400px]")}>
          {showBreadcrumb && layout !== "vertical" && (
            <div className="mb-4">
              <Breadcrumbs />
            </div>
          )}
          {/* 全局路由级错误边界(一劳永逸防白屏):任何页面渲染崩溃 → 隔离卡+重试,
              key=pathname 保证切换路由自动重置边界 */}
          <ErrorBoundary key={pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
      {showFooter && <Footer />}
    </>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {layout === "vertical" && (
        <>
          <Sidebar items={navTree} showLogo />
          <div className="flex min-w-0 flex-1 flex-col">
            <Header
              left={
                <>
                  <CollapseButton />
                  {showBreadcrumb && <Breadcrumbs />}
                </>
              }
            />
            {content}
          </div>
        </>
      )}

      {layout === "horizontal" && (
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            left={
              <>
                <Logo className="h-auto px-0" />
                <div className="ml-2 min-w-0 flex-1">
                  <HorizontalMenu items={navTree} />
                </div>
              </>
            }
          />
          {content}
        </div>
      )}

      {layout === "mixed" && (
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            left={
              <>
                <Logo className="h-auto px-0" />
                <div className="ml-2 min-w-0 flex-1">
                  <HorizontalMenu
                    items={navTree}
                    rootOnly
                    onRootChange={(item) => navigate(firstLeaf(item).path)}
                  />
                </div>
              </>
            }
          />
          <div className="flex min-h-0 flex-1">
            {mixedSideItems.length > 0 && <Sidebar items={mixedSideItems} />}
            <div className="flex min-w-0 flex-1 flex-col">{content}</div>
          </div>
        </div>
      )}

      <SettingsDrawer />
      <GlobalSearch />
      {/* AI 智能助手：全局悬浮球 + 非模态侧边对话面板（登录后所有页可用） */}
      <AiAssistant />
    </div>
  )
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import {
  Bell,
  CheckCheck,
  Command,
  Copy,
  FileCheck2,
  Maximize,
  Megaphone,
  Minimize,
  Monitor,
  Moon,
  Search,
  Settings2,
  Sun,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { useAppStore, type ThemeMode } from "@/stores/app-store"
import { useAuthStore } from "@/stores/auth-store"
import { useUiStore } from "@/stores/ui-store"
import { WF_NOTIFY_TYPE_LABEL, wfFormatTime, wfInstancePath, type WfNotify } from "@/types/workflow"
import { UserMenu } from "./user-menu"

const themeOptions: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "light", label: "亮色模式", icon: Sun },
  { value: "dark", label: "暗色模式", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
]

function ThemeToggle() {
  const themeMode = useAppStore((s) => s.themeMode)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const CurrentIcon = themeOptions.find((o) => o.value === themeMode)?.icon ?? Sun

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <CurrentIcon className="size-4.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {themeOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className={themeMode === option.value ? "bg-accent text-primary" : ""}
            onClick={() => updateSettings({ themeMode: option.value })}
          >
            <option.icon className="size-4" />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FullscreenToggle() {
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="hidden size-8 md:inline-flex"
          onClick={() => {
            if (document.fullscreenElement) {
              void document.exitFullscreen()
            } else {
              void document.documentElement.requestFullscreen()
            }
          }}
        >
          {fullscreen ? <Minimize className="size-4.5" /> : <Maximize className="size-4.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{fullscreen ? "退出全屏" : "全屏"}</TooltipContent>
    </Tooltip>
  )
}

/** 通知类型 → 图标 */
const NOTIFY_ICON: Record<string, typeof Bell> = {
  TODO: FileCheck2,
  RESULT: CheckCheck,
  URGE: Megaphone,
  CC: Copy,
}

const POLL_INTERVAL = 30_000

/**
 * 工作流站内通知铃铛：接真实数据 GET /api/wf/notifies/unread-count 轮询(30s)
 * + Popover 列表（GET /notifies）+ 点击跳实例并标记已读 + 全部已读。
 * 后端未启动/离线时静默降级为 0 未读、空列表，不打断布局。
 */
function WfNotificationsBell() {
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const token = useAuthStore((s) => s.token)
  const [unread, setUnread] = useState(0)
  const [list, setList] = useState<WfNotify[]>([])
  const [open, setOpen] = useState(false)
  const timerRef = useRef<number | null>(null)

  const pollUnread = useCallback(() => {
    if (offline || !token) return
    api<number>("/api/wf/notifies/unread-count")
      .then((n) => setUnread(typeof n === "number" ? n : 0))
      .catch(() => {})
  }, [offline, token])

  useEffect(() => {
    pollUnread()
    if (offline || !token) return
    timerRef.current = window.setInterval(pollUnread, POLL_INTERVAL)
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current)
    }
  }, [pollUnread, offline, token])

  const loadList = useCallback(() => {
    if (offline || !token) return
    api<WfNotify[]>("/api/wf/notifies")
      .then((data) => setList(Array.isArray(data) ? data : []))
      .catch(() => setList([]))
  }, [offline, token])

  const openInstance = useCallback(
    (item: WfNotify) => {
      setOpen(false)
      if (!item.readFlag) {
        api(`/api/wf/notifies/${item.id}/read`, { method: "POST" }).catch(() => {})
        setList((prev) => prev.map((n) => (n.id === item.id ? { ...n, readFlag: true } : n)))
        setUnread((n) => Math.max(0, n - 1))
      }
      if (item.instanceId != null || item.procInstId) {
        navigate(wfInstancePath({ instanceId: item.instanceId, procInstId: item.procInstId }))
      }
    },
    [navigate],
  )

  const markAll = useCallback(() => {
    api("/api/wf/notifies/read-all", { method: "POST" }).catch(() => {})
    setList((prev) => prev.map((n) => ({ ...n, readFlag: true })))
    setUnread(0)
    toast.success("已全部标记为已读")
  }, [])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) loadList()
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-8">
          <Bell className="size-4.5" />
          {unread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full px-1 text-[10px]"
            >
              {unread > 99 ? "99+" : unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-90 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-medium">流程通知</span>
          {unread > 0 && <span className="text-xs text-destructive">{unread} 条未读</span>}
        </div>
        <ScrollArea className="h-80">
          {list.length === 0 ? (
            <div className="flex h-80 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Bell className="size-8 opacity-30" />
              <span className="text-sm">暂无通知</span>
            </div>
          ) : (
            <div className="divide-y">
              {list.map((item) => {
                const Icon = NOTIFY_ICON[item.type] ?? Bell
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
                    onClick={() => openInstance(item)}
                  >
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
                          {WF_NOTIFY_TYPE_LABEL[item.type] ?? item.type}
                        </Badge>
                        <span className="truncate text-sm font-medium">{item.title}</span>
                        {!item.readFlag && <span className="size-1.5 shrink-0 rounded-full bg-destructive" />}
                      </div>
                      {item.content && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.content}</div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground/70">{wfFormatTime(item.createdAt)}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </ScrollArea>
        <div className="flex items-center justify-between border-t px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground"
            onClick={markAll}
            disabled={unread === 0}
          >
            <CheckCheck className="size-3.5" />
            全部已读
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => {
              setOpen(false)
              navigate("/workflow/tasks?tab=todo")
            }}
          >
            查看待办
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function Header({ left }: { left?: ReactNode }) {
  const setSearchOpen = useUiStore((s) => s.setSearchOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">{left}</div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="mr-1.5 hidden h-9 w-56 items-center gap-2.5 rounded-lg bg-muted px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left text-sm">搜索菜单</span>
          <kbd className="pointer-events-none flex h-5.5 shrink-0 items-center gap-0.5 rounded-md border bg-background px-1.5 font-medium text-muted-foreground shadow-xs">
            <Command className="size-3" />
            <span className="text-[11px] leading-none">K</span>
          </kbd>
        </button>
        <Button variant="ghost" size="icon" className="size-8 lg:hidden" onClick={() => setSearchOpen(true)}>
          <Search className="size-4.5" />
        </Button>
        <FullscreenToggle />
        <ThemeToggle />
        <WfNotificationsBell />
        <UserMenu />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="size-4.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>偏好设置</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

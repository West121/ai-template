import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import { api, type PageResult } from "@/lib/api"
import { PageHeader } from "@/components/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuthStore } from "@/stores/auth-store"
import { useBadgeStore } from "@/stores/badge-store"
import type { WfCcItem, WfTaskItem } from "@/types/workflow"
import { TodoList } from "./todo"
import { CcList } from "./cc"
import { DoneList } from "./done"
import { MineList } from "./mine"
import { DraftList } from "./draft"
import { DelegatePanel } from "./delegate"

const TAB_VALUES = ["todo", "cc", "done", "mine", "draft", "delegate"] as const
type TabValue = (typeof TAB_VALUES)[number]

const TAB_LABELS: Record<TabValue, string> = {
  todo: "待办",
  cc: "待阅",
  done: "已办",
  mine: "我发起",
  draft: "草稿",
  delegate: "我的委托",
}

function isTabValue(v: string | null): v is TabValue {
  return v != null && (TAB_VALUES as readonly string[]).includes(v)
}

export default function WorkflowTasksPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const offline = useAuthStore((s) => s.offline)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)
  const setBadge = useBadgeStore((s) => s.setBadge)

  const tabParam = searchParams.get("tab")
  const tab: TabValue = isTabValue(tabParam) ? tabParam : "todo"

  const [todoCount, setTodoCount] = useState<number | undefined>(undefined)
  const [ccUnread, setCcUnread] = useState<number | undefined>(undefined)

  const onTabChange = useCallback(
    (value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set("tab", value)
        return next
      })
    },
    [setSearchParams],
  )

  // 待办数上报 → 「我的审批」菜单徽标
  const handleTodoCount = useCallback(
    (n: number) => {
      setTodoCount(n)
      setBadge("/workflow/tasks", n)
    },
    [setBadge],
  )

  // 未激活的 Tab 不会挂载，故进入页时主动预取待办数 / 待阅未读数，保证小红点与徽标即时呈现
  useEffect(() => {
    if (offline) return
    let cancelled = false
    api<PageResult<WfTaskItem>>("/api/wf/tasks/todo?pageNum=1&pageSize=1")
      .then((page) => {
        if (cancelled) return
        setTodoCount(page.total)
        setBadge("/workflow/tasks", page.total)
      })
      .catch(() => {})
    api<PageResult<WfCcItem>>("/api/wf/instances/cc?pageNum=1&pageSize=100")
      .then((page) => {
        if (cancelled) return
        setCcUnread(page.list.filter((r) => !r.readFlag).length)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [offline, activeAssignmentId, setBadge])

  return (
    <div className="space-y-4">
      <PageHeader
        title="我的审批"
        description="待办、待阅、已办、我发起、草稿与委托规则统一入口"
      />

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          {TAB_VALUES.map((value) => {
            const dot =
              (value === "todo" && !!todoCount) || (value === "cc" && !!ccUnread)
            return (
              <TabsTrigger key={value} value={value} className="flex-none gap-1.5">
                {TAB_LABELS[value]}
                {dot && (
                  <span
                    className={cn(
                      "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium leading-none",
                      "bg-destructive text-destructive-foreground",
                    )}
                  >
                    {value === "todo" ? todoCount : ccUnread}
                  </span>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>

        <TabsContent value="todo" className="mt-4">
          <TodoList onCount={handleTodoCount} />
        </TabsContent>
        <TabsContent value="cc" className="mt-4">
          <CcList onUnread={setCcUnread} />
        </TabsContent>
        <TabsContent value="done" className="mt-4">
          <DoneList />
        </TabsContent>
        <TabsContent value="mine" className="mt-4">
          <MineList />
        </TabsContent>
        <TabsContent value="draft" className="mt-4">
          <DraftList />
        </TabsContent>
        <TabsContent value="delegate" className="mt-4">
          <DelegatePanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}

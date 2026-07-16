import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { Bell, CheckCheck, FileCheck2, Megaphone, MessageSquare } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"

interface NoticeItem {
  id: number
  type: "notice" | "todo" | "message"
  title: string
  desc: string
  time: string
  read?: boolean
}

const initialNotices: NoticeItem[] = [
  { id: 1, type: "notice", title: "关于 2026 年中秋节放假安排的通知", desc: "行政部发布", time: "10 分钟前" },
  { id: 2, type: "notice", title: "第三季度全员大会通知", desc: "总裁办发布", time: "2 小时前" },
  { id: 3, type: "todo", title: "李晓的请假申请待你审批", desc: "年假 · 3 天", time: "30 分钟前" },
  { id: 4, type: "todo", title: "市场部差旅费报销单待审批", desc: "金额 ¥4,280.00", time: "1 小时前" },
  { id: 5, type: "todo", title: "「CRM 系统采购」合同会签", desc: "流程节点：部门负责人", time: "3 小时前" },
  { id: 6, type: "message", title: "陈静 回复了你的公文批注", desc: "「关于印发信息安全管理规定…」", time: "昨天 18:32" },
  { id: 7, type: "message", title: "会议提醒", desc: "「产品评审会」将于 14:00 开始", time: "昨天 13:30" },
]

const typeMeta = {
  notice: { label: "通知", icon: Megaphone },
  todo: { label: "待办", icon: FileCheck2 },
  message: { label: "消息", icon: MessageSquare },
} as const

export function Notifications() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [notices, setNotices] = useState(initialNotices)
  const [tab, setTab] = useState<keyof typeof typeMeta>("notice")
  const unread = notices.filter((n) => !n.read).length
  const list = notices.filter((n) => n.type === tab)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-8">
          <Bell className="size-4.5" />
          {unread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full px-1 text-[10px]"
            >
              {unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-90 p-0">
        <Tabs value={tab} onValueChange={(v) => setTab(v as keyof typeof typeMeta)}>
          <div className="border-b px-3 pt-3">
            <TabsList className="w-full">
              {(Object.keys(typeMeta) as Array<keyof typeof typeMeta>).map((key) => {
                const count = notices.filter((n) => n.type === key && !n.read).length
                return (
                  <TabsTrigger key={key} value={key} className="flex-1">
                    {t(typeMeta[key].label)}
                    {count > 0 && <span className="ml-1 text-xs text-destructive">({count})</span>}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>
          <ScrollArea className="h-72">
            {list.length === 0 ? (
              <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                {t("暂无{{type}}", { type: t(typeMeta[tab].label) })}
              </div>
            ) : (
              <div className="divide-y">
                {list.map((notice) => {
                  const Icon = typeMeta[notice.type].icon
                  return (
                    <button
                      key={notice.id}
                      type="button"
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
                      onClick={() => {
                        setNotices((prev) =>
                          prev.map((n) => (n.id === notice.id ? { ...n, read: true } : n)),
                        )
                        if (notice.type === "todo") navigate("/workflow/tasks?tab=todo")
                        if (notice.type === "notice") navigate("/announcement")
                      }}
                    >
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{notice.title}</span>
                          {!notice.read && <span className="size-1.5 shrink-0 rounded-full bg-destructive" />}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{notice.desc}</div>
                        <div className="mt-1 text-xs text-muted-foreground/70">{notice.time}</div>
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
              onClick={() => {
                setNotices((prev) => prev.map((n) => ({ ...n, read: true })))
                toast.success(t("已全部标记为已读"))
              }}
            >
              <CheckCheck className="size-3.5" />
              {t("全部已读")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => navigate("/workflow/tasks")}
            >
              {t("查看全部")}
            </Button>
          </div>
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}

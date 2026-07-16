import { useCallback, useEffect, useState } from "react"
import { CloudOff, Eye, Megaphone, Pin, RotateCw, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"
import { useBadgeStore } from "@/stores/badge-store"

/** 后端公告响应 */
interface AnnouncementRow {
  id: number
  category: string // NOTICE | RULE | NEWS
  title: string
  content: string
  publisher?: string
  deptName?: string
  top: boolean
  reads: number
  publishAt?: string
  readFlag: boolean
}

const CATEGORY_LABEL: Record<string, string> = {
  NOTICE: "公司通知",
  RULE: "规章制度",
  NEWS: "企业新闻",
}

const categoryBadgeClass: Record<string, string> = {
  NOTICE: "border-blue-500/30 bg-blue-500/10 text-blue-600",
  RULE: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  NEWS: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
}

const TABS = [
  { value: "all", label: "全部" },
  { value: "NOTICE", label: "公司通知" },
  { value: "RULE", label: "规章制度" },
  { value: "NEWS", label: "企业新闻" },
]

function formatTime(iso?: string) {
  if (!iso) return "—"
  return iso.slice(0, 16).replace("T", " ")
}

export default function AnnouncementPage() {
  const [list, setList] = useState<AnnouncementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [total, setTotal] = useState(0)
  // 菜单角标与页内未读同步(读一条降一条;0 → 角标消失)
  const setBadge = useBadgeStore((s) => s.setBadge)
  useEffect(() => {
    setBadge("/announcement", unreadCount > 0 ? unreadCount : undefined)
  }, [unreadCount, setBadge])
  const [tab, setTab] = useState("all")
  const [active, setActive] = useState<AnnouncementRow | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [form, setForm] = useState({ title: "", category: "", content: "", top: false })

  const offline = useAuthStore((s) => s.offline)
  const canPublish = useHasPerm("office:announcement:publish")

  const load = useCallback(async (category: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const categoryParam = category === "all" ? "" : `&category=${category}`
      const [page, unread] = await Promise.all([
        api<PageResult<AnnouncementRow>>(
          `/api/office/announcements?pageNum=1&pageSize=100${categoryParam}`,
        ),
        api<number>("/api/office/announcements/unread-count"),
      ])
      setList(page.list)
      // 「共 X 条」用分页 total(list 被 pageSize=100 截断,length 会小于真实总数 → 曾出现"100 条公告 122 未读")
      setTotal(page.total ?? page.list.length)
      setUnreadCount(unread)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load(tab)
  }, [load, offline, tab])

  function openDetail(item: AnnouncementRow) {
    if (!item.readFlag) {
      // 标记已读（幂等）：本地置读 + reads+1，失败不阻塞阅读
      void api(`/api/office/announcements/${item.id}/read`, { method: "POST" }).catch(() => {})
      const updated = { ...item, readFlag: true, reads: item.reads + 1 }
      setList((prev) => prev.map((a) => (a.id === item.id ? updated : a)))
      setUnreadCount((n) => Math.max(0, n - 1))
      setActive(updated)
      return
    }
    setActive(item)
  }

  async function handlePublish() {
    if (!form.title.trim() || !form.category || !form.content.trim()) {
      toast.error("请填写标题、分类和正文")
      return
    }
    setPublishing(true)
    try {
      await api("/api/office/announcements", {
        method: "POST",
        body: JSON.stringify({
          category: form.category,
          title: form.title.trim(),
          content: form.content.trim(),
          top: form.top,
        }),
      })
      setPublishOpen(false)
      setForm({ title: "", category: "", content: "", top: false })
      toast.success("公告已发布")
      void load(tab)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发布失败")
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="公告通知"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为真实数据"
            : `共 ${total} 条公告，${unreadCount} 条未读`
        }
        actions={
          canPublish ? (
            <Button size="sm" onClick={() => setPublishOpen(true)}>
              <Megaphone className="size-4" />
              发布公告
            </Button>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loadError === "network" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot
              spring-boot:run，然后重新登录，即可查看真实公告、未读状态与阅读量。
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => void load(tab)}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={() => void load(tab)}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <div className="divide-y">
            {loading && (
              <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
            )}
            {!loading && list.length === 0 && (
              <div className="py-16 text-center text-sm text-muted-foreground">该分类下暂无公告</div>
            )}
            {!loading &&
              list.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openDetail(item)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/50"
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      !item.readFlag ? "bg-blue-500" : "bg-transparent",
                    )}
                  />
                  {item.top && (
                    <Badge variant="outline" className="gap-1 border-rose-500/30 bg-rose-500/10 text-rose-600">
                      <Pin className="size-3" />
                      置顶
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={categoryBadgeClass[item.category] ?? "text-muted-foreground"}
                  >
                    {CATEGORY_LABEL[item.category] ?? item.category}
                  </Badge>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      !item.readFlag ? "font-semibold" : "font-normal",
                    )}
                    title={item.title}
                  >
                    {item.title}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {item.deptName ?? item.publisher ?? "—"}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatTime(item.publishAt)}
                  </span>
                  <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                    <Eye className="size-3.5" />
                    {item.reads}
                  </span>
                </button>
              ))}
          </div>
        </Card>
      )}

      {/* 公告详情 */}
      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {active && (
            <>
              <DialogHeader className="items-center">
                <DialogTitle className="text-center text-lg leading-relaxed">{active.title}</DialogTitle>
                <DialogDescription className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
                  <span>
                    发布：{active.publisher ?? "—"}
                    {active.deptName ? `（${active.deptName}）` : ""}
                  </span>
                  <span>发布时间：{formatTime(active.publishAt)}</span>
                  <span className="flex items-center gap-1">
                    <Eye className="size-3.5" />
                    {active.reads} 次阅读
                  </span>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2 text-sm leading-7 text-foreground/90">
                {active.content
                  .split(/\n+/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p, i) => (
                    <p key={i} className="indent-8">
                      {p}
                    </p>
                  ))}
              </div>
              <DialogFooter className="sm:justify-center">
                <Button className="min-w-32" onClick={() => setActive(null)}>
                  我知道了
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 发布公告 */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>发布公告</DialogTitle>
            <DialogDescription>发布后全体员工可见，请仔细核对内容</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="ann-title">公告标题</Label>
              <Input
                id="ann-title"
                placeholder="请输入公告标题"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>公告分类</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="请选择分类" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ann-content">公告正文</Label>
              <Textarea
                id="ann-content"
                rows={6}
                placeholder="请输入公告正文，可用换行分段…"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">置顶公告</div>
                <div className="text-xs text-muted-foreground">置顶后将展示在公告列表顶部</div>
              </div>
              <Switch checked={form.top} onCheckedChange={(checked) => setForm({ ...form, top: checked })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              取消
            </Button>
            <Button disabled={publishing} onClick={() => void handlePublish()}>
              {publishing ? "发布中…" : "发布"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, FileText, GitBranch, History, Paperclip, RotateCw, ShieldAlert, Stamp } from "lucide-react"
import { sanitizeHtml } from "@/lib/sanitize"
import { useAuthStore } from "@/stores/auth-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GongwenPreview } from "@/components/gongwen/gongwen-preview"
import { fetchDoc } from "./gongwen/mock"
import { gwFormatDate, type GwDoc } from "./gongwen/types"
import { DocTypeBadge, GwStatusBadge, SecretBadge, UrgencyBadge } from "./gongwen/badges"
import { OpinionActionBar, OpinionTimeline } from "./gongwen/handling"
import { DocFlowTrack } from "./gongwen/flow-track"
import { GwPredictButton } from "./gongwen/predict"
import { DemoBanner } from "./gongwen/shared"

/** 次要项：规整的 key-value（弱化） */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm" title={typeof children === "string" ? children : undefined}>
        {children}
      </dd>
    </div>
  )
}

export default function SendDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const offline = useAuthStore((s) => s.offline)
  const [doc, setDoc] = useState<GwDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setNotFound(false)
    try {
      const res = await fetchDoc(Number(id), "SEND")
      setDemo(res.demo)
      if (!res.data) setNotFound(true)
      else setDoc(res.data)
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load, offline])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-[720px] rounded-xl" />
      </div>
    )
  }

  if (notFound || !doc) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <ShieldAlert className="size-8 text-rose-500/60" />
          <div className="text-sm">发文不存在或已删除</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate("/document/send")}>
              <ArrowLeft className="size-3.5" /> 返回列表
            </Button>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const isPlain = doc.headerType === "PLAIN"

  return (
    <div className="space-y-4">
      {demo && <DemoBanner />}

      {/* 办文信息卡：突出关键项（标题 / 文号 / 密级·紧急 / 状态 / 当前环节·办理人），次要项弱化网格 */}
      <Card>
        <CardContent className="space-y-4 p-4 md:p-5">
          {/* 标题行 + 操作 */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => navigate("/document/send")}
              >
                <ArrowLeft className="size-4.5" />
              </Button>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold leading-snug">{doc.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <DocTypeBadge docType={doc.docType} />
                  <SecretBadge secret={doc.secret} />
                  <UrgencyBadge urgency={doc.urgency} />
                  <Badge variant="outline" className="text-muted-foreground">
                    {isPlain ? "白头文件" : "红头公文"}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">{doc.code}</span>
                  <GwStatusBadge direction="SEND" status={doc.status} />
                  {doc.sealStatus === "SEALED" && (
                    <span className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400">
                      <Stamp className="size-3.5" /> 已用印
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <GwPredictButton doc={doc} />
              <Button variant="ghost" size="icon" className="size-8" title="刷新" onClick={() => void load()}>
                <RotateCw className="size-4" />
              </Button>
            </div>
          </div>

          {/* 当前环节 + 办理人（进行中才显示） */}
          {doc.currentNode && doc.status !== "ARCHIVED" && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground">当前环节</span>
                <span className="font-medium text-foreground">{doc.currentNode}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground">当前办理人</span>
                <span className="font-medium text-foreground">{doc.currentAssignee ?? "按规则运行时确定"}</span>
              </div>
            </div>
          )}

          {/* 办文动作条 */}
          <div className="empty:hidden">
            <OpinionActionBar doc={doc} onUpdated={setDoc} />
          </div>

          {/* 次要项：规整 key-value 网格（弱化） */}
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t pt-3.5 sm:grid-cols-3 lg:grid-cols-4">
            <Field label="拟稿人">{doc.drafter ?? "—"}</Field>
            <Field label="签发人">{doc.issuer ?? "—"}</Field>
            <Field label="成文日期">{gwFormatDate(doc.docDate)}</Field>
            <Field label={isPlain ? "印发机关" : "发文机关"}>{doc.issuingOrg ?? "—"}</Field>
            <Field label="主送">{doc.mainRecipients ?? "—"}</Field>
            {doc.ccRecipients && <Field label="抄送">{doc.ccRecipients}</Field>}
            {doc.copyNo && <Field label="份号">{doc.copyNo}</Field>}
            {doc.annotation && <Field label="附注">{doc.annotation}</Field>}
          </dl>

          {/* 附件 */}
          {doc.attachments && doc.attachments.length > 0 && (
            <div className="border-t pt-3.5">
              <div className="mb-1.5 text-xs text-muted-foreground">附件（{doc.attachments.length}）</div>
              <div className="flex flex-wrap gap-2">
                {doc.attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm">
                    <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="max-w-52 truncate">{a.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 办理记录 / 正文 / 流程图 */}
      <Card className="gap-0 py-0">
        <Tabs defaultValue="timeline">
          <div className="border-b px-4 pt-3">
            <TabsList>
              <TabsTrigger value="timeline" className="gap-1.5">
                <History className="size-3.5" /> 办理记录
                {doc.opinions?.length ? (
                  <span className="text-xs text-muted-foreground">({doc.opinions.length})</span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="content" className="gap-1.5">
                <FileText className="size-3.5" /> 正文
              </TabsTrigger>
              <TabsTrigger value="flow" className="gap-1.5">
                <GitBranch className="size-3.5" /> 流程图
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="timeline" className="m-0 px-4 py-3">
            <OpinionTimeline items={doc.opinions ?? []} />
          </TabsContent>
          <TabsContent value="content" className="m-0 px-4 py-3">
            {doc.content ? (
              <div
                className="prose-sm mx-auto max-w-2xl text-sm leading-7 text-foreground/90 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-6"
                // eslint-disable-next-line react/no-danger — 已 sanitize
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(doc.content) }}
              />
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">暂无正文</div>
            )}
          </TabsContent>
          <TabsContent value="flow" className="m-0 p-3">
            <DocFlowTrack doc={doc} />
          </TabsContent>
        </Tabs>
      </Card>

      {/* 红头正文预览：整幅全宽居中（A4 版心居中），更大更清楚 */}
      <Card className="overflow-hidden py-0">
        <GongwenPreview doc={doc} className="min-h-[720px]" />
      </Card>
    </div>
  )
}

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, FileText, History, RotateCw, ShieldAlert, Users } from "lucide-react"
import { sanitizeHtml } from "@/lib/sanitize"
import { useAuthStore } from "@/stores/auth-store"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GongwenPreview } from "@/components/gongwen/gongwen-preview"
import { fetchDoc } from "./gongwen/mock"
import { gwFormatDate, type GwDoc } from "./gongwen/types"
import { DocTypeBadge, GwStatusBadge, SecretBadge, UrgencyBadge } from "./gongwen/badges"
import { OpinionActionBar, OpinionTimeline } from "./gongwen/handling"
import { CirculationPanel } from "./gongwen/circulation"
import { DemoBanner } from "./gongwen/shared"

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}

export default function ReceiveDetailPage() {
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
      const res = await fetchDoc(Number(id), "RECEIVE")
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
        <Skeleton className="h-24 rounded-xl" />
        <div className="grid gap-4 xl:grid-cols-5">
          <Skeleton className="h-96 rounded-xl xl:col-span-2" />
          <Skeleton className="h-[640px] rounded-xl xl:col-span-3" />
        </div>
      </div>
    )
  }

  if (notFound || !doc) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <ShieldAlert className="size-8 text-rose-500/60" />
          <div className="text-sm">收文不存在或已删除</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate("/document/receive")}>
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

  const circCount = doc.circulations?.length ?? 0

  return (
    <div className="space-y-4">
      {demo && <DemoBanner />}

      {/* 顶部：标题 / 元信息 / 办文动作条（分层，对齐审批详情观感） */}
      <Card className="py-4">
        <CardContent className="space-y-3 px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => navigate("/document/receive")}>
                <ArrowLeft className="size-4.5" />
              </Button>
              <h1 className="truncate text-base font-semibold">{doc.title}</h1>
              <GwStatusBadge direction="RECEIVE" status={doc.status} />
            </div>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" title="刷新" onClick={() => void load()}>
              <RotateCw className="size-4" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-10 text-xs text-muted-foreground">
            <span>收文号：{doc.registerNo ?? doc.code}</span>
            <span>来文单位：{doc.sourceUnit ?? "—"}</span>
            <span>来文字号：{doc.sourceCode ?? "—"}</span>
            <span>收文日期：{gwFormatDate(doc.receivedAt)}</span>
            {doc.currentNode && <span className="font-medium text-foreground/75">当前环节：{doc.currentNode}</span>}
          </div>
          <div className="pl-10 empty:hidden">
            <OpinionActionBar doc={doc} onUpdated={setDoc} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-5">
        {/* 左：来文信息 + 办理记录/传阅单/正文 */}
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">来文信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <MetaRow label="文种">
                <DocTypeBadge docType={doc.docType} />
              </MetaRow>
              <MetaRow label="密级 / 缓急">
                <span className="flex items-center gap-2">
                  <SecretBadge secret={doc.secret} />
                  <UrgencyBadge urgency={doc.urgency} />
                </span>
              </MetaRow>
              <MetaRow label="来文单位">{doc.sourceUnit ?? "—"}</MetaRow>
              <MetaRow label="来文字号">{doc.sourceCode ?? "—"}</MetaRow>
              <MetaRow label="收文日期">{gwFormatDate(doc.receivedAt)}</MetaRow>
              <MetaRow label="成文日期">{gwFormatDate(doc.docDate)}</MetaRow>
            </CardContent>
          </Card>

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
                  <TabsTrigger value="circulation" className="gap-1.5">
                    <Users className="size-3.5" /> 传阅单
                    {circCount ? <span className="text-xs text-muted-foreground">({circCount})</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="content" className="gap-1.5">
                    <FileText className="size-3.5" /> 正文
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="timeline" className="m-0 px-4 py-3">
                <OpinionTimeline items={doc.opinions ?? []} />
              </TabsContent>
              <TabsContent value="circulation" className="m-0 px-4 py-3">
                <CirculationPanel doc={doc} onUpdated={setDoc} />
              </TabsContent>
              <TabsContent value="content" className="m-0 px-4 py-3">
                {doc.content ? (
                  <div
                    className="prose-sm max-w-none text-sm leading-7 text-foreground/90 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-6"
                    // eslint-disable-next-line react/no-danger — 已 sanitize
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(doc.content) }}
                  />
                ) : (
                  <div className="py-6 text-center text-sm text-muted-foreground">暂无来文正文</div>
                )}
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        {/* 右：来文原件版式预览（GB/T 9704），随左栏滚动吸顶 */}
        <div className="xl:col-span-3">
          <Card className="overflow-hidden py-0 xl:sticky xl:top-4">
            <GongwenPreview doc={doc} className="min-h-[640px]" />
          </Card>
        </div>
      </div>
    </div>
  )
}

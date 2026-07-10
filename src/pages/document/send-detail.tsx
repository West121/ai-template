import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Paperclip, RotateCw, ShieldAlert, Stamp } from "lucide-react"
import { sanitizeHtml } from "@/lib/sanitize"
import { useAuthStore } from "@/stores/auth-store"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { GongwenPreview } from "@/components/gongwen/gongwen-preview"
import { fetchDoc } from "./gongwen/mock"
import { gwFormatDate, gwFormatTime, type GwDoc } from "./gongwen/types"
import { DocTypeBadge, GwStatusBadge, SecretBadge, UrgencyBadge } from "./gongwen/badges"
import { OpinionActionBar, OpinionTimeline } from "./gongwen/handling"
import { DemoBanner } from "./gongwen/shared"

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
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
        <Skeleton className="h-20 rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-5">
          <Skeleton className="h-96 rounded-xl lg:col-span-2" />
          <Skeleton className="h-[600px] rounded-xl lg:col-span-3" />
        </div>
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

  return (
    <div className="space-y-4">
      {demo && <DemoBanner />}

      {/* 顶部：标题 + 状态 + 动作条 */}
      <Card className="py-4">
        <CardContent className="space-y-3 px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => navigate("/document/send")}>
                <ArrowLeft className="size-4.5" />
              </Button>
              <h1 className="truncate text-base font-semibold">{doc.title}</h1>
              <GwStatusBadge direction="SEND" status={doc.status} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <OpinionActionBar doc={doc} onUpdated={setDoc} />
              <Button variant="ghost" size="icon" className="size-8" title="刷新" onClick={() => void load()}>
                <RotateCw className="size-4" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-10 text-xs text-muted-foreground">
            <span>文号：{doc.code}</span>
            <span>拟稿：{doc.drafter ?? "—"}</span>
            {doc.currentNode && <span className="font-medium text-foreground/75">当前环节：{doc.currentNode}</span>}
            {doc.sealStatus === "SEALED" && (
              <span className="flex items-center gap-1 text-violet-600">
                <Stamp className="size-3.5" /> 已用印
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* 左：办文信息 + 办理时间线 */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">办文信息</CardTitle>
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
              <MetaRow label="发文机关">{doc.issuingOrg ?? "—"}</MetaRow>
              <MetaRow label="主送">{doc.mainRecipients ?? "—"}</MetaRow>
              {doc.ccRecipients && <MetaRow label="抄送">{doc.ccRecipients}</MetaRow>}
              {doc.issuer && <MetaRow label="签发人">{doc.issuer}</MetaRow>}
              <MetaRow label="成文日期">{gwFormatDate(doc.docDate)}</MetaRow>
              {doc.copyNo && <MetaRow label="份号">{doc.copyNo}</MetaRow>}
              {doc.annotation && <MetaRow label="附注">{doc.annotation}</MetaRow>}

              {doc.attachments && doc.attachments.length > 0 && (
                <div className="pt-1">
                  <div className="mb-1 text-xs text-muted-foreground">附件</div>
                  <div className="space-y-1">
                    {doc.attachments.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                        <Paperclip className="size-3.5 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                办理时间线
                {doc.opinions?.length ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">({doc.opinions.length})</span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <OpinionTimeline items={doc.opinions ?? []} />
            </CardContent>
          </Card>

          {/* 正文源文（富文本，只读） */}
          {doc.content && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">正文</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="prose-sm max-w-none text-sm leading-7 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-6"
                  // eslint-disable-next-line react/no-danger — 已 sanitize
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(doc.content) }}
                />
              </CardContent>
            </Card>
          )}
        </div>

        {/* 右：红头正文预览（GB/T 9704） */}
        <div className="lg:col-span-3">
          <Card className="overflow-hidden py-0">
            <GongwenPreview doc={doc} className="min-h-[600px]" />
          </Card>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            预览由后端 render 返回红头正文 HTML（演示态本地按 GB/T 9704 版式生成）· 成文日期：{gwFormatTime(doc.createdAt)}
          </p>
        </div>
      </div>
    </div>
  )
}

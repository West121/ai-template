/**
 * 开发者工作台（Dev Studio）· 批W1（docs/design/dev-studio.md，主控拍板附录）。
 * 左·资产树（四类分组+搜索+状态过滤+徽标）｜中·编辑区（CodeEditor(json,lint,expandable)
 * 只读预览态→编辑态、保存草稿/发布两键+发布确认、409 冲突提示、用设计器打开）｜版本侧滑
 * （列表·人/AI 归属·查看·对比当前 buildLineDiff·回滚确认）。W2 才有 AI 栏。
 * 防白屏：三岛各包 ErrorBoundary；列表/内容归一；非法 JSON 资产只读降级不进编辑。
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Braces,
  CloudOff,
  ExternalLink,
  FileClock,
  Loader2,
  Pencil,
  RefreshCw,
  Rocket,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  SquareCode,
  TriangleAlert,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ApiError } from "@/lib/api"
import { ErrorBoundary } from "@/components/error-boundary"
import { CodeEditor } from "@/components/code-editor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"
import { buildLineDiff } from "@/pages/knowledge/diff-util"
import {
  ASSET_TYPE_META,
  DevConflictError,
  STATUS_META,
  fetchDevAsset,
  fetchDevAssets,
  fetchDevVersionContent,
  fetchDevVersions,
  rollbackDevAsset,
  saveDevAsset,
  type DevAsset,
  type DevAssetDetail,
  type DevAssetType,
  type DevAssetVersion,
} from "./dev-studio-api"

const TYPE_ORDER: DevAssetType[] = ["ORCH", "PROCESS", "FORM", "BIZDOC_TPL"]

/** 右栏 AI 助手（批W2）：懒加载（chat-view 重依赖不拖累首屏） */
const DevStudioAssistantPane = lazy(() => import("./assistant-pane").then((m) => ({ default: m.DevStudioAssistantPane })))

/** JSON pretty（失败回 null → 调用方降级只读原文） */
function tryPretty(raw: string): string | null {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return null
  }
}

/** 发布确认文案（按资产生命周期，「立即生效」挂发布动作） */
const PUBLISH_COPY: Record<DevAssetType, string> = {
  ORCH: "将重新编译编排并立即对新触发生效（运行中的执行不受影响）。",
  PROCESS: "将转换为 BPMN 并重新部署到引擎——发布后新发起的实例走新定义，运行中实例不受影响。",
  FORM: "发布后该版本冻结不可修改，消费流程按 code:version 定版取用。",
  BIZDOC_TPL: "发布后打印/渲染立即使用新版本。",
}

/* ============================ 左·资产树 ============================ */

type StatusFilter = "ALL" | "DRAFT" | "PUBLISHED"

function AssetTree({
  assets,
  loading,
  selected,
  onSelect,
  onRefresh,
}: {
  assets: DevAsset[]
  loading: boolean
  selected: { type: DevAssetType; code: string } | null
  onSelect: (a: DevAsset) => void
  onRefresh: () => void
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("ALL")

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hit = (a: DevAsset) =>
      (q === "" || a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)) &&
      (status === "ALL" || (status === "DRAFT" ? a.status === "DRAFT" : a.status !== "DRAFT"))
    return TYPE_ORDER.map((type) => ({ type, items: assets.filter((a) => a.type === type && hit(a)) }))
  }, [assets, query, status])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-1.5 border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜资产名 / 编码" className="h-7 pl-7 text-xs" />
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              { key: "ALL", label: "全部" },
              { key: "DRAFT", label: "草稿" },
              { key: "PUBLISHED", label: "已发布" },
            ] as { key: StatusFilter; label: string }[]
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatus(f.key)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                status === f.key ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
          <Button variant="ghost" size="icon" className="ml-auto size-6" aria-label="刷新资产" onClick={onRefresh}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {groups.every((g) => g.items.length === 0) && !loading && (
          <p className="py-8 text-center text-xs text-muted-foreground">暂无资产</p>
        )}
        {groups.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.type}>
                <div className="px-1 py-1 text-[11px] font-medium text-muted-foreground">
                  {ASSET_TYPE_META[g.type].label}（{g.items.length}）
                </div>
                <ul className="space-y-0.5">
                  {g.items.map((a) => {
                    const active = selected?.type === a.type && selected?.code === a.code
                    const st = STATUS_META[a.status]
                    return (
                      <li key={`${a.type}:${a.code}`}>
                        <button
                          type="button"
                          onClick={() => onSelect(a)}
                          className={cn(
                            "flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                            active ? "bg-primary/10 text-primary" : "hover:bg-muted",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{a.name}</span>
                            <span className="block truncate font-mono text-[10px] text-muted-foreground">{a.code}</span>
                          </span>
                          <Badge variant="outline" className={cn("h-4 shrink-0 px-1 text-[10px]", st?.className)}>
                            {st?.label ?? a.status}
                          </Badge>
                          {a.version > 0 && <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">v{a.version}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ),
        )}
      </div>
    </div>
  )
}

/* ============================ 行级 diff 渲染（复用知识库 buildLineDiff） ============================ */

function DiffView({ before, after }: { before: string; after: string }) {
  const ops = useMemo(() => buildLineDiff(before, after), [before, after])
  return (
    <div className="min-w-0 overflow-x-auto rounded-md border bg-background font-mono text-[11px] leading-5">
      {ops.map((op, i) => (
        <div
          key={i}
          className={cn(
            "whitespace-pre px-2",
            op.type === "add" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
            op.type === "del" && "bg-rose-500/10 text-rose-700 line-through dark:text-rose-400",
            op.type === "same" && "text-muted-foreground",
          )}
        >
          {op.type === "add" ? "+ " : op.type === "del" ? "- " : "  "}
          {op.text || " "}
        </div>
      ))}
    </div>
  )
}

/* ============================ 版本侧滑 ============================ */

function VersionsSheet({
  open,
  onOpenChange,
  asset,
  currentContent,
  onRolledBack,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  asset: { type: DevAssetType; code: string; name: string } | null
  currentContent: string
  onRolledBack: () => void
}) {
  const [versions, setVersions] = useState<DevAssetVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedNo, setSelectedNo] = useState<number | null>(null)
  const [mode, setMode] = useState<"view" | "diff">("view")
  const [versionContent, setVersionContent] = useState<string>("")
  const [rollbackNo, setRollbackNo] = useState<number | null>(null)
  const [rollingBack, setRollingBack] = useState(false)

  useEffect(() => {
    if (!open || !asset) return
    setLoading(true)
    setSelectedNo(null)
    setVersionContent("")
    fetchDevVersions(asset.type, asset.code)
      .then((r) => setVersions(r.data))
      .catch((e) => toast.error(e instanceof Error ? e.message : "版本列表加载失败"))
      .finally(() => setLoading(false))
  }, [open, asset])

  const pickVersion = (v: DevAssetVersion) => {
    if (!asset) return
    setSelectedNo(v.versionNo)
    if (typeof v.content === "string" && v.content) {
      setVersionContent(tryPretty(v.content) ?? v.content)
      return
    }
    fetchDevVersionContent(asset.type, asset.code, v.versionNo)
      .then((r) => setVersionContent(tryPretty(r.data) ?? r.data))
      .catch((e) => toast.error(e instanceof Error ? e.message : "版本内容加载失败"))
  }

  const doRollback = async () => {
    if (!asset || rollbackNo == null) return
    setRollingBack(true)
    try {
      const r = await rollbackDevAsset(asset.type, asset.code, rollbackNo)
      toast.success(`已回滚到 v${rollbackNo}（新版本 v${r.data.version}）${r.demo ? "（演示）" : ""}`)
      setRollbackNo(null)
      onRolledBack()
      onOpenChange(false)
    } catch (e) {
      // PROCESS/BIZDOC_TPL 后端可能回 unsupported → 如实展示
      toast.error(e instanceof Error ? e.message : "回滚失败")
    } finally {
      setRollingBack(false)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-3xl">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2 text-base">
              <FileClock className="size-4 text-primary" /> 历史版本 · {asset?.name}
            </SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1">
            {/* 版本列表 */}
            <div className="w-52 shrink-0 overflow-y-auto border-r p-2">
              {loading ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  <Loader2 className="mx-auto size-4 animate-spin" />
                </p>
              ) : versions.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">暂无版本记录</p>
              ) : (
                <ul className="space-y-0.5">
                  {versions.map((v) => (
                    <li key={v.versionNo}>
                      <button
                        type="button"
                        onClick={() => pickVersion(v)}
                        className={cn(
                          "w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                          selectedNo === v.versionNo ? "bg-primary/10 text-primary" : "hover:bg-muted",
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono font-medium tabular-nums">v{v.versionNo}</span>
                          <Badge variant={v.actor === "AI" ? "default" : "outline"} className="h-4 px-1 text-[10px]">
                            {v.actor === "AI" ? "AI" : "人"}
                          </Badge>
                          <span className="min-w-0 truncate text-muted-foreground">{v.actorName ?? ""}</span>
                        </span>
                        {v.summary && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{v.summary}</span>}
                        {v.createdAt && <span className="block text-[10px] text-muted-foreground/70">{v.createdAt.slice(0, 16).replace("T", " ")}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* 详情：查看 / 对比当前 */}
            <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
              {selectedNo == null ? (
                <p className="py-10 text-center text-xs text-muted-foreground">选择左侧版本查看内容或与当前对比</p>
              ) : (
                <>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {(
                      [
                        { key: "view", label: "查看" },
                        { key: "diff", label: "对比当前" },
                      ] as { key: "view" | "diff"; label: string }[]
                    ).map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setMode(t.key)}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                          mode === t.key ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7 gap-1 text-xs text-destructive hover:text-destructive"
                      onClick={() => setRollbackNo(selectedNo)}
                    >
                      回滚到 v{selectedNo}
                    </Button>
                  </div>
                  {mode === "view" ? (
                    <CodeEditor value={versionContent} language="json" readOnly lint={false} minHeight="20rem" maxHeight="60vh" ariaLabel={`v${selectedNo} 内容`} />
                  ) : (
                    <DiffView before={versionContent} after={currentContent} />
                  )}
                </>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* 回滚确认 */}
      <AlertDialog open={rollbackNo != null} onOpenChange={(o) => !o && setRollbackNo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>回滚到 v{rollbackNo}？</AlertDialogTitle>
            <AlertDialogDescription>
              将以该版本内容生成新版本（当前内容仍保留在历史中，可再次回滚）。PROCESS / 打印模板若后端暂不支持回滚，将如实提示。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollingBack}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={rollingBack}
              onClick={(e) => {
                e.preventDefault()
                void doRollback()
              }}
            >
              确认回滚
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/* ============================ 页面 ============================ */

export default function DevStudioPage() {
  const navigate = useNavigate()
  const permissions = useAuthStore((s) => s.permissions)
  const canView = useHasPerm("dev:studio:view")
  const canEdit = useHasPerm("dev:studio:edit")

  const [assets, setAssets] = useState<DevAsset[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [demo, setDemo] = useState(false)

  const [selected, setSelected] = useState<DevAsset | null>(null)
  const [detail, setDetail] = useState<DevAssetDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  /** 内容 JSON 解析失败 → 只读降级（不进编辑不崩） */
  const [parseBroken, setParseBroken] = useState(false)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** dirty 时切换资产的拦截 */
  const [pendingSelect, setPendingSelect] = useState<DevAsset | null>(null)

  const [versionsOpen, setVersionsOpen] = useState(false)
  /** 右栏 AI 助手折叠态（批W2） */
  const [aiOpen, setAiOpen] = useState(true)

  const loadAssets = useCallback(() => {
    setListLoading(true)
    fetchDevAssets()
      .then((r) => {
        setAssets(r.data)
        setDemo(r.demo)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "资产列表加载失败"))
      .finally(() => setListLoading(false))
  }, [])

  useEffect(() => {
    if (permissions !== null && !canView) return
    loadAssets()
  }, [loadAssets, permissions, canView])


  const loadDetail = useCallback((a: DevAsset) => {
    setDetailLoading(true)
    setEditing(false)
    setDirty(false)
    setConflict(false)
    setSaveError(null)
    fetchDevAsset(a.type, a.code)
      .then((r) => {
        const pretty = tryPretty(r.data.content)
        setParseBroken(pretty === null && r.data.content.trim() !== "")
        setDetail({ ...r.data, content: pretty ?? r.data.content })
        setDraft(pretty ?? r.data.content)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "资产内容加载失败"))
      .finally(() => setDetailLoading(false))
  }, [])
  // devDiff 卡确认成功 → 广播 dev-studio:asset-changed → 刷新资产树 + 当前资产内容/版本（批W2）
  useEffect(() => {
    const onChanged = (e: Event) => {
      const d = (e as CustomEvent<{ assetType?: string; code?: string }>).detail
      loadAssets()
      setSelected((cur) => {
        if (cur && (!d || (d.assetType === cur.type && d.code === cur.code))) loadDetail(cur)
        return cur
      })
    }
    window.addEventListener("dev-studio:asset-changed", onChanged)
    return () => window.removeEventListener("dev-studio:asset-changed", onChanged)
  }, [loadAssets, loadDetail])

  const selectAsset = (a: DevAsset) => {
    if (dirty) {
      setPendingSelect(a)
      return
    }
    setSelected(a)
    loadDetail(a)
  }

  // PROCESS 非 GRAPH（DINGTALK/BPMN）→ 只读 + 只给「用设计器打开」
  const rawEditable = !selected || selected.type !== "PROCESS" || (detail?.meta.designerType ?? "GRAPH") === "GRAPH"
  const jsonError = useMemo(() => {
    if (!editing) return null
    try {
      JSON.parse(draft)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : "JSON 无效"
    }
  }, [editing, draft])

  const doSave = async (publish: boolean) => {
    if (!selected || !detail) return
    // 保存前 JSON.parse 校验：非法就地报错，不发请求
    try {
      JSON.parse(draft)
    } catch (e) {
      setSaveError(`JSON 无效：${e instanceof Error ? e.message : String(e)}`)
      return
    }
    setSaving(true)
    setSaveError(null)
    setConflict(false)
    try {
      const r = await saveDevAsset(selected.type, selected.code, { content: draft, baseVersion: detail.version, publish: publish || undefined })
      setDetail((d) => (d ? { ...d, version: r.data.version, content: draft } : d))
      setDirty(false)
      if (publish) setEditing(false)
      toast.success(`${publish ? "已发布" : "已保存草稿"} v${r.data.version}${r.demo ? "（演示）" : ""}`)
      // FORM latest 陷阱（拍板⑨）：新草稿成为 latest 影响发起取数
      if (r.data.meta?.latestPointerChanged) {
        toast.info("新草稿版本已成为 latest（影响发起取数）", { duration: 6000 })
      }
      loadAssets()
    } catch (e) {
      if (e instanceof DevConflictError) {
        setConflict(true)
      } else if (e instanceof ApiError) {
        // 400 校验失败（如流程转换干跑不过）→ 展示错误明细
        setSaveError(e.message)
      } else {
        toast.error(e instanceof Error ? e.message : "保存失败")
      }
    } finally {
      setSaving(false)
    }
  }

  const formatDraft = () => {
    const pretty = tryPretty(draft)
    if (pretty === null) {
      setSaveError("JSON 无效，无法格式化")
      return
    }
    setDraft(pretty)
    setDirty(true)
  }

  /* ---- 权限门 ---- */
  if (permissions !== null && !canView) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <ShieldAlert className="size-8 text-amber-500/70" />
          <div className="text-sm font-medium">没有访问开发者工作台的权限</div>
          <p className="max-w-md text-xs text-muted-foreground">需要 dev:studio:view 权限（受信开发者）。</p>
        </CardContent>
      </Card>
    )
  }

  const statusMeta = detail?.meta.status ? STATUS_META[detail.meta.status] : selected ? STATUS_META[selected.status] : null

  return (
    <div className="-mx-4 -my-4 flex h-[calc(100dvh-6.5rem)] min-h-[34rem] flex-col overflow-hidden md:-mx-5 md:-my-5">
      {/* 顶部条 */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur">
        <SquareCode className="size-4 shrink-0 text-primary" />
        <span className="shrink-0 text-sm font-semibold">开发者工作台</span>
        {selected && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="min-w-0 truncate text-sm">{selected.name}</span>
            <Badge variant="outline" className="h-4.5 shrink-0 px-1.5 text-[10px]">{ASSET_TYPE_META[selected.type].label}</Badge>
            {statusMeta && (
              <Badge variant="outline" className={cn("h-4.5 shrink-0 px-1.5 text-[10px]", statusMeta.className)}>{statusMeta.label}</Badge>
            )}
            {detail && detail.version > 0 && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">v{detail.version}</span>
            )}
            {dirty && <span className="shrink-0 text-[11px] text-amber-600">未保存●</span>}
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            variant={aiOpen ? "secondary" : "outline"}
            size="sm"
            className="h-7 gap-1 text-xs"
            aria-label="AI 改写栏"
            onClick={() => setAiOpen((o) => !o)}
          >
            <Sparkles className="size-3.5" /> AI
          </Button>
          {selected && detail && (
            <>
              {editing && (
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={formatDraft}>
                  <Braces className="size-3.5" /> 格式化
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setVersionsOpen(true)}>
                <FileClock className="size-3.5" /> 版本
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => navigate(ASSET_TYPE_META[selected.type].designerPath(selected.code))}
              >
                <ExternalLink className="size-3.5" /> 用设计器打开
              </Button>
              {!editing ? (
                <Button
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={!canEdit || !rawEditable || parseBroken}
                  title={!canEdit ? "需 dev:studio:edit 权限" : !rawEditable ? "DINGTALK/BPMN 流程请用设计器编辑" : parseBroken ? "JSON 无法解析，只读" : undefined}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-3.5" /> 编辑
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={saving || !!jsonError} onClick={() => void doSave(false)}>
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 保存草稿
                  </Button>
                  <Button size="sm" className="h-7 gap-1 text-xs" disabled={saving || !!jsonError} onClick={() => setPublishOpen(true)}>
                    <Rocket className="size-3.5" /> 发布
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {demo && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
          <CloudOff className="size-3.5 shrink-0" /> 后端门面未接入——当前为演示资产，操作不落库。
        </div>
      )}

      {/* 主体两栏（W2 加 AI 栏） */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-[260px] shrink-0 border-r">
          <ErrorBoundary label="dev-studio-tree">
            <AssetTree assets={assets} loading={listLoading} selected={selected} onSelect={selectAsset} onRefresh={loadAssets} />
          </ErrorBoundary>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <ErrorBoundary key={`${selected?.type}:${selected?.code}:${detail?.version}`} label="dev-studio-editor">
            {!selected ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                <SquareCode className="size-8 opacity-40" />
                <p className="text-sm">从左侧选择一个热资产开始（默认只读预览）</p>
              </div>
            ) : detailLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
                {parseBroken && (
                  <div className="flex shrink-0 items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-2.5 py-1.5 text-xs text-rose-600">
                    <TriangleAlert className="size-3.5 shrink-0" /> 该资产 JSON 无法解析——以原文只读展示，不可进入编辑（防写坏）。
                  </div>
                )}
                {!rawEditable && (
                  <div className="flex shrink-0 items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-600">
                    <TriangleAlert className="size-3.5 shrink-0" /> {detail?.meta.designerType} 方言流程不支持 raw JSON 直编（易破坏结构），请「用设计器打开」。
                  </div>
                )}
                {conflict && (
                  <div className="flex shrink-0 items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-600">
                    <TriangleAlert className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">保存冲突：该资产已被他人修改，请刷新后对比（当前编辑内容将丢弃）。</span>
                    <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => selected && loadDetail(selected)}>
                      刷新
                    </Button>
                  </div>
                )}
                {saveError && (
                  <pre className="max-h-32 shrink-0 overflow-auto whitespace-pre-wrap rounded-md border border-rose-500/30 bg-rose-500/5 px-2.5 py-1.5 font-mono text-[11px] text-rose-600">{saveError}</pre>
                )}
                <div className="min-h-0 flex-1">
                  <CodeEditor
                    value={editing ? draft : (detail?.content ?? "")}
                    onChange={(v) => {
                      setDraft(v)
                      setDirty(true)
                    }}
                    language="json"
                    lint={editing}
                    readOnly={!editing}
                    expandable
                    fill
                    ariaLabel="资产 JSON"
                  />
                </div>
              </div>
            )}
          </ErrorBoundary>
        </main>
        {/* 右·AI 助手栏（批W2）：作用域绑定当前资产；可折叠；懒加载 + ErrorBoundary 岛 */}
        {aiOpen && (
          <aside className="w-[360px] shrink-0 border-l">
            <ErrorBoundary label="dev-studio-ai">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <DevStudioAssistantPane asset={selected ? { type: selected.type, code: selected.code, name: selected.name } : null} />
              </Suspense>
            </ErrorBoundary>
          </aside>
        )}
      </div>

      {/* 发布确认（「立即生效」挂发布动作，文案随资产） */}
      <AlertDialog open={publishOpen} onOpenChange={setPublishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>发布「{selected?.name}」？将立即生效</AlertDialogTitle>
            <AlertDialogDescription>{selected ? PUBLISH_COPY[selected.type] : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault()
                setPublishOpen(false)
                void doSave(true)
              }}
            >
              确认发布
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* dirty 时切资产拦截 */}
      <AlertDialog open={!!pendingSelect} onOpenChange={(o) => !o && setPendingSelect(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>有未保存的修改</AlertDialogTitle>
            <AlertDialogDescription>切换到「{pendingSelect?.name}」将丢弃当前未保存的编辑内容。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const next = pendingSelect
                setPendingSelect(null)
                if (next) {
                  setDirty(false)
                  setSelected(next)
                  loadDetail(next)
                }
              }}
            >
              丢弃并切换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 版本侧滑 */}
      <ErrorBoundary label="dev-studio-versions">
        <VersionsSheet
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
          asset={selected}
          currentContent={editing ? draft : (detail?.content ?? "")}
          onRolledBack={() => {
            if (selected) loadDetail(selected)
            loadAssets()
          }}
        />
      </ErrorBoundary>
    </div>
  )
}

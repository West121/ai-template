/**
 * 编排设计器整页（/automation/:code/design；/automation/new?code=&name= 新建）。
 *
 * 顶部条：名称 / 触发器徽标 / 错误工作流选择（§8 P0）/ 校验 / 整理 / 保存 / 发布（编译报错展示）/
 * 启停开关 / 测试运行（模拟 payload → run → 轮询 exec 详情逐节点回放状态与输入输出）。
 * 后端未就绪：mock 先行（保存/发布/运行皆有演示行为），offline 降级同约定。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ArrowLeft, ChevronDown, ChevronRight, CircleCheck, FlaskConical, History, LayoutDashboard, Loader2, Save, Send, Undo2, Zap } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Drawer } from "@/components/drawer"
import { Textarea } from "@/components/ui/textarea"
import {
  fetchCredentials,
  fetchExecDetail,
  fetchFlow,
  fetchFlows,
  fetchFlowVersion,
  fetchFlowVersions,
  publishFlow,
  rollbackFlowVersion,
  runFlow,
  saveFlow,
  toggleFlow,
  type OrchCredential,
  type OrchExec,
  type OrchFlow,
  type OrchFlowVersion,
} from "./mock"
import type { OrchModel, TriggerConfig, TriggerType } from "./designer/model"
import { parseOrchModel, type OrchExecNodeStatus } from "./designer/serialize"
import { ErrorBoundary } from "@/components/error-boundary"
import { OrchDesigner, type OrchDesignerHandle } from "./designer/orch-designer"
import { ExecNodeTimeline, WaitingResumeBar } from "./exec-view"

/* ---------------- 版本历史抽屉（§9.5） ---------------- */

function VersionsDrawer({
  flow,
  open,
  onClose,
  onRolledBack,
}: {
  flow: OrchFlow | null
  open: boolean
  onClose: () => void
  /** 回滚成功：外层重载模型 */
  onRolledBack: (flow: OrchFlow) => void
}) {
  const [versions, setVersions] = useState<OrchFlowVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [openVersion, setOpenVersion] = useState<number | null>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !flow) return
    let cancelled = false
    setLoading(true)
    setOpenVersion(null)
    fetchFlowVersions(flow.id)
      .then((res) => {
        if (!cancelled) setVersions(res.data)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, flow])

  const view = async (v: OrchFlowVersion) => {
    if (openVersion === v.version) {
      setOpenVersion(null)
      return
    }
    setOpenVersion(v.version)
    setSnapshot(null)
    const res = await fetchFlowVersion(flow!.id, v.version)
    const model = parseOrchModel(res.data?.designerJson)
    setSnapshot(
      model
        ? `节点 ${model.nodes.length} 个 · 连线 ${model.edges.length} 条\n\n${JSON.stringify(model, null, 2)}`
        : "（快照缺失或解析失败）",
    )
  }

  const rollback = async (v: OrchFlowVersion) => {
    if (!flow) return
    if (!window.confirm(`确定回滚到 v${v.version}？当前设计将被该版本快照覆盖（会发布为新版本）。`)) return
    setBusy(true)
    try {
      const res = await rollbackFlowVersion(flow.id, v.version)
      toast.success(`已回滚到 v${v.version}（新版本 v${res.data.version}）`)
      onRolledBack(res.data)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "回滚失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} title={`版本历史 · ${flow?.name ?? ""}`} description="每次发布留存快照；回滚 = 以该版本覆盖当前设计并发布新版本" width={520}>
      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>
      ) : versions.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">暂无发布版本（保存并发布后生成）</div>
      ) : (
        <div className="space-y-1.5">
          {versions.map((v) => (
            <div key={v.id} className="rounded-md border">
              <div className="flex items-center gap-2 px-2.5 py-2">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void view(v)}>
                  {openVersion === v.version ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                  <Badge variant="outline" className="shrink-0 font-mono text-[11px]">
                    v{v.version}
                  </Badge>
                  <span className="shrink-0 text-xs text-muted-foreground">{v.publishedAt.slice(5, 16).replace("T", " ")}</span>
                  {v.publishedBy && <span className="shrink-0 text-xs text-muted-foreground">{v.publishedBy}</span>}
                  {v.remark && <span className="truncate text-xs text-muted-foreground">· {v.remark}</span>}
                </button>
                {v.version !== flow?.version && (
                  <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1 text-xs" disabled={busy} onClick={() => void rollback(v)}>
                    <Undo2 className="size-3" /> 回滚
                  </Button>
                )}
                {v.version === flow?.version && (
                  <Badge variant="outline" className="shrink-0 border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-600">
                    当前
                  </Badge>
                )}
              </div>
              {openVersion === v.version && (
                <pre className="max-h-64 overflow-auto border-t bg-muted/30 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all">
                  {snapshot ?? "加载快照…"}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}

const TRIGGER_BADGE: Record<TriggerType, string> = {
  MANUAL: "手动",
  CRON: "定时",
  EVENT: "事件",
  WEBHOOK: "Webhook",
}

function blankModel(key: string, name: string): OrchModel {
  return {
    schemaVersion: 1,
    key: key || "orch_flow",
    name: name || "未命名编排",
    nodes: [
      { id: "t1", type: "trigger", name: "触发器", position: { x: 260, y: 20 }, config: { triggerType: "MANUAL" } },
      { id: "end1", type: "end", name: "结束", position: { x: 260, y: 260 }, config: {} },
    ],
    edges: [],
  }
}

export default function AutomationDesignerPage() {
  const { code } = useParams<{ code: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isNew = !code || code === "new"

  const [flow, setFlow] = useState<OrchFlow | null>(null)
  const [model, setModel] = useState<OrchModel | null>(null)
  const [name, setName] = useState("")
  const [flowCode, setFlowCode] = useState("")
  const [errorFlowId, setErrorFlowId] = useState<number | null>(null)
  const [credentials, setCredentials] = useState<OrchCredential[]>([])
  const [flows, setFlows] = useState<OrchFlow[]>([])
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  // 测试运行
  const [testOpen, setTestOpen] = useState(false)
  const [payloadText, setPayloadText] = useState('{\n  "docId": 8101\n}')
  const [running, setRunning] = useState(false)
  const [testExec, setTestExec] = useState<OrchExec | null>(null)
  const pollRef = useRef<number | null>(null)
  // 版本历史（§9.5）
  const [versionsOpen, setVersionsOpen] = useState(false)

  const designerRef = useRef<OrchDesignerHandle>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const [credRes, flowsRes] = await Promise.all([fetchCredentials(), fetchFlows()])
      if (cancelled) return
      setCredentials(credRes.data)
      setFlows(flowsRes.data)
      setDemo(credRes.demo)
      if (isNew) {
        const c = searchParams.get("code") ?? ""
        const n = searchParams.get("name") ?? ""
        setFlowCode(c)
        setName(n)
        setModel(blankModel(c, n))
        setDirty(true)
        setLoading(false)
        return
      }
      const res = await fetchFlow(code!)
      if (cancelled) return
      if (!res.data) {
        toast.error("编排不存在")
        navigate("/automation")
        return
      }
      setFlow(res.data)
      setFlowCode(res.data.code)
      setName(res.data.name)
      setErrorFlowId(res.data.errorFlowId ?? null)
      setModel(parseOrchModel(res.data.designerJson) ?? blankModel(res.data.code, res.data.name))
      setDemo(res.demo)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [code, isNew, searchParams, navigate])

  // 卸载清轮询
  useEffect(
    () => () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current)
    },
    [],
  )

  const triggerType: TriggerType = (() => {
    const m = designerRef.current?.getModel() ?? model
    const t = m?.nodes.find((n) => n.type === "trigger")
    return ((t?.config as TriggerConfig | undefined)?.triggerType ?? "MANUAL") as TriggerType
  })()

  const doSave = useCallback(async (): Promise<OrchFlow | null> => {
    const m = designerRef.current?.getModel()
    if (!m) return null
    if (!flowCode.trim() || !name.trim()) {
      toast.error("请填写编排名称与编码")
      return null
    }
    setSaving(true)
    try {
      const t = m.nodes.find((n) => n.type === "trigger")
      const res = await saveFlow({
        id: flow?.id ?? null,
        code: flowCode.trim(),
        name: name.trim(),
        designerJson: JSON.stringify({ ...m, key: flowCode.trim(), name: name.trim() }),
        triggerType: ((t?.config as TriggerConfig | undefined)?.triggerType ?? "MANUAL") as TriggerType,
        errorFlowId,
      })
      setFlow(res.data)
      setDirty(false)
      toast.success("已保存")
      if (isNew) navigate(`/automation/${flowCode.trim()}/design`, { replace: true })
      return res.data
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败")
      return null
    } finally {
      setSaving(false)
    }
  }, [flow, flowCode, name, errorFlowId, isNew, navigate])

  const doPublish = useCallback(async () => {
    const issues = designerRef.current?.validate() ?? []
    const errors = issues.filter((i) => i.level === "error")
    if (errors.length > 0) {
      toast.error(`校验未通过：${errors.length} 个错误，请先修复`)
      return
    }
    const saved = await doSave()
    if (!saved) return
    setPublishError(null)
    try {
      await publishFlow(saved.id)
      toast.success("已发布（编译为 LiteFlow EL 并缓存）")
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "发布失败")
    }
  }, [doSave])

  const doToggle = useCallback(
    async (enabled: boolean) => {
      if (!flow) return
      try {
        await toggleFlow(flow.id, enabled)
        setFlow({ ...flow, enabled })
        toast.success(enabled ? "已启用" : "已停用")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "操作失败")
      }
    },
    [flow],
  )

  /* ---- 测试运行：run → 轮询 exec 详情 → 回放到画布 ---- */
  const startTestRun = useCallback(async () => {
    let payload: Record<string, unknown>
    try {
      payload = payloadText.trim() ? (JSON.parse(payloadText) as Record<string, unknown>) : {}
    } catch {
      toast.error("模拟 payload 不是合法 JSON")
      return
    }
    const saved = await doSave()
    if (!saved) return
    setRunning(true)
    setTestExec(null)
    try {
      const res = await runFlow(saved.id, payload)
      const execId = res.data.execId
      const poll = async () => {
        const detail = await fetchExecDetail(execId)
        if (!detail.data) return
        setTestExec(detail.data)
        const statusById: Record<string, OrchExecNodeStatus> = {}
        for (const n of detail.data.nodes ?? []) statusById[n.nodeId] = n.status
        designerRef.current?.applyExecStatus(statusById)
        if (detail.data.status !== "RUNNING") {
          if (pollRef.current != null) window.clearInterval(pollRef.current)
          pollRef.current = null
          setRunning(false)
        }
      }
      await poll()
      if (pollRef.current != null) window.clearInterval(pollRef.current)
      pollRef.current = window.setInterval(() => void poll(), 1200)
    } catch (err) {
      setRunning(false)
      toast.error(err instanceof Error ? err.message : "运行失败")
    }
  }, [payloadText, doSave])

  const closeTest = () => {
    setTestOpen(false)
    designerRef.current?.applyExecStatus(null)
    if (pollRef.current != null) window.clearInterval(pollRef.current)
    pollRef.current = null
    setRunning(false)
  }

  if (loading || !model) {
    return (
      <div className="flex h-[70vh] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">加载编排…</span>
      </div>
    )
  }

  return (
    <div className="-mx-4 -my-4 flex h-[calc(100dvh-6.5rem)] min-h-[34rem] flex-col overflow-hidden md:-mx-5 md:-my-5">
      {/* 顶部条 */}
      <div className="flex h-14 shrink-0 flex-wrap items-center gap-2 border-b bg-background/95 px-3 backdrop-blur">
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate("/automation")}>
          <ArrowLeft className="size-4" />
          退出
        </Button>
        <div className="mx-1 h-6 w-px bg-border" />
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setDirty(true)
          }}
          placeholder="未命名编排"
          className="h-8 w-48 border-transparent text-sm font-semibold hover:border-input focus-visible:border-ring"
        />
        {isNew && (
          <Input
            value={flowCode}
            onChange={(e) => {
              setFlowCode(e.target.value)
              setDirty(true)
            }}
            placeholder="编码 如 sync_users"
            className="h-8 w-36 font-mono text-xs"
          />
        )}
        <Badge variant="secondary" className="gap-1">
          <Zap className="size-3" />
          {TRIGGER_BADGE[triggerType]}
        </Badge>
        {demo && (
          <Badge variant="outline" className="border-amber-500/40 text-amber-600">
            演示（后端未连接）
          </Badge>
        )}
        <span className={cn("ml-1 flex items-center gap-1 text-xs", dirty ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
          {dirty ? <span className="size-1.5 rounded-full bg-current" /> : <CircleCheck className="size-3.5 text-emerald-600" />}
          {dirty ? "未保存" : "已保存"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* 错误工作流（§8 P0）：整流失败时触发的编排 */}
          <div className="hidden items-center gap-1.5 lg:flex">
            <Label className="text-xs text-muted-foreground">错误工作流</Label>
            <Select
              value={errorFlowId != null ? String(errorFlowId) : "none"}
              onValueChange={(v) => {
                setErrorFlowId(v === "none" ? null : Number(v))
                setDirty(true)
              }}
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">无</SelectItem>
                {flows
                  .filter((f) => f.code !== flowCode)
                  .map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {flow && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              启用
              <Switch checked={flow.enabled} onCheckedChange={(v) => void doToggle(v)} />
            </label>
          )}
          <Button variant="outline" size="sm" className="h-8" onClick={() => designerRef.current?.validate()}>
            校验
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => designerRef.current?.autoLayout()}>
            <LayoutDashboard className="size-3.5" />
            整理
          </Button>
          {flow && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setVersionsOpen(true)}>
              <History className="size-3.5" />
              版本
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setTestOpen(true)}>
            <FlaskConical className="size-3.5" />
            测试运行
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={saving} onClick={() => void doSave()}>
            <Save className="size-3.5" />
            保存
          </Button>
          <Button size="sm" className="h-8 gap-1.5" disabled={saving} onClick={() => void doPublish()}>
            <Send className="size-3.5" />
            发布
          </Button>
        </div>
      </div>

      {publishError && (
        <div className="shrink-0 border-b border-rose-500/30 bg-rose-500/5 px-4 py-2 text-xs text-rose-600 dark:text-rose-400">
          <span className="font-medium">编译/发布失败：</span>
          <span className="font-mono">{publishError}</span>
        </div>
      )}

      {/* 设计器（key 含 version：版本回滚后强制以快照重挂画布）。ErrorBoundary:脏数据崩画布时隔离,不整页白屏 */}
      <ErrorBoundary key={`eb-${flow?.id ?? "new"}-${flow?.version ?? 0}`}>
        <OrchDesigner
          key={`${flow?.id ?? "new"}-${flow?.version ?? 0}`}
          ref={designerRef}
          initialModel={model}
          meta={{ key: flowCode, name }}
          credentials={credentials}
          flows={flows}
          onDirty={() => setDirty(true)}
        />
      </ErrorBoundary>

      {/* 测试运行抽屉 */}
      <Drawer open={testOpen} onOpenChange={(o) => (o ? setTestOpen(true) : closeTest())} title="测试运行" description="保存当前设计并以模拟 payload 触发一次真实执行，逐节点回放结果" width={480}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">模拟 payload（JSON）</Label>
            <Textarea value={payloadText} onChange={(e) => setPayloadText(e.target.value)} rows={5} className="font-mono text-xs" />
          </div>
          <Button className="w-full gap-1.5" disabled={running} onClick={() => void startTestRun()}>
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
            {running ? "执行中…" : "开始运行"}
          </Button>
          {testExec && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                流水 #{testExec.id} · {testExec.status}
                {testExec.error && <span className="ml-2 text-rose-500">{testExec.error}</span>}
              </div>
              {/* WAITING 挂起：展示恢复回调地址（§9.2） */}
              {testExec.status === "WAITING" && <WaitingResumeBar resumeToken={testExec.resumeToken} />}
              <ExecNodeTimeline nodes={testExec.nodes ?? []} />
            </div>
          )}
        </div>
      </Drawer>

      {/* 版本历史抽屉（§9.5）：查看快照 / 回滚 */}
      <VersionsDrawer
        flow={flow}
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        onRolledBack={(next) => {
          // 回滚后以快照重载画布（key 变化强制重挂设计器）
          setFlow(next)
          setModel(parseOrchModel(next.designerJson) ?? model)
          setDirty(false)
        }}
      />
    </div>
  )
}

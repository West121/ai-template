/**
 * 编排节点/边 配置面板。
 *
 * - 按节点类型出表单；动作类节点带通用「重试/失败策略」区。
 * - 变量选择器 VarInsert：payload / vars / 上游节点 outputs 树 / 内置模板函数，点击把 `{{...}}`
 *   插到光标处（模板插值由后端 OrchTemplate 求值，前端只提示不求值）。
 * - script 复用 ScriptEditor；http headers/body 用 CodeMirror JSON；llm=凭据+model+prompt+输出模式。
 * - 边面板：结构化条件（复用 BranchCondition/OPERATOR_META，field 写上下文表达式）+ Aviator 逃生口 + 默认支。
 */
import { useMemo, useRef, useState, type ComponentType, type ReactNode } from "react"
import ReactCodeMirror from "@uiw/react-codemirror"
import { json } from "@codemirror/lang-json"
import { Braces, Plus, Trash2, Variable } from "lucide-react"
import { cn } from "@/lib/utils"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import { ScriptEditor } from "@/components/script-editor"
import { OrgPicker, OrgPickerField, type OrgRef } from "@/components/org-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { OPERATOR_META, type BranchCondition, type ConditionOperator } from "@/pages/workflow/designer/types"
import type { ScriptConfig } from "@/pages/workflow/designer/flow/model"
import type {
  ActionCommon,
  DataMapConfig,
  DelayConfig,
  EndConfig,
  HttpConfig,
  LlmConfig,
  LoopConfig,
  NotifyConfig,
  OrchNodeConfig,
  OrchNodeType,
  ParallelConfig,
  ScriptNodeConfig,
  StartApprovalConfig,
  SubFlowConfig,
  TriggerConfig,
} from "./model"
import type { OrchCredential, OrchFlow } from "../mock"
import { NODE_META } from "./nodes"

/* ============================ 变量选择器 ============================ */

/** 内置模板函数（后端 Aviator 注册，§8 P0；前端仅展示与插入） */
const BUILTIN_FUNCS: { token: string; label: string }[] = [
  { token: "{{now()}}", label: "now() 当前时间戳" },
  { token: "{{today()}}", label: "today() 今天日期" },
  { token: "{{uuid()}}", label: "uuid() 随机 ID" },
  { token: "{{dateFormat(now(),'yyyy-MM-dd')}}", label: "dateFormat() 日期格式化" },
  { token: "{{jsonGet(outputs.n1,'a.b')}}", label: "jsonGet() 取 JSON 路径" },
]

export interface UpstreamNode {
  id: string
  name: string
}

/** 插变量按钮：payload / vars / 上游 outputs / 内置函数 */
function VarInsert({ upstream, onInsert }: { upstream: UpstreamNode[]; onInsert: (token: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" title="插入变量">
          <Variable className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">触发载荷 / 变量</DropdownMenuLabel>
        <DropdownMenuItem className="font-mono text-xs" onSelect={() => onInsert("{{payload}}")}>
          {"{{payload}}"}
          <span className="ml-auto font-sans text-muted-foreground">触发载荷</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="font-mono text-xs" onSelect={() => onInsert("{{payload.}}")}>
          {"{{payload.xxx}}"}
          <span className="ml-auto font-sans text-muted-foreground">载荷字段</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="font-mono text-xs" onSelect={() => onInsert("{{vars.}}")}>
          {"{{vars.xxx}}"}
          <span className="ml-auto font-sans text-muted-foreground">流程变量</span>
        </DropdownMenuItem>
        {upstream.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">上游节点输出</DropdownMenuLabel>
            {upstream.map((n) => (
              <DropdownMenuItem key={n.id} className="font-mono text-xs" onSelect={() => onInsert(`{{outputs.${n.id}}}`)}>
                {`{{outputs.${n.id}}}`}
                <span className="ml-auto max-w-24 truncate font-sans text-muted-foreground">{n.name}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">内置函数</DropdownMenuLabel>
        {BUILTIN_FUNCS.map((f) => (
          <DropdownMenuItem key={f.token} className="text-xs" onSelect={() => onInsert(f.token)}>
            {f.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 带插变量的单行输入（插到光标处） */
function TplInput({
  value,
  onChange,
  upstream,
  placeholder,
  mono = true,
}: {
  value: string
  onChange: (v: string) => void
  upstream: UpstreamNode[]
  placeholder?: string
  mono?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const insert = (token: string) => {
    const el = ref.current
    const pos = el?.selectionStart ?? value.length
    onChange(value.slice(0, pos) + token + value.slice(pos))
    el?.focus()
  }
  return (
    <div className="flex items-center gap-1">
      <Input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn("h-8 text-xs", mono && "font-mono")} />
      <VarInsert upstream={upstream} onInsert={insert} />
    </div>
  )
}

/** 带插变量的多行输入 */
function TplTextarea({
  value,
  onChange,
  upstream,
  placeholder,
  rows = 4,
}: {
  value: string
  onChange: (v: string) => void
  upstream: UpstreamNode[]
  placeholder?: string
  rows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const insert = (token: string) => {
    const el = ref.current
    const pos = el?.selectionStart ?? value.length
    onChange(value.slice(0, pos) + token + value.slice(pos))
    el?.focus()
  }
  return (
    <div className="space-y-1">
      <Textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} className="text-xs" />
      <div className="flex justify-end">
        <VarInsert upstream={upstream} onInsert={insert} />
      </div>
    </div>
  )
}

/** CodeMirror JSON 编辑器（http headers/body） */
function JsonEditor({ value, onChange, placeholder, height = "120px" }: { value: string; onChange: (v: string) => void; placeholder?: string; height?: string }) {
  const dark = isDarkMode(useAppStore((s) => s.themeMode))
  const extensions = useMemo(() => [json()], [])
  return (
    <div className="overflow-hidden rounded-md border text-xs [&_.cm-editor]:text-xs">
      <ReactCodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={dark ? "dark" : "light"}
        height={height}
        placeholder={placeholder}
        basicSetup={{ lineNumbers: false, foldGutter: false }}
      />
    </div>
  )
}

/** 键值映射列表（dataMap 赋值 / startApproval 表单映射 / subFlow payload 映射） */
function KvListEditor({
  items,
  onChange,
  upstream,
  keyPlaceholder,
  exprPlaceholder,
}: {
  items: { k: string; v: string }[]
  onChange: (items: { k: string; v: string }[]) => void
  upstream: UpstreamNode[]
  keyPlaceholder: string
  exprPlaceholder: string
}) {
  const set = (i: number, patch: Partial<{ k: string; v: string }>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-1">
          <Input value={it.k} onChange={(e) => set(i, { k: e.target.value })} placeholder={keyPlaceholder} className="h-8 w-28 shrink-0 font-mono text-xs" />
          <div className="min-w-0 flex-1">
            <TplInput value={it.v} onChange={(v) => set(i, { v })} upstream={upstream} placeholder={exprPlaceholder} />
          </div>
          <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-rose-600" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => onChange([...items, { k: "", v: "" }])}>
        <Plus className="size-3.5" /> 添加
      </Button>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

/* ============================ 通用重试/失败策略 ============================ */

const ON_ERROR_LABEL: Record<NonNullable<ActionCommon["onError"]>, string> = {
  ABORT: "中止整流（默认）",
  CONTINUE: "忽略继续",
  BRANCH: "走错误分支",
}

function ActionCommonFields({ value, onChange }: { value: ActionCommon; onChange: (patch: ActionCommon) => void }) {
  const retryOn = !!value.retry
  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">失败重试</Label>
        <Switch checked={retryOn} onCheckedChange={(v) => onChange({ retry: v ? { times: 3, intervalMs: 1000 } : undefined })} />
      </div>
      {retryOn && value.retry && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="次数">
            <Input type="number" min={1} max={10} value={value.retry.times} onChange={(e) => onChange({ retry: { ...value.retry!, times: Number(e.target.value) || 1 } })} className="h-8 text-xs" />
          </Field>
          <Field label="间隔 ms">
            <Input type="number" min={0} value={value.retry.intervalMs} onChange={(e) => onChange({ retry: { ...value.retry!, intervalMs: Number(e.target.value) || 0 } })} className="h-8 text-xs" />
          </Field>
          <label className="col-span-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">指数退避（间隔逐次翻倍）</span>
            <Switch checked={!!value.retry.backoff} onCheckedChange={(v) => onChange({ retry: { ...value.retry!, backoff: v || undefined } })} />
          </label>
        </div>
      )}
      <Field label="失败策略">
        <Select value={value.onError ?? "ABORT"} onValueChange={(v) => onChange({ onError: v as ActionCommon["onError"] })}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ON_ERROR_LABEL) as NonNullable<ActionCommon["onError"]>[]).map((k) => (
              <SelectItem key={k} value={k}>
                {ON_ERROR_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  )
}

/* ============================ 节点面板 ============================ */

export interface OrchNodePanelProps {
  nodeId: string
  type: OrchNodeType
  name: string
  config: OrchNodeConfig
  /** 上游节点（拓扑上可达当前节点的），变量选择器用 */
  upstream: UpstreamNode[]
  credentials: OrchCredential[]
  /** 其它编排（subFlow 目标选择） */
  flows: OrchFlow[]
  onNameChange: (name: string) => void
  onConfigChange: (config: OrchNodeConfig) => void
}

export function OrchNodePanel(props: OrchNodePanelProps) {
  const { type, name, config, upstream, onNameChange, onConfigChange } = props
  const meta = NODE_META[type]
  const Icon = meta.icon as ComponentType<{ className?: string }>

  const patch = (p: Partial<OrchNodeConfig>) => onConfigChange({ ...config, ...p } as OrchNodeConfig)

  return (
    <div className="space-y-4 p-3.5">
      <div className="flex items-center gap-2">
        <span className={cn("flex size-7 items-center justify-center rounded-md text-white", meta.headerClass)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{meta.label}</div>
          <div className="truncate text-[11px] text-muted-foreground">{meta.description}</div>
        </div>
      </div>

      <Field label="节点名称">
        <Input value={name} onChange={(e) => onNameChange(e.target.value)} className="h-8 text-sm" />
      </Field>

      {type === "trigger" && <TriggerFields config={config as TriggerConfig} patch={patch} />}
      {type === "http" && <HttpFields {...props} config={config as HttpConfig} patch={patch} />}
      {type === "script" && (
        <Field label="脚本（受信，应用完整权限执行）">
          <ScriptEditor value={(config as ScriptNodeConfig).script} onChange={(script: ScriptConfig) => patch({ script })} />
        </Field>
      )}
      {type === "condition" && (
        <p className="rounded-md border border-dashed bg-muted/30 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
          条件节点本身无配置：<span className="font-medium text-foreground">多条出边 = Switch 多路</span>——
          点击每条出边配置其条件（结构化 / Aviator 表达式），并把一条设为默认支（其余都不满足时走）。
        </p>
      )}
      {type === "parallel" && <ParallelFields config={config as ParallelConfig} patch={patch} />}
      {type === "loop" && <LoopFields config={config as LoopConfig} patch={patch} upstream={upstream} />}
      {type === "delay" && (
        <Field label="延时（毫秒，≤ 300000）" hint="编排是短事务；长等待请用审批流。">
          <Input type="number" min={1} max={300000} value={(config as DelayConfig).ms} onChange={(e) => patch({ ms: Number(e.target.value) || 0 })} className="h-8 text-xs" />
        </Field>
      )}
      {type === "notify" && <NotifyFields config={config as NotifyConfig} patch={patch} upstream={upstream} />}
      {type === "startApproval" && <StartApprovalFields config={config as StartApprovalConfig} patch={patch} upstream={upstream} />}
      {type === "dataMap" && (
        <Field label="赋值列表（vars.目标 = Aviator 表达式）" hint="并行 JOIN 之后各支输出都在 outputs 中，可在此直接引用汇总。">
          <KvListEditor
            items={(config as DataMapConfig).assignments.map((a) => ({ k: a.target, v: a.expr }))}
            onChange={(items) => patch({ assignments: items.map((it) => ({ target: it.k, expr: it.v })) })}
            upstream={upstream}
            keyPlaceholder="变量名"
            exprPlaceholder="如 outputs.n1.body.total + 1"
          />
        </Field>
      )}
      {type === "subFlow" && <SubFlowFields {...props} config={config as SubFlowConfig} patch={patch} />}
      {type === "llm" && <LlmFields {...props} config={config as LlmConfig} patch={patch} />}
      {type === "end" && (
        <Field label="流水结果（可选表达式）">
          <TplInput value={(config as EndConfig).output ?? ""} onChange={(v) => patch({ output: v || undefined })} upstream={upstream} placeholder="如 {{vars.summary}}" />
        </Field>
      )}

      {["http", "script", "notify", "startApproval", "dataMap", "subFlow", "llm"].includes(type) && (
        <ActionCommonFields value={config as ActionCommon} onChange={(p) => patch(p)} />
      )}
    </div>
  )
}

/* ---- trigger ---- */

function TriggerFields({ config, patch }: { config: TriggerConfig; patch: (p: Partial<TriggerConfig>) => void }) {
  return (
    <div className="space-y-3">
      <Field label="触发方式">
        <Select value={config.triggerType} onValueChange={(v) => patch({ triggerType: v as TriggerConfig["triggerType"] })}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MANUAL">手动（页面 / API 触发）</SelectItem>
            <SelectItem value="CRON">定时（CRON）</SelectItem>
            <SelectItem value="EVENT">事件（流程 / 公文）</SelectItem>
            <SelectItem value="WEBHOOK">Webhook 入站</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {config.triggerType === "CRON" && (
        <Field label="CRON 表达式" hint="如 0 0 9 * * ?（每天 9 点）">
          <Input value={config.cron ?? ""} onChange={(e) => patch({ cron: e.target.value })} className="h-8 font-mono text-xs" placeholder="0 0 9 * * ?" />
        </Field>
      )}
      {config.triggerType === "EVENT" && (
        <>
          <Field label="事件来源">
            <Select value={config.event?.source ?? "WF"} onValueChange={(v) => patch({ event: { ...(config.event ?? { type: "" }), source: v as "WF" | "GONGWEN" } })}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WF">审批流事件</SelectItem>
                <SelectItem value="GONGWEN">公文事件</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="事件类型" hint="如 INSTANCE_COMPLETED / DOC_ISSUED">
            <Input value={config.event?.type ?? ""} onChange={(e) => patch({ event: { ...(config.event ?? { source: "WF" }), type: e.target.value } })} className="h-8 font-mono text-xs" />
          </Field>
          <Field label="限定流程编码（可选）">
            <Input value={config.event?.defCode ?? ""} onChange={(e) => patch({ event: { ...(config.event ?? { source: "WF", type: "" }), defCode: e.target.value || undefined } })} className="h-8 font-mono text-xs" placeholder="留空 = 全部" />
          </Field>
        </>
      )}
      {config.triggerType === "WEBHOOK" && (
        <Field label="入站地址" hint="token 由后端生成；POST 该地址即触发，body 即 payload。">
          <div className="rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] break-all">
            POST /api/orch/hooks/{config.webhookToken ?? "（发布后生成）"}
          </div>
        </Field>
      )}
    </div>
  )
}

/* ---- http ---- */

function HttpFields({ config, patch, upstream, credentials }: OrchNodePanelProps & { config: HttpConfig; patch: (p: Partial<HttpConfig>) => void }) {
  const httpCreds = credentials.filter((c) => c.type !== "LLM")
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <Select value={config.method} onValueChange={(v) => patch({ method: v as HttpConfig["method"] })}>
          <SelectTrigger className="h-8 w-24 shrink-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["GET", "POST", "PUT", "DELETE", "PATCH"] as const).map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="min-w-0 flex-1">
          <TplInput value={config.url} onChange={(url) => patch({ url })} upstream={upstream} placeholder="https://…（可插 {{payload.xxx}}）" />
        </div>
      </div>
      <Field label="请求头（JSON，可插模板）">
        <JsonEditor value={config.headers ?? ""} onChange={(headers) => patch({ headers: headers || undefined })} placeholder='{"Content-Type":"application/json"}' height="72px" />
      </Field>
      <Field label="请求体（JSON / 文本，可插模板）">
        <JsonEditor value={config.body ?? ""} onChange={(body) => patch({ body: body || undefined })} placeholder='{"docId": "{{payload.docId}}"}' />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="认证凭据（可选）">
          <Select value={config.credentialId != null ? String(config.credentialId) : "none"} onValueChange={(v) => patch({ credentialId: v === "none" ? undefined : Number(v) })}>
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不使用</SelectItem>
              {httpCreds.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}（{c.type}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="响应解析">
          <Select value={config.responseType ?? "JSON"} onValueChange={(v) => patch({ responseType: v as HttpConfig["responseType"] })}>
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="JSON">JSON</SelectItem>
              <SelectItem value="TEXT">TEXT</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="超时 ms">
          <Input type="number" min={100} value={config.timeoutMs ?? 10000} onChange={(e) => patch({ timeoutMs: Number(e.target.value) || undefined })} className="h-8 text-xs" />
        </Field>
        <Field label="另存变量名（saveAs）">
          <Input value={config.saveAs ?? ""} onChange={(e) => patch({ saveAs: e.target.value || undefined })} className="h-8 font-mono text-xs" placeholder="可选" />
        </Field>
      </div>
    </div>
  )
}

/* ---- parallel / loop / notify / startApproval / subFlow / llm ---- */

function ParallelFields({ config, patch }: { config: ParallelConfig; patch: (p: Partial<ParallelConfig>) => void }) {
  return (
    <Field
      label="模式"
      hint={config.mode === "JOIN" ? "汇合后各并行支的输出都在 outputs[节点id] 中，下游（如数据映射）可直接引用。" : "开叉：所有出边并行执行（编译为 WHEN）。"}
    >
      <Select value={config.mode} onValueChange={(v) => patch({ mode: v as ParallelConfig["mode"] })}>
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="OPEN">开叉（并行执行出边）</SelectItem>
          <SelectItem value="JOIN">汇合（等待各支完成）</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  )
}

function LoopFields({ config, patch, upstream }: { config: LoopConfig; patch: (p: Partial<LoopConfig>) => void; upstream: UpstreamNode[] }) {
  return (
    <div className="space-y-3">
      <Field label="集合表达式">
        <TplInput value={config.collection} onChange={(collection) => patch({ collection })} upstream={upstream} placeholder="如 {{outputs.n1.body.list}}" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="迭代变量名">
          <Input value={config.itemVar} onChange={(e) => patch({ itemVar: e.target.value })} className="h-8 font-mono text-xs" />
        </Field>
        <Field label="最大迭代（护栏）">
          <Input type="number" min={1} value={config.maxIterations ?? 1000} onChange={(e) => patch({ maxIterations: Number(e.target.value) || undefined })} className="h-8 text-xs" />
        </Field>
      </div>
    </div>
  )
}

function NotifyFields({ config, patch, upstream }: { config: NotifyConfig; patch: (p: Partial<NotifyConfig>) => void; upstream: UpstreamNode[] }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  return (
    <div className="space-y-3">
      <Field label="收件人">
        <OrgPickerField
          value={config.recipients}
          multiple
          placeholder="选择成员 / 部门 / 角色"
          onOpen={() => setPickerOpen(true)}
          onRemove={(ref: OrgRef) => patch({ recipients: config.recipients.filter((r) => !(r.type === ref.type && r.id === ref.id)) })}
        />
        <OrgPicker open={pickerOpen} onOpenChange={setPickerOpen} multiple title="选择收件人" value={config.recipients} onConfirm={(recipients) => patch({ recipients })} />
      </Field>
      <Field label="标题模板">
        <TplInput value={config.title} onChange={(title) => patch({ title })} upstream={upstream} mono={false} placeholder="如 新公文：{{outputs.h1.body.title}}" />
      </Field>
      <Field label="内容模板">
        <TplTextarea value={config.content} onChange={(content) => patch({ content })} upstream={upstream} rows={3} placeholder="支持 {{...}} 插值" />
      </Field>
    </div>
  )
}

function StartApprovalFields({ config, patch, upstream }: { config: StartApprovalConfig; patch: (p: Partial<StartApprovalConfig>) => void; upstream: UpstreamNode[] }) {
  return (
    <div className="space-y-3">
      <Field label="流程编码（defCode）">
        <Input value={config.defCode} onChange={(e) => patch({ defCode: e.target.value })} className="h-8 font-mono text-xs" placeholder="如 leave_flow" />
      </Field>
      <Field label="标题模板（可选）">
        <TplInput value={config.title ?? ""} onChange={(v) => patch({ title: v || undefined })} upstream={upstream} mono={false} />
      </Field>
      <Field label="表单数据映射（字段 ← 表达式）">
        <KvListEditor
          items={config.formData.map((f) => ({ k: f.field, v: f.expr }))}
          onChange={(items) => patch({ formData: items.map((it) => ({ field: it.k, expr: it.v })) })}
          upstream={upstream}
          keyPlaceholder="表单字段"
          exprPlaceholder="如 {{payload.days}}"
        />
      </Field>
    </div>
  )
}

function SubFlowFields({ config, patch, upstream, flows, nodeId: _nodeId }: OrchNodePanelProps & { config: SubFlowConfig; patch: (p: Partial<SubFlowConfig>) => void }) {
  return (
    <div className="space-y-3">
      <Field label="目标编排" hint="深度护栏 ≤5 层，防循环调用（后端把关）。">
        <Select value={config.flowCode || undefined} onValueChange={(flowCode) => patch({ flowCode })}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue placeholder={flows.length ? "选择编排" : "暂无其它编排"} />
          </SelectTrigger>
          <SelectContent>
            {flows.map((f) => (
              <SelectItem key={f.code} value={f.code}>
                {f.name}（{f.code}）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="子编排载荷映射（payload 字段 ← 表达式）">
        <KvListEditor
          items={config.payload.map((p) => ({ k: p.field, v: p.expr }))}
          onChange={(items) => patch({ payload: items.map((it) => ({ field: it.k, expr: it.v })) })}
          upstream={upstream}
          keyPlaceholder="字段"
          exprPlaceholder="如 {{payload.docId}}"
        />
      </Field>
      <label className="flex items-center justify-between text-xs">
        <span>等待子编排结果（结果入 outputs）</span>
        <Switch checked={config.waitResult} onCheckedChange={(waitResult) => patch({ waitResult })} />
      </label>
    </div>
  )
}

function LlmFields({ config, patch, upstream, credentials }: OrchNodePanelProps & { config: LlmConfig; patch: (p: Partial<LlmConfig>) => void }) {
  const llmCreds = credentials.filter((c) => c.type === "LLM")
  return (
    <div className="space-y-3">
      <Field label="凭据（OpenAI 兼容端点）" hint="密钥加密存服务端，节点只引用凭据 id。">
        <Select value={config.credentialId != null ? String(config.credentialId) : undefined} onValueChange={(v) => patch({ credentialId: Number(v) })}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue placeholder={llmCreds.length ? "选择凭据" : "先到凭据管理添加"} />
          </SelectTrigger>
          <SelectContent>
            {llmCreds.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}（{c.model ?? "默认模型"}）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="模型（可覆盖凭据默认）">
        <Input value={config.model ?? ""} onChange={(e) => patch({ model: e.target.value || undefined })} className="h-8 font-mono text-xs" placeholder="如 deepseek-chat" />
      </Field>
      <Field label="系统提示词（可选）">
        <TplTextarea value={config.systemPrompt ?? ""} onChange={(v) => patch({ systemPrompt: v || undefined })} upstream={upstream} rows={3} />
      </Field>
      <Field label="用户提示词">
        <TplTextarea value={config.userPrompt} onChange={(userPrompt) => patch({ userPrompt })} upstream={upstream} rows={4} placeholder="支持 {{...}} 插值，如 总结：{{outputs.h1.body}}" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="输出模式">
          <Select value={config.outputMode} onValueChange={(v) => patch({ outputMode: v as LlmConfig["outputMode"] })}>
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TEXT">TEXT 文本</SelectItem>
              <SelectItem value="JSON">JSON 对象</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="另存变量名（saveAs）">
          <Input value={config.saveAs ?? ""} onChange={(e) => patch({ saveAs: e.target.value || undefined })} className="h-8 font-mono text-xs" placeholder="可选" />
        </Field>
        <Field label="temperature">
          <Input type="number" step="0.1" min={0} max={2} value={config.temperature ?? ""} onChange={(e) => patch({ temperature: e.target.value === "" ? undefined : Number(e.target.value) })} className="h-8 text-xs" placeholder="默认" />
        </Field>
        <Field label="maxTokens">
          <Input type="number" min={1} value={config.maxTokens ?? ""} onChange={(e) => patch({ maxTokens: e.target.value === "" ? undefined : Number(e.target.value) })} className="h-8 text-xs" placeholder="默认" />
        </Field>
        <Field label="超时 ms">
          <Input type="number" min={1000} value={config.timeoutMs ?? 60000} onChange={(e) => patch({ timeoutMs: Number(e.target.value) || undefined })} className="h-8 text-xs" />
        </Field>
      </div>
      {config.outputMode === "JSON" && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
          JSON 模式：提示词会被强约束输出 JSON；解析失败按节点失败处理（走上方重试 / 失败策略）。
        </p>
      )}
    </div>
  )
}

/* ============================ 边（分支条件）面板 ============================ */

export interface OrchEdgePanelProps {
  condition?: BranchCondition
  expression?: string
  isDefault?: boolean
  upstream: UpstreamNode[]
  onChange: (patch: { condition?: BranchCondition; expression?: string; isDefault?: boolean }) => void
}

export function OrchEdgePanel({ condition, expression, isDefault, upstream, onChange }: OrchEdgePanelProps) {
  const items = condition?.items ?? []
  const logic = condition?.logic ?? "AND"
  const setItems = (next: typeof items) => onChange({ condition: next.length ? { logic, items: next } : undefined })

  return (
    <div className="space-y-4 p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-amber-600 text-white">
          <Braces className="size-4" />
        </span>
        <div className="text-sm font-medium">分支条件</div>
      </div>

      <label className="flex items-center justify-between rounded-md border px-2.5 py-2 text-xs">
        <span>默认分支（其他条件都不满足时走）</span>
        <Switch checked={!!isDefault} onCheckedChange={(v) => onChange({ isDefault: v || undefined })} />
      </label>

      {!isDefault && (
        <>
          <Field label="结构化条件" hint="字段写上下文表达式（payload.x / vars.x / outputs.节点id.x）。">
            <div className="space-y-1.5">
              {items.length > 1 && (
                <Select value={logic} onValueChange={(v) => onChange({ condition: { logic: v as "AND" | "OR", items } })}>
                  <SelectTrigger className="h-7 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AND">全部满足（且）</SelectItem>
                    <SelectItem value="OR">任一满足（或）</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Input
                    value={it.field}
                    onChange={(e) => setItems(items.map((x, idx) => (idx === i ? { ...x, field: e.target.value } : x)))}
                    className="h-8 min-w-0 flex-1 font-mono text-xs"
                    placeholder="outputs.n1.body.total"
                  />
                  <Select value={it.operator} onValueChange={(v) => setItems(items.map((x, idx) => (idx === i ? { ...x, operator: v as ConditionOperator } : x)))}>
                    <SelectTrigger className="h-8 w-24 shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(OPERATOR_META) as ConditionOperator[]).map((op) => (
                        <SelectItem key={op} value={op}>
                          {OPERATOR_META[op]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={it.value}
                    onChange={(e) => setItems(items.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))}
                    className="h-8 w-20 shrink-0 font-mono text-xs"
                    placeholder="值"
                  />
                  <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-rose-600" onClick={() => setItems(items.filter((_, idx) => idx !== i))}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setItems([...items, { field: "", operator: "eq", value: "" }])}
              >
                <Plus className="size-3.5" /> 添加条件
              </Button>
            </div>
          </Field>
          <Field label="Aviator 表达式（逃生口，优先于结构化条件）">
            <TplInput value={expression ?? ""} onChange={(v) => onChange({ expression: v || undefined })} upstream={upstream} placeholder="如 outputs.h1.body.total > 0" />
          </Field>
        </>
      )}
    </div>
  )
}

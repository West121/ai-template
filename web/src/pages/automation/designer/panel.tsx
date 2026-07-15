/**
 * 编排节点/边 配置面板。
 *
 * - 按节点类型出表单；动作类节点带通用「重试/失败策略」区。
 * - 变量选择器 VarInsert：payload / vars / 上游节点 outputs 树 / 内置模板函数，点击把 `{{...}}`
 *   插到光标处（模板插值由后端 OrchTemplate 求值，前端只提示不求值）。
 * - script 复用 ScriptEditor；http headers/body 用 CodeMirror JSON；llm=凭据+model+prompt+输出模式。
 * - 边面板：结构化条件（复用 BranchCondition/OPERATOR_META，field 写上下文表达式）+ Aviator 逃生口 + 默认支。
 */
import { useRef, useState, type ComponentType, type ReactNode } from "react"
import { Braces, Plus, Trash2, Variable } from "lucide-react"
import { cn } from "@/lib/utils"
import { ScriptEditor } from "@/components/script-editor"
import { OrgPicker, OrgPickerField, type OrgRef } from "@/components/org-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { CodeEditor } from "@/components/code-editor"
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
  AgentConfig,
  AgentTool,
  BotConfig,
  DataMapConfig,
  DbQueryConfig,
  DelayConfig,
  EndConfig,
  HttpConfig,
  LlmConfig,
  LoopConfig,
  NotifyConfig,
  OrchNodeConfig,
  OrchNodeType,
  ParallelConfig,
  RespondConfig,
  ScriptNodeConfig,
  StartApprovalConfig,
  SubFlowConfig,
  TriggerConfig,
  WaitConfig,
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

/** JSON 编辑器（http headers/body 等模板 JSON）：统一 CodeEditor，行号/折叠/查找/着色齐全；
 *  lint 关（模板串含 {{变量}}，严格 JSON 校验会误报）；lineWrap 便于长模板串换行查看。 */
function JsonEditor({ value, onChange, placeholder, height = "120px" }: { value: string; onChange: (v: string) => void; placeholder?: string; height?: string }) {
  return (
    <CodeEditor
      value={value}
      onChange={onChange}
      language="json"
      lint={false}
      lineWrap
      minHeight={height}
      maxHeight="20rem"
      placeholder={placeholder}
      ariaLabel="JSON（模板串）"
    />
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
      {type === "wait" && <WaitFields config={config as WaitConfig} patch={patch} />}
      {type === "respond" && <RespondFields config={config as RespondConfig} patch={patch} upstream={upstream} />}
      {(type === "dingtalkBot" || type === "feishuBot") && (
        <BotFields platform={type === "dingtalkBot" ? "dingtalk" : "feishu"} config={config as BotConfig} patch={patch} upstream={upstream} />
      )}
      {type === "dbQuery" && <DbQueryFields {...props} config={config as DbQueryConfig} patch={patch} />}
      {type === "llm" && <LlmFields {...props} config={config as LlmConfig} patch={patch} />}
      {type === "agent" && <AgentFields {...props} config={config as AgentConfig} patch={patch} />}
      {type === "end" && (
        <Field label="流水结果（可选表达式）">
          <TplInput value={(config as EndConfig).output ?? ""} onChange={(v) => patch({ output: v || undefined })} upstream={upstream} placeholder="如 {{vars.summary}}" />
        </Field>
      )}

      {["http", "script", "notify", "startApproval", "dataMap", "subFlow", "dingtalkBot", "feishuBot", "dbQuery", "llm", "agent"].includes(type) && (
        <ActionCommonFields value={config as ActionCommon} onChange={(p) => patch(p)} />
      )}
    </div>
  )
}

/* ---- trigger ---- */

/** 事件目录（对齐后端 OrchEventBridge 订阅键） */
const EVENT_CATALOG: Record<"WF" | "GONGWEN", { type: string; label: string }[]> = {
  WF: [
    { type: "INSTANCE_COMPLETED", label: "实例办结" },
    { type: "TASK_COMPLETED", label: "任务办理完成" },
  ],
  GONGWEN: [
    { type: "ISSUED", label: "公文签发" },
    { type: "SEALED", label: "公文用印" },
    { type: "PUBLISHED", label: "公文成文分发" },
    { type: "FINISHED", label: "收文办结" },
  ],
}

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
            <Select
              value={config.event?.source ?? "WF"}
              onValueChange={(v) =>
                // 换来源时清空事件类型（两个目录不通用）
                patch({ event: { source: v as "WF" | "GONGWEN", type: "" } })
              }
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WF">审批流事件</SelectItem>
                <SelectItem value="GONGWEN">公文事件</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="事件类型">
            <Select
              value={config.event?.type || undefined}
              onValueChange={(type) => patch({ event: { ...(config.event ?? { source: "WF" }), type } })}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="选择事件" />
              </SelectTrigger>
              <SelectContent>
                {EVENT_CATALOG[config.event?.source ?? "WF"].map((e) => (
                  <SelectItem key={e.type} value={e.type}>
                    {e.label}（{e.type}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

/* ---- 批3：wait / respond / agent ---- */

function WaitFields({ config, patch }: { config: WaitConfig; patch: (p: Partial<WaitConfig>) => void }) {
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
        执行到此节点流水挂起（WAITING），等待回调恢复：
        <code className="font-mono">POST /api/orch/resume/{"{resumeToken}"}</code>（token 在执行详情可复制）。
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="挂起超时 ms" hint="默认 24 小时；超时按下方策略处理">
          <Input type="number" min={1000} value={config.timeoutMs ?? 86_400_000} onChange={(e) => patch({ timeoutMs: Number(e.target.value) || undefined })} className="h-8 text-xs" />
        </Field>
        <Field label="回调 body 存入（saveAs）">
          <Input value={config.saveAs ?? ""} onChange={(e) => patch({ saveAs: e.target.value || undefined })} className="h-8 font-mono text-xs" placeholder="如 callback" />
        </Field>
      </div>
      <Field label="超时策略">
        <Select value={config.onError ?? "ABORT"} onValueChange={(v) => patch({ onError: v as WaitConfig["onError"] })}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ABORT">中止整流（默认）</SelectItem>
            <SelectItem value="CONTINUE">忽略继续</SelectItem>
            <SelectItem value="BRANCH">走错误分支</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  )
}

function RespondFields({ config, patch, upstream }: { config: RespondConfig; patch: (p: Partial<RespondConfig>) => void; upstream: UpstreamNode[] }) {
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-dashed bg-muted/30 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
        仅 <span className="font-medium text-foreground">Webhook 触发</span>时作为同步 HTTP 响应（调用方等到本节点执行完拿响应，
        后续节点继续异步跑）；其它触发方式下等价于数据映射存 body。
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="HTTP 状态码">
          <Input type="number" min={100} max={599} value={config.status ?? 200} onChange={(e) => patch({ status: Number(e.target.value) || undefined })} className="h-8 text-xs" />
        </Field>
        <Field label="Content-Type">
          <Input value={config.contentType ?? "application/json"} onChange={(e) => patch({ contentType: e.target.value || undefined })} className="h-8 font-mono text-xs" />
        </Field>
      </div>
      <Field label="响应体模板">
        <TplTextarea value={config.body} onChange={(body) => patch({ body })} upstream={upstream} rows={4} placeholder='{"result": "{{vars.summary}}"}' />
      </Field>
    </div>
  )
}

/** Agent 工具编辑器：声明（name/description/params）+ 实现（HTTP 模板可用 {{args.xxx}} / SCRIPT 绑定 args） */
function AgentToolsEditor({ tools, onChange, upstream }: { tools: AgentTool[]; onChange: (tools: AgentTool[]) => void; upstream: UpstreamNode[] }) {
  const setTool = (i: number, patch: Partial<AgentTool>) => onChange(tools.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))

  return (
    <div className="space-y-2">
      {tools.map((tool, i) => (
        <div key={i} className="space-y-2 rounded-md border p-2">
          <div className="flex items-center gap-1">
            <Input value={tool.name} onChange={(e) => setTool(i, { name: e.target.value })} className="h-8 flex-1 font-mono text-xs" placeholder="工具名（如 query_user）" />
            <Select
              value={tool.impl.kind}
              onValueChange={(v) =>
                setTool(i, {
                  impl:
                    v === "HTTP"
                      ? { kind: "HTTP", method: "GET", url: "" }
                      : { kind: "SCRIPT", script: { lang: "groovy", code: "" } },
                })
              }
            >
              <SelectTrigger className="h-8 w-24 shrink-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HTTP">HTTP</SelectItem>
                <SelectItem value="SCRIPT">脚本</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-rose-600" onClick={() => onChange(tools.filter((_, idx) => idx !== i))}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <Input value={tool.description} onChange={(e) => setTool(i, { description: e.target.value })} className="h-8 text-xs" placeholder="工具描述（LLM 依此决定何时调用）" />

          {/* 参数声明表 */}
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">参数（LLM 实参 → {"{{args.名}}"}）</div>
            {tool.params.map((p, pi) => (
              <div key={pi} className="flex items-center gap-1">
                <Input value={p.name} onChange={(e) => setTool(i, { params: tool.params.map((x, xi) => (xi === pi ? { ...x, name: e.target.value } : x)) })} className="h-7 w-24 shrink-0 font-mono text-[11px]" placeholder="名称" />
                <Select value={p.type} onValueChange={(v) => setTool(i, { params: tool.params.map((x, xi) => (xi === pi ? { ...x, type: v } : x)) })}>
                  <SelectTrigger className="h-7 w-20 shrink-0 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["string", "number", "boolean"].map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={p.description ?? ""} onChange={(e) => setTool(i, { params: tool.params.map((x, xi) => (xi === pi ? { ...x, description: e.target.value || undefined } : x)) })} className="h-7 min-w-0 flex-1 text-[11px]" placeholder="说明" />
                <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  必填
                  <Switch checked={!!p.required} onCheckedChange={(v) => setTool(i, { params: tool.params.map((x, xi) => (xi === pi ? { ...x, required: v || undefined } : x)) })} />
                </label>
                <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 text-muted-foreground hover:text-rose-600" onClick={() => setTool(i, { params: tool.params.filter((_, xi) => xi !== pi) })}>
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="h-6 gap-1 text-[11px]" onClick={() => setTool(i, { params: [...tool.params, { name: "", type: "string" }] })}>
              <Plus className="size-3" /> 加参数
            </Button>
          </div>

          {/* 实现 */}
          {tool.impl.kind === "HTTP" ? (
            (() => {
              // JSX 回调内 TS 不保留判别收窄，这里显式捕获 HTTP 变体
              const impl = tool.impl
              return (
                <div className="space-y-1.5">
                  <div className="flex gap-1">
                    <Select value={impl.method} onValueChange={(v) => setTool(i, { impl: { ...impl, method: v as "GET" | "POST" | "PUT" | "DELETE" | "PATCH" } })}>
                      <SelectTrigger className="h-8 w-20 shrink-0 text-xs">
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
                      <TplInput value={impl.url} onChange={(url) => setTool(i, { impl: { ...impl, url } })} upstream={upstream} placeholder="https://…（可用 {{args.xxx}}）" />
                    </div>
                  </div>
                  <JsonEditor value={impl.body ?? ""} onChange={(body) => setTool(i, { impl: { ...impl, body: body || undefined } })} placeholder='请求体（可用 {{args.xxx}}），如 {"id": "{{args.userId}}"}' height="60px" />
                </div>
              )
            })()
          ) : (
            <ScriptEditor value={tool.impl.script} onChange={(script: ScriptConfig) => setTool(i, { impl: { kind: "SCRIPT", script } })} />
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={() => onChange([...tools, { name: "", description: "", params: [], impl: { kind: "HTTP", method: "GET", url: "" } }])}
      >
        <Plus className="size-3.5" /> 添加工具
      </Button>
    </div>
  )
}

function AgentFields({ config, patch, upstream, credentials }: OrchNodePanelProps & { config: AgentConfig; patch: (p: Partial<AgentConfig>) => void }) {
  const llmCreds = credentials.filter((c) => c.type === "LLM")
  return (
    <div className="space-y-3">
      <Field label="凭据（OpenAI 兼容，需支持 function-calling）">
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
        <Input value={config.model ?? ""} onChange={(e) => patch({ model: e.target.value || undefined })} className="h-8 font-mono text-xs" />
      </Field>
      <Field label="系统提示词（可选）">
        <TplTextarea value={config.systemPrompt ?? ""} onChange={(v) => patch({ systemPrompt: v || undefined })} upstream={upstream} rows={3} />
      </Field>
      <Field label="用户提示词">
        <TplTextarea value={config.userPrompt} onChange={(userPrompt) => patch({ userPrompt })} upstream={upstream} rows={3} placeholder="任务目标；LLM 会按需调用下方工具" />
      </Field>
      <Field label={`工具（${config.tools.length}）`} hint="LLM 决策 → 执行工具 → 结果回填 → 迭代，至无 tool_calls 或步数上限。">
        <AgentToolsEditor tools={config.tools} onChange={(tools) => patch({ tools })} upstream={upstream} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="最大步数（≤15）">
          <Input type="number" min={1} max={15} value={config.maxSteps ?? 8} onChange={(e) => patch({ maxSteps: Number(e.target.value) || undefined })} className="h-8 text-xs" />
        </Field>
        <Field label="整体超时 ms">
          <Input type="number" min={1000} value={config.timeoutMs ?? 120_000} onChange={(e) => patch({ timeoutMs: Number(e.target.value) || undefined })} className="h-8 text-xs" />
        </Field>
        <Field label="输出模式">
          <Select value={config.outputMode} onValueChange={(v) => patch({ outputMode: v as AgentConfig["outputMode"] })}>
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
      </div>
    </div>
  )
}

/* ---- 批4：连接器 ---- */

function BotFields({ platform, config, patch, upstream }: { platform: "dingtalk" | "feishu"; config: BotConfig; patch: (p: Partial<BotConfig>) => void; upstream: UpstreamNode[] }) {
  return (
    <div className="space-y-3">
      <Field label="机器人 Webhook 地址">
        <Input value={config.url} onChange={(e) => patch({ url: e.target.value })} className="h-8 font-mono text-xs" placeholder={platform === "dingtalk" ? "https://oapi.dingtalk.com/robot/send?access_token=…" : "https://open.feishu.cn/open-apis/bot/v2/hook/…"} />
      </Field>
      <Field label={platform === "dingtalk" ? "加签密钥（推荐）" : "签名密钥（可选）"} hint="服务端计算签名，密钥不落日志。">
        <Input type="password" value={config.secret ?? ""} onChange={(e) => patch({ secret: e.target.value || undefined })} className="h-8 font-mono text-xs" placeholder="SEC…" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="消息类型">
          <Select value={config.msgType} onValueChange={(v) => patch({ msgType: v as BotConfig["msgType"] })}>
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">文本</SelectItem>
              <SelectItem value="markdown">Markdown</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {config.msgType === "markdown" && (
          <Field label={platform === "dingtalk" ? "标题（钉钉必填）" : "标题（可选）"}>
            <Input value={config.title ?? ""} onChange={(e) => patch({ title: e.target.value || undefined })} className="h-8 text-xs" />
          </Field>
        )}
      </div>
      <Field label="消息内容模板">
        <TplTextarea value={config.content} onChange={(content) => patch({ content })} upstream={upstream} rows={4} placeholder="支持 {{...}} 插值" />
      </Field>
    </div>
  )
}

function DbQueryFields({ config, patch, credentials }: OrchNodePanelProps & { config: DbQueryConfig; patch: (p: Partial<DbQueryConfig>) => void }) {
  const jdbcCreds = credentials.filter((c) => c.type === "JDBC")
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
        只读查询（select-only 服务端硬校验）· 行数上限 1000 · 受信门槛同脚本节点。
      </p>
      <Field label="数据源">
        <Select value={config.credentialId != null ? String(config.credentialId) : "app"} onValueChange={(v) => patch({ credentialId: v === "app" ? undefined : Number(v) })}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="app">本应用库（默认）</SelectItem>
            {jdbcCreds.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}（外部 JDBC）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="SQL（SELECT，支持 {{...}} 插值）">
        <CodeEditor value={config.sql} onChange={(sql) => patch({ sql })} language="sql" minHeight="6rem" maxHeight="16rem" ariaLabel="SQL 查询" placeholder="select id, name from sys_user where dept_id = {{payload.deptId}}" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="行数上限（≤1000）">
          <Input type="number" min={1} max={1000} value={config.maxRows ?? 1000} onChange={(e) => patch({ maxRows: Number(e.target.value) || undefined })} className="h-8 text-xs" />
        </Field>
        <Field label="超时 ms">
          <Input type="number" min={100} value={config.timeoutMs ?? 10_000} onChange={(e) => patch({ timeoutMs: Number(e.target.value) || undefined })} className="h-8 text-xs" />
        </Field>
      </div>
      <Field label="另存变量名（saveAs）">
        <Input value={config.saveAs ?? ""} onChange={(e) => patch({ saveAs: e.target.value || undefined })} className="h-8 font-mono text-xs" placeholder="可选" />
      </Field>
    </div>
  )
}

/* ============================ 边（分支条件）面板 ============================ */

export interface OrchEdgePanelProps {
  condition?: BranchCondition
  expression?: string
  isDefault?: boolean
  /** loop 出边：循环体入口标记（源节点为 loop 时展示开关） */
  loopBody?: boolean
  /** onError=BRANCH 出边：失败分支标记（源节点为 BRANCH 动作节点时展示开关） */
  errorBranch?: boolean
  /** 源节点类型（决定展示哪些边级开关） */
  sourceType?: OrchNodeType
  /** 源节点失败策略（BRANCH 时展示失败分支开关） */
  sourceOnError?: ActionCommon["onError"]
  upstream: UpstreamNode[]
  onChange: (patch: {
    condition?: BranchCondition
    expression?: string
    isDefault?: boolean
    loopBody?: boolean
    errorBranch?: boolean
  }) => void
}

export function OrchEdgePanel({
  condition,
  expression,
  isDefault,
  loopBody,
  errorBranch,
  sourceType,
  sourceOnError,
  upstream,
  onChange,
}: OrchEdgePanelProps) {
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

      {/* loop 出边契约：恰两条出边，一条循环体入口 + 一条循环后续接 */}
      {sourceType === "loop" && (
        <label className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs">
          <span>
            循环体（本边为循环体入口）
            <span className="mt-0.5 block text-[11px] text-muted-foreground">体内自然终止不回连；另一条出边为循环结束后的续接</span>
          </span>
          <Switch checked={!!loopBody} onCheckedChange={(v) => onChange({ loopBody: v || undefined })} />
        </label>
      )}

      {/* onError=BRANCH 契约：恰 1 成功 + 1 失败出边 */}
      {sourceType != null && sourceType !== "loop" && sourceOnError === "BRANCH" && (
        <label className="flex items-center justify-between rounded-md border border-rose-500/30 bg-rose-500/5 px-2.5 py-2 text-xs">
          <span>
            失败分支（节点失败时走本边）
            <span className="mt-0.5 block text-[11px] text-muted-foreground">另一条出边为成功支；源节点失败策略已设为 BRANCH</span>
          </span>
          <Switch checked={!!errorBranch} onCheckedChange={(v) => onChange({ errorBranch: v || undefined })} />
        </label>
      )}

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

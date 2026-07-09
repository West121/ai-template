/**
 * 节点字段权限编辑器（设计文档第二部分 2.4）。
 *
 * 传入 `formKey` → `getFormManifest` 拉字段清单 → 渲染「字段 × {可见/可编辑/必填}」矩阵，
 * 按 `group` 归组（子表单字段由后端/清单归到子表单组）→ 读写节点 `WfNodeProps.formPerms`。
 *
 * 与已有模型对齐（**不新增模型**）：`formPerms: Record<string, FormPerm>`（`HIDDEN|READ|EDIT`，
 * 三态编码 可见 + 可编辑）。矩阵的 可见/可编辑 双列即该三态的等价展开：
 *   HIDDEN ↔ 不可见         READ ↔ 可见·只读        EDIT ↔ 可见·可编辑
 * 「必填」列取自字段清单 `FieldDescriptor.required`（表单自身声明，CODE 表单可标注；
 * 在线表单清单不含此键）——运行时 `HostedForm` 据其向字段注入必填校验。节点侧不改表单固有
 * 必填性（该维度无 `formPerms` 存储位，避免破坏在线运行时 tri-state 契约），故此列为只读展示。
 */
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { getFormManifest } from "@/lib/form-registry"
import type { FieldDescriptor, FormFieldManifest } from "@/lib/form-manifest"
import type { FormPerm, FormPerms } from "@/pages/workflow/designer/types"

/* ---------------- FormPerm(tri-state) ↔ 可见/可编辑 双列（纯函数，供单测） ---------------- */

export interface VisibleEditable {
  visible: boolean
  editable: boolean
}

/** 三态 → 可见/可编辑；缺省视为 EDIT（全放行）。 */
export function permToVisibleEditable(perm: FormPerm | undefined): VisibleEditable {
  if (perm === "HIDDEN") return { visible: false, editable: false }
  if (perm === "READ") return { visible: true, editable: false }
  return { visible: true, editable: true }
}

/** 可见/可编辑 → 三态。不可见 → HIDDEN；可见只读 → READ；可见可编辑 → EDIT。 */
export function visibleEditableToPerm(ve: VisibleEditable): FormPerm {
  if (!ve.visible) return "HIDDEN"
  if (!ve.editable) return "READ"
  return "EDIT"
}

/** 在 formPerms 上写入某字段的三态（编辑器读写 formPerms 的核心，供单测）。 */
export function writeFieldPerm(perms: FormPerms, key: string, ve: VisibleEditable): FormPerms {
  return { ...perms, [key]: visibleEditableToPerm(ve) }
}

/* ---------------- 归组 ---------------- */

const DEFAULT_GROUP = "基础字段"

interface FieldGroup {
  name: string
  fields: FieldDescriptor[]
}

/** 按 group 归组，保持字段原始顺序、组首次出现顺序。 */
export function groupFields(fields: FieldDescriptor[]): FieldGroup[] {
  const order: string[] = []
  const map = new Map<string, FieldDescriptor[]>()
  for (const f of fields) {
    const g = f.group?.trim() || DEFAULT_GROUP
    if (!map.has(g)) {
      map.set(g, [])
      order.push(g)
    }
    map.get(g)?.push(f)
  }
  return order.map((name) => ({ name, fields: map.get(name) ?? [] }))
}

/* ---------------- 组件 ---------------- */

export interface FieldPermsEditorProps {
  formKey: string
  /** 节点 WfNodeProps.formPerms */
  value: FormPerms
  onChange: (perms: FormPerms) => void
}

export function FieldPermsEditor({ formKey, value, onChange }: FieldPermsEditorProps) {
  const [manifest, setManifest] = useState<FormFieldManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setManifest(null)
    getFormManifest(formKey)
      .then((m) => {
        if (alive) setManifest(m)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : "字段清单加载失败")
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [formKey])

  const groups = useMemo(() => (manifest ? groupFields(manifest.fields) : []), [manifest])

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>{error}</span>
      </div>
    )
  }

  if (!manifest || manifest.fields.length === 0) {
    return <p className="text-xs text-muted-foreground">该表单暂无可配置字段。</p>
  }

  const setField = (key: string, ve: VisibleEditable) => onChange(writeFieldPerm(value, key, ve))

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 px-1 text-[11px] font-medium text-muted-foreground">
        <span>字段</span>
        <span className="w-10 text-center">可见</span>
        <span className="w-12 text-center">可编辑</span>
        <span className="w-10 text-center">必填</span>
      </div>

      {groups.map((group) => (
        <div key={group.name} className="space-y-1.5">
          <div className="px-1 text-[11px] font-medium text-foreground/70">{group.name}</div>
          {group.fields.map((f) => {
            const ve = permToVisibleEditable(value[f.key])
            return (
              <div
                key={f.key}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 rounded-md px-1 py-1 hover:bg-accent/40"
              >
                <span className="truncate text-xs" title={f.label}>
                  {f.label}
                </span>
                <span className="flex w-10 justify-center">
                  <Checkbox
                    checked={ve.visible}
                    onCheckedChange={(c) =>
                      setField(f.key, { visible: c === true, editable: c === true ? ve.editable : false })
                    }
                    aria-label={`${f.label} 可见`}
                  />
                </span>
                <span className="flex w-12 justify-center">
                  <Checkbox
                    checked={ve.editable}
                    disabled={!ve.visible}
                    onCheckedChange={(c) => setField(f.key, { visible: ve.visible, editable: c === true })}
                    aria-label={`${f.label} 可编辑`}
                  />
                </span>
                <span className="flex w-10 justify-center">
                  <Checkbox
                    checked={f.required ?? false}
                    disabled
                    aria-label={`${f.label} 必填（表单声明）`}
                  />
                </span>
              </div>
            )
          })}
        </div>
      ))}

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        「可见 / 可编辑」写入本节点字段权限（<code className="font-mono">formPerms</code>）；
        「必填」由表单自身声明，运行时由包裹层校验，节点侧不改。
      </p>
    </div>
  )
}

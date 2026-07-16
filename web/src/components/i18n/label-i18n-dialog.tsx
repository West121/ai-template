/**
 * 多语言 label 编辑弹窗 + 触发钮（i18n M1，docs/design/i18n.md §3.4）。
 *
 * 通用于：表单设计器字段标签 / 表单标题（M1），将来流程节点名、字典/维度 label（M3）。
 * 结构：源文（简中只读，恒等于 label 字段）+ 四行可编辑（EN/繁中/泰/日）+「AI 翻译」。
 * 保存：剔除空串，只留已填语言；全空 → 传 undefined（schema 精简，拍板③不存 zh-CN）。
 * AI 翻译：POST /api/ai/translate（lib/i18n-translate，离线/404 → mock 伪译文不阻断手填）；
 * 默认只回填空行，勾选「覆盖已填」则全量覆盖。
 */
import { useState } from "react"
import { Languages, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { aiTranslate, TARGET_LOCALES, type TargetLocale } from "@/lib/i18n-translate"
import { LOCALES, type Locale } from "@/stores/app-store"
import { cn } from "@/lib/utils"

export type LabelI18nValue = Partial<Record<Locale, string>> | undefined

const NATIVE: Record<TargetLocale, string> = Object.fromEntries(
  LOCALES.filter((l) => l.value !== "zh-CN").map((l) => [l.value, l.native]),
) as Record<TargetLocale, string>

/** 剔除空串/仅空白；全空返回 undefined */
export function compactLabelI18n(draft: Partial<Record<TargetLocale, string>>): LabelI18nValue {
  const out: Partial<Record<Locale, string>> = {}
  for (const locale of TARGET_LOCALES) {
    const v = draft[locale]
    if (typeof v === "string" && v.trim()) out[locale] = v.trim()
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function draftOf(value: LabelI18nValue): Record<TargetLocale, string> {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {}
  return Object.fromEntries(
    TARGET_LOCALES.map((l) => [l, typeof source[l] === "string" ? (source[l] as string) : ""]),
  ) as Record<TargetLocale, string>
}

export function LabelI18nDialog({
  open,
  onOpenChange,
  source,
  value,
  onChange,
  context,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 简中源文（= label/title 字段本身，只读展示） */
  source: string
  value: LabelI18nValue
  onChange: (value: LabelI18nValue) => void
  /** AI 翻译领域提示（如 "OA 审批表单字段名，简短名词"） */
  context?: string
}) {
  const [draft, setDraft] = useState<Record<TargetLocale, string>>(() => draftOf(value))
  const [translating, setTranslating] = useState(false)
  const [overwrite, setOverwrite] = useState(false)

  // 每次打开以最新 value 重置草稿（受控重挂：由调用方在 open 时以 key 或 effect 保证，这里兜底）
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setDraft(draftOf(value))
  }

  const runTranslate = async () => {
    const text = source.trim()
    if (!text) {
      toast.error("请先填写中文原文")
      return
    }
    setTranslating(true)
    try {
      const targets = overwrite ? TARGET_LOCALES : TARGET_LOCALES.filter((l) => !draft[l].trim())
      if (targets.length === 0) {
        toast.info("四语均已填写；勾选「覆盖已填」可重新生成")
        return
      }
      const { byText, demo } = await aiTranslate([text], targets, context ?? "OA 表单字段名/标题，简短、名词性")
      const got = byText[text] ?? {}
      setDraft((d) => {
        const next = { ...d }
        for (const l of targets) if (got[l]) next[l] = got[l] as string
        return next
      })
      if (demo) toast.info("AI 翻译端点未连接——已用演示伪译文回填，可手工修改")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI 翻译失败") // 失败不关弹窗、不清手填
    } finally {
      setTranslating(false)
    }
  }

  const save = () => {
    onChange(compactLabelI18n(draft))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>多语言文案</DialogTitle>
          <DialogDescription>缺翻语言运行时自动回退中文原文，不会出现空白。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">简体中文（源文，即字段本身）</Label>
            <Input value={source} readOnly disabled className="h-8 text-sm" />
          </div>
          {TARGET_LOCALES.map((locale) => (
            <div key={locale} className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{NATIVE[locale]}</Label>
              <Input
                value={draft[locale]}
                onChange={(e) => setDraft((d) => ({ ...d, [locale]: e.target.value }))}
                placeholder="留空则显示中文原文"
                aria-label={`${NATIVE[locale]} 译文`}
                className="h-8 text-sm"
              />
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={overwrite} onCheckedChange={(v) => setOverwrite(v === true)} aria-label="覆盖已填" />
              覆盖已填
            </label>
            <Button type="button" variant="outline" size="sm" onClick={() => void runTranslate()} disabled={translating}>
              {translating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              AI 翻译
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" onClick={save}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 触发钮：挂在 label/title 输入框右侧的小图标钮；已配任一语言时右上角加圆点角标。
 * 内聚弹窗开关，调用方只给 source/value/onChange。
 */
export function LabelI18nButton({
  source,
  value,
  onChange,
  context,
  className,
}: {
  source: string
  value: LabelI18nValue
  onChange: (value: LabelI18nValue) => void
  context?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const configured = !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).some((v) => typeof v === "string" && v.trim())

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="多语言"
            className={cn("relative size-8 shrink-0 text-muted-foreground hover:text-primary", className)}
            onClick={() => setOpen(true)}
          >
            <Languages className="size-4" />
            {configured && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" aria-hidden />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>多语言{configured ? "（已配置）" : ""}</TooltipContent>
      </Tooltip>
      <LabelI18nDialog open={open} onOpenChange={setOpen} source={source} value={value} onChange={onChange} context={context} />
    </>
  )
}

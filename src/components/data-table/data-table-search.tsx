import { useState } from "react"
import { Calendar, CircleCheckBig, Hash, Search, Type, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { FilterField, FilterFieldType } from "./data-table-advanced-filter"

export type SearchMode = "global" | "fields"
export type SearchDisplayMode = "filter" | "all"

const typeIcons: Record<FilterFieldType, typeof Type> = {
  text: Type,
  number: Hash,
  select: CircleCheckBig,
  date: Calendar,
}

interface DataTableSearchProps {
  keyword: string
  onKeywordChange: (keyword: string) => void
  fields: FilterField[]
  enabledFields: string[]
  onEnabledFieldsChange: (ids: string[]) => void
  mode: SearchMode
  onModeChange: (mode: SearchMode) => void
  displayMode: SearchDisplayMode
  onDisplayModeChange: (mode: SearchDisplayMode) => void
  placeholder?: string
}

function SegmentedButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors",
        active
          ? "border-primary/30 bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </button>
  )
}

/** Airtable 风格搜索：图标收起 → 胶囊展开，「全局/字段」面板控制搜索范围与显示方式 */
export function DataTableSearch({
  keyword,
  onKeywordChange,
  fields,
  enabledFields,
  onEnabledFieldsChange,
  mode,
  onModeChange,
  displayMode,
  onDisplayModeChange,
  placeholder = "搜索",
}: DataTableSearchProps) {
  const [open, setOpen] = useState(false)
  const [fieldKeyword, setFieldKeyword] = useState("")

  if (!open && keyword === "") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex size-8 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Search className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>搜索</TooltipContent>
      </Tooltip>
    )
  }

  const visibleFields = fields.filter((f) => f.title.toLowerCase().includes(fieldKeyword.toLowerCase()))

  return (
    <div className="flex h-8 items-center gap-1 rounded-full border bg-background py-1 pl-1 pr-2.5 shadow-xs">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-6 shrink-0 items-center rounded-full bg-muted px-2.5 text-xs text-foreground/80 transition-colors hover:bg-accent"
          >
            {mode === "global" ? "全局" : `字段 ${enabledFields.length}`}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={fieldKeyword}
                onChange={(e) => setFieldKeyword(e.target.value)}
                placeholder="搜索字段"
                className="h-7 pl-7 text-xs"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-1.5">
            {visibleFields.map((field) => {
              const Icon = typeIcons[field.type]
              const checked = mode === "global" || enabledFields.includes(field.id)
              return (
                <label
                  key={field.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
                >
                  <Switch
                    checked={checked}
                    className="scale-90"
                    onCheckedChange={(next) => {
                      // 调整任一字段开关即切换到「字段搜索」
                      const base = mode === "global" ? fields.map((f) => f.id) : enabledFields
                      onEnabledFieldsChange(
                        next ? Array.from(new Set([...base, field.id])) : base.filter((id) => id !== field.id),
                      )
                      onModeChange("fields")
                    }}
                  />
                  <Icon className="size-3.5 text-muted-foreground" />
                  <span className="text-xs">{field.title}</span>
                </label>
              )
            })}
            {visibleFields.length === 0 && (
              <div className="py-4 text-center text-xs text-muted-foreground">无匹配字段</div>
            )}
          </div>
          <div className="space-y-1.5 border-t p-2">
            <div className="flex gap-1.5">
              <SegmentedButton active={mode === "global"} onClick={() => onModeChange("global")}>
                全局搜索
              </SegmentedButton>
              <SegmentedButton active={mode === "fields"} onClick={() => onModeChange("fields")}>
                字段搜索
              </SegmentedButton>
            </div>
            <div className="flex gap-1.5">
              <SegmentedButton active={displayMode === "all"} onClick={() => onDisplayModeChange("all")}>
                显示全部
              </SegmentedButton>
              <SegmentedButton active={displayMode === "filter"} onClick={() => onDisplayModeChange("filter")}>
                仅显示匹配行
              </SegmentedButton>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <input
        autoFocus
        value={keyword}
        onChange={(e) => onKeywordChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onKeywordChange("")
            setOpen(false)
          }
        }}
        placeholder={placeholder}
        className="w-36 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <button
        type="button"
        className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => {
          onKeywordChange("")
          setOpen(false)
        }}
      >
        <X className="size-3.5" />
      </button>
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
    </div>
  )
}

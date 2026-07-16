import type { Column } from "@tanstack/react-table"
import { useTranslation } from "react-i18next"
import { Check, CirclePlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"

interface DataTableFacetedFilterProps<TData, TValue> {
  column?: Column<TData, TValue>
  title: string
}

/**
 * 分面筛选器：自动从列数据统计可选值与数量，多选过滤。
 * 注意：对应列的 columnDef 需设置 filterFn: "arrIncludesSome"
 */
export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const { t } = useTranslation()
  if (!column) return null
  const facets = column.getFacetedUniqueValues()
  const selected = new Set((column.getFilterValue() as string[] | undefined) ?? [])
  const options = Array.from(facets.entries())
    .map(([value, count]) => ({ value: String(value), count }))
    .sort((a, b) => a.value.localeCompare(b.value))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed text-xs">
          <CirclePlus className="size-3.5" />
          {title}
          {selected.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-4" />
              {selected.size <= 2 ? (
                Array.from(selected).map((value) => (
                  <Badge key={value} variant="secondary" className="rounded-sm px-1 text-[10px] font-normal">
                    {value}
                  </Badge>
                ))
              ) : (
                <Badge variant="secondary" className="rounded-sm px-1 text-[10px] font-normal">
                  {t("已选 {{count}} 项", { count: selected.size })}
                </Badge>
              )}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-0">
        <Command>
          <CommandInput placeholder={t("筛选{{title}}…", { title })} className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty>{t("无匹配项")}</CommandEmpty>
            <CommandGroup>
              {options.map(({ value, count }) => {
                const active = selected.has(value)
                return (
                  <CommandItem
                    key={value}
                    className="text-xs"
                    onSelect={() => {
                      const next = new Set(selected)
                      if (active) {
                        next.delete(value)
                      } else {
                        next.add(value)
                      }
                      column.setFilterValue(next.size ? Array.from(next) : undefined)
                    }}
                  >
                    <div
                      className={cn(
                        "flex size-4 items-center justify-center rounded-[4px] border border-input",
                        active && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {active && <Check className="size-3" />}
                    </div>
                    <span>{value}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">{count}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    className="justify-center text-xs text-muted-foreground"
                    onSelect={() => column.setFilterValue(undefined)}
                  >
                    {t("清除筛选")}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

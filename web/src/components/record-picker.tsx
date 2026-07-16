import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Check, ChevronLeft, ChevronRight, Inbox, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Modal } from "@/components/modal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"

/**
 * 弹窗表格选择器（类 Teable 关系记录弹窗）
 *
 * 核心设计：存储与展示分离——
 * - idField：唯一字段（如工号/编号），作为 value 存储、提交给后端
 * - labelField：名称字段，用于选中标签、回显等人类可读展示
 */

export interface RecordPickerColumn<T> {
  key: keyof T & string
  title: string
  width?: number
  render?: (row: T) => ReactNode
}

export interface RecordPickerProps<T extends Record<string, unknown>> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  /** 数据源（演示为前端数组，接后端时替换为查询结果） */
  data: T[]
  columns: RecordPickerColumn<T>[]
  /** 唯一字段：存储值 */
  idField: keyof T & string
  /** 名称字段：展示值 */
  labelField: keyof T & string
  multiple?: boolean
  /** 已选的唯一值集合（单选时长度 ≤ 1） */
  value: string[]
  onConfirm: (ids: string[], rows: T[]) => void
  /** 参与搜索的字段，默认 [labelField, idField] */
  searchKeys?: Array<keyof T & string>
  pageSize?: number
}

export function RecordPicker<T extends Record<string, unknown>>({
  open,
  onOpenChange,
  title,
  description,
  data,
  columns,
  idField,
  labelField,
  multiple = false,
  value,
  onConfirm,
  searchKeys,
  pageSize = 8,
}: RecordPickerProps<T>) {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState("")
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string[]>(value)

  const idOf = (row: T) => String(row[idField])
  const labelOf = (row: T) => String(row[labelField])

  // 每次打开重置为外部值
  useEffect(() => {
    if (open) {
      setSelected(value)
      setKeyword("")
      setPage(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const keys = useMemo(() => searchKeys ?? [labelField, idField], [searchKeys, labelField, idField])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return data
    return data.filter((row) => keys.some((key) => String(row[key] ?? "").toLowerCase().includes(k)))
  }, [data, keyword, keys])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize)

  const toggle = (row: T) => {
    const id = idOf(row)
    setSelected((prev) => {
      if (multiple) {
        return prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
      }
      return prev.includes(id) ? [] : [id]
    })
  }

  const selectedRows = useMemo(
    () => data.filter((row) => selected.includes(String(row[idField]))),
    [data, selected, idField],
  )

  const confirm = () => {
    onConfirm(selected, selectedRows)
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? t("选择记录")}
      description={
        description ??
        t("存储唯一字段「{{idField}}」· 展示名称字段「{{labelField}}」", { idField, labelField })
      }
      width={720}
      height={560}
      bodyClassName="flex flex-col gap-3 p-4"
      footer={
        <>
          <span className="mr-auto text-xs text-muted-foreground">
            {t("已选")} <span className="font-semibold text-primary">{selected.length}</span>
            {multiple ? t(" 条") : selected.length ? t(" 条") : t("，请选择一条记录")}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("取消")}
          </Button>
          <Button onClick={confirm} disabled={!multiple && selected.length === 0 && value.length === 0}>
            {t("确定")}
          </Button>
        </>
      }
    >
      {/* 搜索 */}
      <div className="relative shrink-0">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value)
            setPage(0)
          }}
          placeholder={t("搜索 {{keys}}", { keys: keys.join(" / ") })}
          className="h-8 pl-8 text-sm"
        />
      </div>

      {/* 已选标签（多选） */}
      {multiple && selected.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-md border bg-muted/30 p-2">
          {selectedRows.map((row) => (
            <Badge key={idOf(row)} variant="secondary" className="gap-1 pr-1 font-normal">
              {labelOf(row)}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-foreground/10"
                onClick={() => setSelected((prev) => prev.filter((v) => v !== idOf(row)))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs text-muted-foreground"
            onClick={() => setSelected([])}
          >
            {t("清空")}
          </Button>
        </div>
      )}

      {/* 表格 */}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="w-10 px-3 py-2" />
              {columns.map((col) => (
                <th key={col.key} style={{ width: col.width }} className="px-3 py-2 font-medium">
                  {col.title}
                  {col.key === idField && (
                    <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px] font-normal text-muted-foreground">
                      {t("唯一")}
                    </Badge>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="h-40">
                  <div className="flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
                    <Inbox className="size-8 opacity-30" />
                    <span className="text-xs">{t("未找到匹配记录")}</span>
                  </div>
                </td>
              </tr>
            ) : (
              pageRows.map((row) => {
                const id = idOf(row)
                const checked = selected.includes(id)
                return (
                  <tr
                    key={id}
                    onClick={() => toggle(row)}
                    className={cn(
                      "cursor-pointer border-b transition-colors last:border-b-0 hover:bg-accent/50",
                      checked && "bg-primary/5",
                    )}
                  >
                    <td className="px-3 py-2">
                      {multiple ? (
                        <Checkbox checked={checked} className="pointer-events-none" />
                      ) : (
                        <span
                          className={cn(
                            "flex size-4 items-center justify-center rounded-full border-2",
                            checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                          )}
                        >
                          {checked && <Check className="size-2.5" />}
                        </span>
                      )}
                    </td>
                    {columns.map((col) => (
                      <td key={col.key} className="px-3 py-2">
                        {col.render ? col.render(row) : String(row[col.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <div className="flex shrink-0 items-center justify-between text-xs text-muted-foreground">
        <span>
          {t("共 {{count}} 条", { count: filtered.length })}
          {keyword && t("（已过滤）")}
        </span>
        <span className="flex items-center gap-1">
          {page + 1} / {pageCount}
          <Button
            variant="outline"
            size="icon"
            className="ml-1 size-6"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </span>
      </div>
    </Modal>
  )
}

/* ================= 触发器：字段样式的选择入口 ================= */

interface RecordPickerFieldProps {
  /** 已选 id → 展示名称 的映射结果 */
  labels: Array<{ id: string; label: string }>
  placeholder?: string
  multiple?: boolean
  onOpen: () => void
  onRemove: (id: string) => void
  className?: string
}

/** 表单字段样式的触发器：展示名称标签，存储层由调用方持有 id */
export function RecordPickerField({
  labels,
  placeholder,
  multiple,
  onOpen,
  onRemove,
  className,
}: RecordPickerFieldProps) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2.5 py-1.5 text-left text-sm transition-colors hover:border-primary/40",
        className,
      )}
    >
      {labels.length === 0 ? (
        <span className="text-muted-foreground">{placeholder ?? t("点击选择")}</span>
      ) : (
        labels.map(({ id, label }) => (
          <Badge key={id} variant="secondary" className="gap-1 pr-1 font-normal">
            {label}
            {multiple && (
              <span
                role="button"
                tabIndex={0}
                className="rounded-full p-0.5 hover:bg-foreground/10"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(id)
                }}
                onKeyDown={(e) => e.key === "Enter" && onRemove(id)}
              >
                <X className="size-3" />
              </span>
            )}
          </Badge>
        ))
      )}
      <Search className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

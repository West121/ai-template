import { useMemo, useState, type ReactNode } from "react"
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getGroupedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ExpandedState,
  type GroupingState,
  type PaginationState,
  type RowData,
  type SortingState,
  type Updater,
  type Table as TableInstance,
  type VisibilityState,
} from "@tanstack/react-table"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Inbox,
  Layers,
  Maximize,
  Minimize,
  RotateCw,
  Rows2,
  Settings2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import {
  DataTableAdvancedFilter,
  emptyFilterRoot,
  evalFilterGroup,
  type FilterField,
  type FilterFieldType,
  type FilterRoot,
} from "./data-table-advanced-filter"
import { DataTableFacetedFilter } from "./data-table-faceted-filter"
import {
  DataTableSearch,
  type SearchDisplayMode,
  type SearchMode,
} from "./data-table-search"

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** 中文列名，用于列设置面板与 CSV 导出表头 */
    title?: string
    /** 字段类型：条件筛选的操作符与值输入按此渲染，默认 text */
    filterType?: FilterFieldType
    /** select 类型字段的可选值 */
    options?: string[]
  }
}

type Density = "compact" | "default" | "loose"

const densityClass: Record<Density, string> = {
  compact: "[&_td]:py-1.5 [&_th]:h-8",
  default: "[&_td]:py-2.5 [&_th]:h-10",
  loose: "[&_td]:py-4 [&_th]:h-12",
}

/** 行选择列，配合 enableSelection 使用或自行加入 columns */
export function selectionColumn<TData>(): ColumnDef<TData> {
  return {
    id: "select",
    size: 40,
    enableSorting: false,
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="全选"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="选择行"
        onClick={(e) => e.stopPropagation()}
      />
    ),
  }
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  /** 快捷搜索匹配的字段（支持多个，任一匹配即命中） */
  searchKeys?: Array<keyof TData & string>
  searchPlaceholder?: string
  /** 工具栏左侧区域（通常放筛选器） */
  filterSlot?: ReactNode
  /** 工具栏右侧操作按钮（如“新建”） */
  actionSlot?: ReactNode
  /** 选中行时出现的批量操作区 */
  batchSlot?: (rows: TData[], clear: () => void) => ReactNode
  loading?: boolean
  onRefresh?: () => void
  /** 提供文件名即开启 CSV 导出 */
  exportFileName?: string
  enableSelection?: boolean
  onRowClick?: (row: TData) => void
  initialPageSize?: number
  className?: string
  /**
   * 分面筛选器：按列值多选过滤（自动统计各值数量）。
   * 对应列的 columnDef 需设置 filterFn: "arrIncludesSome"
   */
  facetedFilters?: Array<{ columnId: string; title: string }>
  /** 可分组的列，提供后工具栏出现「分组」选择器；配合 columnDef 的 aggregationFn/aggregatedCell 可做聚合 */
  groupOptions?: Array<{ id: string; label: string }>
  /** Notion 风格条件筛选器（条件/条件组/与或逻辑），字段取自列的 meta.title + meta.filterType */
  advancedFilter?: boolean
  /**
   * 服务端搜索（受控）：传入后搜索框改为受控、禁用本地关键词过滤，由外部按 keyword 查后端。
   * 与 serverPagination 配合可实现"后端搜索 + 后端分页"（避免只拉前 N 条本地搜索导致搜不全）。
   */
  serverSearch?: {
    keyword: string
    onKeywordChange: (keyword: string) => void
  }
  /**
   * 服务端分页（受控）：传入后分页交由外部（manualPagination），total 用 rowCount。
   * pageIndex 为 0-based。
   */
  serverPagination?: {
    pageIndex: number
    pageSize: number
    rowCount: number
    onPaginationChange: (pageIndex: number, pageSize: number) => void
  }
}

function exportCsv<TData>(table: TableInstance<TData>, fileName: string) {
  const columns = table
    .getVisibleLeafColumns()
    .filter((col) => col.id !== "select" && col.id !== "actions" && col.accessorFn)
  const header = columns.map((col) => col.columnDef.meta?.title ?? col.id)
  const rows = table.getFilteredRowModel().rows.map((row) =>
    columns.map((col) => {
      const value = row.getValue(col.id)
      const text = value == null ? "" : String(value)
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
    }),
  )
  const csv = "\uFEFF" + [header, ...rows].map((line) => line.join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${fileName}.csv`
  link.click()
  URL.revokeObjectURL(url)
  toast.success(`已导出 ${rows.length} 条数据`)
}

export function DataTable<TData>({
  columns: userColumns,
  data,
  searchKeys,
  searchPlaceholder = "搜索…",
  filterSlot,
  actionSlot,
  batchSlot,
  loading,
  onRefresh,
  exportFileName,
  enableSelection,
  onRowClick,
  initialPageSize = 10,
  className,
  facetedFilters,
  groupOptions,
  advancedFilter,
  serverSearch,
  serverPagination,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState({})
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [grouping, setGrouping] = useState<GroupingState>([])
  const [expanded, setExpanded] = useState<ExpandedState>(true)
  const [density, setDensity] = useState<Density>("default")
  const [fullscreen, setFullscreen] = useState(false)

  // 搜索：关键词 / 范围（全局或指定字段）/ 显示方式（过滤或淡化非匹配行）
  const [keyword, setKeyword] = useState("")
  const [searchMode, setSearchMode] = useState<SearchMode>("global")
  const [searchDisplay, setSearchDisplay] = useState<SearchDisplayMode>("filter")
  // 条件筛选器
  const [filterRoot, setFilterRoot] = useState<FilterRoot>(emptyFilterRoot)

  const columns = useMemo(
    () => (enableSelection ? [selectionColumn<TData>(), ...userColumns] : userColumns),
    [enableSelection, userColumns],
  )

  /** 从列定义提取可筛选/可搜索字段（需要 accessorKey + meta.title） */
  const filterFields = useMemo<FilterField[]>(
    () =>
      userColumns.flatMap((col) => {
        const key = (col as { accessorKey?: string }).accessorKey
        const title = col.meta?.title
        if (!key || !title) return []
        return [{ id: key, title, type: col.meta?.filterType ?? "text", options: col.meta?.options }]
      }),
    [userColumns],
  )

  const [enabledFields, setEnabledFields] = useState<string[]>(
    () => searchKeys ?? filterFields.map((f) => f.id),
  )

  const searchIds = useMemo(() => {
    if (searchMode === "fields") return enabledFields
    return filterFields.length ? filterFields.map((f) => f.id) : (searchKeys ?? [])
  }, [searchMode, enabledFields, filterFields, searchKeys])

  const matchesKeyword = (original: TData, kw: string) => {
    const k = kw.toLowerCase().trim()
    if (!k) return true
    return searchIds.some((id) =>
      String((original as Record<string, unknown>)[id] ?? "")
        .toLowerCase()
        .includes(k),
    )
  }

  // 条件筛选在进表格前完成，与搜索/列筛选/分组自由叠加
  const filteredData = useMemo(
    () =>
      advancedFilter && filterRoot.items.length
        ? data.filter((row) => evalFilterGroup(row, filterRoot, filterFields))
        : data,
    [data, advancedFilter, filterRoot, filterFields],
  )

  // 「显示全部」模式不过滤行，仅淡化非匹配行；服务端搜索时本地不过滤
  const globalFilter = serverSearch ? "" : searchDisplay === "filter" ? keyword : ""

  // 服务端搜索时搜索框改为受控绑定外部 keyword（内部 keyword 保持空，不参与本地过滤/淡化）
  const searchKeyword = serverSearch ? serverSearch.keyword : keyword
  const setSearchKeyword = serverSearch ? serverSearch.onKeywordChange : setKeyword

  const table = useReactTable({
    data: filteredData,
    columns,
    manualFiltering: !!serverSearch,
    manualPagination: !!serverPagination,
    rowCount: serverPagination?.rowCount,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      globalFilter,
      columnFilters,
      grouping,
      expanded,
      ...(serverPagination
        ? { pagination: { pageIndex: serverPagination.pageIndex, pageSize: serverPagination.pageSize } }
        : {}),
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setKeyword,
    onColumnFiltersChange: setColumnFilters,
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    // 注意：本地模式**不能**显式传 onPaginationChange: undefined —— TanStack v8 的 setPagination 是
    // options.onPaginationChange?.(updater)，显式 undefined 会覆盖默认的内部状态更新器(makeStateUpdater)，
    // 导致翻页/改每页条数全部无效（曾致所有表格分页失灵）。仅服务端模式才提供受控回调。
    ...(serverPagination
      ? {
          onPaginationChange: (updater: Updater<PaginationState>) => {
            const current = { pageIndex: serverPagination.pageIndex, pageSize: serverPagination.pageSize }
            const next = typeof updater === "function" ? updater(current) : updater
            serverPagination.onPaginationChange(next.pageIndex, next.pageSize)
          },
        }
      : {}),
    globalFilterFn: (row, _columnId, filterValue) => matchesKeyword(row.original, String(filterValue)),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    autoResetExpanded: false,
    initialState: { pagination: { pageSize: initialPageSize } },
  })

  const selectedRows = table.getFilteredSelectedRowModel().rows
  const total = serverPagination ? serverPagination.rowCount : table.getFilteredRowModel().rows.length
  const { pageIndex, pageSize } = table.getState().pagination
  const pageCount = table.getPageCount()

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-lg border bg-card",
        fullscreen && "fixed inset-0 z-50 rounded-none",
        className,
      )}
    >
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        {(searchKeys || filterFields.length > 0) && (
          <DataTableSearch
            keyword={searchKeyword}
            onKeywordChange={setSearchKeyword}
            fields={filterFields}
            enabledFields={enabledFields}
            onEnabledFieldsChange={setEnabledFields}
            mode={searchMode}
            onModeChange={setSearchMode}
            displayMode={searchDisplay}
            onDisplayModeChange={setSearchDisplay}
            placeholder={searchPlaceholder}
          />
        )}
        {advancedFilter && (
          <DataTableAdvancedFilter fields={filterFields} root={filterRoot} onChange={setFilterRoot} />
        )}
        {facetedFilters?.map((filter) => (
          <DataTableFacetedFilter
            key={filter.columnId}
            column={table.getColumn(filter.columnId)}
            title={filter.title}
          />
        ))}
        {groupOptions && groupOptions.length > 0 && (
          <Select
            value={grouping[0] ?? "none"}
            onValueChange={(value) => {
              setGrouping(value === "none" ? [] : [value])
              setExpanded(true)
            }}
          >
            <SelectTrigger size="sm" className="h-8 gap-1.5 text-xs">
              <Layers className="size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不分组</SelectItem>
              {groupOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  按{option.label}分组
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {filterSlot}
        <div className="ml-auto flex items-center gap-1">
          {actionSlot}
          {onRefresh && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" onClick={onRefresh}>
                  <RotateCw className={cn("size-4", loading && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>刷新</TooltipContent>
            </Tooltip>
          )}
          {exportFileName && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => exportCsv(table, exportFileName)}>
                  <Download className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>导出 CSV</TooltipContent>
            </Tooltip>
          )}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8">
                    <Rows2 className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>密度</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={density} onValueChange={(v) => setDensity(v as Density)}>
                <DropdownMenuRadioItem value="compact">紧凑</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="default">默认</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="loose">宽松</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8">
                    <Settings2 className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>列设置</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel className="text-xs">显示的列</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllLeafColumns()
                .filter((col) => col.getCanHide())
                .map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={col.getIsVisible()}
                    onCheckedChange={(checked) => col.toggleVisibility(!!checked)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {col.columnDef.meta?.title ?? col.id}
                  </DropdownMenuCheckboxItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setColumnVisibility({})}>重置</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setFullscreen((f) => !f)}>
                {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{fullscreen ? "退出全屏" : "全屏"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* 批量操作：视口底部悬浮胶囊，不占布局、不影响表格行位置 */}
      {enableSelection && selectedRows.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border bg-background/95 py-1.5 pl-4 pr-1.5 shadow-lg backdrop-blur animate-in fade-in-0 slide-in-from-bottom-2">
            <span className="text-sm">
              已选 <span className="font-semibold text-primary">{selectedRows.length}</span> 项
            </span>
            <span className="h-4 w-px bg-border" />
            {batchSlot?.(
              selectedRows.map((r) => r.original),
              () => table.resetRowSelection(),
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-2.5 text-xs text-muted-foreground"
              onClick={() => table.resetRowSelection()}
            >
              取消
            </Button>
          </div>
        </div>
      )}

      {/* 表格主体 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table className={densityClass[density]}>
          <TableHeader className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                    className="bg-muted/50 text-xs font-medium text-muted-foreground"
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          {/* 刷新/翻页时不整体换骨架（会整表闪烁）：保留旧行 + 半透明禁交互；骨架仅用于首载（无数据） */}
          <TableBody className={cn(loading && filteredData.length > 0 && "pointer-events-none opacity-55 transition-opacity")}>
            {loading && filteredData.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {table.getVisibleLeafColumns().map((col) => (
                    <TableCell key={col.id}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) =>
                row.getIsGrouped() ? (
                  // 分组行：展开/收起 + 分组值 + 条数，其余列展示聚合值
                  <TableRow key={row.id} className="bg-muted/40 hover:bg-muted/50">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="text-sm">
                        {cell.getIsGrouped() ? (
                          <button
                            type="button"
                            onClick={row.getToggleExpandedHandler()}
                            className="flex items-center gap-1.5 font-medium"
                          >
                            <ChevronRight
                              className={cn(
                                "size-4 text-muted-foreground transition-transform",
                                row.getIsExpanded() && "rotate-90",
                              )}
                            />
                            <span>{String(cell.getValue() ?? "")}</span>
                            <span className="text-xs font-normal text-muted-foreground">
                              ({row.subRows.length})
                            </span>
                          </button>
                        ) : cell.getIsAggregated() ? (
                          flexRender(
                            cell.column.columnDef.aggregatedCell ?? (() => null),
                            cell.getContext(),
                          )
                        ) : null}
                      </TableCell>
                    ))}
                  </TableRow>
                ) : (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className={cn(
                      onRowClick && "cursor-pointer",
                      // 「显示全部」搜索模式：非匹配行淡化
                      searchDisplay === "all" &&
                        keyword.trim() !== "" &&
                        !matchesKeyword(row.original, keyword) &&
                        "opacity-35",
                    )}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="text-sm">
                        {cell.getIsPlaceholder()
                          ? null
                          : flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ),
              )
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-48">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Inbox className="size-10 opacity-30" />
                    <span className="text-sm">暂无数据</span>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 分页 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5">
        <div className="text-xs text-muted-foreground">
          共 <span className="font-medium text-foreground">{total}</span> 条
          {enableSelection && selectedRows.length > 0 && <span>，已选 {selectedRows.length} 条</span>}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            每页
            <Select value={String(pageSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
              <SelectTrigger size="sm" className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            条
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="mr-1">
              {pageCount === 0 ? 0 : pageIndex + 1} / {pageCount} 页
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.setPageIndex(0)}
            >
              <ChevronsLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={!table.getCanNextPage()}
              onClick={() => table.setPageIndex(pageCount - 1)}
            >
              <ChevronsRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

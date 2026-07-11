import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import { Archive, FileText } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useDebounced, useServerPage } from "@/lib/use-server-page"
import { fetchArchivePage, fetchLedgerPage } from "./gongwen/mock"
import { gwFormatDate, type GwDoc, type GwLedgerRow } from "./gongwen/types"
import { DocTypeBadge } from "./gongwen/badges"
import { DemoBanner } from "./gongwen/shared"

const YEARS = ["2026", "2025", "2024"]

/* ------------------------------- 文号台账 ------------------------------- */

function NumberLedger() {
  const [demo, setDemo] = useState(false)
  const [year, setYear] = useState("all")
  const [keyword, setKeyword] = useState("")

  // 服务端分页 + keyword（后端 /api/office/doc/ledger 支持 year/keyword/pageNum/pageSize）
  const query = useDebounced(keyword.trim())
  const page = useServerPage<GwLedgerRow>(
    async (pageNum, pageSize) => {
      const res = await fetchLedgerPage({
        year: year === "all" ? undefined : year,
        keyword: query || undefined,
        pageNum,
        pageSize,
      })
      setDemo(res.demo)
      return res.data
    },
    { resetKey: `${year}|${query}`, offlineFetch: true },
  )
  const { rows, loading, reload } = page

  const columns = useMemo<ColumnDef<GwLedgerRow, unknown>[]>(
    () => [
      {
        accessorKey: "docNumber",
        meta: { title: "文号" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="文号" />,
        cell: ({ row }) => (
          <span className={cn("font-mono text-sm", row.original.status === "VOIDED" && "text-muted-foreground line-through")}>
            {row.original.docNumber}
          </span>
        ),
      },
      {
        accessorKey: "docTitle",
        meta: { title: "标题" },
        header: () => <span>标题</span>,
        cell: ({ row }) => (
          <span
            className={cn(
              "block max-w-96 truncate",
              row.original.status === "VOIDED" ? "text-muted-foreground line-through" : "font-medium",
            )}
            title={row.original.docTitle}
          >
            {row.original.docTitle}
          </span>
        ),
      },
      {
        accessorKey: "issuer",
        meta: { title: "签发人" },
        header: () => <span>签发人</span>,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.issuer ?? "—"}</span>,
      },
      {
        accessorKey: "issuedAt",
        meta: { title: "占号日期" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="占号日期" />,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{gwFormatDate(row.original.issuedAt)}</span>,
      },
      {
        accessorKey: "status",
        meta: { title: "状态" },
        header: () => <span>状态</span>,
        cell: ({ row }) =>
          row.original.status === "VOIDED" ? (
            <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-500">
              作废
            </Badge>
          ) : (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
              占用
            </Badge>
          ),
      },
    ],
    [],
  )

  return (
    <div className="space-y-3">
      {demo && <DemoBanner />}
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="flex items-start gap-2 px-4 py-3 text-xs text-muted-foreground">
          <FileText className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>
            文号台账连续可查，作废文号<strong className="text-rose-500">置灰不回收</strong>（合规要求）。文号在签发通过节点正式占号，采用六角括号 <code className="font-mono">〔〕</code>，年份四位全称。
          </span>
        </CardContent>
      </Card>
      <DataTable
        columns={columns}
        data={rows}
        searchKeys={["docNumber", "docTitle"]}
        searchPlaceholder="搜索文号 / 标题"
        loading={loading}
        onRefresh={reload}
        exportFileName="文号台账"
        serverSearch={{ keyword, onKeywordChange: setKeyword }}
        serverPagination={{
          pageIndex: page.pageIndex,
          pageSize: page.pageSize,
          rowCount: page.total,
          onPaginationChange: page.onPaginationChange,
        }}
        filterSlot={
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger size="sm" className="h-8 w-28 text-sm">
              <SelectValue placeholder="年度" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部年度</SelectItem>
              {YEARS.map((y) => (
                <SelectItem key={y} value={y}>
                  {y} 年度
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </div>
  )
}

/* ------------------------------ 归档卷宗检索 ------------------------------ */

function ArchiveSearch() {
  const navigate = useNavigate()
  const [demo, setDemo] = useState(false)
  const [year, setYear] = useState("all")
  const [category, setCategory] = useState("all")
  const [keyword, setKeyword] = useState("")

  // 服务端分页 + keyword（后端 /api/office/doc/archive 支持 direction/keyword/pageNum/pageSize）
  const query = useDebounced(keyword.trim())
  const page = useServerPage<GwDoc>(
    async (pageNum, pageSize) => {
      const res = await fetchArchivePage({
        year: year === "all" ? undefined : year,
        category: category === "all" ? undefined : category,
        keyword: query || undefined,
        pageNum,
        pageSize,
      })
      setDemo(res.demo)
      return res.data
    },
    { resetKey: `${year}|${category}|${query}`, offlineFetch: true },
  )
  const { rows, loading, reload } = page

  const columns = useMemo<ColumnDef<GwDoc, unknown>[]>(
    () => [
      {
        accessorKey: "archiveNo",
        meta: { title: "卷宗号" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="卷宗号" />,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.archiveNo}</span>,
      },
      {
        accessorKey: "code",
        meta: { title: "文号" },
        header: () => <span>文号</span>,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.code}</span>,
      },
      {
        accessorKey: "title",
        meta: { title: "标题" },
        header: () => <span>标题</span>,
        cell: ({ row }) => (
          <span className="block max-w-80 truncate font-medium" title={row.original.title}>
            {row.original.title}
          </span>
        ),
      },
      {
        accessorKey: "archiveCategory",
        meta: { title: "类别" },
        header: () => <span>类别</span>,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-muted-foreground">
            {row.original.archiveCategory}
          </Badge>
        ),
      },
      {
        accessorKey: "docType",
        meta: { title: "文种" },
        header: () => <span>文种</span>,
        cell: ({ row }) => <DocTypeBadge docType={row.original.docType} />,
      },
      {
        accessorKey: "archivedAt",
        meta: { title: "归档日期" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="归档日期" />,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{gwFormatDate(row.original.archivedAt)}</span>,
      },
    ],
    [],
  )

  return (
    <div className="space-y-3">
      {demo && <DemoBanner />}
      <DataTable
        columns={columns}
        data={rows}
        searchKeys={["archiveNo", "code", "title"]}
        searchPlaceholder="搜索卷宗号 / 文号 / 标题"
        loading={loading}
        onRefresh={reload}
        exportFileName="归档卷宗"
        onRowClick={(row) => navigate(`/document/${row.direction === "SEND" ? "send" : "receive"}/${row.id}`)}
        serverSearch={{ keyword, onKeywordChange: setKeyword }}
        serverPagination={{
          pageIndex: page.pageIndex,
          pageSize: page.pageSize,
          rowCount: page.total,
          onPaginationChange: page.onPaginationChange,
        }}
        filterSlot={
          <>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger size="sm" className="h-8 w-28 text-sm">
                <SelectValue placeholder="年度" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部年度</SelectItem>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y} 年度
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger size="sm" className="h-8 w-28 text-sm">
                <SelectValue placeholder="类别" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类别</SelectItem>
                <SelectItem value="发文">发文</SelectItem>
                <SelectItem value="收文">收文</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />
    </div>
  )
}

/* --------------------------------- 页面 --------------------------------- */

export default function LedgerPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="公文台账" description="文号台账（连续文号、作废置灰）与归档卷宗检索（按年度 / 类别）" />
      <Tabs defaultValue="number">
        <TabsList>
          <TabsTrigger value="number" className="gap-1.5">
            <FileText className="size-3.5" /> 文号台账
          </TabsTrigger>
          <TabsTrigger value="archive" className="gap-1.5">
            <Archive className="size-3.5" /> 归档卷宗
          </TabsTrigger>
        </TabsList>
        <TabsContent value="number" className="mt-4">
          <NumberLedger />
        </TabsContent>
        <TabsContent value="archive" className="mt-4">
          <ArchiveSearch />
        </TabsContent>
      </Tabs>
    </div>
  )
}

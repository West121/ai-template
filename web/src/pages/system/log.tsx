import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { CloudOff, RotateCw, ShieldAlert, TerminalSquare, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { Modal } from "@/components/modal"
import { DataTable, indexColumn } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { runBatch, toastBatch } from "@/lib/batch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"

interface OperLog {
  id: number
  username: string
  module: string
  action: string
  method?: string | null
  params?: string | null
  status: "SUCCESS" | "FAIL"
  errorMsg?: string | null
  costMs: number
  ip?: string | null
  createdAt?: string | null
}

interface LoginLog {
  id: number
  username: string
  ip?: string | null
  location?: string | null
  userAgent?: string | null
  success: boolean
  message?: string | null
  createdAt?: string | null
}

interface RuntimeLog {
  file: string
  lines: string[]
}

function formatTime(iso?: string | null) {
  if (!iso) return "—"
  return iso.slice(0, 19).replace("T", " ")
}

/** 运行日志行着色：ERROR 红 / WARN 黄 */
function lineClass(line: string) {
  if (line.includes("ERROR")) return "text-red-400"
  if (line.includes("WARN")) return "text-amber-400"
  return undefined
}

export default function LogPage() {
  const [operRows, setOperRows] = useState<OperLog[]>([])
  const [loginRows, setLoginRows] = useState<LoginLog[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [operDetail, setOperDetail] = useState<OperLog | null>(null)
  // 批量清理确认：kind 决定命中操作日志 / 登录日志端点
  const [batchDel, setBatchDel] = useState<{ kind: "oper" | "login"; ids: number[]; clear: () => void } | null>(null)

  // 运行日志
  const [runtimeLines, setRuntimeLines] = useState<string[]>([])
  const [runtimeFile, setRuntimeFile] = useState("")
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [lineCount, setLineCount] = useState("300")
  const termRef = useRef<HTMLDivElement | null>(null)

  const offline = useAuthStore((s) => s.offline)

  const loadRuntime = useCallback(async (lines: string) => {
    setRuntimeLoading(true)
    setRuntimeError(null)
    try {
      const data = await api<RuntimeLog>(`/api/infra/logs/runtime?lines=${lines}`)
      setRuntimeLines(data.lines)
      setRuntimeFile(data.file)
    } catch (err) {
      if (err instanceof NetworkError) setRuntimeError("无法连接后端服务")
      else setRuntimeError(err instanceof Error ? err.message : "运行日志加载失败")
    } finally {
      setRuntimeLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [oper, login] = await Promise.all([
        api<PageResult<OperLog>>("/api/infra/logs/oper?pageNum=1&pageSize=100"),
        api<PageResult<LoginLog>>("/api/infra/logs/login?pageNum=1&pageSize=100"),
      ])
      setOperRows(oper.list)
      setLoginRows(login.list)
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  const confirmBatchDelete = async () => {
    if (!batchDel) return
    // 操作日志 → /api/infra/logs/oper，登录日志 → /api/infra/logs/login
    const base = batchDel.kind === "oper" ? "/api/infra/logs/oper" : "/api/infra/logs/login"
    const result = await runBatch({
      ids: batchDel.ids,
      batchPath: `${base}/batch-delete`,
      single: (id) => api(`${base}/${id}`, { method: "DELETE" }),
    })
    toastBatch(result, "清理")
    batchDel.clear()
    setBatchDel(null)
    void load()
  }

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
    void loadRuntime("300")
  }, [load, loadRuntime, offline])

  // 运行日志更新后自动滚到底部（终端习惯：最新日志在最下方）
  useEffect(() => {
    const el = termRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [runtimeLines])

  /* ---------- 操作日志列 ---------- */

  const moduleOptions = useMemo(
    () => Array.from(new Set(operRows.map((r) => r.module).filter(Boolean))),
    [operRows],
  )

  const operColumns = useMemo<ColumnDef<OperLog, unknown>[]>(
    () => [
      indexColumn<OperLog>(),
      {
        accessorKey: "username",
        meta: { title: "操作人" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="操作人" />,
        cell: ({ row }) => <span className="font-medium">{row.original.username}</span>,
      },
      {
        accessorKey: "module",
        meta: { title: "模块", filterType: "select", options: moduleOptions },
        header: ({ column }) => <DataTableColumnHeader column={column} title="模块" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.module}</Badge>,
      },
      {
        accessorKey: "action",
        meta: { title: "操作" },
        header: () => <span>操作</span>,
        cell: ({ row }) => row.original.action,
      },
      {
        accessorKey: "method",
        meta: { title: "请求" },
        header: () => <span>请求</span>,
        cell: ({ row }) => (
          <span className="block max-w-[220px] truncate font-mono text-xs text-muted-foreground">
            {row.original.method ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        meta: { title: "状态", filterType: "select", options: ["SUCCESS", "FAIL"] },
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) =>
          row.original.status === "SUCCESS" ? (
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            >
              成功
            </Badge>
          ) : (
            <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400">
              失败
            </Badge>
          ),
      },
      {
        accessorKey: "costMs",
        meta: { title: "耗时", filterType: "number" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="耗时" />,
        cell: ({ row }) => (
          <span
            className={cn(
              "text-sm tabular-nums",
              row.original.costMs > 1000 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
            )}
          >
            {row.original.costMs} ms
          </span>
        ),
      },
      {
        accessorKey: "ip",
        meta: { title: "IP" },
        header: () => <span>IP</span>,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.ip ?? "—"}</span>,
      },
      {
        accessorKey: "createdAt",
        meta: { title: "时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="时间" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatTime(row.original.createdAt)}</span>
        ),
      },
    ],
    [moduleOptions],
  )

  /* ---------- 登录日志列 ---------- */

  const loginColumns = useMemo<ColumnDef<LoginLog, unknown>[]>(
    () => [
      indexColumn<LoginLog>(),
      {
        accessorKey: "username",
        meta: { title: "账号" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="账号" />,
        cell: ({ row }) => <span className="font-medium">{row.original.username}</span>,
      },
      {
        accessorKey: "ip",
        meta: { title: "IP" },
        header: () => <span>IP</span>,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.ip ?? "—"}</span>,
      },
      {
        accessorKey: "location",
        meta: { title: "登录地点", filterType: "text" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="登录地点" />,
        cell: ({ row }) =>
          row.original.location ? (
            <Badge variant="outline" className="font-normal">
              {row.original.location}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "userAgent",
        meta: { title: "浏览器" },
        header: () => <span>浏览器</span>,
        cell: ({ row }) =>
          row.original.userAgent ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block max-w-[240px] truncate text-xs text-muted-foreground">
                  {row.original.userAgent}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-md break-all">{row.original.userAgent}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "success",
        meta: { title: "结果" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="结果" />,
        cell: ({ row }) =>
          row.original.success ? (
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            >
              成功
            </Badge>
          ) : (
            <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400">
              失败
            </Badge>
          ),
      },
      {
        accessorKey: "message",
        meta: { title: "说明" },
        header: () => <span>说明</span>,
        cell: ({ row }) => (
          <span className="block max-w-[220px] truncate text-sm text-muted-foreground">
            {row.original.message ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        meta: { title: "时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="时间" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatTime(row.original.createdAt)}</span>
        ),
      },
    ],
    [],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="日志管理"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页为真实数据"
            : "操作日志（@OperLog 注解 + AOP 自动落库）、登录日志与应用运行日志"
        }
      />

      {loadError === "network" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，
              然后用 admin（密码 admin123）重新登录，即可查看真实的操作日志、登录日志与运行日志。
            </p>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                void load()
                void loadRuntime(lineCount)
              }}
            >
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="oper">
          <TabsList>
            <TabsTrigger value="oper">操作日志</TabsTrigger>
            <TabsTrigger value="login">登录日志</TabsTrigger>
            <TabsTrigger value="runtime">运行日志</TabsTrigger>
          </TabsList>

          {/* 操作日志 */}
          <TabsContent value="oper" className="mt-3">
            <DataTable
              columns={operColumns}
              data={operRows}
              loading={loading}
              searchKeys={["username", "module", "action", "method"]}
              searchPlaceholder="搜索操作人 / 模块 / 操作"
              advancedFilter
              onRowClick={(row) => setOperDetail(row)}
              onRefresh={() => void load()}
              exportFileName="操作日志"
              enableSelection
              batchSlot={(rows, clear) => (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 rounded-full px-2.5 text-xs text-destructive hover:text-destructive"
                  onClick={() => setBatchDel({ kind: "oper", ids: rows.map((r) => r.id), clear })}
                >
                  <Trash2 className="size-3.5" /> 清理
                </Button>
              )}
            />
          </TabsContent>

          {/* 登录日志 */}
          <TabsContent value="login" className="mt-3">
            <DataTable
              columns={loginColumns}
              data={loginRows}
              loading={loading}
              searchKeys={["username", "ip", "message"]}
              searchPlaceholder="搜索账号 / IP / 地点"
              onRefresh={() => void load()}
              exportFileName="登录日志"
              enableSelection
              batchSlot={(rows, clear) => (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 rounded-full px-2.5 text-xs text-destructive hover:text-destructive"
                  onClick={() => setBatchDel({ kind: "login", ids: rows.map((r) => r.id), clear })}
                >
                  <Trash2 className="size-3.5" /> 清理
                </Button>
              )}
            />
          </TabsContent>

          {/* 运行日志：黑底终端风 */}
          <TabsContent value="runtime" className="mt-3">
            <div className="rounded-lg border bg-card">
              <div className="flex flex-wrap items-center gap-2 border-b p-3">
                <TerminalSquare className="size-4 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">
                  {runtimeFile || "logs/oa-platform.log"}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Select
                    value={lineCount}
                    onValueChange={(v) => {
                      setLineCount(v)
                      void loadRuntime(v)
                    }}
                  >
                    <SelectTrigger size="sm" className="h-8 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["100", "300", "1000"].map((n) => (
                        <SelectItem key={n} value={n}>
                          最近 {n} 行
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={() => void loadRuntime(lineCount)}
                  >
                    <RotateCw className={cn("size-3.5", runtimeLoading && "animate-spin")} /> 刷新
                  </Button>
                </div>
              </div>
              <div ref={termRef} className="max-h-[560px] overflow-auto bg-zinc-950 p-4">
                {runtimeError ? (
                  <div className="py-10 text-center font-mono text-xs text-zinc-500">{runtimeError}</div>
                ) : runtimeLines.length === 0 ? (
                  <div className="py-10 text-center font-mono text-xs text-zinc-500">
                    {runtimeLoading ? "加载中…" : "暂无日志输出"}
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-zinc-300">
                    {runtimeLines.map((line, i) => (
                      <div key={i} className={lineClass(line)}>
                        {line || " "}
                      </div>
                    ))}
                  </pre>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* 操作日志详情 */}
      <Modal
        open={!!operDetail}
        onOpenChange={(open) => !open && setOperDetail(null)}
        title="操作日志详情"
        description={
          operDetail ? `${operDetail.module} · ${operDetail.action} · ${formatTime(operDetail.createdAt)}` : undefined
        }
        width={560}
        footer={
          <Button variant="outline" onClick={() => setOperDetail(null)}>
            关闭
          </Button>
        }
      >
        {operDetail && (
          <div className="space-y-3 text-sm">
            {[
              ["操作人", operDetail.username],
              ["模块", operDetail.module],
              ["操作", operDetail.action],
              ["请求", operDetail.method ?? "—"],
              ["状态", operDetail.status === "SUCCESS" ? "成功" : "失败"],
              ["耗时", `${operDetail.costMs} ms`],
              ["IP", operDetail.ip ?? "—"],
              ["时间", formatTime(operDetail.createdAt)],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-3">
                <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
                <span className="min-w-0 flex-1 break-all font-mono text-xs leading-5">{value}</span>
              </div>
            ))}
            <div className="space-y-1.5">
              <span className="text-muted-foreground">请求参数</span>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">
                {operDetail.params || "（无）"}
              </pre>
            </div>
            {operDetail.errorMsg && (
              <div className="space-y-1.5">
                <span className="text-muted-foreground">错误信息</span>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-rose-500/10 p-3 font-mono text-xs text-rose-700 dark:text-rose-400">
                  {operDetail.errorMsg}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 批量清理确认（带选中数） */}
      <AlertDialog open={!!batchDel} onOpenChange={(o) => !o && setBatchDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清理选中的 {batchDel?.ids.length ?? 0} 条日志？此操作不可恢复。</AlertDialogTitle>
            <AlertDialogDescription>
              将删除所选{batchDel?.kind === "login" ? "登录" : "操作"}日志记录，无法找回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmBatchDelete()}
            >
              清理
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

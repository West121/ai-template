/**
 * 在线用户（系统管理）：Redis 会话列表 + 踢下线。DataTable 展示账号/姓名/IP/归属地/客户端/登录·活动时间。
 * 权限：system:online:list（页/列表）、system:online:kick（踢下线）。本人当前会话标「本机」且禁踢（踢自己后端回 400）。
 * offline/404/NetworkError → 演示会话 + banner；踢下线离线走演示成功。防白屏：列表归一 + 页级 ErrorBoundary（路由层已包）。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { CloudOff, LogOut, MonitorSmartphone, RotateCw, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { DataTable, indexColumn } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"
import { fetchOnline, kickSession, type OnlineSession } from "./online-api"

function formatTime(v?: string) {
  if (!v) return "—"
  return v.slice(0, 19).replace("T", " ")
}

export default function OnlinePage() {
  const canList = useHasPerm("system:online:list")
  const canKick = useHasPerm("system:online:kick")
  const permissions = useAuthStore((s) => s.permissions)

  const [rows, setRows] = useState<OnlineSession[]>([])
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)
  const [kickTarget, setKickTarget] = useState<OnlineSession | null>(null)
  const [kicking, setKicking] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const r = await fetchOnline()
      setRows(r.data)
      setDemo(r.demo)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "在线用户加载失败")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canList) {
      setLoading(false)
      return
    }
    void load()
  }, [canList, load])

  // 轻量自动轮询（30s，静默刷新，不打断操作）；离线演示态不轮询
  const offline = useAuthStore((s) => s.offline)
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    if (!canList || offline) return
    const t = window.setInterval(() => void loadRef.current(true), 30000)
    return () => window.clearInterval(t)
  }, [canList, offline])

  const confirmKick = async () => {
    if (!kickTarget) return
    setKicking(true)
    try {
      const r = await kickSession(kickTarget.sessionId)
      toast.success(r.demo ? `已强制「${kickTarget.name}」下线（演示）` : `已强制「${kickTarget.name}」下线`)
      setKickTarget(null)
      void load()
    } catch (e) {
      // 踢自己当前会话 → 400；其它业务错
      toast.error(e instanceof Error ? e.message : "踢下线失败")
    } finally {
      setKicking(false)
    }
  }

  const columns: ColumnDef<OnlineSession, unknown>[] = [
    indexColumn<OnlineSession>(),
    {
      accessorKey: "username",
      meta: { title: "账号", filterType: "text" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="账号" />,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.username}</span>,
    },
    {
      accessorKey: "name",
      meta: { title: "姓名", filterType: "text" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="姓名" />,
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          <span className="font-medium">{row.original.name}</span>
          {row.original.current && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">本机</Badge>
          )}
        </span>
      ),
    },
    {
      accessorKey: "ip",
      meta: { title: "IP", filterType: "text" },
      header: () => <span>IP</span>,
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.ip || "—"}</span>,
    },
    {
      accessorKey: "location",
      meta: { title: "归属地", filterType: "text" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="归属地" />,
      cell: ({ row }) =>
        row.original.location ? (
          <Badge variant="outline" className="font-normal">{row.original.location}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: "client",
      meta: { title: "客户端", filterType: "text" },
      header: () => <span>客户端</span>,
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MonitorSmartphone className="size-3.5 shrink-0" />
          {row.original.client || "—"}
        </span>
      ),
    },
    {
      accessorKey: "loginTime",
      meta: { title: "登录时间" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="登录时间" />,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatTime(row.original.loginTime)}</span>,
    },
    {
      accessorKey: "lastActive",
      meta: { title: "最后活动" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="最后活动" />,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatTime(row.original.lastActive)}</span>,
    },
    {
      id: "actions",
      enableSorting: false,
      enableHiding: false,
      header: () => <span>操作</span>,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
          disabled={!canKick || row.original.current}
          title={row.original.current ? "不能踢自己当前会话" : undefined}
          onClick={() => setKickTarget(row.original)}
        >
          <LogOut className="size-3.5" /> 踢下线
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="在线用户"
        description="当前登录的会话（Redis 会话表）——可查看归属地/客户端并强制下线"
      />

      {permissions !== null && !canList ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-amber-500/70" />
            <div className="text-sm font-medium">没有查看在线用户的权限</div>
            <p className="max-w-md text-xs text-muted-foreground">需要 system:online:list 权限。</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {demo && (
            <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
              <CloudOff className="size-3.5 shrink-0" />
              离线演示数据——启动后端并重新登录后展示真实在线会话
              <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={() => void load()}>
                <RotateCw className="size-3.5" /> 重试连接
              </Button>
            </div>
          )}
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            searchKeys={["username", "name", "ip", "location", "client"]}
            searchPlaceholder="搜索账号 / 姓名 / IP / 归属地"
            onRefresh={() => void load()}
            exportFileName="在线用户"
          />
        </>
      )}

      {/* 踢下线二次确认 */}
      <AlertDialog open={!!kickTarget} onOpenChange={(o) => !o && setKickTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>强制「{kickTarget?.name}」下线？</AlertDialogTitle>
            <AlertDialogDescription>
              该用户（{kickTarget?.username} · {kickTarget?.ip}）的会话将立即失效，需重新登录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={kicking}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={kicking}
              onClick={(e) => {
                e.preventDefault()
                void confirmKick()
              }}
            >
              确认踢下线
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

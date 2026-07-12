import { useCallback, useEffect, useState } from "react"
import {
  AlarmClock,
  CircleCheck,
  CircleOff,
  CloudOff,
  ExternalLink,
  Info,
  RotateCw,
  ServerCog,
} from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { api, NetworkError } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface JobHandlerMeta {
  name: string
  description: string
  recommendedCron: string
}

interface JobInfo {
  enabled: boolean
  consoleUrl: string
  appname: string
  port: number
  handlers: JobHandlerMeta[]
}

export default function JobPage() {
  const [info, setInfo] = useState<JobInfo | null>(null)
  const [loadError, setLoadError] = useState<"network" | string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setInfo(await api<JobInfo>("/api/system/jobs"))
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loadError === "network") {
    return (
      <div className="space-y-4">
        <PageHeader title="定时任务" description="基于 XXL-Job 的分布式任务调度" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              启动后端与调度中心：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => void load()}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="定时任务"
        description="基于 XXL-Job 3.1 的分布式任务调度 · 任务的新建/启停/日志在调度中心操作"
        actions={
          info?.consoleUrl ? (
            <Button className="gap-1.5" onClick={() => window.open(info.consoleUrl, "_blank")}>
              <ExternalLink className="size-4" />
              打开调度中心
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 执行器信息 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ServerCog className="size-4 text-primary" />
              执行器信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {[
              ["执行器状态", info?.enabled ? (
                <Badge key="s" variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                  <CircleCheck className="mr-0.5 size-3" /> 已启用
                </Badge>
              ) : (
                <Badge key="s" variant="outline" className="text-muted-foreground">
                  <CircleOff className="mr-0.5 size-3" /> 未启用
                </Badge>
              )],
              ["AppName", <span key="a" className="font-mono text-xs">{info?.appname ?? "—"}</span>],
              ["执行器端口", <span key="p" className="font-mono text-xs">{info?.port ?? "—"}</span>],
              ["调度中心", <span key="c" className="break-all font-mono text-xs">{info?.consoleUrl || "—"}</span>],
              ["控制台账号", <span key="u" className="font-mono text-xs">admin / 123456</span>],
            ].map(([label, value]) => (
              <div key={label as string} className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
                {value}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* JobHandler 清单 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlarmClock className="size-4 text-primary" />
              已注册的 JobHandler
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center text-xs">#</TableHead>
                  <TableHead className="text-xs">JobHandler</TableHead>
                  <TableHead className="text-xs">说明</TableHead>
                  <TableHead className="text-xs">建议 CRON</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(info?.handlers ?? []).map((handler, i) => (
                  <TableRow key={handler.name}>
                    <TableCell className="text-center text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs text-primary">{handler.name}</TableCell>
                    <TableCell className="text-sm">{handler.description}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{handler.recommendedCron}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              在调度中心「任务管理 → 新增」：选择执行器「{info?.appname ?? "oa-executor"}」，运行模式 BEAN，JobHandler
              填上表名称，配置 CRON 后启动即可；执行日志在「调度日志」查看。
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 内嵌调度中心 */}
      {info?.consoleUrl && (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex h-11 items-center justify-between border-b px-4">
            <span className="text-sm font-medium">调度中心控制台</span>
            <span className="text-xs text-muted-foreground">
              内嵌页面 · 首次使用请先登录（admin / 123456）
            </span>
          </div>
          <iframe src={info.consoleUrl} title="XXL-Job 调度中心" className="h-[640px] w-full bg-white" />
        </Card>
      )}
    </div>
  )
}

import { useState } from "react"
import { CloudOff, RotateCw } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { PermissionBanner } from "@/components/permission-banner"
import { ErrorBoundary } from "@/components/error-boundary"
import { DeptTree } from "@/components/system/dept-tree"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"

/**
 * 部门管理：薄壳页。整页复用共享 `<DeptTree>`（与用户管理左栏同组件，避免两处维护）。
 * 选中态仅本页高亮，不驱动其它面板。后端未连接时保留「后端服务未启动」卡片。
 */
export default function DeptPage() {
  const offline = useAuthStore((s) => s.offline)
  const canEdit = useHasPerm("system:dept:edit")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // 断网卡片「重试连接」：无页级 loader，remount DeptTree 让其重新拉取
  const [nonce, setNonce] = useState(0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="部门管理"
        description={
          offline
            ? "后端未连接——启动 server/ 后此页为真实数据"
            : "维护组织架构：编码 / 负责人 / 同级排序 / 启用状态（右键节点管理）"
        }
      />

      <PermissionBanner perm="system:dept:edit" action="部门管理" />

      {offline ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，
              然后用 admin（密码 admin123）重新登录，即可维护真实的组织架构树。
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => setNonce((n) => n + 1)}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ErrorBoundary label="部门树">
          <div className="flex max-h-[calc(100dvh-11rem)] min-h-[480px] flex-col overflow-hidden rounded-lg border bg-card">
            <DeptTree
              key={nonce}
              selectedId={selectedId}
              onSelect={setSelectedId}
              canEdit={canEdit}
              className="min-h-0 flex-1"
            />
          </div>
        </ErrorBoundary>
      )}
    </div>
  )
}

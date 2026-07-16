import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { CloudOff, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const DEFAULT_DESCRIPTION =
  "此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，然后重新登录即可查看真实数据。"

interface OfflineFallbackProps {
  /** 标题，默认「后端服务未启动」 */
  title?: string
  /** 说明文案，默认给出后端启动指引；各页面可传入更贴合场景的描述 */
  description?: ReactNode
  /** 重试按钮回调；不传则不渲染按钮 */
  onRetry?: () => void
  /** 重试按钮文案，默认「重试连接」 */
  retryLabel?: string
}

/**
 * 离线降级卡片（后端未连接 / auth-store 离线演示模式）。
 * 与 useApiData 返回的 `offline` 配套：`{offline ? <OfflineFallback onRetry={reload} /> : ...}`。
 */
export function OfflineFallback({
  title,
  description,
  onRetry,
  retryLabel,
}: OfflineFallbackProps) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <CloudOff className="size-5 text-muted-foreground" />
        </div>
        <div className="text-sm font-medium">{title ?? t("后端服务未启动")}</div>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          {description ?? t(DEFAULT_DESCRIPTION)}
        </p>
        {onRetry && (
          <Button size="sm" className="gap-1.5" onClick={onRetry}>
            <RotateCw className="size-3.5" /> {retryLabel ?? t("重试连接")}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

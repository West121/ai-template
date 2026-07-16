import { useTranslation } from "react-i18next"
import { ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface ErrorStateProps {
  /** 错误消息（通常来自 useApiData 返回的 `error`） */
  message: string
  /** 重试按钮回调；不传则不渲染按钮 */
  onRetry?: () => void
  /** 重试按钮文案，默认「重试」 */
  retryLabel?: string
}

/**
 * 通用错误卡片（业务/HTTP 错误，非网络离线）。
 * 与 useApiData 返回的 `error` 配套：`{error ? <ErrorState message={error} onRetry={reload} /> : ...}`。
 */
export function ErrorState({ message, onRetry, retryLabel }: ErrorStateProps) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <ShieldAlert className="size-8 text-rose-500/60" />
        <div className="text-sm">{message}</div>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            {retryLabel ?? t("重试")}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

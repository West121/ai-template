/** 知识库共用小件（仅组件导出，满足 react-refresh）。 */
import { CloudOff } from "lucide-react"

/** 后端未连接演示提示条 */
export function KbDemoBanner() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
      <CloudOff className="size-4 shrink-0" />
      <span>
        后端未连接，当前为<strong>演示数据</strong>。启动 server/ 接入 <code>/api/kb</code> 后自动切换真实知识库数据。
      </span>
    </div>
  )
}

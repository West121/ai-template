import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle, RotateCw } from "lucide-react"
import i18n from "@/lib/i18n"

interface Props {
  children: ReactNode
  /** 出错时的自定义兜底；不传则用内置提示卡 */
  fallback?: ReactNode
  /** 日志标签，便于定位 */
  label?: string
}
interface State {
  error: Error | null
}

/**
 * React 错误边界：隔离子树渲染异常，避免单点崩溃白屏整页。
 * 用于设计器配置区等易受"异常/历史数据"影响的区域。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 仅记录到控制台，避免二次抛出
    console.error(`[ErrorBoundary${this.props.label ? ":" + this.props.label : ""}]`, error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="m-2 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-destructive">
            <AlertTriangle className="size-4" />
            {i18n.t("此区域渲染出错，已隔离以免整页崩溃")}
          </div>
          <p className="mb-2 break-all text-xs text-muted-foreground">{this.state.error.message}</p>
          <button
            type="button"
            onClick={this.reset}
            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
          >
            <RotateCw className="size-3" /> {i18n.t("重试")}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

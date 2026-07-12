/**
 * 发文办文单详情——套统一基座 `WorkflowDetailShell`（重构阶段 D）。
 * 收发文共用 `GongwenDetail`（direction 分流），布局/流程图增强与审批一致。
 */
import { GongwenDetail } from "./gongwen/detail"

export default function SendDetailPage() {
  return <GongwenDetail direction="SEND" />
}

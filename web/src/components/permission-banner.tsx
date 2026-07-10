import { ShieldAlert } from "lucide-react"
import { useAuthStore, useHasPerm } from "@/stores/auth-store"

/**
 * 功能权限提示条：当前身份缺少指定权限码时展示，说明为何操作按钮被禁用。
 * 放在 PageHeader 下方即可。
 */
export function PermissionBanner({ perm, action = "管理操作" }: { perm: string; action?: string }) {
  const allowed = useHasPerm(perm)
  const user = useAuthStore((s) => s.user)
  if (allowed) return null
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      <div>
        当前账号 <span className="font-medium">{user?.name ?? "访客"}</span> 的角色未授予{" "}
        <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono text-xs">{perm}</code> 权限，
        {action}按钮已禁用。可退出后用 <span className="font-medium">admin / admin123</span>{" "}
        登录体验，或在「角色管理 → 权限配置」中为当前角色授权。
      </div>
    </div>
  )
}

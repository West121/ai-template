import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { BriefcaseBusiness, Check, CircleUserRound, KeyRound, Layers, LogOut } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuthStore } from "@/stores/auth-store"
import { toast } from "sonner"

export function UserMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const assignments = useAuthStore((s) => s.assignments)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)
  const switchAssignment = useAuthStore((s) => s.switchAssignment)
  const logout = useAuthStore((s) => s.logout)

  const handleSwitch = async (assignmentId: string, label: string) => {
    if (assignmentId === activeAssignmentId) return
    try {
      await switchAssignment(assignmentId)
      toast.success(t("已切换身份：{{label}}，数据权限已更新", { label }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("切换身份失败"))
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent">
          <Avatar className="size-7">
            {user?.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
            <AvatarFallback className="bg-primary text-xs text-primary-foreground">
              {user?.name?.slice(0, 1) ?? t("客")}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-24 truncate text-sm md:block">{user?.name ?? t("访客")}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="text-sm font-medium">{user?.name}</div>
          <div className="mt-0.5 text-xs font-normal text-muted-foreground">
            {user?.dept} · {user?.post}
          </div>
        </DropdownMenuLabel>

        {/* 多任职：身份切换（主任职 / 兼任 / 全部身份） */}
        {assignments.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <BriefcaseBusiness className="size-3" />
              {t("我的身份（数据权限随身份切换）")}
            </DropdownMenuLabel>
            {assignments.map((assignment) => {
              const label = `${assignment.deptName} · ${assignment.postName}`
              const active = String(assignment.id) === activeAssignmentId
              return (
                <DropdownMenuItem
                  key={assignment.id}
                  className="items-start"
                  onClick={() => void handleSwitch(String(assignment.id), label)}
                >
                  <span className="mt-0.5 flex size-4 items-center justify-center">
                    {active && <Check className="size-3.5 text-primary" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm">
                      <span className="truncate">{label}</span>
                      <Badge
                        variant={assignment.primary ? "default" : "outline"}
                        className="h-4 shrink-0 px-1 text-[10px]"
                      >
                        {assignment.primary ? t("主任职") : t("兼任")}
                      </Badge>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {assignment.roleNames.join(" / ")}
                    </span>
                  </span>
                </DropdownMenuItem>
              )
            })}
            {assignments.length > 1 && (
              <DropdownMenuItem onClick={() => void handleSwitch("ALL", t("全部身份"))}>
                <span className="flex size-4 items-center justify-center">
                  {activeAssignmentId === "ALL" && <Check className="size-3.5 text-primary" />}
                </span>
                <Layers className="size-4 text-muted-foreground" />
                {t("全部身份（数据范围并集）")}
              </DropdownMenuItem>
            )}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/profile")}>
          <CircleUserRound className="size-4" />
          {t("个人中心")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/profile?tab=security")}>
          <KeyRound className="size-4" />
          {t("修改密码")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            logout()
            navigate("/login")
          }}
        >
          <LogOut className="size-4" />
          {t("退出登录")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Eye, EyeOff, Lock, Sparkles, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuthStore } from "@/stores/auth-store"
import { toast } from "sonner"

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const [account, setAccount] = useState("admin")
  const [password, setPassword] = useState("admin123")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!account || !password) {
      toast.error(t("请输入账号和密码"))
      return
    }
    setLoading(true)
    try {
      const { offline } = await login(account, password)
      if (offline) {
        toast.info(t("后端未启动，已进入离线演示模式（数据为前端 mock）"))
      } else {
        toast.success(t("登录成功"))
      }
      navigate("/dashboard", { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("登录失败"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* 左侧品牌区 */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, #fff 0, transparent 40%), radial-gradient(circle at 80% 70%, #fff 0, transparent 35%)",
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/15 backdrop-blur">
            <Sparkles className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-wide">{t("企业开发平台")}</span>
        </div>
        <div className="relative">
          <h1 className="text-3xl font-bold leading-snug">
            {t("一站式企业协同办公平台")}
            <br />
            {t("让工作流转更高效")}
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-primary-foreground/80">
            {t("审批流程、公文流转、会议管理、考勤假勤、组织通讯录——多种布局与主题随心配置，开箱即用的企业级中后台模板。")}
          </p>
        </div>
        <div className="relative text-xs text-primary-foreground/60">
          {t("Copyright © 2026 企业开发平台 · Powered by React + shadcn/ui")}
        </div>
      </div>

      {/* 右侧表单区 */}
      <div className="flex flex-1 items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold tracking-tight">{t("账号登录")}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t("后端在线：admin / manager / zhangsan（密码 admin123）")}
              <br />
              {t("后端未启动时任意账号进入离线演示模式")}
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="account">{t("账号")}</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="account"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder={t("请输入账号")}
                  className="h-10 pl-9"
                  autoComplete="username"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("密码")}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("请输入密码")}
                  className="h-10 pl-9 pr-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                <Checkbox defaultChecked />
                {t("记住我")}
              </label>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => toast.info(t("请联系管理员重置密码"))}
              >
                {t("忘记密码？")}
              </button>
            </div>
            <Button type="submit" className="h-10 w-full" disabled={loading}>
              {loading ? t("登录中…") : t("登 录")}
            </Button>
          </form>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t("登录即代表同意")} <span className="cursor-pointer text-primary">{t("《使用协议》")}</span> {t("与")}{" "}
            <span className="cursor-pointer text-primary">{t("《隐私政策》")}</span>
          </p>
        </div>
      </div>
    </div>
  )
}

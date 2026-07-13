/**
 * 个人中心（从用户菜单进，非主导航）。三 Tab：基本资料 / 安全设置 / 我的身份。
 * 进页拉 /api/auth/me；offline/NetworkError → auth-store 兜底 + banner；改密码/改资料离线走演示成功。
 * ?tab=security 直达安全设置（用户菜单「修改密码」入口）。防白屏：响应容错 + 页级 ErrorBoundary（路由层已包）。
 */
import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { BriefcaseBusiness, Check, CloudOff, IdCard, KeyRound, Layers, Loader2, ShieldCheck } from "lucide-react"
import { ApiError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { changePassword, fetchMe, updateProfile, type MeUser } from "./profile-api"

type TabKey = "basic" | "security" | "identity"
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 只读字段（键值行） */
function ReadonlyField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value?.trim() ? value : "—"}</div>
    </div>
  )
}

export default function ProfilePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const paramTab = searchParams.get("tab")
  const initialTab: TabKey = paramTab === "security" ? "security" : paramTab === "identity" ? "identity" : "basic"
  const [tab, setTab] = useState<TabKey>(initialTab)

  const storeUser = useAuthStore((s) => s.user)
  const roles = storeUser?.roles ?? []
  const patchUser = useAuthStore((s) => s.patchUser)

  const [me, setMe] = useState<MeUser | null>(
    storeUser
      ? { name: storeUser.name, username: storeUser.account, email: storeUser.email, phone: storeUser.phone, avatar: storeUser.avatar, dept: storeUser.dept, post: storeUser.post }
      : null,
  )
  const [demo, setDemo] = useState(false)
  const [loading, setLoading] = useState(true)

  // 基本资料 可编辑字段
  const [nickname, setNickname] = useState(storeUser?.name ?? "")
  const [phone, setPhone] = useState(storeUser?.phone ?? "")
  const [email, setEmail] = useState(storeUser?.email ?? "")
  const [savingProfile, setSavingProfile] = useState(false)

  const syncForm = (u: MeUser) => {
    setNickname(u.name ?? "")
    setPhone(u.phone ?? "")
    setEmail(u.email ?? "")
  }

  const load = () => {
    setLoading(true)
    fetchMe()
      .then((r) => {
        setMe(r.data.user)
        setDemo(r.demo)
        syncForm(r.data.user)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "加载个人信息失败"))
      .finally(() => setLoading(false))
  }
  // 仅进页拉一次
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changeTab = (v: string) => {
    const next = (v as TabKey) || "basic"
    setTab(next)
    const sp = new URLSearchParams(searchParams)
    if (next === "basic") sp.delete("tab")
    else sp.set("tab", next)
    setSearchParams(sp, { replace: true })
  }

  const emailInvalid = email.trim() !== "" && !EMAIL_RE.test(email.trim())

  const saveProfile = async () => {
    if (!nickname.trim()) {
      toast.error("昵称不能为空")
      return
    }
    if (emailInvalid) {
      toast.error("邮箱格式不正确")
      return
    }
    setSavingProfile(true)
    try {
      const r = await updateProfile({ nickname: nickname.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined })
      setMe(r.data)
      // 就地同步 auth-store（名字/头像变了顶栏也更新）
      patchUser({ name: r.data.name, phone: r.data.phone, email: r.data.email, avatar: r.data.avatar })
      toast.success(r.demo ? "资料已保存（演示）" : "资料已保存")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSavingProfile(false)
    }
  }

  const initial = (me?.name ?? storeUser?.name ?? "客").slice(0, 1)

  return (
    <div className="space-y-4">
      {demo && (
        <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <CloudOff className="size-3.5 shrink-0" />
          离线演示数据——启动后端并重新登录后展示 / 保存真实资料
          <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={load}>
            重试连接
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value="basic" className="gap-1.5"><IdCard className="size-3.5" /> 基本资料</TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5"><KeyRound className="size-3.5" /> 安全设置</TabsTrigger>
          <TabsTrigger value="identity" className="gap-1.5"><BriefcaseBusiness className="size-3.5" /> 我的身份</TabsTrigger>
        </TabsList>

        {/* ---------- 基本资料 ---------- */}
        <TabsContent value="basic" className="mt-4">
          <Card>
            <CardContent className="space-y-6 pt-6">
              <div className="flex items-center gap-4">
                <Avatar className="size-16">
                  {me?.avatar && <AvatarImage src={me.avatar} alt={me?.name} />}
                  <AvatarFallback className="bg-primary text-xl text-primary-foreground">{initial}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="text-lg font-semibold">{me?.name ?? "—"}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {(me?.dept || "—")} · {(me?.post || "—")}
                  </div>
                </div>
              </div>

              {/* 只读身份信息 */}
              <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
                <ReadonlyField label="姓名" value={me?.name} />
                <ReadonlyField label="账号" value={me?.username} />
                <ReadonlyField label="部门" value={me?.dept} />
                <ReadonlyField label="岗位" value={me?.post} />
                <ReadonlyField label="角色" value={roles.join("、")} />
              </div>

              {/* 可编辑安全字段 */}
              <div className="space-y-4">
                <div className="text-sm font-medium">可编辑资料</div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pf-nickname">昵称</Label>
                    <Input id="pf-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="显示名称" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pf-phone">手机</Label>
                    <Input id="pf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="选填" inputMode="tel" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pf-email">邮箱</Label>
                    <Input id="pf-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="选填" type="email" aria-invalid={emailInvalid} />
                    {emailInvalid && <p className="text-xs text-destructive">邮箱格式不正确</p>}
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button className="gap-1.5" disabled={savingProfile || loading} onClick={() => void saveProfile()}>
                    {savingProfile && <Loader2 className="size-4 animate-spin" />} 保存资料
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- 安全设置 ---------- */}
        <TabsContent value="security" className="mt-4">
          <SecurityTab demo={demo} />
        </TabsContent>

        {/* ---------- 我的身份 ---------- */}
        <TabsContent value="identity" className="mt-4">
          <IdentityTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ============================ 安全设置：改密码 ============================ */

function SecurityTab({ demo }: { demo: boolean }) {
  const [oldPwd, setOldPwd] = useState("")
  const [newPwd, setNewPwd] = useState("")
  const [confirmPwd, setConfirmPwd] = useState("")
  const [oldError, setOldError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const newTooShort = newPwd !== "" && newPwd.length < 6
  const mismatch = confirmPwd !== "" && newPwd !== confirmPwd
  const sameAsOld = newPwd !== "" && oldPwd !== "" && newPwd === oldPwd
  const canSubmit = oldPwd !== "" && newPwd.length >= 6 && newPwd === confirmPwd && !sameAsOld

  const submit = async () => {
    setOldError(null)
    if (!canSubmit) {
      if (newTooShort) toast.error("新密码至少 6 位")
      else if (mismatch) toast.error("两次输入的新密码不一致")
      else if (sameAsOld) toast.error("新密码不能与原密码相同")
      else toast.error("请完整填写")
      return
    }
    setSubmitting(true)
    try {
      const r = await changePassword({ oldPassword: oldPwd, newPassword: newPwd })
      toast.success(r.demo ? "密码已修改（演示）" : "密码修改成功，建议重新登录")
      setOldPwd("")
      setNewPwd("")
      setConfirmPwd("")
    } catch (e) {
      // 原密码错 → envelope code 400 → 原密码框高亮
      if (e instanceof ApiError && e.code === 400) setOldError(e.message || "原密码错误")
      else toast.error(e instanceof Error ? e.message : "修改密码失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-primary" /> 修改密码
        </CardTitle>
      </CardHeader>
      <CardContent className="max-w-md space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="sec-old">原密码</Label>
          <Input id="sec-old" type="password" value={oldPwd} onChange={(e) => { setOldPwd(e.target.value); setOldError(null) }} aria-invalid={!!oldError} autoComplete="current-password" />
          {oldError && <p className="text-xs text-destructive">{oldError}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sec-new">新密码</Label>
          <Input id="sec-new" type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} aria-invalid={newTooShort || sameAsOld} autoComplete="new-password" />
          {newTooShort && <p className="text-xs text-destructive">新密码至少 6 位</p>}
          {sameAsOld && <p className="text-xs text-destructive">新密码不能与原密码相同</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sec-confirm">确认新密码</Label>
          <Input id="sec-confirm" type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} aria-invalid={mismatch} autoComplete="new-password" />
          {mismatch && <p className="text-xs text-destructive">两次输入的新密码不一致</p>}
        </div>
        <div className="flex items-center gap-3">
          <Button className="gap-1.5" disabled={!canSubmit || submitting} onClick={() => void submit()}>
            {submitting && <Loader2 className="size-4 animate-spin" />} 确认修改
          </Button>
          {demo && <span className="text-xs text-muted-foreground">离线演示：不会真正改密</span>}
        </div>
      </CardContent>
    </Card>
  )
}

/* ============================ 我的身份：任职切换 ============================ */

function IdentityTab() {
  const assignments = useAuthStore((s) => s.assignments)
  const activeAssignmentId = useAuthStore((s) => s.activeAssignmentId)
  const switchAssignment = useAuthStore((s) => s.switchAssignment)
  const [switching, setSwitching] = useState<string | null>(null)

  const doSwitch = async (id: string, label: string) => {
    if (id === activeAssignmentId) return
    setSwitching(id)
    try {
      await switchAssignment(id)
      toast.success(`已切换身份：${label}，数据权限已更新`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "切换身份失败")
    } finally {
      setSwitching(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BriefcaseBusiness className="size-4 text-primary" /> 我的身份
        </CardTitle>
        <p className="text-xs text-muted-foreground">一人可多部门任职；切换身份将同步切换数据权限口径。</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {assignments.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">暂无任职信息（离线演示模式下不可切换）</div>}
        {assignments.map((a) => {
          const id = String(a.id)
          const active = id === activeAssignmentId
          const label = `${a.deptName} · ${a.postName}`
          return (
            <button
              key={a.id}
              type="button"
              disabled={switching !== null}
              onClick={() => void doSwitch(id, label)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                active ? "border-primary/40 bg-primary/[0.06]" : "hover:bg-accent/50",
              )}
            >
              <span className="flex size-5 items-center justify-center">
                {switching === id ? <Loader2 className="size-4 animate-spin text-primary" /> : active ? <Check className="size-4 text-primary" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{label}</span>
                  <Badge variant={a.primary ? "default" : "outline"} className="h-4 shrink-0 px-1.5 text-[10px]">{a.primary ? "主任职" : "兼任"}</Badge>
                  {active && <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">当前</Badge>}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{a.roleNames.join(" / ") || "—"}</span>
              </span>
            </button>
          )
        })}
        {assignments.length > 1 && (
          <button
            type="button"
            disabled={switching !== null}
            onClick={() => void doSwitch("ALL", "全部身份")}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
              activeAssignmentId === "ALL" ? "border-primary/40 bg-primary/[0.06]" : "hover:bg-accent/50",
            )}
          >
            <span className="flex size-5 items-center justify-center">
              {switching === "ALL" ? <Loader2 className="size-4 animate-spin text-primary" /> : activeAssignmentId === "ALL" ? <Check className="size-4 text-primary" /> : <Layers className="size-4 text-muted-foreground" />}
            </span>
            <span className="text-sm font-medium">全部身份（数据范围并集）</span>
          </button>
        )}
      </CardContent>
    </Card>
  )
}

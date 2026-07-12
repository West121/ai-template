/**
 * 转岗弹层（DP3）：原地变更主任职——选新部门 + 新岗位 + 新角色（多选）+ 可选「旧部门数据保留天数」。
 * 提交 POST /users/{id}/transfer {deptId,postId,roleIds?,retentionDays?}；成功 toast（含保留到期）→ 刷新列表。
 * 离线/端点未实现 → 演示成功 + banner；响应容错；调用方再包 ErrorBoundary（防白屏）。
 */
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { CloudOff, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { transferUser } from "./transfer-api"

export interface TransferDeptOption {
  id: number
  name: string
  depth: number
}
export interface TransferPostOption {
  id: number
  name: string
}
export interface TransferRoleOption {
  id: number
  name: string
}

export function TransferDialog({
  open,
  onOpenChange,
  user,
  deptOptions,
  postOptions,
  roleOptions,
  canEdit = true,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  user: { id: number; name: string; currentDeptName?: string }
  deptOptions: TransferDeptOption[]
  postOptions: TransferPostOption[]
  roleOptions: TransferRoleOption[]
  canEdit?: boolean
  onDone: () => void
}) {
  const [deptId, setDeptId] = useState("")
  const [postId, setPostId] = useState("")
  const [roleIds, setRoleIds] = useState<number[]>([])
  const [retention, setRetention] = useState("") // 原始字符串：""=系统默认、"0"=不保留
  const [submitting, setSubmitting] = useState(false)
  const [demo, setDemo] = useState(false)

  // 每次打开重置
  useEffect(() => {
    if (open) {
      setDeptId("")
      setPostId("")
      setRoleIds([])
      setRetention("")
      setDemo(false)
    }
  }, [open])

  const depts = Array.isArray(deptOptions) ? deptOptions : []
  const posts = Array.isArray(postOptions) ? postOptions : []
  const roles = Array.isArray(roleOptions) ? roleOptions : []

  const retentionInvalid = useMemo(() => {
    const t = retention.trim()
    if (t === "") return false
    const n = Number(t)
    return !Number.isFinite(n) || n < 0 || !Number.isInteger(n)
  }, [retention])

  const canSubmit = !!deptId && !!postId && !retentionInvalid && canEdit

  const toggleRole = (id: number) => {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const submit = async () => {
    if (!deptId || !postId) {
      toast.error("请选择新部门和新岗位")
      return
    }
    const t = retention.trim()
    const retentionDays = t === "" ? undefined : Math.max(0, Math.floor(Number(t)))
    setSubmitting(true)
    try {
      const r = await transferUser(user.id, {
        deptId: Number(deptId),
        postId: Number(postId),
        roleIds: roleIds.length > 0 ? roleIds : undefined,
        retentionDays,
      })
      setDemo(r.demo)
      const until = r.data.retentionUntil
      const tail = until ? `，旧部门数据保留至 ${until}` : retentionDays === 0 ? "，旧部门数据不保留" : ""
      toast.success(`已为「${user.name}」办理转岗${tail}`)
      onOpenChange(false)
      onDone()
    } catch (e) {
      // 离职用户拒转岗 / 无权 等真实业务错
      toast.error(e instanceof Error ? e.message : "转岗失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>转岗 · {user.name}</DialogTitle>
          <DialogDescription>
            原地变更主任职（换部门 / 岗位 / 角色）
            {user.currentDeptName ? `，当前部门：${user.currentDeptName}` : ""}。
          </DialogDescription>
        </DialogHeader>

        {demo && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            <CloudOff className="size-3.5 shrink-0" /> 后端未接入，转岗为<strong>演示结果</strong>。
          </div>
        )}

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">
                <span className="text-destructive">*</span> 新部门
              </Label>
              <Select value={deptId} onValueChange={setDeptId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="请选择部门" />
                </SelectTrigger>
                <SelectContent>
                  {depts.map((dept) => (
                    <SelectItem key={dept.id} value={String(dept.id)}>
                      {"　".repeat(dept.depth)}
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                <span className="text-destructive">*</span> 新岗位
              </Label>
              <Select value={postId} onValueChange={setPostId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="请选择岗位" />
                </SelectTrigger>
                <SelectContent>
                  {posts.map((post) => (
                    <SelectItem key={post.id} value={String(post.id)}>
                      {post.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">新角色</Label>
            <div className="grid grid-cols-2 gap-2 rounded-md border p-2.5 sm:grid-cols-3">
              {roles.map((role) => (
                <div key={role.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`transfer-role-${role.id}`}
                    checked={roleIds.includes(role.id)}
                    onCheckedChange={() => toggleRole(role.id)}
                  />
                  <Label htmlFor={`transfer-role-${role.id}`} className="cursor-pointer text-sm font-normal">
                    {role.name}
                  </Label>
                </div>
              ))}
              {roles.length === 0 && <span className="col-span-full text-xs text-muted-foreground">暂无角色</span>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="transfer-retention" className="text-xs">
              旧部门数据保留天数
            </Label>
            <Input
              id="transfer-retention"
              type="number"
              min={0}
              inputMode="numeric"
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              placeholder="留空=系统默认，0=不保留"
              aria-invalid={retentionInvalid}
            />
            <p className="text-[11px] text-muted-foreground">
              转岗后一段时间内仍可见原部门数据，便于交接过渡。
              {retentionInvalid && <span className="ml-1 text-destructive">请填非负整数</span>}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button className="gap-1.5" disabled={!canSubmit || submitting} onClick={() => void submit()}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            确认转岗
            {roleIds.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                {roleIds.length} 角色
              </Badge>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

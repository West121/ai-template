/** 空间成员与权限管理：列表（角色可改 / 移除）+ 通过 OrgPicker 添加成员。 */
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Trash2, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { OrgPicker, type OrgRef } from "@/components/org-picker"
import { fetchMembers, removeMember, upsertMember } from "./mock"
import { ROLE_META, type KbMemberRole, type KbSpaceMember } from "./types"

const ROLES: KbMemberRole[] = ["VIEWER", "EDITOR", "ADMIN"]
const PRINCIPAL_LABEL = { USER: "用户", DEPT: "部门", ROLE: "角色" } as const

export function MemberDialog({
  open,
  onOpenChange,
  spaceId,
  canManage,
  onChanged,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  spaceId: number
  canManage: boolean
  onChanged?: () => void
}) {
  const [members, setMembers] = useState<KbSpaceMember[]>([])
  const [loading, setLoading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [addRole, setAddRole] = useState<KbMemberRole>("VIEWER")

  const load = useCallback(() => {
    setLoading(true)
    fetchMembers(spaceId)
      .then((r) => setMembers(Array.isArray(r.data) ? r.data : []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false))
  }, [spaceId])
  useEffect(() => {
    if (open) load()
  }, [open, load])

  const addMembers = async (refs: OrgRef[]) => {
    try {
      for (const ref of refs) {
        await upsertMember(spaceId, { principalType: ref.type, principalId: ref.id, principalName: ref.name, role: addRole })
      }
      toast.success(`已添加 ${refs.length} 个成员`)
      load()
      onChanged?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败")
    }
  }
  const changeRole = async (m: KbSpaceMember, role: KbMemberRole) => {
    try {
      await upsertMember(spaceId, { principalType: m.principalType, principalId: m.principalId, principalName: m.principalName, role })
      load()
      onChanged?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新失败")
    }
  }
  const remove = async (m: KbSpaceMember) => {
    try {
      await removeMember(spaceId, m.id)
      toast.success("已移除成员")
      load()
      onChanged?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "移除失败")
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>成员与权限</DialogTitle>
          </DialogHeader>
          {canManage && (
            <div className="flex items-center gap-2">
              <Select value={addRole} onValueChange={(v) => setAddRole(v as KbMemberRole)}>
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_META[r].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPickerOpen(true)}>
                <UserPlus className="size-4" /> 添加成员
              </Button>
            </div>
          )}
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {loading ? (
              <div className="py-6 text-center text-muted-foreground">
                <Loader2 className="mx-auto size-4 animate-spin" />
              </div>
            ) : members.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">暂无成员</div>
            ) : (
              members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{m.principalName}</span>
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        {PRINCIPAL_LABEL[m.principalType]}
                      </Badge>
                    </div>
                  </div>
                  {canManage ? (
                    <Select value={m.role} onValueChange={(v) => void changeRole(m, v as KbMemberRole)}>
                      <SelectTrigger size="sm" className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_META[r].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className={cn("text-xs", ROLE_META[m.role].className)}>{ROLE_META[m.role].label}</span>
                  )}
                  {canManage && (
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label="移除成员" onClick={() => void remove(m)}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
      <OrgPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="添加空间成员"
        value={[]}
        onConfirm={(refs) => {
          setPickerOpen(false)
          void addMembers(refs)
        }}
      />
    </>
  )
}

/** 新建 / 编辑知识空间弹窗（名称/图标/标识/描述/可见性）。 */
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createSpace, updateSpace } from "./mock"
import { VISIBILITY_META, type KbSpace, type KbVisibility } from "./types"

const VIS_DESC: Record<KbVisibility, string> = { PUBLIC: "全员可见", INTERNAL: "登录用户可见", PRIVATE: "仅成员可见" }

export function SpaceDialog({
  open,
  onOpenChange,
  space,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  space?: KbSpace | null
  onSaved: (id?: number) => void
}) {
  const editing = !!space
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [icon, setIcon] = useState("📁")
  const [description, setDescription] = useState("")
  const [visibility, setVisibility] = useState<KbVisibility>("INTERNAL")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(space?.name ?? "")
      setCode(space?.code ?? "")
      setIcon(space?.icon ?? "📁")
      setDescription(space?.description ?? "")
      setVisibility(space?.visibility ?? "INTERNAL")
    }
  }, [open, space])

  const save = async () => {
    if (!name.trim()) {
      toast.error("请输入空间名称")
      return
    }
    setSaving(true)
    try {
      const payload = { name: name.trim(), code: code.trim() || undefined, icon: icon || "📁", description: description.trim() || undefined, visibility }
      const res = editing && space ? await updateSpace(space.id, payload) : await createSpace(payload)
      toast.success(editing ? "空间已更新" : "空间已创建")
      onOpenChange(false)
      onSaved(res.data?.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑知识空间" : "新建知识空间"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input value={icon} onChange={(e) => setIcon(e.target.value)} className="w-14 text-center text-xl" maxLength={2} aria-label="图标" />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="空间名称" className="flex-1" aria-label="空间名称" />
          </div>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="空间标识（可选，如 PRD）" aria-label="空间标识" />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="空间描述（可选）" rows={3} />
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">可见性</label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as KbVisibility)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["PUBLIC", "INTERNAL", "PRIVATE"] as KbVisibility[]).map((v) => (
                  <SelectItem key={v} value={v}>
                    {VISIBILITY_META[v].label} · {VIS_DESC[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="size-4 animate-spin" />}
            {editing ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

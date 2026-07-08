/**
 * 电子章管理 /workflow/seals（P3）
 * GET/POST/DELETE /api/wf/seals —— 引用文件管理的印章图，用于节点盖章与套打叠加。
 * POST/DELETE 需权限【wf:def:edit】。后端未就绪时优雅空态（不造假数据）。
 */
import { useCallback, useEffect, useState } from "react"
import { CloudOff, Plus, RotateCw, Stamp, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { api, ApiError, NetworkError } from "@/lib/api"
import { useHasPerm } from "@/stores/auth-store"
import { PageHeader } from "@/components/page-header"
import { FileUploader, type UploadedFile } from "@/components/file-uploader"
import { Modal } from "@/components/modal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { WfSealDef } from "@/types/workflow-p3"
import { AuthImg } from "./wf-print"

/** 印章图预览地址：后端直出 imageUrl 优先，否则回退文件管理下载端点 */
function sealImageSrc(seal: { imageUrl?: string; imageFileId: number }) {
  return seal.imageUrl || `/api/infra/files/${seal.imageFileId}/download`
}

export default function WorkflowSealsPage() {
  const canEdit = useHasPerm("wf:def:edit")
  const [rows, setRows] = useState<WfSealDef[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<"network" | string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState<{ name: string; imageFileId: number | null; enabled: boolean }>({
    name: "",
    imageFileId: null,
    enabled: true,
  })
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WfSealDef | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await api<WfSealDef[]>("/api/wf/seals")
      setRows(Array.isArray(list) ? list : [])
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else if (err instanceof ApiError) setLoadError(err.message)
      else setLoadError("加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const startCreate = () => {
    setDraft({ name: "", imageFileId: null, enabled: true })
    setCreateOpen(true)
  }

  const confirmCreate = async () => {
    if (!draft.name.trim()) {
      toast.error("请填写印章名称")
      return
    }
    if (!draft.imageFileId) {
      toast.error("请上传印章图")
      return
    }
    setSaving(true)
    try {
      await api("/api/wf/seals", {
        method: "POST",
        body: JSON.stringify({ name: draft.name.trim(), imageFileId: draft.imageFileId, enabled: draft.enabled }),
      })
      toast.success("电子章已创建")
      setCreateOpen(false)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败（接口可能尚未就绪）")
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await api(`/api/wf/seals/${deleteTarget.id}`, { method: "DELETE" })
      toast.success("电子章已删除")
      setDeleteTarget(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="电子章管理"
        description="维护流程盖章用电子章，引用文件管理的印章图；节点盖章与套打页叠加展示"
        actions={
          canEdit ? (
            <Button size="sm" className="h-8 gap-1" onClick={startCreate}>
              <Plus className="size-4" /> 新建印章
            </Button>
          ) : undefined
        }
      />

      {loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">印章接口尚未就绪</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              /api/wf/seals 暂不可用（{loadError === "network" ? "后端未启动" : loadError}）。后端 P3 就绪后重试即可管理电子章。
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => void load()}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="py-14 text-center text-sm text-muted-foreground">加载中…</div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Stamp className="size-8 text-muted-foreground/40" />
            <div className="text-sm font-medium">暂无电子章</div>
            <p className="max-w-md text-xs text-muted-foreground">上传印章图创建第一枚电子章，供流程节点盖章使用。</p>
            {canEdit && (
              <Button size="sm" className="gap-1.5" onClick={startCreate}>
                <Plus className="size-3.5" /> 新建印章
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rows.map((seal) => (
            <Card key={seal.id} className="overflow-hidden">
              <CardContent className="flex flex-col items-center gap-2 p-4">
                <AuthImg
                  src={sealImageSrc(seal)}
                  alt={seal.name}
                  className="size-24 object-contain mix-blend-multiply dark:mix-blend-normal"
                />
                <div className="w-full text-center">
                  <div className="truncate text-sm font-medium">{seal.name}</div>
                  <Badge
                    variant="outline"
                    className={
                      seal.enabled
                        ? "mt-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                        : "mt-1 border-slate-500/30 bg-slate-500/10 text-slate-500"
                    }
                  >
                    {seal.enabled ? "启用" : "停用"}
                  </Badge>
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs text-rose-500 hover:text-rose-600"
                    onClick={() => setDeleteTarget(seal)}
                  >
                    <Trash2 className="size-3.5" /> 删除
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 新建印章 */}
      <Modal
        open={createOpen}
        onOpenChange={(o) => !o && !saving && setCreateOpen(false)}
        title="新建电子章"
        description="上传印章图并命名，创建后可用于流程节点盖章"
        width={460}
        resizable={false}
        fullscreenable={false}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void confirmCreate()} disabled={saving}>
              {saving ? "创建中…" : "创建"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">印章名称</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="如：行政公章"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">印章图</Label>
            {draft.imageFileId ? (
              <div className="flex items-center gap-3 rounded-md border p-2">
                <AuthImg
                  src={`/api/infra/files/${draft.imageFileId}/download`}
                  alt="印章预览"
                  className="size-16 object-contain mix-blend-multiply dark:mix-blend-normal"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => setDraft((d) => ({ ...d, imageFileId: null }))}
                >
                  重新上传
                </Button>
              </div>
            ) : (
              <FileUploader
                accept="image/*"
                multiple={false}
                onUploaded={(f: UploadedFile) => setDraft((d) => ({ ...d, imageFileId: f.id }))}
              />
            )}
          </div>
          <label className="flex items-center justify-between rounded-md border p-2.5">
            <span className="text-sm font-medium">启用</span>
            <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft((d) => ({ ...d, enabled }))} />
          </label>
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="删除电子章"
        description={deleteTarget?.name}
        width={400}
        resizable={false}
        fullscreenable={false}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">删除后该印章不可用于新的盖章，已盖章记录不受影响。确定删除吗？</p>
      </Modal>
    </div>
  )
}

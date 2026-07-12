/**
 * 知识空间内页（/knowledge/:spaceId）：左目录树 + 右文档编辑区。
 * myRole 驱动读写：VIEWER 只读、EDITOR 可编文档、ADMIN 可管空间/成员。非成员 PRIVATE → 403 友好提示。
 * 目录树 / 文档区 各自 ErrorBoundary（防白屏第 1 层：坏 payload 局部降级不炸整页）。
 */
import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft, RotateCw, Settings, ShieldAlert, Users } from "lucide-react"
import { ApiError } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorBoundary } from "@/components/error-boundary"
import { createDoc, deleteDoc, fetchDocTree, fetchSpace, updateDoc } from "./mock"
import { canEdit, canManage } from "./permissions"
import { firstDoc } from "./tree"
import { KbDemoBanner } from "./kb-ui"
import { DocTree } from "./doc-tree"
import { DocEditor } from "./doc-editor"
import { MemberDialog } from "./member-dialog"
import { SpaceDialog } from "./space-dialog"
import { ROLE_META, VISIBILITY_META, type KbDocType, type KbSpace, type KbTreeNode } from "./types"

export default function KnowledgeSpaceDetailPage() {
  const { spaceId } = useParams()
  const id = Number(spaceId)
  const navigate = useNavigate()

  const [space, setSpace] = useState<KbSpace | null>(null)
  const [tree, setTree] = useState<KbTreeNode[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)
  const [error, setError] = useState<"forbidden" | "notfound" | string | null>(null)
  const [memberOpen, setMemberOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const role = space?.myRole ?? null
  const editable = canEdit(role)
  const manageable = canManage(role)

  const reloadTree = useCallback(
    (selectId?: number | null) =>
      fetchDocTree(id)
        .then((r) => {
          const t = Array.isArray(r.data) ? r.data : []
          setTree(t)
          if (selectId !== undefined) setSelectedId(selectId)
        })
        .catch(() => setTree([])),
    [id],
  )

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([fetchSpace(id), fetchDocTree(id)])
      .then(([s, t]) => {
        if (!s.data) {
          setError("notfound")
          return
        }
        setSpace(s.data)
        const tr = Array.isArray(t.data) ? t.data : []
        setTree(tr)
        setSelectedId((prev) => prev ?? firstDoc(tr)?.id ?? null)
        setDemo(s.demo || t.demo)
      })
      .catch((e: unknown) => {
        setError(e instanceof ApiError && (e.code === 403 || String(e.message).includes("403")) ? "forbidden" : e instanceof Error ? e.message : "加载失败")
      })
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  /* ---- 目录树写操作（落 API 后 reload） ---- */
  const onCreate = (parentId: number | null, type: KbDocType) => {
    void createDoc(id, { parentId, type, title: type === "FOLDER" ? "新建目录" : "无标题文档" })
      .then((r) => {
        void reloadTree(type === "DOC" ? r.data?.id ?? null : undefined)
        toast.success(type === "FOLDER" ? "已新建目录" : "已新建文档")
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "创建失败"))
  }
  const onRename = (node: KbTreeNode, title: string) => {
    void updateDoc(node.id, { title }).then(() => reloadTree()).catch((e) => toast.error(e instanceof Error ? e.message : "重命名失败"))
  }
  const onDelete = (node: KbTreeNode) => {
    void deleteDoc(node.id)
      .then(() => {
        void reloadTree(node.id === selectedId ? null : undefined)
        toast.success("已删除")
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "删除失败"))
  }
  const onMove = (dragId: number, parentId: number, sort: number) => {
    void updateDoc(dragId, { parentId, sort }).then(() => reloadTree()).catch((e) => toast.error(e instanceof Error ? e.message : "移动失败"))
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[520px] w-full rounded-xl" />
      </div>
    )
  }
  if (error) {
    return (
      <Card className="flex flex-col items-center gap-3 py-16 text-center">
        <ShieldAlert className="size-8 text-rose-500/60" />
        <div className="text-sm font-medium">{error === "forbidden" ? "无权访问该知识空间（非成员的私有空间）" : error === "notfound" ? "空间不存在或已删除" : error}</div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/knowledge")}>
          <ArrowLeft className="size-3.5" /> 返回知识库
        </Button>
      </Card>
    )
  }
  if (!space) return null

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="返回" onClick={() => navigate("/knowledge")}>
          <ArrowLeft className="size-4.5" />
        </Button>
        <span className="text-xl">{space.icon || "📁"}</span>
        <h1 className="truncate text-base font-semibold">{space.name}</h1>
        {VISIBILITY_META[space.visibility] && (
          <Badge variant="outline" className={VISIBILITY_META[space.visibility].className}>
            {VISIBILITY_META[space.visibility].label}
          </Badge>
        )}
        {role && <Badge variant="outline" className={ROLE_META[role].className}>{ROLE_META[role].label}</Badge>}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setMemberOpen(true)}>
            <Users className="size-3.5" /> 成员 {space.memberCount ? `(${space.memberCount})` : ""}
          </Button>
          {manageable && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSettingsOpen(true)}>
              <Settings className="size-3.5" /> 设置
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-8" title="刷新" onClick={load}>
            <RotateCw className="size-4" />
          </Button>
        </div>
      </div>

      {demo && <KbDemoBanner />}

      {/* 左树 + 右文档 */}
      <Card className="flex h-[calc(100vh-12rem)] min-h-[520px] flex-row gap-0 overflow-hidden p-0">
        <div className="w-64 shrink-0 border-r p-3">
          <ErrorBoundary label="kb-tree">
            <DocTree
              tree={tree}
              selectedId={selectedId}
              onSelect={(n) => setSelectedId(n.id)}
              canEdit={editable}
              onCreate={onCreate}
              onRename={onRename}
              onDelete={onDelete}
              onMove={onMove}
            />
          </ErrorBoundary>
        </div>
        <div className="min-w-0 flex-1 p-4">
          <ErrorBoundary label="kb-editor">
            <DocEditor docId={selectedId} canEdit={editable} onDocChanged={() => reloadTree()} />
          </ErrorBoundary>
        </div>
      </Card>

      <MemberDialog open={memberOpen} onOpenChange={setMemberOpen} spaceId={id} canManage={manageable} onChanged={load} />
      <SpaceDialog open={settingsOpen} onOpenChange={setSettingsOpen} space={space} onSaved={() => load()} />
    </div>
  )
}

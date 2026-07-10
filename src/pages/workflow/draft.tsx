import { useCallback, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { FileEdit, ShieldAlert, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { api, NetworkError } from "@/lib/api"
import { Modal } from "@/components/modal"
import { FormRenderer } from "@/components/form-renderer"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { BackendDownCard } from "@/pages/approval/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  parseFormData,
  parseFormSchema,
  wfFormatTime,
  type FormSchema,
  type WfDraftItem,
  type WfFormData,
  type WfInstanceDetail,
} from "@/types/workflow"
import { useServerPage } from "./use-server-page"

/** 草稿列表（我的审批「草稿」Tab 内容） */
export function DraftList() {
  // 继续编辑弹窗
  const [editing, setEditing] = useState<WfDraftItem | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [schema, setSchema] = useState<FormSchema | null>(null)
  const [initial, setInitial] = useState<WfFormData>({})
  const [title, setTitle] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)

  // 删除确认
  const [deleting, setDeleting] = useState<WfDraftItem | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const page = useServerPage<WfDraftItem>(
    (pageNum, pageSize) => `/api/wf/instances/drafts?pageNum=${pageNum}&pageSize=${pageSize}`,
  )
  const { rows, loading, loadError, reload } = page

  const openEdit = useCallback((row: WfDraftItem) => {
    setEditing(row)
    setSchema(null)
    setInitial({})
    setTitle(row.title ?? "")
    setEditError(null)
    setEditLoading(true)
    api<WfInstanceDetail>(`/api/wf/instances/${row.id}`)
      .then((detail) => {
        setSchema(parseFormSchema(detail.formSchema))
        setInitial(parseFormData(detail.formData))
        if (detail.title) setTitle(detail.title)
      })
      .catch((err) => {
        setEditError(
          err instanceof NetworkError ? "无法连接后端服务" : err instanceof Error ? err.message : "草稿加载失败",
        )
      })
      .finally(() => setEditLoading(false))
  }, [])

  // 提交草稿 → 激活流程
  const submit = useCallback(
    async (formData: WfFormData) => {
      if (!editing) return
      setSubmitting(true)
      try {
        await api(`/api/wf/instances/${editing.id}/submit`, {
          method: "POST",
          body: JSON.stringify({ formData }),
        })
        toast.success(`「${title.trim() || editing.title || "草稿"}」已提交`)
        setEditing(null)
        reload()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "提交失败")
      } finally {
        setSubmitting(false)
      }
    },
    [editing, title, reload],
  )

  // 保存草稿修改（不激活）
  const saveDraft = useCallback(
    async (formData: WfFormData) => {
      if (!editing) return
      setSavingDraft(true)
      try {
        await api(`/api/wf/instances/${editing.id}/draft`, {
          method: "PUT",
          body: JSON.stringify({ formData, title: title.trim() || undefined }),
        })
        toast.success("草稿已保存")
        setEditing(null)
        reload()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "保存失败")
      } finally {
        setSavingDraft(false)
      }
    },
    [editing, title, reload],
  )

  const remove = useCallback(async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api(`/api/wf/instances/${deleting.id}/draft`, { method: "DELETE" })
      toast.success("草稿已删除")
      setDeleting(null)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleteBusy(false)
    }
  }, [deleting, reload])

  const columns = useMemo<ColumnDef<WfDraftItem, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        meta: { title: "标题" },
        header: () => <span>标题</span>,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.title || "（未命名草稿）"}</span>
        ),
      },
      {
        accessorKey: "defName",
        meta: { title: "流程" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="流程" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.defName ?? "—"}</Badge>,
      },
      {
        accessorKey: "updatedAt",
        meta: { title: "更新时间" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="更新时间" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {wfFormatTime(row.original.updatedAt ?? row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => <span>操作</span>,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary"
              onClick={(e) => {
                e.stopPropagation()
                openEdit(row.original)
              }}
            >
              <FileEdit className="size-3.5" /> 继续编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-600"
              onClick={(e) => {
                e.stopPropagation()
                setDeleting(row.original)
              }}
            >
              <Trash2 className="size-3.5" /> 删除
            </Button>
          </div>
        ),
      },
    ],
    [openEdit],
  )

  return (
    <div className="space-y-4">
      {loadError === "network" ? (
        <BackendDownCard onRetry={reload} />
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={reload}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          searchKeys={["title", "defName"]}
          searchPlaceholder="搜索当前页标题 / 流程"
          onRowClick={(row) => openEdit(row)}
          onRefresh={reload}
          exportFileName="我的草稿"
          serverPagination={{
            pageIndex: page.pageIndex,
            pageSize: page.pageSize,
            rowCount: page.total,
            onPaginationChange: page.onPaginationChange,
          }}
        />
      )}

      {/* 继续编辑弹窗 */}
      <Modal
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !submitting && !savingDraft) setEditing(null)
        }}
        title={editing ? `编辑草稿：${editing.defName ?? ""}` : "编辑草稿"}
        description="修改后可保存草稿或提交激活流程"
        width={640}
      >
        {editLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        ) : editError ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm text-muted-foreground">{editError}</div>
            <Button size="sm" variant="outline" onClick={() => editing && openEdit(editing)}>
              重试
            </Button>
          </div>
        ) : schema ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">标题</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="选填" />
            </div>
            <FormRenderer
              key={editing?.id}
              widgets={schema.widgets}
              initialValues={initial}
              submitting={submitting}
              savingDraft={savingDraft}
              submitLabel="提交激活"
              saveDraftLabel="保存草稿"
              onSubmit={submit}
              onSaveDraft={saveDraft}
              onCancel={() => setEditing(null)}
            />
          </div>
        ) : null}
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={!!deleting}
        onOpenChange={(open) => !open && !deleteBusy && setDeleting(null)}
        title="删除草稿"
        description={deleting?.title}
        width={420}
        resizable={false}
        fullscreenable={false}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={deleteBusy}>
              {deleteBusy ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">删除后草稿不可恢复，确定要删除吗？</p>
      </Modal>
    </div>
  )
}

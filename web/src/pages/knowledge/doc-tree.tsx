/**
 * 知识库目录树：FOLDER/DOC 节点，展开/折叠、选中、右键菜单（新建/重命名/删除）、HTML5 拖拽移动/排序。
 * 纯展示 + 回调解耦：所有写操作由父级（space-detail）落 API 后 reload 树。canEdit=false 时只读（无写入口）。
 */
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ChevronRight, FilePlus, FileText, Folder, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { DOC_STATUS_META, type KbDocType, type KbTreeNode } from "./types"
import { descendantIds, findNode } from "./tree"

interface DocTreeProps {
  tree: KbTreeNode[]
  selectedId: number | null
  onSelect: (node: KbTreeNode) => void
  canEdit: boolean
  /** parentId=null 表示空间根 */
  onCreate: (parentId: number | null, type: KbDocType) => void
  onRename: (node: KbTreeNode, title: string) => void
  onDelete: (node: KbTreeNode) => void
  /** parentId=0 表示移到空间根 */
  onMove: (dragId: number, parentId: number, sort: number) => void
}

export function DocTree({ tree, selectedId, onSelect, canEdit, onCreate, onRename, onDelete, onMove }: DocTreeProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropId, setDropId] = useState<number | null>(null)
  const [rootOver, setRootOver] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<KbTreeNode | null>(null)

  // 首次/树变化：默认展开全部有子目录
  useEffect(() => {
    const ids = new Set<number>()
    const walk = (nodes: KbTreeNode[]) => {
      for (const n of nodes) {
        if (n.children.length) ids.add(n.id)
        walk(n.children)
      }
    }
    walk(tree)
    setExpanded(ids)
  }, [tree])

  const toggle = (id: number) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const startRename = (node: KbTreeNode) => {
    setRenamingId(node.id)
    setRenameValue(node.title)
  }
  const commitRename = (node: KbTreeNode) => {
    const v = renameValue.trim()
    setRenamingId(null)
    if (v && v !== node.title) onRename(node, v)
  }

  const doMove = (target: KbTreeNode | null) => {
    if (dragId == null) return
    const drag = findNode(tree, dragId)
    if (!drag) return
    if (target == null) {
      const rootSort = tree.length ? Math.max(...tree.map((r) => r.sort)) + 1 : 1
      onMove(dragId, 0, rootSort)
      return
    }
    if (dragId === target.id) return
    if (drag.type === "FOLDER" && descendantIds(drag).includes(target.id)) {
      toast.error("不能移动到自身子目录")
      return
    }
    if (target.type === "FOLDER") {
      const sort = target.children.length ? Math.max(...target.children.map((c) => c.sort)) + 1 : 1
      onMove(dragId, target.id, sort)
    } else {
      onMove(dragId, target.parentId ?? 0, target.sort + 0.5)
    }
  }

  const renderNode = (node: KbTreeNode, depth: number) => {
    const isFolder = node.type === "FOLDER"
    const isOpen = expanded.has(node.id)
    const isSel = node.id === selectedId
    const isRenaming = renamingId === node.id

    const row = (
      <div
        role="treeitem"
        aria-selected={isSel}
        draggable={canEdit && !isRenaming}
        onDragStart={(e) => {
          setDragId(node.id)
          e.dataTransfer.effectAllowed = "move"
        }}
        onDragEnd={() => {
          setDragId(null)
          setDropId(null)
        }}
        onDragOver={(e) => {
          if (dragId == null || dragId === node.id) return
          e.preventDefault()
          e.stopPropagation()
          setDropId(node.id)
          setRootOver(false)
        }}
        onDragLeave={() => setDropId((d) => (d === node.id ? null : d))}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          doMove(node)
          setDragId(null)
          setDropId(null)
        }}
        onClick={() => {
          if (isFolder) toggle(node.id)
          onSelect(node)
        }}
        className={cn(
          "group/row flex cursor-pointer items-center gap-1 rounded-md py-1 pr-1 text-sm hover:bg-accent",
          isSel && "bg-accent font-medium",
          dropId === node.id && "ring-1 ring-primary",
        )}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <button
          type="button"
          className={cn("grid size-4 shrink-0 place-items-center text-muted-foreground", !isFolder && "invisible")}
          onClick={(e) => {
            e.stopPropagation()
            toggle(node.id)
          }}
          aria-label={isOpen ? "折叠" : "展开"}
        >
          <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
        </button>
        {isFolder ? (
          isOpen ? <FolderOpen className="size-4 shrink-0 text-amber-500" /> : <Folder className="size-4 shrink-0 text-amber-500" />
        ) : (
          <FileText className="size-4 shrink-0 text-muted-foreground" />
        )}
        {isRenaming ? (
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => commitRename(node)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(node)
              if (e.key === "Escape") setRenamingId(null)
            }}
            className="h-6 flex-1 px-1 py-0 text-sm"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.title}</span>
        )}
        {!isFolder && node.status !== "PUBLISHED" && (
          <Badge variant="outline" className={cn("h-4 shrink-0 px-1 text-[10px]", DOC_STATUS_META[node.status]?.className)}>
            {DOC_STATUS_META[node.status]?.label}
          </Badge>
        )}
        {canEdit && !isRenaming && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:bg-muted group-hover/row:opacity-100"
                aria-label="更多操作"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {isFolder && (
                <>
                  <DropdownMenuItem onClick={() => onCreate(node.id, "DOC")}>
                    <FilePlus className="size-4" /> 新建文档
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onCreate(node.id, "FOLDER")}>
                    <FolderPlus className="size-4" /> 新建子目录
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => startRename(node)}>
                <Pencil className="size-4" /> 重命名
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(node)}>
                <Trash2 className="size-4" /> 删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    )

    return (
      <div key={node.id}>
        {canEdit ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
            <ContextMenuContent>
              {isFolder && (
                <>
                  <ContextMenuItem onClick={() => onCreate(node.id, "DOC")}>
                    <FilePlus className="size-4" /> 新建文档
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onCreate(node.id, "FOLDER")}>
                    <FolderPlus className="size-4" /> 新建子目录
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              )}
              <ContextMenuItem onClick={() => startRename(node)}>
                <Pencil className="size-4" /> 重命名
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onClick={() => setDeleteTarget(node)}>
                <Trash2 className="size-4" /> 删除
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          row
        )}
        {isFolder && isOpen && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-xs font-medium text-muted-foreground">目录</span>
        {canEdit && (
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" aria-label="新建文档" onClick={() => onCreate(null, "DOC")}>
              <FilePlus className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" aria-label="新建目录" onClick={() => onCreate(null, "FOLDER")}>
              <FolderPlus className="size-4" />
            </Button>
          </div>
        )}
      </div>
      <div
        role="tree"
        className={cn("min-h-0 flex-1 overflow-y-auto pb-4", rootOver && "rounded-md ring-1 ring-primary")}
        onDragOver={(e) => {
          if (dragId == null) return
          e.preventDefault()
          setRootOver(true)
        }}
        onDragLeave={() => setRootOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          doMove(null)
          setDragId(null)
          setRootOver(false)
        }}
      >
        {tree.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
            <FileText className="size-6 opacity-40" />
            暂无文档
            {canEdit && (
              <Button variant="outline" size="sm" className="mt-1 gap-1.5" onClick={() => onCreate(null, "DOC")}>
                <Plus className="size-3.5" /> 新建文档
              </Button>
            )}
          </div>
        ) : (
          tree.map((n) => renderNode(n, 0))
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{deleteTarget?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "FOLDER" ? "该目录及其下所有子目录、文档将一并删除，" : "该文档将被删除，"}此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) onDelete(deleteTarget)
                setDeleteTarget(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

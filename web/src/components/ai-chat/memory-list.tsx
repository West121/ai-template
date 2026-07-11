/**
 * 长期记忆管理视图（批D §13.4）：面板内视图（不另开抽屉）。
 * 项 = 记忆键 + 值 + 类型徽标（显式/推断/偏好）+ 更新时间 + 删除（AlertDialog 二次确认）。
 * 对话里"记住我…"由后端产 confirm 卡（前端已能渲染，无需特殊处理）；此处仅查看与删除。
 */
import { useState } from "react"
import { BrainCircuit, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { AiMemory } from "./types"

/** 记忆类型 → 徽标文案/样式 */
function typeBadge(type: AiMemory["memoryType"]): { label: string; variant: "default" | "secondary" | "outline" } {
  switch (type) {
    case "EXPLICIT":
      return { label: "显式", variant: "default" }
    case "INFERRED":
      return { label: "推断", variant: "secondary" }
    case "SYSTEM_PREF":
      return { label: "偏好", variant: "outline" }
    default:
      return { label: String(type || "其他"), variant: "outline" }
  }
}

export function MemoryListView({
  memories,
  loading,
  onDelete,
}: {
  memories: AiMemory[]
  loading: boolean
  onDelete: (id: string) => void
}) {
  const [deleting, setDeleting] = useState<AiMemory | null>(null)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <p className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
        助手会记住你的显式偏好与部分推断，用于更贴合的回答。业务实时数据（待办、余额等）不会写入记忆。你可随时删除任意条目。
      </p>
      {loading ? (
        <div className="space-y-2 p-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : memories.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <BrainCircuit className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">还没有任何记忆</p>
          <p className="max-w-[16rem] text-xs text-muted-foreground/70">
            在对话里说「记住我常按研发中心统计」，助手会先出确认卡，你确认后即写入。
          </p>
        </div>
      ) : (
        <ul className="space-y-1">
          {memories.map((m) => {
            const b = typeBadge(m.memoryType)
            return (
              <li key={m.id}>
                <div className="group flex items-start gap-2 rounded-lg border bg-card px-2.5 py-2 shadow-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{m.memoryKey}</span>
                      <Badge variant={b.variant} className="px-1.5 py-0 text-[10px]">
                        {b.label}
                      </Badge>
                    </div>
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">{m.memoryValue}</p>
                    {m.updatedAt && <p className="mt-0.5 text-[10px] text-muted-foreground/70">{m.updatedAt.slice(0, 16).replace("T", " ")}</p>}
                  </div>
                  <button
                    type="button"
                    aria-label={`删除记忆 ${m.memoryKey}`}
                    onClick={() => setDeleting(m)}
                    className="shrink-0 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除记忆</AlertDialogTitle>
            <AlertDialogDescription>
              删除「{deleting?.memoryKey}」后不可恢复，助手将不再据此回答。确定删除吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleting) onDelete(deleting.id)
                setDeleting(null)
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

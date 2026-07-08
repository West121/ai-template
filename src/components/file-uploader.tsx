import { useRef, useState, type ChangeEvent, type DragEvent } from "react"
import {
  CloudUpload,
  File as FileIcon,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Pause,
  Play,
  RotateCw,
  X,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuthStore } from "@/stores/auth-store"

/** 上传完成后后端返回的文件记录（对应 FileRecord 的展示子集） */
export interface UploadedFile {
  id: number
  originalName: string
  size: number
  contentType?: string
  storageType: string
  createdAt?: string
}

export interface FileUploaderProps {
  /** 每个文件上传成功（含秒传）后回调 */
  onUploaded?: (file: UploadedFile) => void
  accept?: string
  /** 是否允许多文件，默认 true */
  multiple?: boolean
  /** 超过该体积走分片上传，默认 5MB */
  chunkThreshold?: number
  /** 分片大小，默认 2MB */
  chunkSize?: number
  className?: string
}

type TaskStatus =
  | "waiting"
  | "hashing"
  | "uploading"
  | "paused"
  | "merging"
  | "done"
  | "instant"
  | "failed"

interface UploadTask {
  key: string
  file: File
  /** 是否走分片上传（按 chunkThreshold 判定） */
  chunked: boolean
  status: TaskStatus
  progress: number
  error?: string
}

/** 每个任务的运行时控制块（不进 React 状态，避免暂停/取消时的竞态） */
interface TaskCtrl {
  xhr: XMLHttpRequest | null
  paused: boolean
  cancelled: boolean
}

interface ChunkInitResult {
  uploadId: string
  uploaded: number[]
  instant: boolean
  file?: UploadedFile
}

const STATUS_META: Record<TaskStatus, { label: string; className: string }> = {
  waiting: { label: "等待", className: "text-muted-foreground" },
  hashing: { label: "计算指纹", className: "text-sky-600 dark:text-sky-400" },
  uploading: { label: "上传中", className: "text-primary" },
  paused: { label: "已暂停", className: "text-amber-600 dark:text-amber-400" },
  merging: { label: "合并中", className: "text-sky-600 dark:text-sky-400" },
  done: { label: "已完成", className: "text-emerald-600 dark:text-emerald-400" },
  instant: { label: "秒传", className: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "失败", className: "text-rose-600 dark:text-rose-400" },
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"])
const ARCHIVE_EXTS = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz"])
const SHEET_EXTS = new Set(["xls", "xlsx", "csv"])
const TEXT_EXTS = new Set(["txt", "md", "doc", "docx", "pdf", "log", "json", "xml", "yml", "yaml"])

/** 按扩展名映射文件图标（文件管理页复用） */
export function getFileIcon(nameOrExt: string): LucideIcon {
  const ext = (nameOrExt.includes(".") ? nameOrExt.split(".").pop()! : nameOrExt).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return FileImage
  if (ARCHIVE_EXTS.has(ext)) return FileArchive
  if (SHEET_EXTS.has(ext)) return FileSpreadsheet
  if (TEXT_EXTS.has(ext)) return FileText
  return FileIcon
}

/** 字节数格式化为 B / KB / MB / GB */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 上传被主动中断（暂停/取消），与真实失败区分 */
class UploadAborted extends Error {}

interface Envelope<T> {
  code: number
  message?: string
  data: T
}

/**
 * XMLHttpRequest 上传：fetch 无法拿到上传进度，这里用 xhr.upload.onprogress 汇报真实进度。
 * register 用于把 xhr 交给控制块，供暂停/取消时 abort。
 */
function xhrUpload<T>(
  url: string,
  form: FormData,
  opts: {
    onProgress?: (fraction: number) => void
    register: (xhr: XMLHttpRequest | null) => void
  },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    opts.register(xhr)
    xhr.open("POST", url)
    const { token, offline } = useAuthStore.getState()
    if (token && !offline) xhr.setRequestHeader("Authorization", `Bearer ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      opts.register(null)
      try {
        const body = JSON.parse(xhr.responseText) as Envelope<T>
        if (body.code !== 0) reject(new Error(body.message ?? `上传失败（HTTP ${xhr.status}）`))
        else resolve(body.data)
      } catch {
        reject(new Error(`上传失败（HTTP ${xhr.status}）`))
      }
    }
    xhr.onerror = () => {
      opts.register(null)
      reject(new Error("无法连接后端服务"))
    }
    xhr.onabort = () => {
      opts.register(null)
      reject(new UploadAborted("已中断"))
    }
    xhr.send(form)
  })
}

/**
 * 文件指纹：SHA-256(前 2MB + 后 2MB + size 字符串)。
 * 对大文件只采样头尾，避免整文件读入内存，仍能满足秒传/断点续传的去重判定。
 */
async function computeFileHash(file: File): Promise<string> {
  const SAMPLE = 2 * 1024 * 1024
  const head = await file.slice(0, Math.min(SAMPLE, file.size)).arrayBuffer()
  const tail =
    file.size > SAMPLE ? await file.slice(Math.max(file.size - SAMPLE, 0)).arrayBuffer() : new ArrayBuffer(0)
  const sizeBytes = new TextEncoder().encode(String(file.size))
  const merged = new Uint8Array(head.byteLength + tail.byteLength + sizeBytes.byteLength)
  merged.set(new Uint8Array(head), 0)
  merged.set(new Uint8Array(tail), head.byteLength)
  merged.set(sizeBytes, head.byteLength + tail.byteLength)
  const digest = await crypto.subtle.digest("SHA-256", merged)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * 通用文件上传组件：拖拽/点击选择，小文件直传、大文件分片（秒传 / 断点续传 / 暂停继续）。
 * 组件自包含：任务队列与 xhr 引用均在内部管理。
 */
export function FileUploader({
  onUploaded,
  accept,
  multiple = true,
  chunkThreshold = 5 * 1024 * 1024,
  chunkSize = 2 * 1024 * 1024,
  className,
}: FileUploaderProps) {
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const ctrls = useRef(new Map<string, TaskCtrl>())

  const patch = (key: string, p: Partial<UploadTask>) =>
    setTasks((prev) => prev.map((t) => (t.key === key ? { ...t, ...p } : t)))

  const runTask = async (key: string, file: File) => {
    const ctrl = ctrls.current.get(key)
    if (!ctrl || ctrl.cancelled) return
    ctrl.paused = false
    try {
      /* ---------- 小文件：FormData 直传（XHR 汇报真实进度） ---------- */
      if (file.size <= chunkThreshold) {
        patch(key, { status: "uploading", progress: 0, error: undefined })
        const form = new FormData()
        form.append("file", file)
        const record = await xhrUpload<UploadedFile>("/api/infra/files/upload", form, {
          onProgress: (f) => patch(key, { progress: Math.round(f * 100) }),
          register: (x) => {
            ctrl.xhr = x
          },
        })
        patch(key, { status: "done", progress: 100 })
        onUploaded?.(record)
        return
      }

      /* ---------- 大文件：指纹 → init（秒传/续传）→ 逐片上传 → merge ---------- */
      patch(key, { status: "hashing", progress: 0, error: undefined })
      const fileHash = await computeFileHash(file)
      if (ctrl.cancelled) return
      if (ctrl.paused) {
        patch(key, { status: "paused" })
        return
      }

      const init = await api<ChunkInitResult>("/api/infra/files/chunk/init", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
          chunkSize,
          fileHash,
        }),
      })

      // 指纹命中已有完整文件：秒传
      if (init.instant && init.file) {
        patch(key, { status: "instant", progress: 100 })
        onUploaded?.(init.file)
        return
      }

      const total = Math.ceil(file.size / chunkSize)
      const uploaded = new Set(init.uploaded)
      patch(key, { status: "uploading", progress: Math.round((uploaded.size / total) * 100) })

      for (let index = 0; index < total; index++) {
        if (ctrl.cancelled) return
        if (ctrl.paused) {
          patch(key, { status: "paused" })
          return
        }
        if (uploaded.has(index)) continue // 断点续传：跳过服务端已记录的分片
        const form = new FormData()
        form.append("uploadId", init.uploadId)
        form.append("index", String(index))
        form.append("chunk", file.slice(index * chunkSize, Math.min((index + 1) * chunkSize, file.size)))
        await xhrUpload<{ uploaded: number[] }>("/api/infra/files/chunk", form, {
          // 整体进度 =（已完成片数 + 当前片进度）/ 总片数
          onProgress: (f) => patch(key, { progress: Math.round(((uploaded.size + f) / total) * 100) }),
          register: (x) => {
            ctrl.xhr = x
          },
        })
        uploaded.add(index)
        patch(key, { progress: Math.round((uploaded.size / total) * 100) })
      }

      patch(key, { status: "merging", progress: 100 })
      const record = await api<UploadedFile>("/api/infra/files/chunk/merge", {
        method: "POST",
        body: JSON.stringify({ uploadId: init.uploadId }),
      })
      patch(key, { status: "done" })
      onUploaded?.(record)
    } catch (err) {
      if (ctrl.cancelled) return
      if (err instanceof UploadAborted) {
        // 暂停触发的 xhr.abort：已传分片服务端已记录，继续时重新 init 续传
        patch(key, { status: "paused" })
        return
      }
      patch(key, { status: "failed", error: err instanceof Error ? err.message : "上传失败" })
    }
  }

  const addFiles = (files: FileList | File[]) => {
    const picked = multiple ? Array.from(files) : Array.from(files).slice(0, 1)
    if (picked.length === 0) return
    if (!multiple) {
      // 单文件模式：替换现有任务
      for (const ctrl of ctrls.current.values()) {
        ctrl.cancelled = true
        ctrl.xhr?.abort()
      }
      ctrls.current.clear()
      setTasks([])
    }
    for (const file of picked) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      ctrls.current.set(key, { xhr: null, paused: false, cancelled: false })
      setTasks((prev) => [
        ...prev,
        { key, file, chunked: file.size > chunkThreshold, status: "waiting", progress: 0 },
      ])
      void runTask(key, file)
    }
  }

  const pause = (key: string) => {
    const ctrl = ctrls.current.get(key)
    if (!ctrl) return
    ctrl.paused = true
    ctrl.xhr?.abort()
  }

  const resume = (task: UploadTask) => {
    void runTask(task.key, task.file)
  }

  const cancel = (key: string) => {
    const ctrl = ctrls.current.get(key)
    if (ctrl) {
      ctrl.cancelled = true
      ctrl.xhr?.abort()
    }
    ctrls.current.delete(key)
    setTasks((prev) => prev.filter((t) => t.key !== key))
  }

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = "" // 允许再次选择同一文件
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* 拖拽/点击选择区 */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setDragging(false)
        }}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50",
        )}
      >
        <div className="flex size-11 items-center justify-center rounded-full bg-primary/10">
          <CloudUpload className="size-5 text-primary" />
        </div>
        <div className="text-sm font-medium">拖拽文件到此处，或点击选择</div>
        <p className="text-xs text-muted-foreground">
          单文件 ≤ {formatFileSize(chunkThreshold)} 直传；更大文件自动分片上传，支持秒传 / 断点续传 / 暂停继续
        </p>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept}
          multiple={multiple}
          onChange={onInputChange}
        />
      </div>

      {/* 任务列表 */}
      {tasks.length > 0 && (
        <div className="space-y-2">
          {tasks.map((task) => {
            const Icon = getFileIcon(task.file.name)
            const meta = STATUS_META[task.status]
            const busy = task.status === "uploading" || task.status === "hashing" || task.status === "merging"
            return (
              <div key={task.key} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                <Icon className="size-7 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{task.file.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatFileSize(task.file.size)}
                      {task.chunked && " · 分片"}
                    </span>
                  </div>
                  <Progress value={task.progress} className="h-1.5" />
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-xs", meta.className)}>
                      {meta.label}
                      {(task.status === "uploading" || task.status === "paused") && ` · ${task.progress}%`}
                    </span>
                    {task.error && (
                      <span className="truncate text-xs text-rose-600 dark:text-rose-400">{task.error}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {task.status === "uploading" && task.chunked && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => pause(task.key)}>
                          <Pause className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>暂停</TooltipContent>
                    </Tooltip>
                  )}
                  {task.status === "paused" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => resume(task)}>
                          <Play className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>继续（断点续传）</TooltipContent>
                    </Tooltip>
                  )}
                  {task.status === "failed" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => resume(task)}>
                          <RotateCw className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>重试</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-rose-600"
                        onClick={() => cancel(task.key)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{busy ? "取消上传" : "移除"}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

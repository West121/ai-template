/**
 * RichTextEditor —— 全站统一富文本编辑器（TipTap 3.x，React 19）。
 *
 * 契约（docs/design/rich-text-component.md §3）：
 *  - 受控：`value`(HTML) / `onChange(html)`；**空文档回传 ""**（非 `<p></p>`）；
 *    受控回写仅在 value ≠ 编辑器现值时 setContent（emitUpdate:false，不重置光标）。
 *  - 产出干净 HTML：段落 `<p>`、无裸 <br> 换行；粘贴经 TipTap 解析清理。
 *  - preset（minimal/standard/full）或 features 精确定制；工具栏按 feature 自动出按钮。
 *  - placeholder / readOnly / disabled / minHeight / maxHeight（超出内滚）/
 *    maxLength（CharacterCount 硬限）+ showCount 字数统计。
 *  - 图片（full）：上传 POST /api/infra/files/upload 插 URL；offline/失败降级 base64 预览并提示。
 *  - 暗色两态走主题 token；工具栏 aria-label + Tooltip。
 */
import { useCallback, useEffect, type CSSProperties } from "react"
import { toast } from "sonner"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import {
  buildExtensions,
  resolveFeatures,
  type RichTextFeature,
  type RichTextPreset,
} from "./extensions"
import { RichTextToolbar } from "./toolbar"
import "./rich-text.css"

export interface RichTextEditorProps {
  /** 受控 HTML 值；空文档时回传 "" */
  value: string
  onChange: (html: string) => void
  /** 能力档位（feature 集合别名），缺省 standard */
  preset?: RichTextPreset
  /** 精确定制能力（优先于 preset） */
  features?: RichTextFeature[]
  placeholder?: string
  /** 只读（隐藏工具栏，仅展示内容；展示场景请优先用 RichTextViewer） */
  readOnly?: boolean
  /** 禁用（只读 + 弱化外观） */
  disabled?: boolean
  /** 编辑区最小高度 px，默认 120 */
  minHeight?: number
  /** 编辑区最大高度 px；超出内部滚动 */
  maxHeight?: number
  /** 字数上限（硬限制，超出无法输入）；配合 showCount 展示 */
  maxLength?: number
  /** 显示字数统计（有 maxLength 时默认显示） */
  showCount?: boolean
  className?: string
  /** 拿到底层 TipTap 编辑器实例（如知识库 AI 写作辅助：选区/插入/替换）；卸载回传 null。传稳定引用（useCallback）。 */
  onEditorReady?: (editor: Editor | null) => void
}

/** 后端文件上传响应（对齐 file-uploader 的 UploadedFile） */
interface UploadedFile {
  id: number
}

/** 文件 → base64 data URL（offline / 上传失败的预览降级） */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("读取图片失败"))
    reader.readAsDataURL(file)
  })
}

export function RichTextEditor({
  value,
  onChange,
  preset,
  features,
  placeholder = "请输入内容…",
  readOnly = false,
  disabled = false,
  minHeight = 120,
  maxHeight,
  maxLength,
  showCount,
  className,
  onEditorReady,
}: RichTextEditorProps) {
  const resolved = resolveFeatures(preset, features)
  const editable = !readOnly && !disabled

  const editor = useEditor({
    extensions: buildExtensions(resolved, { placeholder, maxLength }),
    content: value || "",
    editable,
    editorProps: {
      attributes: { class: "rt-content", role: "textbox", "aria-multiline": "true" },
    },
    // 空文档归一 ""：配合「必填」校验，不被 <p></p> 骗过
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
  })

  // 受控同步：外部 value 与现值不一致才回写（emitUpdate:false 防回环/光标跳动）
  useEffect(() => {
    if (!editor) return
    const current = editor.isEmpty ? "" : editor.getHTML()
    if ((value || "") !== current) editor.commands.setContent(value || "", { emitUpdate: false })
  }, [value, editor])

  // readOnly / disabled 切换
  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  // 暴露编辑器实例（可选；卸载回传 null）
  useEffect(() => {
    onEditorReady?.(editor)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

  /* ---- 图片：上传优先，offline/失败降级 base64 预览 ---- */
  const insertImage = useCallback(
    async (file: File) => {
      if (!editor) return
      const { token, offline } = useAuthStore.getState()
      if (!offline) {
        try {
          const form = new FormData()
          form.append("file", file)
          const res = await fetch("/api/infra/files/upload", {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            body: form,
          })
          const body = (await res.json()) as { code: number; message?: string; data: UploadedFile }
          if (body.code !== 0) throw new Error(body.message ?? "上传失败")
          editor.chain().focus().setImage({ src: `/api/infra/files/${body.data.id}/download` }).run()
          return
        } catch (err) {
          toast.warning(
            `图片上传失败（${err instanceof Error ? err.message : "网络异常"}），已降级为本地预览`,
          )
        }
      } else {
        toast.info("后端未连接，图片以本地预览（base64）插入")
      }
      try {
        const dataUrl = await fileToDataUrl(file)
        editor.chain().focus().setImage({ src: dataUrl }).run()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "插入图片失败")
      }
    },
    [editor],
  )

  const count = editor?.storage.characterCount?.characters?.() ?? 0
  const showCounter = showCount ?? maxLength != null
  const atLimit = maxLength != null && count >= maxLength

  return (
    <div
      className={cn(
        "rt-editor rounded-md border bg-background focus-within:border-ring",
        maxHeight != null && "rt-editor--scroll",
        disabled && "rt-editor--disabled",
        className,
      )}
      style={
        {
          "--rt-min-height": `${minHeight}px`,
          ...(maxHeight != null ? { "--rt-max-height": `${maxHeight}px` } : {}),
        } as CSSProperties
      }
    >
      {editable && editor && (
        <RichTextToolbar editor={editor} features={resolved} onPickImage={(f) => void insertImage(f)} />
      )}
      <EditorContent editor={editor} />
      {showCounter && editable && (
        <div
          className={cn(
            "border-t px-2.5 py-1 text-right text-[11px] tabular-nums",
            atLimit ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {count}
          {maxLength != null && ` / ${maxLength}`}
          {atLimit && <span className="ml-1.5">已达上限</span>}
        </div>
      )}
    </div>
  )
}

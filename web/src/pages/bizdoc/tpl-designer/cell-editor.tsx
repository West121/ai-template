/**
 * 单元格就地编辑器（用户第五张截图交互）：
 * 点击 infoTable/labelField/docInfo 的值区 → 内联输入框（显示原始 `{{token}}` 文本可直接编辑，
 * 右侧 (x) 清空）；聚焦时旁边浮出「插入变量」面板（表单字段/系统字段/审批数据/计算变量分组，
 * 蓝 chips 平铺，含显示属性变体），点击 chip 在**光标处**插入 `{{...}}`；
 * 失焦/Enter 提交、Esc 取消、点外部关闭；浮层贴单元格下方，近视口底部自动上翻。
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { X } from "lucide-react"
import type { VarGroup } from "./token-vars"

export function CellTokenEditor({
  initial,
  groups,
  fontStyle,
  onCommit,
  onCancel,
}: {
  /** 原始值（含 {{token}} 文本） */
  initial: string
  /** 变量分组（与 field-picker 同源，见 buildVarGroups） */
  groups: VarGroup[]
  /** 跟随单元格字号等 */
  fontStyle?: CSSProperties
  onCommit: (v: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const [flipUp, setFlipUp] = useState(false)
  // chips 点击用 preventDefault 保焦点；真正提交只走 blur/Enter
  const committedRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // 防溢出翻转：浮层默认在下方，接近视口底部时翻到上方
  useLayoutEffect(() => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (rect) setFlipUp(window.innerHeight - rect.bottom < 240)
  }, [])

  const commit = (v: string) => {
    if (committedRef.current) return
    committedRef.current = true
    onCommit(v)
  }

  /** 光标处插入 {{expr}}（保持焦点，光标落到插入内容之后） */
  const insertAtCaret = (expr: string) => {
    const el = inputRef.current
    const token = `{{${expr}}}`
    if (!el) {
      setValue((v) => v + token)
      return
    }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? start
    const next = value.slice(0, start) + token + value.slice(end)
    setValue(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <span ref={wrapRef} className="bd-cell-editor" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <span className="bd-cell-editor-box">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => commit(value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit(value)
            } else if (e.key === "Escape") {
              committedRef.current = true
              onCancel()
            }
          }}
          style={fontStyle}
          placeholder="文本或 {{变量}}"
          className="bd-cell-editor-input"
        />
        {value !== "" && (
          <button
            type="button"
            aria-label="清空"
            title="清空"
            // preventDefault 保持输入框焦点，避免 blur 提交旧值
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setValue("")
              inputRef.current?.focus()
            }}
            className="bd-cell-editor-clear"
          >
            <X className="size-3" />
          </button>
        )}
      </span>

      {/* 插入变量浮层（mousedown preventDefault：点 chip 不触发输入框 blur） */}
      <div className={`bd-var-pop ${flipUp ? "bd-var-pop--up" : ""}`} onMouseDown={(e) => e.preventDefault()}>
        <div className="bd-var-pop-title">插入变量</div>
        <div className="bd-var-pop-body">
          {groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.title} className="bd-var-group">
                <div className="bd-var-group-title">{g.title}</div>
                <div className="bd-var-chips">
                  {g.items.map((it) => (
                    <button key={it.expr} type="button" title={`{{${it.expr}}}`} className="bd-var-chip" onClick={() => insertAtCaret(it.expr)}>
                      {it.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          {groups.every((g) => g.items.length === 0) && <p className="px-1 py-2 text-xs text-muted-foreground">暂无可插入的变量</p>}
        </div>
      </div>
    </span>
  )
}

/**
 * 设计器撤销/重做（§8 裁定：undo ≥20 步单栈，redo 尽力而为）。
 * push 提交新快照（截断 redo）；replace 合并到当前步（连续打字不炸栈）。
 */
import { useCallback, useRef, useState } from "react"

const MAX_STEPS = 20

export interface History<T> {
  state: T
  /** 提交新状态（入栈，可撤销） */
  push: (next: T) => void
  /** 覆盖当前状态（不入栈，用于连续输入合并） */
  replace: (next: T) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** 载入即重置（切模板） */
  reset: (initial: T) => void
}

export function useHistory<T>(initial: T): History<T> {
  const [state, setState] = useState<T>(initial)
  const undoRef = useRef<T[]>([])
  const redoRef = useRef<T[]>([])
  // 渲染触发用（canUndo/canRedo 跟随栈变化）
  const [, bump] = useState(0)

  const push = useCallback(
    (next: T) => {
      setState((cur) => {
        undoRef.current.push(cur)
        if (undoRef.current.length > MAX_STEPS) undoRef.current.shift()
        redoRef.current = []
        return next
      })
      bump((n) => n + 1)
    },
    [],
  )

  const replace = useCallback((next: T) => {
    setState(next)
  }, [])

  const undo = useCallback(() => {
    setState((cur) => {
      const prev = undoRef.current.pop()
      if (prev === undefined) return cur
      redoRef.current.push(cur)
      return prev
    })
    bump((n) => n + 1)
  }, [])

  const redo = useCallback(() => {
    setState((cur) => {
      const next = redoRef.current.pop()
      if (next === undefined) return cur
      undoRef.current.push(cur)
      return next
    })
    bump((n) => n + 1)
  }, [])

  const reset = useCallback((init: T) => {
    undoRef.current = []
    redoRef.current = []
    setState(init)
    bump((n) => n + 1)
  }, [])

  return {
    state,
    push,
    replace,
    undo,
    redo,
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    reset,
  }
}

/**
 * 语音输入（批D 亮点⑥）：Web Speech API 特性检测 + 极简识别会话封装。
 * 不支持的浏览器隐藏麦克风按钮（getSpeechRecognitionCtor → null）；识别失败上层 toast 降级。
 * 纯特性检测部分可在 node 下测（stub globalThis）。
 */

/** 最小可用的 SpeechRecognition 结果类型（避免依赖 lib.dom 里可选的语音类型声明） */
interface MinimalRecognitionResult {
  transcript: string
}
interface MinimalRecognitionEvent {
  results: ArrayLike<ArrayLike<MinimalRecognitionResult>>
}
export interface MinimalSpeechRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: MinimalRecognitionEvent) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => MinimalSpeechRecognition

/** 取浏览器 SpeechRecognition 构造器（标准或 webkit 前缀）；不支持 → null（按钮隐藏） */
export function getSpeechRecognitionCtor(scope: unknown = typeof window !== "undefined" ? window : undefined): RecognitionCtor | null {
  if (!scope || typeof scope !== "object") return null
  const w = scope as Record<string, unknown>
  const ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as RecognitionCtor | undefined
  return typeof ctor === "function" ? ctor : null
}

/** 是否支持语音输入（特性检测） */
export function isSpeechSupported(scope?: unknown): boolean {
  return getSpeechRecognitionCtor(scope) !== null
}

/** 从识别事件里拼出最终文本（拼接所有 result 的首选转写） */
export function transcriptOf(e: MinimalRecognitionEvent): string {
  let out = ""
  const results = e.results
  for (let i = 0; i < results.length; i++) {
    const alt = results[i]?.[0]
    if (alt && typeof alt.transcript === "string") out += alt.transcript
  }
  return out.trim()
}

export interface SpeechSession {
  stop: () => void
}

/**
 * 起一段识别（中文普通话）：onText 回填输入框，onError/onEnd 收尾。
 * 返回可 stop 的句柄；构造/启动异常回 null（上层降级）。
 */
export function startSpeech(handlers: {
  onText: (text: string) => void
  onError?: (msg: string) => void
  onEnd?: () => void
}): SpeechSession | null {
  const Ctor = getSpeechRecognitionCtor()
  if (!Ctor) return null
  let rec: MinimalSpeechRecognition
  try {
    rec = new Ctor()
  } catch {
    return null
  }
  rec.lang = "zh-CN"
  rec.continuous = false
  rec.interimResults = true
  rec.onresult = (e) => {
    const text = transcriptOf(e)
    if (text) handlers.onText(text)
  }
  rec.onerror = (e) => handlers.onError?.(e?.error ?? "语音识别失败")
  rec.onend = () => handlers.onEnd?.()
  try {
    rec.start()
  } catch {
    handlers.onError?.("无法启动麦克风")
    return null
  }
  return {
    stop: () => {
      try {
        rec.stop()
      } catch {
        /* 已结束忽略 */
      }
    },
  }
}

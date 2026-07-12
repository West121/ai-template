# AI 助手 · 「思考中」折叠态规范(丹青)

> 用户实测反馈:助手回复时工具状态**平铺一堆"工具执行完成"绿勾**(查 4 个报表 → 堆 4 行 + 一个
> 打字"..."),啰嗦不优雅。改成 **thinking 折叠态**(像 Claude / ChatGPT 的思考块):进行中单行呼吸态、
> 完成后收成一行可回看、失败标黄。
>
> 现状对照:`web/src/components/ai-chat/chat-view.tsx` 的 `ToolStatusBar`(L180-198)——把
> `toolStatuses: ToolStatusItem[]` **每工具一行**平铺,并与 `TypingIndicator`(L201-214)在
> `sending` 时**同时**渲染(L570-571)。数据结构 `ToolStatusItem = { id, displayName, state:
> "running"|"done"|"failed" }`(`api.ts` L494)。本文替换 `ToolStatusBar` 为 `ThinkingBlock`,
> 对齐 ai-chat 现有视觉(rounded-lg / bg-muted/30 / border-dashed / text-xs / muted / 主色)。
> 只写规范,疾风照做。

---

## 0. 三条裁定(先定口径)

| 议题 | 裁定 | 理由 |
|---|---|---|
| 收起态显什么 | **显当前运行步的 displayName**(如「正在按流程汇总…」),无运行步时才回落「思考中…」 | 比笼统"思考中"有信息量,与 Claude/ChatGPT 一致;用户知道 AI 此刻在干嘛 |
| 完成后 | **收成一行灰字可回看**(`✦ 已完成 · N 步 ▸`),不淡出消失 | 可解释性——用户能追溯 AI 调了哪些工具;绝不残留一堆绿勾 |
| 默认展开? | **默认收起**;失败时头部标黄提示但仍收起(可展开看哪步) | 优雅优先;失败靠颜色引注意,不强行撑开打断阅读 |

**一句话**:一个块从"呼吸的单行(进行中)"平滑变成"灰色一行摘要(完成)",永远只占一行高度,
展开才见步骤明细。

---

## 1. 组件结构 `ThinkingBlock`

新建 `web/src/components/ai-chat/thinking-block.tsx`,**替换** `ToolStatusBar`。

```tsx
import { useState } from "react"
import { ChevronRight, Sparkles, Loader2, Check, X, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ToolStatusItem } from "./api"

export function ThinkingBlock({
  steps,
  phase,                         // "active"(流式中) | "done"(消息落地后)
  defaultOpen = false,
}: {
  steps: ToolStatusItem[]
  phase: "active" | "done"
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const running = steps.find((s) => s.state === "running")
  const failed = steps.some((s) => s.state === "failed")
  const n = steps.length

  // 头部三态文案 + 语义色
  const head =
    phase === "active"
      ? { text: running?.displayName ?? "思考中…", tone: "active" as const }
      : failed
        ? { text: `部分步骤失败 · ${n} 步`, tone: "warn" as const }
        : { text: `已完成 · ${n} 步`, tone: "done" as const }

  // 无步骤且已完成 → 不渲染回看块(纯文本直答,没什么可追溯)
  if (phase === "done" && n === 0) return null

  return (
    <div className="ml-9 w-fit min-w-0 max-w-full">
      {/* 折叠头(整行可点) */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="thinking-steps"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-xs transition-colors",
          head.tone === "active" && "border-primary/30 bg-primary/5 text-primary",
          head.tone === "done" && "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50",
          head.tone === "warn" && "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
        )}
      >
        <Sparkles
          className={cn(
            "size-3.5 shrink-0",
            head.tone === "active" && "animate-pulse text-primary motion-reduce:animate-none",
          )}
        />
        <span className="min-w-0 truncate">{head.text}</span>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      </button>

      {/* 展开体:步骤明细(复用原 ToolStatusBar 的每行视觉) */}
      {open && (
        <ul id="thinking-steps" className="mt-1 flex flex-col gap-1 rounded-lg border bg-muted/20 px-2.5 py-1.5">
          {steps.map((t) => (
            <li key={t.id || t.displayName} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t.state === "running" ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
              ) : t.state === "done" ? (
                <Check className="size-3.5 shrink-0 text-emerald-500" />
              ) : (
                <X className="size-3.5 shrink-0 text-destructive" />
              )}
              <span className="min-w-0 truncate">{t.displayName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

要点:
- **永远一行高度**(收起态);展开体在下方浮出,不改变收起头。
- 收起头**整行可点**(button),右侧 `ChevronRight` 展开时 `rotate-90`(不用上下双箭头,单箭头旋转更轻)。
- `motion-reduce`:呼吸(`animate-pulse`)、转圈(`animate-spin`)、箭头旋转过渡全部降级为静态。
- `ml-9`:沿用现状,与助手头像(`size-7`=28px + `gap-2.5`=10px ≈ 36px = ml-9)对齐,块视觉挂在气泡列左缘。

---

## 2. 状态 → 视觉映射

| 阶段 | 头部文案 | 头部色 | 图标 | 动画 |
|---|---|---|---|---|
| **进行中**(active) | 当前运行步 displayName;无则「思考中…」 | 主色 `border-primary/30 bg-primary/5 text-primary` | `Sparkles` | `animate-pulse` 呼吸(主色) |
| **完成·全成功**(done) | `已完成 · N 步` | 灰 `border-border bg-muted/30 text-muted-foreground` | `Sparkles`(静) | 无 |
| **完成·有失败**(done+failed) | `部分步骤失败 · N 步` | 琥珀 `border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400` | `Sparkles`(静) | 无 |

展开体内**每步**:
| step.state | 图标 | 色 |
|---|---|---|
| running | `Loader2 animate-spin` | 主色 |
| done | `Check` | `text-emerald-500` |
| failed | `X` | `text-destructive` |

> 语义色沿用 ai-chat 现有约定(成功 emerald-500、失败 destructive、警示 amber-600/dark:amber-400、
> 进行主色),暗色两态自动。收起头灰态用 `text-muted-foreground` 与普通时间戳同级,足够"退到背景"。

---

## 3. 展开 / 收起交互

- 默认 **收起**(`open=false`),全阶段一致。
- 点头部任意处切换;`aria-expanded` + `aria-controls="thinking-steps"` 关联展开体;键盘 `Enter/Space`
  原生 button 支持。
- 箭头 `ChevronRight` → 展开 `rotate-90`,`transition-transform`(motion-reduce 去过渡)。
- 展开体用**条件渲染**(不必上 Radix Collapsible;若要高度动画可选用仓库已有 `ui/collapsible`,但
  条件渲染最省、无跳动风险)。
- **失败**默认仍收起,只把头部标黄;如产品希望失败即暴露,可传 `defaultOpen={failed}`——本文默认不自动展开
  (优雅优先),留 prop 备选。

---

## 4. 与消息流的位置关系(替换现状两处渲染)

### 4.1 现状(要改)

`chat-view.tsx` L570-571:
```tsx
{sending && <ToolStatusBar items={toolStatuses} />}
{sending && <TypingIndicator />}
```
→ 平铺 N 行绿勾 + 三点,即用户吐槽的"堆一堆 + ..."。

### 4.2 目标:流式期一个"思考行",完成后并入助手消息

**A. 流式进行中**(`sending`)——替换上面两行为**单一 active 思考块**,不再同时挂三点:

```tsx
{sending && (
  toolStatuses.length > 0
    ? <ThinkingBlock steps={toolStatuses} phase="active" />   /* 有工具:呼吸头即进度指示 */
    : <TypingIndicator />                                     /* 纯思考无工具:保留三点 */
)}
```
- **关键**:有工具时**只**渲染 `ThinkingBlock`(呼吸头承担"正在进行"的动效),**不再叠** `TypingIndicator`——
  消除"思考块 + 独立 ..."的双重噪音。纯思考(还没触发任何工具)才用三点。
- 正文开始流式(`onTextDelta` 进气泡)后,思考块保持 active 单行在气泡上方,正文在下方增量;
  无需再显三点(正文本身在动)。

**B. 完成后**(消息落地)——思考块**并入该条助手消息**,收成灰色一行可回看。
在 `MessageRow` 助手分支的内容列(L157-158 附近),作为 `AssistantMarkdown` **之前**的首个子节点:

```tsx
<div className="flex min-w-0 max-w-[85%] flex-1 flex-col gap-2">
  {message.thinking?.length ? <ThinkingBlock steps={message.thinking} phase="done" /> : null}
  {message.content && <AssistantMarkdown content={message.content} />}
  {/* parts / cards / time … 不变 */}
</div>
```
- 在内容列内时,块本身已在气泡列,`ml-9` 会二次缩进——**done 态放进消息列时去掉 `ml-9`**。
  实现:`ThinkingBlock` 收起头容器的 `ml-9` 改为可控——流式独立渲染(4.2A)时容器套 `ml-9`;
  并入消息列(4.2B)时不套。建议给组件加 `inset?: boolean`(true=独立态套 ml-9,默认 false),
  或外层包裹类由调用方决定(组件内部不写 ml-9,A 处 `<div className="ml-9"><ThinkingBlock/></div>`)。
  **推荐后者**:`ThinkingBlock` 内部不含 `ml-9`,由两处调用方各自决定缩进,组件更纯。

### 4.3 数据落点(需疾风/磐石对齐)

"完成后可回看"要求把**该轮的步骤持久化到助手消息**——现状 `toolStatuses` 是
`assistant.tsx` 的临时 state(L37),`sending` 结束即弃。改造:
- 在 `AiMessage` 上加 `thinking?: ToolStatusItem[]`(或复用 parts 加一个 `reasoning` part);
- 流式 `completed` 时,把本轮累积的 `toolStatuses` 快照写进新落地的助手消息 `thinking`;
- 渲染:流式中读 live `toolStatuses`(4.2A),落地后读 `message.thinking`(4.2B)。
- **无工具的轮次**:`thinking` 为空/缺 → done 态 `ThinkingBlock` 直接不渲染(§1 已处理 `n===0`),
  纯文本直答不留空块。

> 这是唯一的数据结构改动;磐石侧无需变(displayName 已由 `tool.*` 事件给),纯前端把临时态存进消息即可。

---

## 5. a11y / 动效 / 细节

- **动效尊重 `prefers-reduced-motion`**:呼吸 `animate-pulse`、转圈 `animate-spin`、箭头
  `transition-transform` 一律加 `motion-reduce:animate-none` / `motion-reduce:transition-none`
  (§1 代码已含)。减弱动效下:进行中头部为静态主色行(靠文案"正在…"表意),不闪。
- **朗读**:流式 active 头部所在消息流容器已是 `aria-live="polite"`(chat-view L551),当前步文案变化
  会被朗读("正在查询审批数据""正在按流程汇总");完成后头部变"已完成 · N 步"同样朗读一次。
  展开体 `ul` 无需 live(用户主动展开查看)。
- **可点区域**:折叠头 `py-1.5`(高度约 28px)达标;移动端热区足够,无需额外撑高。
- **失败可辨**:琥珀头 + 展开后失败步 `X` destructive——颜色+图标双编码,色弱/灰度模式仍可辨。
- **不撑破面板**:头部 `w-fit max-w-full` + 文案 `min-w-0 truncate`;展开体每行 `truncate`。长
  displayName 截断不换行,与气泡宽度约束一致。
- **收起头灰态**要"退到背景":`text-muted-foreground` + `bg-muted/30`,与时间戳同级视觉重量,
  不与助手正文抢注意。

---

## 6. 落地 checklist(疾风)

**新建 `web/src/components/ai-chat/thinking-block.tsx`**
- [ ] 按 §1 实现 `ThinkingBlock({ steps, phase, defaultOpen? })`;内部**不写 `ml-9`**(缩进交调用方)。
- [ ] 三态头(active 主色呼吸 / done 灰 / warn 琥珀)+ 展开体复用原 ToolStatusBar 行视觉。
- [ ] `phase="done" && steps.length===0` → 返回 null。
- [ ] 全部动效带 `motion-reduce` 降级。

**改 `web/src/components/ai-chat/chat-view.tsx`**
- [ ] 删除 `ToolStatusBar`(L180-198)。
- [ ] L570-571 两行替换为 §4.2A:`sending` 时,有工具 → `<div className="ml-9"><ThinkingBlock steps={toolStatuses} phase="active"/></div>`;无工具 → `<TypingIndicator/>`。**不再同时**渲染两者。
- [ ] `MessageRow` 助手内容列(L157-158)首个子节点插 §4.2B 的 done 态 `ThinkingBlock`(读 `message.thinking`)。
- [ ] `TypingIndicator` 保留(纯思考态与正文流式态用)。

**数据(§4.3,疾风 + 确认磐石无改动)**
- [ ] `AiMessage` 加 `thinking?: ToolStatusItem[]`(`types.ts`)。
- [ ] `assistant.tsx`:流式 `completed` 时把本轮 `toolStatuses` 快照写进落地助手消息的 `thinking`;
      随后清空临时 `toolStatuses`。

**自检**
- [ ] 查 4 个报表:流式期只见**一行**呼吸「正在生成统计数据…」,展开才见 4 步;**不再** 4 行绿勾 + 三点。
- [ ] 完成后该消息上方一行灰字「已完成 · 4 步 ▸」,可展开回看四步(含各自 ✓)。
- [ ] 有一步失败 → 灰字变琥珀「部分步骤失败 · 4 步」,展开见失败步 ✗。
- [ ] 纯文本直答(无工具)→ 无思考块残留,只有正文气泡。
- [ ] 减弱动效开:进行中不闪、箭头不转,功能与朗读不受影响。
- [ ] 暗色两态:三态头与步骤色正常。
```

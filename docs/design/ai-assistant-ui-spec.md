# AI 智能助手 · 对话面板 + 六类卡片 UI/视觉规范（丹青）

> 本文是 `ai-assistant-design.md` §9「丹青先行项」的落地稿。目标:给疾风(前端)一份**可直接照抄的
> 视觉/交互契约**——悬浮入口、对话面板、六类卡片、会话列表、a11y。所有视觉一律走 `web/src/index.css`
> 已声明的主题 token（`--primary`/`--muted`/`--card`/`--border`/`--destructive`/`--chart-1..5`/`--radius`）,
> **暗色两态自动生效**,不引第三方图表/动画库。类名沿用现有 shadcn/ui + Tailwind v4 约定。
>
> 本文只出规范与示意片段,**不落实现代码**。疾风据此在 `web/src/components/ai-chat/` 建组件库。

---

## 0. 设计语言与基调

| 维度 | 决策 | 理由 |
|---|---|---|
| 视觉母体 | 完全复用现有 shadcn token,不引入新配色 | 助手是"系统的一部分",不是独立产品;暗色两态零成本 |
| 圆角 | 气泡/卡片 `rounded-2xl`(=`--radius`+~1.2rem 的观感),控件沿用 `rounded-md`/`rounded-xl` | 对话区比表单区更"软",与业务页拉开层次 |
| 强调色 | `--primary`(蓝)= 助手身份色;`--destructive`= 危险/删除语义;`--chart-1..5`= 图表分类色 | 与全局主题联动,换肤自动跟随 |
| 密度 | 对话区**比业务表格宽松**:气泡 `px-3.5 py-2.5`、消息间距 `space-y-4` | 阅读型场景,留白优先 |
| 动效 | 复用 `tw-animate-css`(已 `@import`);全部尊重 `prefers-reduced-motion` | 与 Sheet/Drawer 现有动画一致 |
| 文案 | 全中文硬编码(无 i18n),与全站一致 | 项目约定 |

**关键字体/排版**:气泡内 markdown 直接复用 `rich-text.css` 的 `.rt-content` prose 尺度
(`font-size: .875rem; line-height: 1.75`),避免另造一套。见 §2.2。

### 0.1 z-index 分层(务必遵守,避免与现有浮层打架)

现状:Sonner toast 挂 `top-center`(sonner 内部 `z-index` 极高);Sheet/Dialog/Drawer overlay=`z-50`。
助手浮层排布:

| 层 | 元素 | z-index |
|---|---|---|
| 页面内容 | 业务页 | 0 ~ 10 |
| **悬浮球 FAB** | 常驻入口 | `z-40`(在业务页之上,在模态浮层之下) |
| **对话面板(桌面,非模态)** | 抽屉本体 | `z-40`(与 FAB 同层,面板打开时 FAB 让位/变形) |
| **对话面板(移动,模态)** | 抽屉 + scrim | `z-50` |
| 卡片内二级弹层 | 表单卡里的 OrgPicker/日期等 | 走各自组件 `z-50`,Portal 到 body,天然盖过面板 |
| Toast | 全站提示 | 最高(sonner 默认) |

> 决策:桌面用 **非模态** 抽屉(无遮罩、不锁定 body),这样卡片里的「打开」按钮 `navigate(path)` 后
> 页面在助手右侧照常切换,面板保持打开;移动端才用模态 + scrim 全屏。详见 §1.2。

---

## 1. 全局入口

### 1.1 悬浮球 FAB

**挂载点**:`AppLayout`(`web/src/components/layout/app-layout.tsx`)根 `<div>` 末尾,登录后可见;
路由无关(所有页共用一枚)。offline 模式仍渲染,点击后面板内提示"助手需要后端"(§1.4)。

**形态/尺寸/位置**

```
- 尺寸:size-14(56×56)圆形,rounded-full
- 位置:fixed bottom-6 right-6(24px 边距)
        移动端:right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))](避让手势条)
- 层级:z-40
- 背景:bg-primary,图标 text-primary-foreground(Sparkles / Bot,size-6)
- 阴影:shadow-lg;hover:shadow-xl + scale-105;active:scale-95(过渡 transition-transform duration-150)
- 焦点:focus-visible:ring-[3px] ring-ring/50(沿用 button 规范)
- 未读提示:右上角 size-2.5 rounded-full bg-destructive ring-2 ring-background(仅红点,不显数字)
```

```tsx
<button
  type="button"
  aria-label="打开星辰助手"
  aria-haspopup="dialog"
  aria-expanded={open}
  className="fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center
             rounded-full bg-primary text-primary-foreground shadow-lg outline-none
             transition-transform duration-150 hover:scale-105 hover:shadow-xl active:scale-95
             focus-visible:ring-[3px] focus-visible:ring-ring/50
             motion-reduce:transition-none motion-reduce:hover:scale-100"
>
  <Sparkles className="size-6" />
  {hasUnread && (
    <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-destructive ring-2 ring-background" />
  )}
</button>
```

**展开动画**:点击 → 面板从右侧滑入(`slide-in-from-right` + `fade-in`,duration-300,ease
`cubic-bezier(0.4,0,0.2,1)`,与 `drawer.tsx` 一致)。桌面:FAB 原地把图标 crossfade 成 `X`/`ChevronsRight`
充当"收起"键(也可点面板头部关闭);移动:面板全屏时 FAB 隐藏(`opacity-0 pointer-events-none`)。
`prefers-reduced-motion` 时改为无位移的 opacity 淡入。

### 1.2 对话面板(侧边抽屉)

**结构**:自上而下三段栅格 `grid grid-rows-[auto_1fr_auto] h-full`——头部 / 消息流 / 输入区。

**尺寸与响应式**

```
- 桌面(≥640px):非模态右侧抽屉,固定 inset-y-0 right-0,宽 w-[420px]
    · 无遮罩、不锁 body → 页面仍可点击/滚动(navigate 卡才有意义)
    · 边框 border-l,bg-background,shadow-2xl
    · 可选:复用 drawer.tsx 的内缘拖拽改宽(min 380 / max 560),MVP 可先固定 420
- 移动(<640px):模态全屏,inset-0 w-full h-full + 背后 scrim(bg-black/50, z-50)
    · 点 scrim 或返回手势关闭
```

> 实现建议:桌面用 Radix `Dialog modal={false}`(去遮罩、去 pointer-events 锁),或直接 bespoke
> `fixed` 面板 + `data-[state]` 动画类;移动用 `modal` 全屏 Sheet。**不要**用默认 Sheet(它带遮罩、
> 会锁页面,与 navigate 卡冲突)。

**头部** `h-14 shrink-0 border-b px-3`:

```tsx
<header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
  {/* 助手身份小头像(会话列表视图时替换为返回箭头) */}
  <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
    <Sparkles className="size-4.5" />
  </div>
  <div className="min-w-0 flex-1">
    <p className="truncate text-sm font-semibold leading-tight">{sessionTitle ?? "星辰助手"}</p>
    <p className="truncate text-[11px] text-muted-foreground">AI 生成内容仅供参考</p>
  </div>
  {/* 右侧动作:新会话 / 会话列表 / 关闭,统一 ghost icon-sm */}
  <Button variant="ghost" size="icon-sm" aria-label="新会话"><SquarePen className="size-4" /></Button>
  <Button variant="ghost" size="icon-sm" aria-label="会话列表"><History className="size-4" /></Button>
  <Button variant="ghost" size="icon-sm" aria-label="关闭助手"><X className="size-4" /></Button>
</header>
```

**消息流** `flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4`:
- 新消息到达/发送后自动滚到底(`scrollIntoView` 或 `scrollTop=scrollHeight`);用户手动上滚时暂停自动
  跟随,新消息时右下角出现「回到底部 ↓」小圆钮(`bg-card border shadow-sm`)。
- 顶部可放**会话首屏欢迎态**(空会话):助手头像 + 一句问候 + 3~4 个 §3.6 link chips 作快捷起手式
  ("查我的待办""本月审批统计""我要请假")。

**输入区** `shrink-0 border-t p-3`:

```tsx
<div className="shrink-0 border-t p-3">
  <div className="flex items-end gap-2 rounded-xl border bg-background px-3 py-2
                  focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:border-ring">
    <textarea
      rows={1}
      placeholder="问问星辰助手…(Enter 发送 / Shift+Enter 换行)"
      className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-sm outline-none
                 placeholder:text-muted-foreground"
      // 自适应高度:1~5 行,超出内部滚动;发送中 disabled
    />
    <Button size="icon-sm" disabled={!value.trim() || sending} aria-label="发送">
      {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
    </Button>
  </div>
</div>
```

交互:
- **Enter 发送**;**Shift+Enter 换行**;**发送中禁用**输入与发送键(占位/送出后立即 append 用户气泡 +
  助手 loading 气泡)。
- 空串/纯空白不可发送(发送键 `disabled:opacity-50`)。
- 输入超 1 行时 textarea 自增高,`max-h-32`(≈5 行)后内部滚动。
- (P1)发送键在流式期间切换为「停止 ■」。

### 1.3 空态 / 首屏

```tsx
<div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
  <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
    <Sparkles className="size-6" />
  </div>
  <p className="text-sm font-medium">我是星辰助手</p>
  <p className="max-w-[15rem] text-xs text-muted-foreground">
    可以帮你查待办、发起审批、看报表。试试下面这些:
  </p>
  {/* §3.6 link chips */}
</div>
```

### 1.4 offline 降级

FAB 正常显示;打开后消息流位置显示一条**系统提示条**(非气泡):

```tsx
<div className="mx-auto flex max-w-[18rem] items-center gap-2 rounded-lg border border-dashed
                bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
  <CloudOff className="size-4 shrink-0" />
  智能助手需要连接后端服务,当前处于离线演示模式,暂不可用。
</div>
```
输入区禁用(placeholder 改"离线模式暂不可用")。

---

## 2. 消息气泡

### 2.1 布局:两侧对齐 + 角色标识

- **用户**:右对齐。气泡 `bg-primary text-primary-foreground`,`rounded-2xl rounded-br-md`(右下收角
  作"指向"),`max-w-[85%]`,`px-3.5 py-2.5 text-sm`。无头像(右侧留白即可),或右侧 `size-7` 用户首字头像。
- **助手**:左对齐。左侧 `size-7` 圆形头像(`bg-primary/10 text-primary` + Sparkles)。内容列
  `max-w-[85%]`:纯文本/markdown 走浅底气泡 `bg-muted text-foreground rounded-2xl rounded-bl-md
  px-3.5 py-2.5`;**卡片不进气泡**,在文本气泡下方以独立 `AiCard` 平铺(占满内容列宽,给表格/图表空间)。

```tsx
{/* 助手一条消息 = 头像 + 内容列(文本气泡 + 若干卡片) */}
<div className="flex gap-2.5">
  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
    <Sparkles className="size-4" />
  </div>
  <div className="flex min-w-0 max-w-[85%] flex-col gap-2">
    {content && (
      <div className="ai-md w-fit rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5">
        {/* markdown 渲染,见 2.2 */}
      </div>
    )}
    {cards?.map((c) => <AiCard key={c.id} card={c} />)}
    <time className="px-1 text-[11px] text-muted-foreground">{formatTime(createdAt)}</time>
  </div>
</div>

{/* 用户一条消息 */}
<div className="flex justify-end">
  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
    {text}
  </div>
</div>
```

**关键约束**:内容列与气泡都要 `min-w-0`,否则长英文/URL/表格会把面板撑出横向滚动。

### 2.2 气泡内 markdown 排版(`.ai-md`)

助手 `content` 是 markdown。渲染路径二选一(§6 契约留了口子):
1. 轻量 md → HTML,再经 `sanitizeHtml`(`web/src/lib/sanitize.ts`),用 `RichTextViewer` 同款出口;
2. 直接复用 `.rt-content` 的 prose 语义。

无论哪种,**在气泡内加 `.ai-md` 作用域**,在 `rich-text.css` 尺度上做三处收敛(防撑破气泡):

```css
/* 与 .rt-content 同源,仅收敛对话气泡内的极端内容 */
.ai-md { font-size: .875rem; line-height: 1.7; word-break: break-word; }
.ai-md > :first-child { margin-top: 0; }
.ai-md > :last-child  { margin-bottom: 0; }

/* 标题:气泡内降一档,避免喧宾夺主 */
.ai-md h1, .ai-md h2 { font-size: 1rem;  font-weight: 600; margin: .5em 0 .25em; }
.ai-md h3           { font-size: .9375rem; font-weight: 600; margin: .5em 0 .25em; }

/* 列表 */
.ai-md ul { list-style: disc; padding-left: 1.25rem; margin: .25rem 0; }
.ai-md ol { list-style: decimal; padding-left: 1.25rem; margin: .25rem 0; }

/* 行内代码 / 代码块:代码块横向滚动,不撑破气泡 */
.ai-md code { background: var(--muted); border-radius: .25rem; padding: .1em .35em;
              font-family: ui-monospace, monospace; font-size: .8em; }
.ai-md pre  { background: var(--muted); border: 1px solid var(--border); border-radius: .5rem;
              padding: .625rem .75rem; margin: .375rem 0; overflow-x: auto; }
.ai-md pre code { background: transparent; padding: 0; }

/* 表格:限高 + 双向滚动,包在自身容器里 */
.ai-md .md-table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid var(--border);
                        border-radius: .5rem; margin: .375rem 0; }
.ai-md table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: .8125rem; }
.ai-md th, .ai-md td { border: 1px solid var(--border); padding: .3rem .5rem; text-align: left;
                       vertical-align: top; white-space: nowrap; }
.ai-md th { background: var(--muted); font-weight: 600; }

/* 链接:用户气泡内(蓝底)需反白;助手气泡内走 primary */
.ai-md a { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
```
> 用户气泡是 `bg-primary`,若用户消息也可能含链接,用户侧不要套 `.ai-md`(用户输入按纯文本渲染即可,
> 避免注入 + 反白问题)。markdown 渲染**只用于助手消息**。

### 2.3 时间戳

- 默认每条消息底部一行 `text-[11px] text-muted-foreground`(见 2.1)。
- 同一分钟内的连续消息可合并只显一次(可选优化);跨天插入居中日期分隔:
  `<div className="my-2 text-center text-[11px] text-muted-foreground">今天 / 7月11日</div>`。

### 2.4 Loading 打字指示(三点动画)

助手响应期间,内容列放一枚"打字气泡"(同助手气泡外形):

```tsx
<div className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-3.5 py-3">
  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
</div>
```
- 用 Tailwind 内建 `animate-bounce` + 负 `animation-delay` 错峰;`motion-reduce:animate-none`(改为静态三点)。
- 无障碍:该气泡容器加 `aria-label="助手正在输入"`,消息流根容器 `aria-live="polite"`,响应到达时朗读。

### 2.5 错误消息态(重试)

请求失败(网络/超时/后端 5xx)时,把 loading 气泡替换为错误条:

```tsx
<div className="flex w-fit max-w-[85%] flex-col gap-2 rounded-2xl rounded-bl-md border border-destructive/40
                bg-destructive/5 px-3.5 py-2.5">
  <div className="flex items-center gap-2 text-sm text-destructive">
    <AlertTriangle className="size-4 shrink-0" />
    <span>回复失败,请稍后重试</span>
  </div>
  <Button variant="outline" size="sm" className="h-7 w-fit gap-1.5 text-xs">
    <RotateCw className="size-3.5" /> 重试
  </Button>
</div>
```
- 「重试」重发上一条用户消息(不新增用户气泡)。
- 权限类失败(工具返回 403)**不是错误态**:后端会把它包成正常 `ASSISTANT` 文案("你没有 xx 权限…"),
  按普通气泡渲染即可(契约 §6)。

---

## 3. 六类卡片

### 3.0 卡片通用外壳 `AiCard`

所有卡片共用一层壳,保证在助手内容列里成组时节奏统一:

```
外壳:rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden
      (bg-card 比气泡的 bg-muted 略"亮/实",让卡片从对话流里浮起)
头部:px-3.5 pt-3(可选,含类型图标 + 标题)
主体:px-3.5 pb-3
按钮:主操作 size-sm(h-8)或 default(h-9);移动端点击热区≥44px(见 §5)
宽度:w-full min-w-0(占满内容列,绝不横向撑破)
```

类型图标建议(lucide,`size-4 text-muted-foreground`):
navigate→`Compass` / confirm→`ShieldCheck`(危险 `AlertTriangle`) / form→`FileText` /
list→`ListChecks` / chart→`BarChart3` / link→`LayoutGrid`。

下述每类给出:骨架 + 类名 + 暗色说明。暗色**无需额外类**——全部走 token,`.dark` 下自动翻转;
仅在语义色(危险红、图表色)处补一句注意。

---

### 3.1 navigate —— 打开功能

载荷 `{path, title, desc?}`。行为:「打开」→ `navigate(path)`(路径已由后端校验在可见菜单内)。

```tsx
<div className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
    <Compass className="size-4.5" />
  </div>
  <div className="min-w-0 flex-1">
    <p className="truncate text-sm font-medium">{title}</p>
    {desc && <p className="truncate text-xs text-muted-foreground">{desc}</p>}
  </div>
  <Button size="sm" className="h-8 shrink-0 gap-1" onClick={() => navigate(path)}>
    打开 <ArrowRight className="size-3.5" />
  </Button>
</div>
```
- 暗色:`bg-primary/10` 在暗底下仍是柔和高光,OK。
- 整卡可点(`role="button"` + hover `bg-accent/40`)作为可选增强,但「打开」按钮是主 CTA。

---

### 3.2 confirm —— 二段式确认(变更类)

载荷 `{actionId, title, summary, params}`。行为:「确认」→ `POST /api/ai/confirm {actionId}`。
`危险操作`(删除/驳回等)用**红色语义**:左描边 + `AlertTriangle` + `destructive` 确认键。

```tsx
<div className={cn(
  "rounded-xl border bg-card p-3.5 shadow-sm",
  danger && "border-destructive/40 border-l-4 border-l-destructive"
)}>
  <div className="mb-2 flex items-center gap-2">
    {danger
      ? <AlertTriangle className="size-4 text-destructive" />
      : <ShieldCheck className="size-4 text-primary" />}
    <p className="text-sm font-semibold">{title}</p>
  </div>
  {summary && <p className="mb-3 text-xs text-muted-foreground">{summary}</p>}

  {/* 参数摘要:定义列表,label 灰 / value 常规 */}
  <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-lg bg-muted/50 p-2.5 text-xs">
    {params.map((p) => (
      <Fragment key={p.label}>
        <dt className="text-muted-foreground">{p.label}</dt>
        <dd className="min-w-0 break-words font-medium">{p.value}</dd>
      </Fragment>
    ))}
  </dl>

  <div className="flex justify-end gap-2">
    <Button variant="outline" size="sm" className="h-8" onClick={onCancel}>取消</Button>
    <Button
      variant={danger ? "destructive" : "default"}
      size="sm" className="h-8" disabled={state !== "idle"} onClick={onConfirm}>
      {state === "submitting" ? "执行中…" : "确认"}
    </Button>
  </div>
</div>
```

**状态机**(卡片本地状态,后端 actionId 10min 过期):
| state | 呈现 |
|---|---|
| `idle` | 双按钮可用 |
| `submitting` | 确认键"执行中…"+disabled,取消键 disabled |
| `done` | 按钮区整体替换为成功条:`<div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4"/> 已执行</div>`,并可带结果链接 |
| `cancelled` | 按钮区替换为 `text-muted-foreground text-xs`「已取消」 |
| `expired` | 双按钮 disabled + 底部 `text-xs text-muted-foreground`「此操作已过期,请重新发起」 |

- 暗色语义色:成功用 `text-emerald-600 dark:text-emerald-400`(emerald 在两态都够对比;不要用裸 `green-500`)。
  危险红全程走 `--destructive` token,暗色自动加深。

---

### 3.3 form —— 内嵌表单卡(在线表单)/ 跳转(CODE 表单)

载荷 `{defCode, defName, formType, schema?, submitPath?}`。两条分支:

**A. 在线表单(有 `schema` widgets)**:卡内嵌 `FormRenderer`,提交起流程。

```tsx
<div className="rounded-xl border bg-card shadow-sm">
  <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
    <FileText className="size-4 text-primary" />
    <p className="text-sm font-semibold">{defName}</p>
  </div>
  <div className="ai-form px-3.5 py-3">
    <FormRenderer
      widgets={schema}
      submitLabel="提交并发起"
      submitting={submitting}
      onSubmit={handleSubmit}   /* 前端直调 /api/wf/instances,不经 LLM(契约 §3) */
    />
  </div>
</div>
```

- **窄容器适配**:`FormRenderer` 默认 2 列栅格(`grid-cols-2`)。420px 面板里必须压成 1 列——
  用容器查询覆盖:面板内容区已是 `@container`(参考 drawer.tsx),给表单外层加作用域类:
  ```css
  /* 面板宽度不足时,把 FormRenderer 的两列强制成一列 */
  .ai-form :where(.grid.grid-cols-2) { grid-template-columns: minmax(0,1fr); }
  ```
  (疾风若不便改 FormRenderer,可用此 CSS 覆盖;子表单内部表格保持 `overflow-x-auto` 横滚。)
- 表单卡最好可折叠:标题栏右侧放 `ChevronDown` 折叠键,长表单默认展开,提交后折叠成结果条。

**提交后成功态**(替换表单主体):
```tsx
<div className="flex flex-col items-start gap-2 px-3.5 py-4">
  <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
    <CheckCircle2 className="size-4" /> 已发起「{defName}」
  </div>
  <Button variant="outline" size="sm" className="h-8 gap-1"
          onClick={() => navigate(`/workflow/instances/${instId}`)}>
    查看实例 <ExternalLink className="size-3.5" />
  </Button>
</div>
```

**B. CODE 表单(无 schema,`submitPath` 为发起页路由)**:不内嵌,只给跳转 CTA。

```tsx
<div className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
  <FileText className="size-4.5 shrink-0 text-primary" />
  <div className="min-w-0 flex-1">
    <p className="truncate text-sm font-medium">{defName}</p>
    <p className="text-xs text-muted-foreground">该表单需在发起页填写</p>
  </div>
  <Button size="sm" className="h-8 gap-1" onClick={() => navigate(submitPath)}>
    去填写 <ArrowRight className="size-3.5" />
  </Button>
</div>
```

---

### 3.4 list —— 结构化列表(待办/公文等)

载荷 `{title, columns:[{key,label}], rows, moreLink?}`。行可带 `link`(点击 `navigate`)。

**布局决策**:面板窄,**默认用"堆叠行"**(首列做主标题+链接,其余列做 `label:value` 次级信息),
比塞一张多列表格更耐窄。列很少(≤2)且短时可退化为紧凑表格(横滚兜底)。

```tsx
<div className="rounded-xl border bg-card shadow-sm">
  <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
    <ListChecks className="size-4 text-primary" />
    <p className="text-sm font-semibold">{title}</p>
    <span className="ml-auto text-xs text-muted-foreground">{rows.length} 项</span>
  </div>

  <ul className="divide-y">
    {rows.map((row) => (
      <li key={row.id}>
        <button
          type="button"
          disabled={!row.link}
          onClick={() => row.link && navigate(row.link)}
          className="flex w-full items-start gap-2 px-3.5 py-2.5 text-left
                     enabled:hover:bg-accent/50 disabled:cursor-default">
          <div className="min-w-0 flex-1">
            {/* 主列:首个 column,链接语义用 primary */}
            <p className={cn("truncate text-sm", row.link ? "font-medium text-primary" : "font-medium")}>
              {row[columns[0].key]}
            </p>
            {/* 次级列:label:value,逗号分隔或换行 */}
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {columns.slice(1).map((c) => `${c.label} ${row[c.key]}`).join(" · ")}
            </p>
          </div>
          {row.link && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        </button>
      </li>
    ))}
  </ul>

  {rows.length === 0 && (
    <div className="px-3.5 py-6 text-center text-xs text-muted-foreground">暂无数据</div>
  )}
  {moreLink && (
    <button onClick={() => navigate(moreLink)}
            className="flex w-full items-center justify-center gap-1 border-t px-3.5 py-2
                       text-xs text-primary hover:bg-accent/50">
      查看全部 <ArrowRight className="size-3.5" />
    </button>
  )}
</div>
```
- 紧凑表格退化款:外层 `<div className="overflow-x-auto">` 包 `<table className="w-max min-w-full text-xs">`,
  `th` `bg-muted`,与 `.ai-md` 表格同规格,横滚兜底。
- 暗色:`hover:bg-accent/50`、`divide-y`(=`--border`)自动适配。

---

### 3.5 chart —— 轻量 SVG 图表(bar | line | pie),不引重库

载荷 `{chartType, title, categories?, series:[{name,data}]}`。丹青出**视觉规范**,疾风按此手写 SVG。

#### 3.5.1 通用视觉 token

```
- 画布:响应式,外层 w-full,SVG viewBox 固定逻辑坐标(如 320×180)+ preserveAspectRatio="xMidYMid meet"
        (用 viewBox 让图随面板宽缩放,坐标算术用逻辑单位)
- 高度:图区 h-44(176px)左右;含图例时整卡更高
- 分类色:严格用 --chart-1 … --chart-5 循环(i => var(--chart-{(i%5)+1}))。这 5 色已在
        index.css 为亮/暗两态各自定义,天然可辨、暗色不刺眼。禁止硬编码十六进制。
- 坐标轴 / 网格:stroke var(--border);轴刻度文字 fill var(--muted-foreground),font-size 10(逻辑单位)
- 数据标签 / tooltip:MVP 用原生 <title> 悬浮显值(零依赖);hover 高亮该系列/扇区(opacity 或描边)
- 圆角:柱顶 rx≈2~3;线端 stroke-linecap round
- 空态:series 空或全 0 → 不画轴,居中 "暂无数据"(text-xs text-muted-foreground)
- a11y:SVG role="img" aria-label="{title},{类型}图";颜色不作唯一编码 → 必配图例文字/直接标签
```

卡片外壳:
```tsx
<div className="rounded-xl border bg-card p-3.5 shadow-sm">
  <div className="mb-2 flex items-center gap-2">
    <BarChart3 className="size-4 text-primary" />
    <p className="text-sm font-semibold">{title}</p>
  </div>
  {isEmpty
    ? <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">暂无数据</div>
    : <ChartSvg .../> }
  <Legend series={series} />   {/* 见 3.5.5 */}
</div>
```

#### 3.5.2 Bar(柱状 / 分组柱)

```
- 纵向柱;单系列=等宽柱,多系列=同类目下分组并排(每组内 gap≈2,组间 gap≈类目宽的 25%)
- 基线 y=0 一条 border 轴;顶部留 8~12% headroom 给最大值
- y 轴 2~3 条浅网格线(stroke var(--border), stroke-dasharray 可选 "2 3")+ 左侧刻度值
- x 轴类目标签:底部一行,过长则截断 + <title> 全称;类目多(>6)时可 45° 旋转或隔项显示
- 柱色:单系列可统一 chart-1,或按类目循环 chart-1..5(枚举型数据更醒目);多系列按系列取色
- 柱顶 rx=2;hover 该柱 opacity-80 + <title>显值
```
布局要点:`x = padL + i*bandW`,`barW = bandW*0.6/seriesCount`;`y = padT + (1 - v/max)*plotH`,
`height = v/max*plotH`。左内边距 `padL≈28` 容纳刻度,底 `padB≈22` 容纳类目。

#### 3.5.3 Line(折线 / 面积)

```
- <polyline> 折线,stroke var(--chart-n) stroke-width 2 fill none;多系列多条线
- 单/主系列可加面积:<path> 闭合到基线,fill var(--chart-1) 透明度低
        (fill-opacity .12,或 linear-gradient defs:顶 .18 → 底 0)
- 数据点:每点 <circle r=2.5> 同色实心;hover 放大 r=4 + <title>
- 轴/网格同 bar;x 轴按 categories 均匀布点
- 折点 stroke-linejoin round
```

#### 3.5.4 Pie / Donut(推荐 Donut)

```
- 优先 环形(donut):外半径 R,内半径 ≈0.62R,中心留白可放"合计/总数"
- 画法(零依赖、可读性好):用单个 <circle> + stroke + stroke-dasharray 叠加多段更简单:
    · 每段 dash 长度 = 周长 * 占比,dashoffset 累加;stroke-width = R-r;各段 stroke=chart-n
    · 或用 <path> 极坐标弧线(A 命令)——需 polarToCartesian 辅助函数
- 扇区色:按数据项循环 chart-1..5(pie 多是"占比构成",项即系列)
- 段间 1~2px 描边间隙(stroke var(--card) 细线)让扇区分明
- 中心文案:<text> 合计值(text-sm font-semibold)+ 下方标签(text-[10px] muted)
- 图例必配(见 3.5.5):扇区颜色 + 名称 + 百分比
- hover 扇区:略微外扩/加亮(transform scale 1.03 或 opacity 提升)
```
> donut 比实心 pie 更省"标注空间"(中心可写合计),且窄面板里图例竖排更协调 → 定为默认。

#### 3.5.5 图例 Legend(三类图通用)

```tsx
<ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
  {series.map((s, i) => (
    <li key={s.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-2.5 rounded-[3px]" style={{ background: `var(--chart-${(i % 5) + 1})` }} />
      <span className="text-foreground">{s.name}</span>
      {percent != null && <span>{percent}%</span>}
    </li>
  ))}
</ul>
```
- 色块 `size-2.5 rounded-[3px]`(方形微圆角,区别于 link 的圆 chip)。
- 图例项可点(hover/点选 → 高亮/切换对应系列,P1);MVP 只做展示。
- **无障碍关键**:颜色不是唯一信息来源——图例文字、pie 中心合计、hover `<title>` 三者兜底,
  色弱/灰度模式(全站有 `grayscale-mode`/`color-weak-mode`)下仍可读。

---

### 3.6 link —— 快捷入口 chips

载荷 `{items:[{title, path}]}`。行为:点击 `navigate(path)`。用于"相关功能/推荐动作"。

```tsx
<div className="flex flex-wrap gap-2">
  {items.map((it) => (
    <button key={it.path} onClick={() => navigate(it.path)}
      className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5
                 text-xs font-medium text-foreground shadow-sm
                 transition-colors hover:border-primary/40 hover:bg-accent
                 focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <ArrowUpRight className="size-3.5 text-muted-foreground" />
      {it.title}
    </button>
  ))}
</div>
```
- 圆角 pill(`rounded-full`),区别于 navigate 卡的"重"外壳——chips 是"轻量并列多入口"。
- 也用于**首屏欢迎态**的起手式建议(§1.3)。
- 暗色:`bg-card` + `border` + `hover:bg-accent` 全 token,自动适配。

---

## 4. 会话列表

**形态决策**:**面板内视图切换**(不另开抽屉)。点头部「会话列表」图标 → 消息区整体被列表视图覆盖
(同一抽屉内 `slide-in-from-left`),头部左侧 Sparkles 头像换成 `←` 返回键、标题变"会话历史"。
移动端同理(全屏内切换,省一层堆叠)。

```tsx
<div className="flex h-full flex-col">
  {/* 复用同一头部,左侧为返回、右侧为「新会话」 */}
  <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
    <Button variant="ghost" size="icon-sm" aria-label="返回对话"><ArrowLeft className="size-4" /></Button>
    <p className="flex-1 text-sm font-semibold">会话历史</p>
    <Button variant="ghost" size="icon-sm" aria-label="新会话"><SquarePen className="size-4" /></Button>
  </header>

  <div className="min-h-0 flex-1 overflow-y-auto p-2">
    <ul className="space-y-0.5">
      {sessions.map((s) => (
        <li key={s.id}>
          <div className={cn(
            "group flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-accent",
            s.id === activeId && "bg-accent")}>
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
            <button onClick={() => openSession(s.id)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium">{s.title}</p>
              <p className="truncate text-[11px] text-muted-foreground">{relativeTime(s.updatedAt)}</p>
            </button>
            {/* 删除:hover 显形,二次确认走 AlertDialog */}
            <button aria-label="删除会话"
              className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity
                         hover:text-destructive group-hover:opacity-100
                         focus-visible:opacity-100">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  </div>
</div>
```

- **项**:图标 + 标题(首问摘要,`truncate`)+ 相对时间(`刚刚 / 3分钟前 / 昨天 / 7月8日`);
  当前会话 `bg-accent` 高亮。
- **删除**:hover/focus 显 `Trash2`(`hover:text-destructive`);点击弹 `AlertDialog`(项目已有
  `ui/alert-dialog.tsx`)二次确认"删除后不可恢复"。移动端无 hover → 删除键常显(靠右 `text-muted-foreground`)。
- **时间分组**(可选优化):按 `今天 / 昨天 / 更早` 插 `text-[11px] text-muted-foreground px-2.5 py-1` 小节标题;
  契约近 30 天。
- **空态**:
  ```tsx
  <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
    <MessagesSquare className="size-8 text-muted-foreground/40" />
    <p className="text-sm text-muted-foreground">还没有会话</p>
    <Button size="sm" className="h-8" onClick={newSession}>开始新对话</Button>
  </div>
  ```

---

## 5. a11y 与关键细节

### 5.1 焦点管理
- **打开面板**:动画结束后(~300ms)`inputRef.focus()`,把光标落到输入框。
- **关闭面板**:焦点归还触发它的 FAB(`fabRef.focus()`),避免焦点丢到 body。
- 面板根:`role="dialog"` `aria-label="星辰智能助手"` `aria-modal={isMobile}`(桌面非模态=false,
  不抢占页面可达性;移动模态=true + focus trap)。
- 会话列表↔对话视图切换:切到列表时焦点落到列表首项或返回键;切回时回到输入框。
- 卡片操作完成(confirm 执行、form 提交)后,把焦点/朗读引到结果条,`aria-live="polite"` 播报结果。

### 5.2 键盘操作
| 键 | 作用 |
|---|---|
| `Enter`(输入框) | 发送 |
| `Shift+Enter` | 换行 |
| `Esc` | 关闭面板(输入框有内容时可先要求二次 Esc,或直接关——MVP 直接关) |
| `Tab / Shift+Tab` | 面板内可聚焦元素顺序:输入框 → 发送 → 头部动作 → 消息内交互(卡片按钮/链接) |
| `↑/↓`(会话列表) | 移动选中项;`Enter` 打开;`Delete` 触发删除确认(可选) |
| (P1)`⌘/Ctrl+K` | 全局唤起助手(与现有 GlobalSearch 协调,避免冲突) |

- 消息流里所有可点元素(navigate/list 行/link chips/卡片按钮)都是原生 `<button>`/`<a>`,天然可 Tab 可回车。

### 5.3 触控与按钮尺寸
- 卡片主操作按钮最小 `h-8`(32px);**移动端点击热区≥44×44px**——给小图标钮用 padding 撑热区
  (如 `p-2.5` 使 `size-4` 图标达到 ~40px+,或外层 `min-h-11`),视觉不必变大。
- FAB 56px 本身达标;会话删除键在移动端加大热区(`p-2`)。
- 焦点态一律 `focus-visible:ring-[3px] ring-ring/50`(全站规范),不要只靠 hover。

### 5.4 长内容滚动约束(防撑破)
- 消息流是唯一纵向滚动容器(`overflow-y-auto`);面板本身不横向滚动。
- **每一处宽内容都在自己的容器里横滚**,绝不外溢到面板:
  - markdown 表格 → `.md-table-wrap { overflow-x:auto }`(§2.2);
  - markdown 代码块 → `pre { overflow-x:auto }`;
  - list 卡表格退化款 → 外层 `overflow-x-auto`;
  - form 卡子表单 → `FormRenderer` 内已有 `overflow-x-auto`;
  - chart → SVG 用 viewBox 自适应缩放,不产生横滚。
- 所有 flex 子项(内容列、气泡、卡片)加 `min-w-0`;文本 `break-words`/`truncate` 按需;URL 用 `break-all`。
- 卡片最大宽 = 助手内容列宽(`max-w-[85%]` 的父);图表/表格再宽也在卡内滚,不改变卡片外廓。

### 5.5 动效与偏好
- 全部过渡尊重 `prefers-reduced-motion`:FAB 悬停缩放、打字三点、面板滑入 → `motion-reduce` 降级为
  无位移淡入/静态。
- 全站有 `grayscale-mode`/`color-weak-mode` 滤镜:图表已靠图例文字/标签兜底,灰度下不失信息。

### 5.6 暗色两态自检清单(交付前逐项过)
- [ ] 用户气泡 `bg-primary` 文字对比够(`text-primary-foreground`)。
- [ ] 助手气泡 `bg-muted` 与卡片 `bg-card` 在暗色下有可辨层次(muted 略暗于 card)。
- [ ] 成功色用 `emerald-600/dark:emerald-400`,危险色走 `--destructive`,不用裸 `green/red-500`。
- [ ] 图表 5 色在 `.dark` 下取的是暗色版 `--chart-*`(index.css 已分别定义),不刺眼。
- [ ] 边框/分隔 `border`/`divide-y` 用 token,暗色为半透明白(已定义)。
- [ ] FAB 红点 `ring-background` 在两态都与背景分离。

---

## 6. 组件落地清单(交给疾风)

建议目录 `web/src/components/ai-chat/`:

```
ai-chat/
  assistant-fab.tsx          §1.1 悬浮球(挂 AppLayout)
  chat-panel.tsx             §1.2 抽屉外壳(桌面非模态/移动模态 + 三段栅格)
  chat-header.tsx            §1.2 头部(对话/会话列表两态)
  message-list.tsx           §2   消息流 + 自动滚动 + aria-live
  message-bubble.tsx         §2.1 用户/助手气泡
  markdown.tsx               §2.2 助手 md 渲染(sanitize 出口)+ .ai-md 作用域
  typing-indicator.tsx       §2.4 三点
  message-error.tsx          §2.5 错误 + 重试
  composer.tsx               §1.2 输入区(Enter 发送/自增高/禁用)
  session-list.tsx           §4   会话列表视图 + 空态 + 删除确认
  cards/
    ai-card.tsx              §3.0 外壳
    navigate-card.tsx        §3.1
    confirm-card.tsx         §3.2(状态机)
    form-card.tsx            §3.3(内嵌 FormRenderer / CODE 跳转)
    list-card.tsx            §3.4
    chart-card.tsx           §3.5(分发 bar/line/pie)
      chart-bar.tsx / chart-line.tsx / chart-donut.tsx / chart-legend.tsx
    link-card.tsx            §3.6
    card-router.tsx          按 card.type 分发
  ai-chat.css                .ai-md / .ai-form 覆盖(§2.2 / §3.3)
```

样式复用优先级:能用 token/现有 `ui/*` 组件就不新造;`.ai-md` 从 `rich-text.css` 派生;
表单卡直接吃 `FormRenderer`;图表纯手写 SVG 吃 `--chart-*`。

---

## 7. 待主控/磐石对齐的开放项

1. **markdown 渲染管线**:走"md→HTML→sanitize→RichTextViewer"还是引一个轻量 md 库?本文两法皆兼容,
   倾向前者(零新依赖、复用既有 sanitize 出口)。
2. **面板模态性**:桌面确定为**非模态**(navigate 卡需要页面可点)。若主控希望"助手打开即专注",
   再评估模态 + 遮罩方案。
3. **form 卡窄屏两列压一列**:优先用 `.ai-form` CSS 覆盖,不改 `FormRenderer`;若需长期支持窄容器,
   建议给 `FormRenderer` 加 `columns` prop(P1)。
4. **chart tooltip**:MVP 用原生 `<title>` 悬浮;需要更强交互(跟随光标浮层)再评估(仍不引图表库)。
5. **卡片数据契约字段**:list 的 `row.link`、form 的 `submitPath`/成功后 `instId`、confirm 的 `danger`
   标记、chart 的 pie `percent` 是否由后端算——请磐石在响应里明确给出,前端不臆测。
```

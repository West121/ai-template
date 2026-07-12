# AI 助手 · 输入区(Composer)视觉现代化规范(丹青)

> 用户反馈:"AI 助手输入框要高级点,目前感觉就是个 input"。功能其实齐全——textarea 自增高、附件
> (图片/文本+预览+上传态)、语音、模型档案选择器、斜杠命令面板都有;问题是**布局散、不一体化**,
> 像"朴素 input + 一排散按钮",没有 Claude/ChatGPT 那种**整体输入卡**的高级感。
>
> 现状:`web/src/components/ai-chat/chat-view.tsx` 底部 composer(L604-721)。**只重排视觉 + 一体化容器,
> 不动任何逻辑**(附件校验/上传态/语音红点/斜杠面板/模型切换/视觉档案提示全保留)。只写规范,疾风实施。

---

## 0. 现状拆解(为什么散)

`chat-view.tsx` L604-721 现结构:
```
div.shrink-0 space-y-2 border-t p-3        ← 外层:三块竖向平铺(space-y-2)
├─ 模型选择器行(L607-632)                  ← 在输入框【外】,飘在最上
├─ 附件预览 AttachmentStrip(L635-637)       ← 在输入框【外】
├─ visionWarn 提示(L638-643)                ← 在输入框【外】
└─ div.relative(L645)
    ├─ SlashPalette(absolute bottom-full)
    └─ div.flex.items-end.rounded-xl.border.bg-background.px-3.py-2   ← 这才是"输入框"
        ├─ 附件按钮 Paperclip(ghost icon-sm)
        ├─ textarea(自增高)
        ├─ 语音 Mic/Square
        └─ 发送 ArrowUp/Loader2
```
**病灶**:模型器/附件预览/警示都在容器外,和输入框各自为政;输入框内只有一行(textarea + 右侧三按钮
挤一起),没有"上=预览 / 中=输入 / 下=工具栏"的层次 → 观感就是 input+按钮堆。

**目标**:把 附件预览、textarea、底部工具栏(含模型器+发送)**全收进一个圆角大卡**,竖向三层,
focus-within 主色描边+微阴影,像一张 Claude/ChatGPT 输入卡。

---

## 1. 一体化输入卡 结构

```
外层 div.shrink-0.border-t.p-3(仅顶部分隔 + 内边距;去掉 space-y-2 平铺)
└─ div.relative                                    ← 定位锚(斜杠面板 + 拖拽覆盖层)
   ├─ SlashPalette(absolute bottom-full,不变)
   └─ 【输入卡】div  role=group  data-dragging?
       group flex flex-col gap-0 rounded-2xl border bg-card px-0 py-0 transition
       focus-within:border-primary/50 focus-within:ring-[3px] focus-within:ring-ring/30 focus-within:shadow-sm
       data-[dragging=true]:border-primary data-[dragging=true]:ring-[3px] data-[dragging=true]:ring-primary/30
       ├─ ① 附件/警示层(pending>0 或 visionWarn 时才有;容器内顶部)
       │    div.flex.flex-col.gap-2.px-3.pt-3
       │    ├─ AttachmentStrip items=pending onRemove   ← 原组件不动,挪进卡内
       │    └─ visionWarn 提示条                          ← 挪进卡内(紧贴附件)
       ├─ ② 输入层
       │    textarea  无边框 融入:bg-transparent w-full resize-none px-3.5 pt-3 pb-1
       │             max-h-40 min-h-[2.75rem] text-sm outline-none placeholder:text-muted-foreground
       └─ ③ 底部工具栏  div.flex.items-center.gap-1.px-2.pb-2.pt-0.5
            ├─ 左:图标按钮组(附件 / 图片 / 语音 / 斜杠提示)  flex items-center gap-0.5 min-w-0
            └─ 右:模型器(精简)+ 圆形发送键                  ml-auto flex items-center gap-1.5 shrink-0
```

要点:
- **textarea 无自己的边框/ring**(现状它已无边框,但外层从"输入框"升级为"整卡");focus 视觉由**卡**承载。
- **三层竖排**(附件条 / 输入 / 工具栏)在**同一张卡内**,不再 `space-y-2` 外部平铺。
- 卡圆角 `rounded-2xl`(比现状 `rounded-xl` 更大、更"卡"),`bg-card`(比 `bg-background` 略实,从对话流浮起)。
- 顶部分隔 `border-t` 留在最外层(与消息流分界),卡本身四边 `border`。

---

## 2. 底部工具栏分区

```tsx
<div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
  {/* 左:图标按钮组(紧凑 ghost) */}
  <div className="flex min-w-0 items-center gap-0.5">
    {/* 附件(图片+文本统一入口,复用现 fileRef.click) */}
    <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="添加附件（图片/文本文件）"
            disabled={offline || sending} onClick={() => fileRef.current?.click()}>
      <Paperclip className="size-4" />
    </Button>
    {/* 语音(仅 speechSupported;录音态红点保留) */}
    {speechSupported && (
      <Button variant="ghost" size="icon-sm"
              className={cn("relative", recording ? "text-destructive" : "text-muted-foreground")}
              aria-label={recording ? "结束语音输入" : "语音输入"} aria-pressed={recording}
              disabled={offline || sending} onClick={toggleVoice}>
        {recording ? <><Square className="size-3.5 fill-current" />
          <span className="absolute right-0.5 top-0.5 size-1.5 animate-pulse rounded-full bg-destructive motion-reduce:animate-none" /></>
          : <Mic className="size-4" />}
      </Button>
    )}
    {/* 斜杠提示(点击把 "/" 填入并聚焦,唤起命令面板;窄屏隐藏文字) */}
    <button type="button" onClick={insertSlash}
            className="ml-0.5 hidden items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent sm:inline-flex"
            aria-label="斜杠命令">
      <Slash className="size-3" /> 命令
    </button>
  </div>

  {/* 右:模型器 + 发送 */}
  <div className="ml-auto flex shrink-0 items-center gap-1.5">
    {/* 模型档案选择器(精简成紧凑 chip;移入工具栏) */}
    {!offline && models.length > 0 && (
      <Select value={modelId ?? "default"} onValueChange={(v) => onModelChange(v === "default" ? null : v)}>
        <SelectTrigger size="sm"
          className="h-7 max-w-[9rem] gap-1 border-none bg-transparent px-2 text-xs text-muted-foreground hover:bg-accent focus:ring-0">
          {selectedModel?.supportsVision && <Eye className="size-3 shrink-0 text-emerald-500" />}
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{/* 选项不变:名称 + description + 👁 视觉徽标 */}</SelectContent>
      </Select>
    )}
    {/* 发送键:圆形主色,有内容才亮;发送/上传中转 loading */}
    <Button size="icon" className="size-8 shrink-0 rounded-full"
      disabled={(!value.trim() && pending.length === 0) || sending || offline || uploading}
      aria-label={uploading ? "附件上传中" : sending ? "发送中" : "发送"} onClick={send}>
      {sending || uploading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
    </Button>
  </div>
</div>
```

分区口径:
- **左 = 内容动作**(往输入里加东西):附件、语音、斜杠。全 `ghost icon-sm`、`text-muted-foreground`,
  紧凑 `gap-0.5`,视觉退到背景。
- **右 = 提交相关**:模型器(精简无边框 chip,`max-w` + `SelectValue` 自 truncate)+ **圆形发送键**
  (`size-8 rounded-full`,主色)。发送键是全卡视觉焦点。
- 模型器从卡外(现 L607-632 独立行)**移进工具栏右侧**;视觉档案提示(👁)收进触发器前缀 + 选项内,
  不再单占一行(现 L626-631 的"支持图片理解"行删除,信息进 Select)。

---

## 3. 三态(空 / 输入中 / 发送中)

| 态 | 卡 | textarea | 发送键 | 说明 |
|---|---|---|---|---|
| **空** | 常态 `border bg-card` | placeholder 显 | `disabled`(`opacity-50`,淡) | 无内容不可发 |
| **输入中**(focus / 有文本/附件) | `focus-within:border-primary/50 ring-[3px] ring-ring/30 shadow-sm` | 文本 + 自增高 | **亮**(`bg-primary`,可点) | 主色描边 + 微阴影 = "激活"高级感 |
| **发送中**(sending/uploading) | 保持 focus 视觉 | `disabled`(`opacity-60`) | `Loader2 animate-spin`,`disabled` | 工具栏左侧按钮也 `disabled`;录音态另有红点 |

- placeholder:`offline ? "离线模式暂不可用" : recording ? "正在聆听…（再次点击麦克风结束）" :
  "问问星辰助手…（/ 唤起命令 · Enter 发送）"`(沿用现状 L680-682,不变)。
- **Enter 发送 / Shift+Enter 换行**提示:放工具栏左侧"命令"chip 旁不够;建议做成**卡右下角极简角标**
  或 textarea `focus` 时显一行 `text-[10px] text-muted-foreground`("Enter 发送 · Shift+Enter 换行"),
  hover/focus 才现、失焦淡出;或直接并进 placeholder(现状已在 placeholder,**保持即可**,不额外加)。
  裁定:**保持 placeholder 内提示**(最省、不占位),不再加角标(避免又变"散")。

---

## 4. 新增交互:拖拽文件 / 粘贴图片

复用现有 `onPickFiles` 的校验+上传逻辑(把它对 `File[]` 的处理抽成 `ingestFiles(files: File[])`,
供三处调用:选择、拖拽、粘贴)。

**拖拽到卡**:
```tsx
// 输入卡容器
<div
  data-dragging={dragging || undefined}
  onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true) } }}
  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
  onDrop={(e) => { e.preventDefault(); setDragging(false); void ingestFiles([...e.dataTransfer.files]) }}
  className="… data-[dragging=true]:border-primary data-[dragging=true]:ring-[3px] data-[dragging=true]:ring-primary/30"
>
  {/* 拖拽覆盖层(仅 dragging 显) */}
  {dragging && (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/5 text-xs font-medium text-primary">
      <Paperclip className="mr-1.5 size-4" /> 松开以添加附件
    </div>
  )}
  … 三层内容 …
</div>
```
- 覆盖层 `absolute inset-0`,`pointer-events-none`(不挡 drop);`offline/sending` 时不进入拖拽态。

**粘贴图片**(textarea `onPaste`):
```tsx
onPaste={(e) => {
  const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"))
  if (files.length) { e.preventDefault(); void ingestFiles(files) }
  // 无图片文件 → 不拦截,正常粘贴文本
}}
```
- 走 `ingestFiles` → 现有 `checkAttachmentFile`(类型/大小)+ `MAX_ATTACHMENTS` 上限 + 上传态,零新逻辑。

**计数(可选)**:附件条右上角 `text-[10px] text-muted-foreground` 显 `{pending.length}/{MAX_ATTACHMENTS}`;
字数计数默认不做(输入型场景多余),仅当 textarea 接近某上限时才提示(本期不加)。

---

## 5. 响应式 / 暗色 / 动效

- **响应式**:卡 `min-w-0`;工具栏左组 `min-w-0` + 次要项(斜杠"命令"文字)`hidden sm:inline-flex`
  (窄面板收起文字留图标,或整颗隐藏);模型器 `max-w-[9rem]` + SelectValue truncate,极窄时可
  `hidden @[16rem]:flex`(若面板是 `@container`;否则用 `sm:`)。发送键与附件/语音**始终可见**(核心操作不收)。
  全屏/拖宽:卡 `w-full` 自然撑开,textarea `max-h-40`(~5 行)后内部滚。
- **暗色两态**:全走 token(`bg-card`/`border`/`ring-ring`/`text-muted-foreground`/`bg-primary`),
  `.dark` 自动;拖拽/focus 主色在两态均有对比。录音红点 `bg-destructive`、视觉徽标 `emerald-500` 两态可辨。
- **motion-reduce**:卡 `transition`、发送 `animate-spin`、录音红点 `animate-pulse` 全部
  `motion-reduce:*`(spin/pulse → `animate-none`,transition 去除)。focus 描边是静态,不受影响。

---

## 6. 改造 checklist(对照 chat-view.tsx L604-721)

**结构重排(不动逻辑)**
- [ ] 外层去 `space-y-2`(L605),仅留 `shrink-0 border-t p-3`。
- [ ] **模型选择器行**(L607-632)从卡外**移入**底部工具栏右侧(§2),精简为无边框紧凑 chip;删除独立的
      "支持图片理解"提示行(L626-631),👁 信息进 SelectTrigger 前缀 + 选项内。
- [ ] **附件预览**(L635-637)`AttachmentStrip` 挪进**卡内顶部**(①层);**visionWarn**(L638-643)紧随其下(卡内)。
- [ ] 现"输入框"容器(L650-655 的 `flex items-end … rounded-xl border bg-background px-3 py-2`)升级为
      **整卡**:`flex flex-col rounded-2xl border bg-card`,承载 ①附件层 / ②textarea / ③工具栏 三层(§1)。
- [ ] textarea(L675-689):去掉与按钮同行的 `flex items-end` 排布,改为**独立成层**、`w-full bg-transparent
      px-3.5 pt-3 pb-1 max-h-40`,`autoGrow` 逻辑不变(改 max 128→160 对应 max-h-40,或维持)。
- [ ] 附件按钮(L665-674)、语音(L691-710)、发送(L711-718)**移入 ③底部工具栏**:附件+语音进左组,
      发送进右组并改**圆形** `size-8 rounded-full`(原 `size-icon-sm`)。隐藏 file input(L657-664)位置随意(卡内)。
- [ ] SlashPalette(L647-649)保持 `absolute bottom-full`,锚点从"输入框 div"改为"整卡 div"(定位不变)。

**新增交互(复用现有校验/上传)**
- [ ] 把 `onPickFiles` 里对 `files` 的处理抽成 `ingestFiles(files: File[])`(现 L403-438 的循环体),
      `onPickFiles` 调它;新增拖拽 `onDrop`、粘贴 `onPaste` 也调它(§4)。
- [ ] 卡加 `data-dragging` 拖拽态 + 覆盖层(§4);`dragging` 用一个 `useState`。
- [ ] textarea 加 `onPaste`(§4),仅图片文件时拦截并 ingest,否则不阻止默认粘贴。
- [ ] (可选)附件条计数 `{pending.length}/{MAX_ATTACHMENTS}`。

**保留验证(不得回归)**
- [ ] 附件:选择/拖拽/粘贴三入口都走 `checkAttachmentFile` + `MAX_ATTACHMENTS` + 上传进度/失败态(AttachmentStrip 原样)。
- [ ] 语音:`speechSupported` 才显、录音红点 `animate-pulse`、`toggleVoice`/`stopVoice` 不变。
- [ ] 斜杠:输入 "/" 唤起 SlashPalette,↑↓/Enter/Esc 键控(`onKeyDown` L473-502)不变;新增"命令"chip 只是
      再加一个唤起入口(填 "/" + focus)。
- [ ] 模型切换:`onModelChange`、会话内记忆、👁 视觉档案、`visionWarn` 拦截逻辑不变。
- [ ] 发送:`send()`(L444-452)、`disabled` 条件、`sending/uploading` loading 不变。

**三态 / 响应式 / 暗色自检**
- [ ] 空 → 发送键淡 disabled;有文本/附件 → focus 卡主色描边+微阴影、发送键亮;发送中 → Loader2 + 全禁用。
- [ ] 面板拖窄:发送/附件/语音不丢,次要文字("命令")与模型器按规则收;textarea 与卡不横向溢出(min-w-0)。
- [ ] 暗色:卡/描边/发送/红点/徽标两态正常;拖拽覆盖层主色可见。
- [ ] motion-reduce:spin/pulse/transition 降级,功能不受影响。

---

## 7. 视觉基调(对齐 Claude/ChatGPT 观感,收敛口径)

- 一张 `rounded-2xl` 卡,`bg-card` 从对话流浮起,focus 时主色描边 + `ring-ring/30` 柔光 + `shadow-sm`——
  "激活即高级"的核心手感。
- 三层信息密度自上而下递减:附件(临时物料)→ 输入(主体)→ 工具栏(操作,退为 ghost 图标)。
- 唯一实心强调 = **圆形主色发送键**;其余按钮全 ghost/muted,让视觉焦点单一。
- 与 ai-chat 既有体系一致:圆角/muted/主色/token 暗色两态,不引新配色。

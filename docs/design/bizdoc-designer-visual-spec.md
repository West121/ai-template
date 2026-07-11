# BizDoc 模板设计器 · 视觉对齐规范(丹青)

> 依据:用户参考编辑器截图(主控读图结论)× 现状实现(`web/src/pages/bizdoc/tpl-designer/*` +
> `web/src/components/bizdoc/*`)。本文把参考观察展开为**可照做的调整 checklist**,精确到文件/类名/
> 属性值。只调视觉与少量 DOM 结构,**不动 model-v2 契约、不动交互逻辑**(拖拽/选中/就地编辑/撤销全保留)。
>
> 现状问题一句话:画布块是"透明虚线框 + 深蓝药丸工具条",表格是"纯黑线 + #f2f2f2",token 是胶囊
> chip——整体像线框稿;参考是"白卡块 + 灰类型标签 + 细灰线表格 + 裸蓝 token"的现代块编辑器质感。

---

## 0. 总口径(先裁定,后面全部依此展开)

### 0.1 画布 = 结构编辑视图;预览 = 所见即所得

块卡片化后,卡片 chrome(圆角边框、块间 12px、卡内边距、类型标签)**只存在于设计画布,不进打印**。
打印/预览仍按 `.bd-flow-list` 的 `gap: 2mm`、无卡片内边距渲染。两者由**一个新修饰类隔离**:

- `canvas.tsx` L355 的纸面根:`className="bd-paper bd-paper--flow"` → **加 `bd-paper--canvas`**。
- `bizdoc.css` 中所有设计态卡片样式一律挂 `.bd-paper--canvas` 作用域下,`V2Paper`(final)不受影响。

> 代价说明(写进代码注释):卡内水平 padding 12px 会让画布行宽比打印窄 ~24px,换行位置可能略有出入;
> 版式精确以「预览」为准。这是参考编辑器同款取舍。

### 0.2 token 口径:**彻底裸蓝字**(裁定)

设计态插值一律渲染为裸蓝字 `{{人话名}}`(如 `{{请假类型}}`),**不再用胶囊 chip**;
「插入变量」浮层里的 `.bd-var-chip` 保留胶囊(那是拾取器控件,语境不同)。
理由:与参考一致、不打断行内排版节奏、`{{}}` 原文明示"这是变量"。

### 0.3 设计态色板(纸面语境,一律写死,不用主题 token)

建议收敛为 `.bd-paper` 上的局部 CSS 变量(自有变量不违反"禁主题 token"红线),一处可调:

```css
.bd-paper {
  --bd-line: #d8dde3;        /* 表格细灰线 */
  --bd-label-bg: #f7f8fa;    /* label 列/表头浅灰底(bg-muted 级) */
  --bd-label-fg: #4b5563;    /* label 深灰字 */
  --bd-token: #2563eb;       /* 裸蓝 token(blue-600) */
  --bd-card-bd: #e6e8ec;     /* 块卡默认边框 */
  --bd-card-hover: #93c5fd;  /* hover 淡蓝框(blue-300) */
  --bd-card-active: #3b82f6; /* 选中蓝框(blue-500) */
  --bd-card-tint: #f7faff;   /* 选中整卡淡蓝底 */
  --bd-type-fg: #9aa1ad;     /* 类型标签灰 */
  --bd-ghost: #c2cad4;       /* 占位"⋯"/空值提示灰 */
}
```

---

## 1. 块卡片化(重点,`bd-shell` 重构)

### 1.1 目标结构(每块一张白卡)

```
        ┌─ 画布(纸面白) ──────────────────────────────┐
 ⠿ ─────│┌─卡片─────────────────────────────────────┐│
(块外左  ││ ▤ 智能表格                    ↑ ↓ ⧉ 🗑    ││ ← 类型标签左上 / 工具条右上(hover 显)
 垂直居中)││ ┌────────┬─────────┬────────┬─────────┐ ││
        ││ │ 请假类型 │{{请假类型}}│ 请假天数│{{请假天数}}│ ││ ← 卡内容 = 原块渲染体(V2BlockBody)
        ││ └────────┴─────────┴────────┴─────────┘ ││
        │└──────────────────────────────────────────┘│
        │            ↕ 12px 块间距                     │
        │┌─卡片─────────────────────────────────────┐│
        └──────────────────────────────────────────────┘
```

### 1.2 CSS(替换 `bizdoc.css` L196-246 的 `.bd-shell*` 段,全部挂 `.bd-paper--canvas` 域)

```css
/* 块间距:设计画布 12px(打印仍 2mm,§0.1) */
.bd-paper--canvas .bd-flow-list { gap: 12px; }

/* 块卡 */
.bd-paper--canvas .bd-shell {
  position: relative;
  background: #fff;
  border: 1px solid var(--bd-card-bd);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(23, 26, 31, 0.04);
  padding: 28px 12px 12px;            /* 顶部 28px 容纳类型标签行 */
  transition: border-color .12s, background-color .12s, box-shadow .12s;
}
.bd-paper--canvas .bd-shell:hover { border-color: var(--bd-card-hover); }
.bd-paper--canvas .bd-shell--selected,
.bd-paper--canvas .bd-shell--selected:hover {
  border-color: var(--bd-card-active);
  box-shadow: 0 0 0 1px var(--bd-card-active), 0 1px 2px rgba(23, 26, 31, 0.04);
  background: var(--bd-card-tint);    /* 整卡淡蓝底:表格值格无底色,tint 透出 = 参考的明细表格选中效果 */
}

/* 类型标签:卡内左上,非交互 */
.bd-shell-type {
  position: absolute; top: 7px; left: 10px;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; line-height: 16px; color: var(--bd-type-fg);
  pointer-events: none; user-select: none;
}
.bd-shell-type svg { width: 12px; height: 12px; }

/* 拖拽把手:块外左侧垂直居中(根级块) */
.bd-shell-grip {
  position: absolute; left: -24px; top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 28px; border-radius: 4px;
  color: #a3a9b3; cursor: grab;
  opacity: 0; transition: opacity .12s;
}
.bd-shell-grip:active { cursor: grabbing; }
.bd-shell-grip:hover { color: #6b7280; background: rgba(23, 26, 31, 0.05); }
.bd-paper--canvas .bd-shell:hover > .bd-shell-grip,
.bd-paper--canvas .bd-shell--selected > .bd-shell-grip { opacity: 1; }

/* 工具条:卡内右上,白底浮群(替换深蓝药丸) */
.bd-shell-tools {
  position: absolute; top: 4px; right: 6px; z-index: 10;
  display: flex; align-items: center; gap: 2px;
  padding: 2px; border-radius: 6px;
  background: #fff; border: 1px solid var(--bd-card-bd);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.bd-shell--selected .bd-shell-tools { opacity: 1; }   /* 保留现状:选中常显 */
.bd-shell-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 4px; color: #6b7280;
}
.bd-shell-btn:hover { background: #f3f4f6; color: #111827; }
.bd-shell-btn:hover.bd-shell-btn--danger,
.bd-shell-btn--danger:hover { background: #fef2f2; color: #dc2626; }
```

删除:`.bd-shell-name`(块名从工具条移到左上类型标签)、深蓝药丸相关(`background:#1e40af`、
`color:#dbeafe`、`top:-18px`)。

### 1.3 `canvas.tsx` 调整点(BlockShell,L188-299)

1. 根 div 类:`bd-shell group/blk relative` 不变;**新增两个子元素**(与 `bd-shell-tools` 平级):
   ```tsx
   {/* 类型标签(左上) */}
   <span className="bd-shell-type">
     {(() => { const Icon = BLOCK_META[block.type].icon; return <Icon /> })()}
     {BLOCK_META[block.type].label}
   </span>
   {/* 拖拽把手(块外左,仅根级;嵌套块保留工具条内拖拽钮,见 3) */}
   {!nested && (
     <button type="button" title="拖拽排序" draggable
       onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData(DND_MOVE, block.id); e.dataTransfer.effectAllowed = "move" }}
       className="bd-shell-grip">
       <GripVertical className="size-3.5" />
     </button>
   )}
   ```
2. 工具条:删掉 `<span className="bd-shell-name">` 一项;**根级**块删掉工具条里的 GripVertical 拖拽钮
   (把手已外置);删除钮加 `bd-shell-btn--danger` 类、去掉 `hover:!text-red-600` 内联覆盖。
3. `BlockShell` 增加 `nested?: boolean` prop(`BlockList` 已有 `nested`,透传即可);
   **嵌套块**(行容器栏内)不渲染外置把手(会压到相邻栏),保留工具条内拖拽钮——即嵌套块工具条 =
   `⠿ ↑ ↓ ⧉ 🗑`,根级块工具条 = `↑ ↓ ⧉ 🗑`。
4. 纸面根(L355):`className="bd-paper bd-paper--flow bd-paper--canvas"`(§0.1)。
5. 行容器空栏 `bd-droplist--nested`(css L261-265)微调,和卡片语言一致:
   ```css
   .bd-droplist--nested { border: 1px dashed #dbe0e6; border-radius: 6px; padding: 6px; background: #fafbfc; }
   ```

### 1.4 低高度块(divider/spacer)口径

同规格卡片化(28px 顶部标签区照常)——divider 卡内就一条线,视觉偏空但规则统一、可点选;
不做特殊紧凑变体(如嫌重列 P1)。页眉/页脚 band 壳(`bandShell`,canvas.tsx L322-351)同步吃新
`.bd-shell` 卡样式,类型标签用现成文案「文档页眉/页脚」——把 `bd-shell-tools` 里的名字 span 同样
换成 `bd-shell-type` 左上标签。

---

## 2. 智能表格视觉(`bd-tbl` 重构,**打印同步变**)

WYSIWYG 口径:表格线/底色是**内容**,画布怎么显打印就怎么出(`print-color-adjust: exact` 兜底)。
细灰线打印件是参考编辑器的既定观感;若后续要"纯黑正式件",在页面设置加"线色"开关(P1,§9)。

`bizdoc.css` L76-99 替换:

```css
.bd-tbl { width: 100%; border-collapse: collapse; table-layout: fixed; }
.bd-tbl th, .bd-tbl td {
  border: 0.2mm solid var(--bd-line);     /* 细灰线(原 0.3mm 纯黑) */
  padding: 1.8mm 2.5mm;                    /* 行高 ~32px:1.8mm 上下 + 1.5 行高 ≈ 8.5mm */
  vertical-align: middle;                  /* 原 top;单行值居中更舒适 */
  word-break: break-all; white-space: pre-wrap;
  text-align: left; font-weight: inherit;
}
.bd-tbl tr { height: 8.5mm; }              /* ≈32px;表格里 height 即 min-height */
.bd-tbl-label {
  background: var(--bd-label-bg);          /* 原 #f2f2f2 → #f7f8fa */
  color: var(--bd-label-fg);               /* 新增:label 深灰字(原黑) */
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
th.bd-tbl-label { font-weight: 700; text-align: center; }   /* 表头照旧:加粗居中 */
```

要点:
- **label 列浅灰底 + 深灰字,值列白底黑字**(值格 td 无底色,继承纸白/选中 tint)。
- 明细/审批表头(`th.bd-tbl-label`)与 label 列同底色,靠加粗+居中区分,与参考一致。
- `.bd-tbl-sign`(审批签字格 16mm)不动。
- divider 线色同步:`.bd-blk-divider` 的 `border-top: 0.3mm solid #000` → `0.2mm solid var(--bd-line)`?
  **不改**——分割线是用户显式排版元素,保持黑色(与表格线语义不同);如需灰色随 P1 线色开关走。

---

## 3. token 裸蓝字(`paper-renderer.tsx` TokenText,L78-94)

1. `bizdoc.css` L170-182 `.bd-chip` 替换为:
   ```css
   .bd-token { color: var(--bd-token); white-space: nowrap; }
   ```
   (去掉底色/边框/圆角/缩字号/margin——彻底裸字,字号继承块字号,排版不再被 chip 打断。)
2. `TokenText` design 分支(L87-90):
   ```tsx
   <span key={i} className="bd-token" data-expr={m[1]} title={m[1]}>
     {`{{${tokenLabel(m[1], ctx.fields)}}}`}
   </span>
   ```
   —— 显示 `{{人话名}}`(如 `{{请假类型}}`、`{{审批1·办理人}}`);`title` 保留原始表达式便于排查。
3. 连带点(全用 `.bd-chip` 的地方一起换):
   - `V2BlockBody` detailTable 设计态占位行 L309(→ 改为两行占位,见 §4,不再用 chip);
   - `.bd-cell-val--empty`(css L302-305)不动(空值"点击插入变量"灰提示仍是设计态 chrome);
   - 插入变量浮层 `.bd-var-chip`(css L388-400)**保留胶囊**,不动。
4. `token-vars.ts` / `field-picker.tsx`(TokenInput 内的 chip 预览,如有)同口径换裸蓝字——
   属性面板输入框内是原文 `{{expr}}`,不受影响。

---

## 4. 明细表格设计态占位(两行示例)

`paper-renderer.tsx` L304-312(`rows == null` 设计态分支)替换为**两行占位**:

```tsx
{rows == null ? (
  [1, 2].map((n) => (
    <tr key={n}>
      {block.showIndex && <td style={{ textAlign: "center" }}>{n}</td>}
      {block.columns.map((c, i) => (
        <td key={i} style={{ textAlign: "center", color: "var(--bd-ghost)" }}
            title={`绑定:${block.field}.${c.field || "(未绑定)"}`}>
          ⋯
        </td>
      ))}
    </tr>
  ))
) : ...}
```

- 序号列 1、2;各值格灰色「⋯」居中(`--bd-ghost`),让设计时预感"这里循环出 N 行"。
- 列与字段的绑定关系不再在格内展示(参考同款),改由:**表头/值格 hover `title`**(上面已给)+
  属性面板列配置(§6)承担;失效绑定仍走预览黄条(staleTokensV2,不动)。
- `⋯` 是设计态 chrome 吗?否——它在 `rows == null` 分支,final 态永远有 rows(空数组走空行分支),
  天然不进打印,无需 `bd-editing-only`。
- 序号列宽 `10mm`(colgroup 现状)不动,符合参考"首列序号窄列"。

---

## 5. 单据信息块单行化(docInfo)

现状竖排(`bd-blk-docinfo` flex column,每 item 一行)→ 参考为**单行扁块、右对齐、多组并排**。

1. `bizdoc.css` L105-109 替换:
   ```css
   .bd-blk-docinfo {
     display: flex; flex-direction: row; flex-wrap: wrap;
     column-gap: 6mm; row-gap: 1mm;
     justify-content: flex-end;      /* 缺省右对齐;由内联 style 按 align 覆盖 */
     align-items: baseline;
   }
   ```
2. `paper-renderer.tsx` docInfo case(L190-201):`alignItems: alignFlex(align)` →
   `justifyContent: alignFlex(align)`(横排后对齐语义从交叉轴换到主轴),其余(item 内
   `label：` + EditableValue 结构、就地编辑 CellRef)全部不动。
3. 效果:`单据编号：{{单号}}　　日期：{{创建时间}}` 一行右靠;超长自动折行(wrap)。
   打印同步变(内容级调整,符合参考的最终观感)。

---

## 6. 属性面板 · 明细表格列配置卡片化(`props-panel.tsx` L402-431)

现状:数据源/序号开关/裸行内三输入一排。目标结构(参考图):

```
┌ 数据源 ─────────────────────────┐
│ [items____________]  [⧉变量]    │   ← 置顶;变量按钮弹子表字段拾取
└─────────────────────────────────┘
  序号列 [switch]
  列
  ┌─列卡─────────────────────────┐
  │ 字段  [name________ (×)]  🗑 │   ← (×) 清空;🗑 删除列(hover 红)
  │ 显示名 [事项_______________] │
  │ 列宽  [−] [ 60 ] [+] mm      │   ← stepper,步长 5;0 显示"自动"
  └──────────────────────────────┘
  ┌─列卡─────────────────────────┐ …
  [ + 添加列 ]                       ← 通栏虚线按钮
```

Tailwind 类建议:

```tsx
{/* 数据源置顶 */}
<div className="space-y-1.5">
  <Label className="text-[11px] text-muted-foreground">数据源(子表字段)</Label>
  <div className="flex items-center gap-1">
    <CommitInput value={block.field} mono placeholder="如 items" onCommit={...} />
    <Button variant="outline" size="icon" className="size-7 shrink-0" title="选择子表字段"
            onClick={openSubformPicker}>
      <Braces className="size-3.5" />
    </Button>
  </div>
</div>

{/* 每列一张小卡 */}
<div className="space-y-2">
  {block.columns.map((c, i) => (
    <div key={i} className="space-y-1.5 rounded-lg border bg-muted/30 p-2">
      <div className="flex items-center gap-1">
        <Label className="w-10 shrink-0 text-[11px] text-muted-foreground">字段</Label>
        <div className="relative min-w-0 flex-1">
          <CommitInput value={c.field} mono placeholder="字段 key" onCommit={...} />
          {c.field && (
            <button type="button" aria-label="清空"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-0.5
                         text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => 置空 field}>
              <X className="size-3" />
            </button>
          )}
        </div>
        <Button variant="ghost" size="icon"
                className="size-6 shrink-0 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                onClick={删除列}>
          <Trash2 className="size-3" />
        </Button>
      </div>
      <div className="flex items-center gap-1">
        <Label className="w-10 shrink-0 text-[11px] text-muted-foreground">显示名</Label>
        <CommitInput value={c.label} placeholder="表头" onCommit={...} />
      </div>
      <div className="flex items-center gap-1">
        <Label className="w-10 shrink-0 text-[11px] text-muted-foreground">列宽</Label>
        <Button variant="outline" size="icon" className="size-6" onClick={() => step(-5)}>−</Button>
        <CommitNumber value={c.w ?? 0} min={0} max={180} onCommit={...} />
        <Button variant="outline" size="icon" className="size-6" onClick={() => step(+5)}>＋</Button>
        <span className="shrink-0 text-[10px] text-muted-foreground">{c.w ? "mm" : "自动"}</span>
      </div>
    </div>
  ))}
  <Button variant="outline" size="sm" className="h-7 w-full gap-1 border-dashed text-[11px]" onClick={加一列}>
    <Plus className="size-3" /> 添加列
  </Button>
</div>
```

- 「变量」按钮的子表字段拾取:`fields.filter(f => f.type === "subform")` 弹 Popover 列表
  (index.tsx 已算 `subformOptions`,可下传复用);无子表字段时列表显示"当前表单无子表字段"。
- 同风格顺延(本次可一并做,量小):docInfo「信息行」/ infoTable「单元格」/ approvalTable「步骤」的
  行卡把现状 `rounded-md border p-1.5` 统一升级为 `rounded-lg border bg-muted/30 p-2`,行内加
  `w-10` 左标签(标签/值/跨组),删除钮统一 `hover:bg-red-50 hover:text-red-600`;
  「加一行/加一格/加一步」统一 `border-dashed`。
- 面板标题加类型图标:`BlockPanel` L301 的 `<h3>` 前插 `BLOCK_META[block.type].icon`
  (`size-3.5 text-muted-foreground`)。

---

## 7. 层次与暗色(精确方案)

**三层白的区分**(桌面 → 纸面 → 块卡):

| 层 | 底色 | 分离手段 |
|---|---|---|
| 桌面 `.bd-desk` | `#e5e7eb` / `.dark #1f2328`(现状不动) | — |
| 纸面 `.bd-paper` | `#fff`(恒白) | 大阴影 `0 2px 16px rgba(0,0,0,.15)`(现状不动) |
| 块卡 `.bd-shell` | `#fff`(与纸同白) | **1px 边框 `#e6e8ec` + 微阴影 `0 1px 2px rgba(23,26,31,.04)` + 12px 块间距透出纸白** |

即:纸面靠"深阴影浮在灰桌面"成立,块卡靠"发丝边框 + 极轻投影 + 间距"成立,两级阴影量差一个数量级,
不会打架。**不要**给块卡加灰底或给纸面加灰底(参考图两层都是白)。

**暗色**:`.bd-desk` 已有 `.dark` 分支;纸面及其内一切(含新增 `--bd-*` 全部写死值)在暗色下**原样不变**
——纸恒白、卡恒白、灰线恒灰,这正是套打的正确行为。左右栏/顶栏是主题 token(index.tsx 现状),暗色自动。
无新增暗色工作量,仅需自检:暗色下 `--bd-card-hover/active` 蓝在白纸上对比不变(纸内不受主题影响,必过)。

---

## 8. 落地 checklist(按文件,疾风照勾)

**`web/src/components/bizdoc/bizdoc.css`**
- [ ] `.bd-paper` 增加 §0.3 的 `--bd-*` 局部变量组。
- [ ] 新增 `.bd-paper--canvas .bd-flow-list { gap: 12px }`(§1.2)。
- [ ] `.bd-shell*` 段整体替换为 §1.2(卡片/类型标签/外置把手/白底工具条/danger 钮);删除 `.bd-shell-name`。
- [ ] `.bd-tbl` 段替换为 §2(0.2mm 灰线/1.8mm padding/行高 8.5mm/middle/label 灰底深灰字)。
- [ ] `.bd-chip` → `.bd-token`(§3);`.bd-var-chip` 保留。
- [ ] `.bd-blk-docinfo` 改横排(§5)。
- [ ] `.bd-droplist--nested` 微调(§1.3-5)。

**`web/src/pages/bizdoc/tpl-designer/canvas.tsx`**
- [ ] 纸面根加 `bd-paper--canvas`(L355)。
- [ ] BlockShell:新增 `bd-shell-type`(icon+label)与根级外置 `bd-shell-grip`;工具条去名字、
      根级去拖拽钮、删除钮换 `bd-shell-btn--danger`;透传 `nested`(§1.3)。
- [ ] bandShell 同步:名字 span → 左上 `bd-shell-type`(§1.4)。

**`web/src/components/bizdoc/paper-renderer.tsx`**
- [ ] TokenText design 分支:`.bd-chip` → `.bd-token`,文案 `{{人话名}}` + `title=原始表达式`(§3)。
- [ ] detailTable `rows == null` 分支:两行「1/2 + ⋯」占位 + hover title 显绑定(§4)。
- [ ] docInfo:`alignItems` → `justifyContent`(§5)。

**`web/src/pages/bizdoc/tpl-designer/props-panel.tsx`**
- [ ] detailTable 段重排:数据源+变量按钮置顶;列 → 小卡(字段+清空/显示名/列宽 stepper/删除红钮);
      底部虚线「+ 添加列」(§6)。
- [ ] docInfo/infoTable/approvalTable 行卡统一 `rounded-lg border bg-muted/30 p-2` + 虚线添加钮(§6)。
- [ ] BlockPanel 标题加类型图标(§6)。

**不动**:`meta.ts`(图标/文案现成)、`model-v2.ts`(零契约变更)、`index.tsx`(布局/顶栏不变)、
`cell-editor.tsx` 与 `.bd-var-pop`(就地编辑观感已达标)、打印隔离段(css L402-437)。

**自检清单**(改完过一遍):
- [ ] 预览(PreviewDialog)与打印不出现卡片 chrome(间距仍 2mm、无边框/标签)。
- [ ] 表格灰线/灰底在打印预览可见(`print-color-adjust`)。
- [ ] 选中含表格块 = 蓝框 + 整卡淡蓝底;值格白底不被 tint 吃掉可读性。
- [ ] 嵌套(行容器)块无外置把手、工具条内可拖;根级块外置把手不与页边距冲突(默认 20mm≈75px > 24px,安全)。
- [ ] 暗色下画布纸/卡恒白,左右栏跟主题。
- [ ] 撤销/重做、就地编辑、拖拽落点蓝线全部行为不变。

---

## 9. 开放项

1. **打印线色**:细灰线进打印是本次口径(对齐参考观感);若有"正式黑线件"诉求,页面设置加
   「表格线色:灰/黑」开关(P1,只改 `--bd-line`)。
2. **低高度块紧凑卡**(divider/spacer 顶部 28px 略空):P1 可加 `bd-shell--slim`(padding-top 20px、
   标签字号 10px);本次不做。
3. **列配置的字段拾取升级**:列卡「字段」目前手填 key;P1 可像数据源一样加拾取按钮
   (需字段清单含子表列 schema,依赖磐石 `/fields` 端点是否下发子表列)。

---
## 附:主控裁定(开放项)
- 打印线色开关(正式黑线件):P1。
- 低高度块紧凑卡变体:允许,疾风实现时按需采用。
- 列字段拾取升级:**直接做**——字段端点已下发子表(type=subform)及其列(`子表key.列key`),
  明细列配置的字段输入升级为拾取器(选子表列),与就地编辑浮层同源。

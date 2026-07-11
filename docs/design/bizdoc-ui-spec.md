# 单据管理(BizDoc) · 套打设计器 + 定义管理 + 运行时台账 UI/视觉规范(丹青)

> 本文是 `bizdoc-design.md` §7「丹青先行项」的落地稿,规范对象为契约 §4(套打设计器)与 §5(运行时页面)。
> 给疾风一份可直接照抄的视觉/交互契约。所有编辑 UI 走主题 token 暗色两态;**画布纸面/打印输出恒白**,
> 做法完全沿用 `gongwen-format-spec.md` 的物理单位方案(mm/pt、写死黑白、`@page` 隔离)——该方案已在
> `web/src/components/gongwen/gongwen.css` 落地验证,本文直接引用其结论。
>
> 类名前缀约定 `bd-`(bizdoc)。只出规范与示意片段,不落实现代码。

---

## 0. 总则与复用清单

| 事项 | 决策 |
|---|---|
| 双语境配色 | **编辑 chrome**(三栏、工具条、抽屉、台账)全部走主题 token,暗色自动;**纸面**(`.bd-paper` 内)写死 `#fff`/`#000`,禁用任何主题 token(同 `.gongwen-paper` 红线) |
| 物理单位 | 纸内一律 **mm(位置尺寸)/ pt(字号)**;CSS 定义 1mm = 96/25.4 ≈ **3.7795px**,屏幕与打印同一套坐标,禁 rem/em 定位 |
| 渲染器同源 | 设计器画布、预览、打印**共用一个元素渲染器**(绝对定位 mm):设计器 = 渲染器 + 交互覆盖层;预览 = 渲染器 + 样例数据;打印 = 渲染器 + 真实数据 + `@media print`。杜绝三套实现漂移 |
| 复用组件 | 列表 `DataTable`(serverPagination)、抽屉 `components/drawer.tsx`、表单 `FormRenderer`、状态徽标沿用 `WF_STATUS_META` 的 `Badge variant="outline"` 配色语法、页头 `PageHeader` |
| 三栏尺寸基线 | 沿用现有表单设计器(`designer/form/designer-core.tsx`):左栏 `w-56`、右栏 `w-72`,中栏自适应;整体高 `h-[calc(100vh-…)]` 内滚 |
| 图标 | lucide;元素类型图标见 §1.8 |

---

## 1. 可视化套打设计器(核心)

### 1.1 整体布局

设计器**整页路由**(从定义抽屉的「打印模板」区进入,如 `/bizdoc/defs/:defId/print-tpl/:tplId`),
非弹窗——画布需要最大可用面积。

```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏 h-12:← 返回 | 模板名(可改) | 纸张 A4/A5 | 纵/横 | 缩放 │
│        | 网格开关 | 预览 | 保存                                │
├─────────┬────────────────────────────────────────┬───────────┤
│ 左栏     │ 中栏(画布区)                            │ 右栏       │
│ w-56    │  ┌─角块─┬─水平标尺───────────────┐      │ w-72      │
│ 元素面板 │  ├─────┼───────────────────────┤      │ 属性面板   │
│ ────    │  │垂直  │   灰底桌面(可平移)      │      │ (随选中   │
│ 字段树   │  │标尺  │   ┌─ 白纸(mm) ─┐      │      │  切换)    │
│ (可拖)  │  │     │   │  元素…      │      │      │           │
│         │  └─────┴───┴─────────────┴──────┘      │           │
└─────────┴────────────────────────────────────────┴───────────┘
```

- 三栏均 `shrink-0` + 各自 `overflow-y-auto`;中栏 `flex-1 min-w-0`。
- 顶栏控件从左到右:返回(未保存有改动时 `AlertDialog` 确认)、模板名内联编辑(`Input` ghost 态,
  blur 保存到本地状态)、纸张 `Select`(A4 210×297 / A5 148×210)、方向切换(`Tabs` 纵/横)、
  缩放组(见 1.2)、网格显隐 `Toggle`、`预览`(outline)、`保存`(primary)。
- 未保存标记:模板名旁 `size-1.5 rounded-full bg-amber-500` 圆点 + 顶栏保存键高亮。

### 1.2 画布与坐标系(mm → px、缩放、平移)

**坐标模型**:模板 JSON 的 `x/y/w/h` 全部是 mm(原点 = 纸左上角,**不含 margin**——margin 只画参考线,
不参与元素坐标,与契约 JSON 示例一致)。渲染:

```css
/* 共用渲染器:纸面(恒白,脱离主题) */
.bd-paper {
  position: relative;
  background: #fff;
  color: #000;
  width: 210mm;   /* A4 纵向;A5=148mm;横向交换宽高 */
  height: 297mm;  /* 设计器画布用固定高;打印多页 P1 */
  box-shadow: 0 2px 16px rgba(0,0,0,.15);   /* 仅屏幕;打印去除 */
}
.bd-el { position: absolute; /* left/top/width/height 由元素 mm 值内联生成 */ }
```

```tsx
<div className="bd-el" style={{ left: `${el.x}mm`, top: `${el.y}mm`,
                                width: `${el.w}mm`, height: `${el.h}mm` }} />
```

**缩放**:对纸容器整体 `transform: scale(z)`(`transform-origin: 0 0`),**绝不改字号/坐标**——
与 gongwen「A4 缩放用 transform,保持 mm 尺寸不变」同一决策。

- 档位:50 / 75 / 100 / 125 / 150 / 200%,加「适应宽度」(默认,进入时按中栏宽计算 z 并取整到 5%)。
- 控件:`- [100%] +` 按钮组 + 下拉档位;`Ctrl+滚轮` 以光标为锚缩放;`Ctrl+0` 回适应宽度。
- px/mm 换算:`pxPerMm = 96 / 25.4 * z`。标尺、吸附命中半径等一切屏幕像素计算都由它推导。

**平移**:灰底桌面容器(`.bd-desk`,主题色 `bg-muted/50`,同 `gw-preview-shell` 观感)自身滚动;
`Space+拖拽` 或鼠标中键拖拽平移(光标 `grab/grabbing`)。纸面四周留 `24px` 以上桌面边距。

### 1.3 mm 标尺

水平/垂直标尺贴画布区上/左缘,交角处 20×20 角块显示单位「mm」。

```
- 厚度 20px(固定 px,不随缩放变化);背景 bg-background,刻度线/文字 text-muted-foreground
- 刻度(逻辑 mm,屏距 = mm * pxPerMm):
    · 10mm 主刻度:全高线 + 数字标签(text-[9px],标 0,10,20…)
    · 5mm  中刻度:2/3 高线
    · 1mm  细刻度:1/3 高线,仅当 pxPerMm ≥ 3(即 z ≥ ~80%)时绘制,避免糊成一片
- 绘制:Canvas 2D 或密集 div 均可,推荐 Canvas(一次 redraw,随 scroll/zoom 重绘)
- 联动:
    · 光标定位线:鼠标在画布内时,两标尺上各画一条 primary 色 1px 指示线跟随
    · 选中映射:选中元素的 x..x+w / y..y+h 区间在标尺上铺 primary/15 高亮带
    · margin 标记:模板 margin 四值在标尺上用小三角(muted-foreground)标出
- 标尺原点 = 纸左上角(0mm),滚动/缩放时同步偏移
- aria-hidden="true"(纯视觉,坐标信息由属性面板提供可达途径)
```

### 1.4 网格与吸附反馈

**网格**(画在纸面内、恒白语境下写死色值,打印/预览不渲染):

```
- 5mm 网格线:#eef0f2 1px(极浅,不干扰内容);10mm 处略深 #e2e5e9
- 1mm 点阵:仅 z ≥ 150% 时以 0.5px 点显示(可选)
- margin 参考线:按模板 margin[t,r,b,l] 画一圈虚线 #93c5fd(dashed 1px),标识"建议排版区"
- 网格开关在顶栏;关闭只影响显示,吸附仍生效
```

**吸附(契约:1mm)与反馈**:

| 吸附源 | 行为 | 反馈 |
|---|---|---|
| 1mm 网格 | 拖拽/缩放时坐标四舍五入到 1mm | 无(基础行为) |
| 智能参考线 | 与其他元素的 左/中/右/上/中/下 边线差 < 0.5mm 时磁吸对齐 | 画布上画一条**primary 色 1px 实线**贯穿两元素,吸附瞬间轻微"卡顿"手感(阈值内直接贴合) |
| 纸面中线/页边距线 | 元素中心过纸面水平/垂直中线、边缘贴 margin 线时磁吸 | 同上,中线用 primary、margin 线用蓝 #3b82f6 |
| 临时关闭 | 按住 `Alt` 拖拽 → 关闭一切吸附,0.1mm 自由移动 | 光标旁 tooltip 显示「自由移动」 |

拖拽过程中光标右下角跟随一枚坐标浮签(`bg-foreground text-background text-[10px] rounded px-1.5 py-0.5`):
`x 25.0  y 30.0`(移动)或 `60.0 × 7.0`(缩放),单位 mm、精度 0.1。

### 1.5 选中 / 多选 / 手柄 / 对齐分布

**选中态**:

```
- 单选:元素外框 1.5px solid var(--primary) + 8 个缩放手柄
- 手柄:size 8px(屏幕 px,固定不随缩放),bg-background border-[1.5px] border-primary rounded-[2px]
        四角 + 四边中点;光标 nwse/nesw/ns/ew-resize
- line 元素:只有两端 2 个手柄(改长度),高度锁 0
- hover(未选中):外框 1px dashed var(--primary)/50
- 多选:Shift+点击 逐个加减;空白处按下拖拽 = 框选(marquee:border border-primary bg-primary/10)
        多选后显示整体包围盒(1px dashed primary)+ 仅整体移动(不提供多选缩放,MVP)
- 取消:Esc 或点击纸面空白
```

**对齐/分布工具条**:多选 ≥2 时,画布区顶部浮出一条工具条(`bg-card border rounded-lg shadow-md
px-1 py-0.5`,吸附在画布区顶部居中,不遮属性面板):

```
[左对齐][水平居中][右对齐] | [顶对齐][垂直居中][底对齐] | [横向等距≥3][纵向等距≥3] | [等宽][等高]
```
- 图标 lucide `AlignStartVertical` 系列,`Button variant="ghost" size="icon-sm"` + Tooltip 中文名。
- 对齐基准 = 多选包围盒;等距 = 首尾固定、中间均分间隙。
- 单选时同位置显示层级组:`[上移一层][下移一层][置顶][置底]`(元素数组序 = 绘制序)+ `[复制][删除]`。

### 1.6 键盘与右键

| 键 | 作用 |
|---|---|
| `↑↓←→` | 移动 1mm |
| `Shift+方向` | 移动 10mm(粗调) |
| `Alt+方向` | 移动 0.1mm(微调,绕过网格) |
| `Delete/Backspace` | 删除选中(无确认,可撤销兜底) |
| `Ctrl+C / V / D` | 复制 / 粘贴(偏移 +5mm,+5mm)/ 原位副本 |
| `Ctrl+Z / Ctrl+Shift+Z` | 撤销 / 重做(建议 ≥50 步;实现成本高可列批 B 内后置,但保存前删除无确认依赖它) |
| `Ctrl+A` | 全选元素 |
| `Esc` | 取消选中 / 退出预览 |
| `Space+拖` | 平移画布 |

右键菜单(`ContextMenu`,已有 ui 组件):复制/粘贴/删除/层级四项/对齐子菜单——与工具条同能力,
供触控板用户与减少鼠标行程。

### 1.7 属性面板(右栏 w-72)

无选中 → **模板属性**;选中 → **元素属性**。分区标题 `text-xs font-medium text-muted-foreground`,
控件排布沿用 shadcn 表单纵向节奏(`space-y-3`,label `text-xs`)。

**模板属性**(无选中):
- 纸张(A4/A5)、方向(纵/横)、页边距四值(mm,四个 `Input type=number` 田字排)。
- 切纸张/方向时若有元素超出新纸面 → toast 警告"N 个元素超出纸面",超界元素打警示标(见 §2.3),不自动挪。

**元素通用区**(任何选中):
```
位置尺寸:X / Y / W / H 四个数字输入(单位后缀 mm,step 0.1,支持键入回车)
          line 只有 X/Y/W;table 只有 X/Y/W(高度随行数自动)
层级:上移/下移/置顶/置底 按钮组
```

**各类型专属区**:

| 类型 | 属性表单 |
|---|---|
| `label` | 文本(Textarea 2 行)、字号 pt(数字,默认 10.5=五号)、加粗 Switch、对齐(左/中/右 Tabs) |
| `field` | **绑定字段**(下拉 = 表单字段清单,显示 label(key);来源 `/api/wf/forms/{key}/fields`)、前缀 label(Input,如"请假类型:")、字号/加粗/对齐 |
| `sysfield` | 系统字段下拉(单号 docNo/标题 title/创建人 creator/部门 dept/日期 date)、前缀 label、字号/加粗/对齐 |
| `table` | 绑定子表字段(下拉,仅子表类型字段);**列编辑器**:列清单(拖拽排序),每列 = 子表列下拉 + 表头文案 + 列宽 mm;`headerBold` Switch、字号(默认 9)、行高 mm(默认 7) |
| `line` | 线宽 pt(默认 0.75)、样式(实线/虚线) |
| `rect` | 边框宽 pt、样式(实/虚)、圆角 mm(默认 0) |
| `image` | 上传(复用 FileUploader → 存 fileId;或粘贴 dataURL)、缩略预览、适应方式(拉伸/等比包含) |
| `qrcode` | 值(Input,支持 `{{docNo}}` 等插值,下拉可插入系统字段占位)、纠错级别 L/M/Q/H(默认 M) |

> `line/rect` 的线宽/样式、`image` 适应方式、`qrcode` 纠错级别是对契约 JSON 的**style 扩展提案**,
> 见 §7 开放项,需主控确认后进 schema;MVP 可先只做契约已有字段。

### 1.8 左栏:元素面板 + 字段树

上下两段,各自可折叠(`Collapsible`):

**元素面板**(拖入画布,或点击 = 放到纸面中心):

```
2 列网格,每项:图标 + 名称(text-xs),h-16 rounded-md border bg-card hover:border-primary/40
label 文本  Type    field 字段   FormInput
sysfield 系统字段 Hash   table 明细表  Table2
line 直线   Minus   rect 矩形    Square
image 图片  Image   qrcode 二维码 QrCode
```

**字段树**(核心提效入口):
- 两组:「表单字段」(绑定表单的字段清单,子表字段带展开箭头列出列)、「系统字段」(单号/标题/创建人/部门/日期)。
- 每项:`GripVertical` 拖柄 + 字段 label + key(`text-[10px] text-muted-foreground`)。
- **拖到画布 = 自动建元素**:普通字段 → `field`(默认 w=60 h=7mm,字号 10.5,前缀=字段 label+":");
  子表字段 → `table`(默认全列、列宽均分);系统字段 → `sysfield`。落点吸附 1mm。
- 已在画布使用的字段,树上项右侧打钩标记(`Check size-3 text-emerald-500`),可重复拖(允许一字段多处打印)。
- 顶部小搜索框过滤(`Input h-7 text-xs`)。

拖拽实现:原生 HTML5 DnD 或 pointer 事件受控坐标(契约明确**非 react-flow**);拖拽悬停画布时显示
半透明幽灵框(元素默认尺寸,`bg-primary/10 border border-dashed border-primary`)预示落点。

### 1.9 预览态(样例数据)

顶栏「预览」切换(`Eye` 图标,再点退出;或 Esc 退出):

- 隐藏一切交互:网格/margin 线/手柄/选中框/标尺定位线全部不渲染;左右栏变灰禁用或收起(推荐**收起**,
  画布居中放大,顶栏变为:退出预览 | 缩放 | 打印测试)。
- 元素按**样例数据**渲染(与运行时打印同一渲染器):

| 元素 | 样例 |
|---|---|
| field(文本/单选/下拉) | 「示例文本」/ 首个选项 label |
| field(数字/金额) | `1,234.56` |
| field(日期) | `2026-07-11` |
| field(人员/部门) | `张三` / `研发部` |
| sysfield.docNo | 按绑定编号规则生成示意(如 `BX〔2026〕0001`),无规则则 `单号示例` |
| sysfield 其他 | `请假申请单-张三` / `张三` / `研发部` / `2026年7月11日` |
| table | 表头 + 2 行样例(列类型同上规则) |
| qrcode | 用插值后的样例值真实生成 QR |
| image 无 src | 预览态**不渲染**(设计态才显示占位) |

- 「打印测试」按钮:用样例数据直接走 §1.10 打印链路,验证所见即所得。

### 1.10 打印一致性要点(照抄 gongwen 方案)

打印/预览/画布共用渲染器,打印时:

```css
@page { size: A4 portrait; margin: 0; }        /* A5/landscape 由模板值生成:size: A5 landscape */

@media print {
  body * { visibility: hidden; }
  .bd-paper, .bd-paper * { visibility: visible; }
  .bd-paper { position: absolute; inset: 0; margin: 0; box-shadow: none; transform: none !important; }
  .bd-paper { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* 设计态专属层(网格/参考线/手柄)根本不在打印 DOM;若同 DOM 则 .bd-editing-only{display:none!important} */
}
```

硬性要点(违反即预览≠打印):
1. 纸内定位/尺寸只用 mm、字号只用 pt;**任何 px/rem 不得进入 `.bd-paper`**。
2. 缩放只作用于屏幕 wrapper 的 `transform`,打印前置 `transform:none`。
3. `@page margin: 0`,边距由模板 margin 参考线引导用户自行留白(元素坐标含边距语义),避免双重边距。
4. 颜色:纸内黑白为主;qrcode 纯黑;`print-color-adjust: exact` 保灰度表格线。
5. 多页:MVP 单页(元素超纸面在设计器就警示);明细表跨页+表头重复列 P1(契约同口径)。
6. 打印入口统一 `window.print()`,打印容器挂 body 级 Portal(与运行时 §4.5 同一容器)。

### 1.11 暗色(画布纸面恒白)

- `.bd-desk` 桌面、三栏、标尺、工具条:全部主题 token,暗色自动(桌面暗色下 `#1f2328` 观感,
  同 `gw-preview-shell` 的 `.dark` 处理)。
- `.bd-paper` 及其内元素、网格线、margin 参考线:**写死色值**,暗色下纸依旧白、字依旧黑、网格依旧浅灰。
- 选中框/手柄/智能参考线用 `--primary`(它们属于交互 chrome,画在覆盖层,可随主题)——primary 在两态
  都与白纸有足够对比,允许跟随主题。

---

## 2. 元素视觉(画布呈现)

### 2.1 状态总表

| 状态 | 视觉 |
|---|---|
| 常态(数据完备) | 按最终打印样呈现(所见即所得第一原则) |
| 占位态(设计态特有) | 内容未定时的灰示意,见各元素;**只在设计态**,预览/打印消失 |
| 绑定态(field/sysfield/table) | 值位置显示 `«字段label»` token 样式:字面文字 + 淡蓝底 `#dbeafe` 圆角 2px(设计态);预览换真样例 |
| **未绑警示** | 见 2.3,琥珀色系 |
| 选中/hover | §1.5 |
| 超出纸面 | 超界部分照画(不裁),外框变 `#f59e0b` 虚线 + 右上角 `TriangleAlert` 12px 琥珀标 |

> 设计态语境色(淡蓝 token 底、琥珀警示)是**画布覆盖层的写死色值**(白纸语境),不随主题,不进打印。

### 2.2 各元素呈现

**label(静态文本)**:即见即所得——文本按 style 的字号/加粗/对齐用宋体族(`"SimSun","宋体",serif`,
默认字体族全局一致,P1 再开字体选择)。空文本时显示灰字「双击输入文本」(设计态占位);
**双击 = 进入内联编辑**(contentEditable 或浮动 Input)。

**field(表单字段)**:一行内 `前缀label` + 值 token:

```
┌────────────────────────┐
│ 请假类型: «请假类型»    │   ← 前缀黑字;token = 字段label,#1e40af 字 + #dbeafe 底 + 圆角
└────────────────────────┘      h 不足以放下字号时,框内容器 overflow hidden(打印同裁切)
```

**sysfield(系统字段)**:同 field 版式,token 底色改**淡紫** `#ede9fe` / 字 `#5b21b6`,与表单字段
一眼区分;token 前缀小图标 `Hash` 10px。

**table(明细循环)**:

```
┌───────┬───────┬───────┐
│ 事项   │ 金额  │ 备注   │  ← 表头行:headerBold 生效,底 #f3f4f6,黑 0.75pt 边线
├───────┼───────┼───────┤
│ «name»│«amount»│ «memo»│  ← 设计态:2 行幽灵样行,token 样式,行高=style 行高
│  ⋯    │  ⋯    │  ⋯    │     第二行内容用「⋯」弱化,暗示循环
└───────┴───────┴───────┘
- 整表宽 = w(mm);列宽为 columns[].w,末列吃剩余;列边线可在画布直接拖拽调宽(命中 ±2px,
  光标 col-resize,坐标浮签显示两侧列宽 mm)
- 高度 = 表头 + 设计态 2 行(运行时随数据行数增长;MVP 超纸面即警示)
```

**line**:黑色实线,粗 0.75pt 默认;h 恒 0(水平)——垂直线用 w=0(两端手柄拖拽决定方向);
命中区放宽到 6px 便于选中。

**rect**:0.75pt 黑边框、透明填充;常用作签名框/裁切框。

**image**:有 src → 实图按适应方式渲染;无 src(设计态占位)→

```
┌ ─ ─ ─ ─ ─ ┐
   Image图标      虚线框 #d1d5db + 居中 ImageIcon 16px + 「双击上传」灰字
└ ─ ─ ─ ─ ─ ┘    双击 = 打开上传;预览/打印时无 src 不渲染
```

**qrcode**:设计态直接用插值前模板串生成**真实 QR**(值如 `{{docNo}}` 字面串——扫出来是占位符没关系,
视觉即真实黑白模块);框内留 QR 标准静区(quiet zone ≥2 模块);下方不渲染文字(纯图)。
生成器用 ~10KB 级无依赖实现(契约要求,不引重库)。

### 2.3 未绑字段警示 + 保存门禁

**field/sysfield/table 的 `field` 为空或不在字段清单**(表单换绑/字段删除后失效):

```
- 外框:1.5px dashed #f59e0b(琥珀)
- token 变:「未绑定字段」/「字段已失效: leaveTyp」,底 #fef3c7、字 #92400e
- 右上角 TriangleAlert 12px 琥珀角标;Tooltip 说明原因
```

**保存校验**(点保存时):
- 阻断项:无(允许保存半成品草稿模板)。
- 警告项(toast + 左栏顶部黄条汇总,点击定位到元素):未绑定字段 N 个、元素超出纸面 N 个、
  table 列宽合计 > 表宽。
- 「设为默认模板」时若存在失效字段 → `AlertDialog` 确认(“该模板存在失效绑定,打印将输出空值”)。

---

## 3. 定义管理页 `/bizdoc/defs`

### 3.1 布局与列表

`PageHeader`(标题「单据管理」+ 右侧「新建定义」primary 按钮)+ `Card` 包 `DataTable`:

| 列 | 说明 |
|---|---|
| 编码 code | `font-mono text-xs` |
| 名称 name | 主列,`font-medium`;前置 icon(定义配置的图标,无则 `FileSpreadsheet`) |
| 分类 category | `Badge variant="outline"` 中性 |
| 表单 | `formType` 小标(ONLINE 蓝 / CODE 紫,`text-[10px]`)+ formCode |
| 编号规则 | 规则名或 `—`(不占号) |
| 审批流 | wf defCode 或 `—`(纯台账) |
| 状态 | §3.4 徽标 |
| 更新时间 | `text-muted-foreground text-xs` |
| 操作 | 编辑 / 发布|停用 / 打印模板 / 删除(仅 DRAFT) |

`searchKeys=[code,name]` 快搜;权限 `bizdoc:def:write` 门控整页入口(菜单层)。

### 3.2 编辑抽屉(Drawer width≈640,分区纵排)

一个抽屉纵向分区滚动(区间 `Separator` + 区头 `text-sm font-semibold`),**不用 tabs**——定义字段
总量不大,一屏纵览减少跳转;打印模板列表在最后一区。

```
① 基本信息    code(新建可填,编辑只读 font-mono)/ name / category / icon(图标选择器,可缺省)
              / remark(Textarea)/ 标题模板(Input,占位提示「缺省=定义名+创建人」)
② 绑定表单    formType(Tabs: 在线表单|CODE 表单)→ 下拉(ONLINE=表单定义列表 / CODE=登记表单列表)
              选中后下方灰卡预览字段清单(前 8 个字段 label chips + 「共 N 字段」)
③ 编号规则    下拉(复用公文规则列表,含「不占号」空选项);选中显示 pattern 示意(font-mono text-xs)
④ 审批流      下拉(已发布 wf defs,含「不绑定(纯台账)」);选中显示「提交后将发起审批」提示行
⑤ 台账配置    两个可排序清单(同 table 列编辑器交互):
              · 台账列 columns:字段下拉 + 显示名 + 宽度(可选);拖拽排序
              · 查询条件 filters:字段下拉 + 显示名 + 控件类型(文本/下拉/日期区间)
              字段选项 = ②所绑表单字段清单 ∪ 系统字段(单号/状态/创建人/时间)
⑥ 打印模板    列表行:名称 + 纸张徽标(A4/A5·横)+ 默认星标(Star,点击设默认)+ 编辑(→ §1 整页)
              + 删除;底部「新建模板」dashed 按钮(新建后直接进设计器)
```

- ②~⑤ 的变更若影响已发布定义,保存时后端校验;前端在区头右侧放灰字提示「发布后修改台账配置即时生效」。
- footer:取消 / 保存草稿 / 保存并发布(状态 DRAFT 时)。

### 3.3 发布 / 停用

- 发布:操作列或抽屉 footer;失败(后端校验:表单不存在/规则不存在/流程未发布/台账字段越界)时
  `toast.error` 逐条列出原因(后端 400 message 直显)。
- 停用:`AlertDialog` 确认「停用后单据中心不再展示入口,存量单据不受影响」。

### 3.4 定义状态徽标

沿用 `WF_STATUS_META` 语法(`Badge variant="outline"`):

| 状态 | 文案 | 类 |
|---|---|---|
| DRAFT | 草稿 | `border-slate-500/30 bg-slate-500/10 text-slate-500` |
| PUBLISHED | 已发布 | `border-emerald-500/30 bg-emerald-500/10 text-emerald-600` |
| DISABLED | 已停用 | `border-gray-500/30 bg-gray-500/10 text-gray-500` |

---

## 4. 单据中心与运行时台账

### 4.1 单据中心入口(卡片墙)

菜单「单据中心」→ 已发布定义的卡片墙(路由如 `/bizdoc/center`,遵循 path=菜单 key 约定):

```tsx
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
  <button className="group flex items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-sm
                     transition-colors hover:border-primary/40 hover:shadow-md
                     focus-visible:ring-[3px] focus-visible:ring-ring/50">
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <Icon className="size-5" />   {/* def.icon,缺省 FileSpreadsheet */}
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium group-hover:text-primary">{def.name}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{def.category ?? "通用"}</p>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {def.wfDefCode && <Badge variant="outline" className="h-4.5 px-1.5 text-[10px]">审批流</Badge>}
        {def.numberRuleId && <Badge variant="outline" className="h-4.5 px-1.5 text-[10px]">自动编号</Badge>}
      </div>
    </div>
    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
  </button>
</div>
```

点击 → `/bizdoc/run/:defCode`。卡片按 category 分组(组头 `text-xs font-medium text-muted-foreground`)。

### 4.2 运行时台账 `/bizdoc/run/:defCode`

`PageHeader`(定义名 + description=分类;actions=「新建{定义名}」primary)+ 筛选行 + `DataTable`:

- **筛选行**(list_config.filters 驱动,`flex flex-wrap gap-2`):文本 → `Input h-8 w-44`;
  下拉 → `Select h-8`(选项来自字段 options);日期区间 → 两枚 `DatePicker h-8`。
  外加固定「状态」下拉与关键字 `Input`。变更即触发 serverSearch(防抖 300ms)。
- **动态列**(list_config.columns 驱动):`meta.title` 用配置显示名(喂列显隐/CSV 导出);
  固定前置列:单号(`font-mono text-xs`,无号显 `—`)、标题(主列,点击开详情);
  固定后置列:状态徽标(§4.4)、创建人、创建时间、操作。
- **serverPagination**(0-based pageIndex,`DataTable` 现成模式)。
- **行操作**(依状态显隐):

| 状态 | 可用操作 |
|---|---|
| DRAFT | 详情 / 编辑 / 提交 / 删除 |
| APPROVING | 详情 / 查看流程(链接 `/workflow/instances/:pid`) |
| EFFECTIVE | 详情 / 打印 / 作废 |
| REJECTED | 详情 / 编辑(改后再提)/ 作废 |
| VOID | 详情 / 打印(水印见 §4.5) |

### 4.3 新建 / 编辑抽屉

- **ONLINE 表单**:`Drawer`(width 640,resizable)内嵌 `FormRenderer`(schema=绑定表单 widgets);
  footer 双动作:「保存草稿」(secondary)/「提交」(primary;有流程时文案=「提交审批」)。
  提交成功 → toast + 抽屉关 + 台账刷新;有流程的补一条 toast action「查看流程」。
- **CODE 表单**:不开抽屉,直接跳转该表单发起页(同契约 §5「跳转(CODE)」);台账行「编辑」同理跳转。
- **详情**:同抽屉复用,`FormRenderer readOnly` + 顶部信息条(单号/状态徽标/创建人/时间)+
  流程单据加「审批记录」链接;REJECTED 态在信息条下放 `bg-rose-500/10 text-rose-600 rounded-md px-3 py-2 text-xs`
  驳回原因条(取流程意见)。

### 4.4 单据状态徽标(运行时)

与 `WF_STATUS_META` 同族配色,语义对齐:

| 状态 | 文案 | 类 |
|---|---|---|
| DRAFT | 草稿 | `border-slate-500/30 bg-slate-500/10 text-slate-500` |
| APPROVING | 审批中 | `border-blue-500/30 bg-blue-500/10 text-blue-600` |
| EFFECTIVE | 生效 | `border-emerald-500/30 bg-emerald-500/10 text-emerald-600` |
| REJECTED | 驳回 | `border-rose-500/30 bg-rose-500/10 text-rose-600` |
| VOID | 作废 | `border-gray-500/30 bg-gray-500/10 text-gray-400 line-through decoration-gray-400/60` |

> VOID 加删除线是唯一"非纯色"处理——作废单据要一眼与生效区分,且灰度模式下仍可辨(形状编码)。

### 4.5 打印流程(选模板 → 预览 → 打印)

1. 行操作「打印」→ 若定义只有一个模板**直接进预览**;多个 → `DropdownMenu` 列模板名
   (默认模板置顶带 `Star` 标)。
2. **打印预览 Modal**(大尺寸,`width≈900`,内滚):
   - 主体 = `.bd-desk` 灰底 + `.bd-paper`(§1.10 同一渲染器,数据来自
     `GET /api/bizdoc/docs/{id}/print?tplId=`:tpl JSON + form_data + 系统字段 + fields label 映射)。
   - 顶部工具条:模板切换下拉(重新拉数据)、缩放(适应宽度默认)、`打印`(primary,`Printer` 图标)。
   - **VOID 单据**:纸面斜向 45° 水印「作废」(`#9ca3af` 22pt 半透明 0.25,重复平铺;进打印——作废件
     打出来必须可辨,防止流通)。
3. 「打印」→ `window.print()`(打印容器 Portal 到 body,`@media print` 隔离,§1.10)。
4. 失效模板兜底:print 接口返回的 tpl 含失效字段绑定 → 该元素输出空,预览顶部黄条提示
   「模板存在失效字段,建议联系管理员更新」。

---

## 5. a11y / 空态 / 加载态

### 5.1 a11y

- **设计器**:
  - 画布元素是可聚焦节点(`tabindex=0` + `role="button"` + `aria-label="字段元素:请假类型,位置 25,30 毫米"`);
    `Tab` 按元素数组序遍历,聚焦即选中(等价单击),方向键微调即 §1.6。
  - 全部能力有非拖拽等价途径:位置尺寸可在属性面板键入;对齐分布有按钮;字段可"点击添加"不必拖。
  - 标尺/网格/参考线 `aria-hidden`;坐标浮签仅视觉,属性面板输入框是可达数据源。
  - 工具条按钮 `Tooltip` + `aria-label`;缩放控件可键盘操作。
- **通用**:所有 icon-only 按钮带 `aria-label`;抽屉/Modal 沿用 Radix 焦点圈;台账行操作按钮
  `min h-8`,移动端热区 ≥44px;状态不只靠色(徽标有文字、VOID 有删除线)。
- 危险操作(删除定义/作废/停用)一律 `AlertDialog` 二次确认,确认键 `variant="destructive"`。

### 5.2 空态

| 场景 | 呈现 |
|---|---|
| 定义列表空 | 居中插画区:`FileSpreadsheet size-8 text-muted-foreground/40` + 「还没有单据定义」+ 「新建定义」primary 按钮 |
| 单据中心无已发布定义 | 同上文案「暂无可用单据,请联系管理员发布」(无按钮,普通用户无定义权限) |
| 台账无数据 | `DataTable` 内置空态 + 「新建{定义名}」按钮;有筛选条件时文案改「无匹配结果」+「清空筛选」ghost 按钮 |
| 设计器空画布 | 纸面中央灰字「从左侧拖入元素或字段开始设计」(设计态 only) |
| 定义未绑表单进台账 | 整页提示卡「该单据未完成配置(缺表单绑定)」+ 管理员可见「去配置」按钮 |
| 打印无模板 | 打印入口置灰 + Tooltip「未配置打印模板」;管理员在预览位显示「去创建模板」链接 |

### 5.3 加载态

| 场景 | 呈现 |
|---|---|
| 定义列表/台账 | `DataTable` Skeleton 行(现成模式) |
| 卡片墙 | 6 枚 `Skeleton h-24 rounded-xl` |
| 编辑抽屉(拉字段清单) | 区块内 `Skeleton h-9` 若干;字段下拉 loading 态 `disabled` + spinner |
| 设计器载入模板 | 中栏纸面位置 `Skeleton`(A4 比例);左栏字段树 Skeleton 行 |
| 打印预览拉数据 | Modal 内 A4 比例 Skeleton;工具条「打印」disabled |
| 提交/保存中 | 按钮「提交中…」+ disabled(FormRenderer 现成 submitting 模式) |
| offline | 台账/列表降级 mock + 顶部离线横幅(全站既有模式);设计器/打印提示需后端,入口置灰 |

---

## 6. 组件落地清单(给疾风)

```
web/src/pages/bizdoc/
  defs.tsx                    §3 定义管理(列表+编辑抽屉)
  center.tsx                  §4.1 单据中心卡片墙
  run.tsx                     §4.2-4.4 运行时台账(动态列/筛选/抽屉)
  print-preview.tsx           §4.5 打印预览 Modal(复用渲染器)
  designer/
    index.tsx                 §1.1 三栏整页 + 顶栏
    canvas.tsx                §1.2/1.4/1.5 画布交互层(拖拽/框选/手柄/参考线)
    ruler.tsx                 §1.3 mm 标尺(Canvas 2D)
    element-panel.tsx         §1.8 元素面板
    field-tree.tsx            §1.8 字段树
    property-panel.tsx        §1.7 属性面板(按类型分发)
    align-toolbar.tsx         §1.5 对齐分布工具条
    model.ts                  模板 JSON 类型(契约 §4)+ 默认值/校验
web/src/components/bizdoc/
  paper-renderer.tsx          共用渲染器(设计/预览/打印三态,§0 同源红线)
  bizdoc.css                  .bd-paper 恒白作用域 + @media print(照 gongwen.css 结构)
  qrcode.ts                   轻量 QR 生成(无依赖)
  sample-data.ts              §1.9 样例数据生成
```

---

## 7. 开放项(待主控/磐石对齐)

1. **style 扩展字段**:line/rect 线宽与虚实、image 适应方式、qrcode 纠错级别、label 字体族——
   契约 JSON 未含,本文按提案给了默认值;需主控裁定进 schema(`schemaVersion` 仍为 1 可兼容,均有缺省)。
2. **元素坐标是否含 margin**:本文按契约示例取「x/y 相对纸张原点、margin 仅参考线」;若磐石渲染另有
   理解,以 JSON 契约字段注释为准对齐。
3. **撤销/重做**:本文列为设计器标配(删除无确认依赖它);若批 B 工期紧,可降级为"删除加确认 + 无撤销",
   请主控裁定。
4. **table 跨页/表头重复**:契约已列 P1,本文 MVP 按"超纸面警示、不分页"处理,预览与打印一致。
5. **编号规则样例**(§1.9 预览 docNo):前端本地按 pattern 拼示意即可,还是加只读接口取真实预览号?
   建议前端本地拼(零接口),精确格式以磐石 `DocNumberService` pattern 语法为准。
6. **VOID 水印进打印**:本文裁定作废件打印必须带水印(合规考虑);若业务另有口径请主控确认。
```

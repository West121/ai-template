# 公文版式规范（GB/T 9704） · 红头 / 正文 / 用印 预览与打印

> 丹青（UI/视觉）产出 · 对应 `docs/design/gongwen-advanced.md` 第 7 节。
> 本文是**版式实现契约**：疾风据此实现红头正文预览组件与打印样式，磐石据此设计 `oa_doc_template.content` 占位符与渲染输出。
> 依据国家标准 **GB/T 9704—2012《党政机关公文格式》**。企业场景对"发文机关标志/密级"等做合规化沿用，非强制党政公文的可裁剪，但版式尺寸、字体字号一律照标准落地，保证"看起来就是正规公文"。

---

## 0. 设计红线（先读）

1. **预览 / 打印固定白底正规版式**：公文纸永远是白纸黑字红章，**不随深浅色主题变化**。深浅色只影响外层编辑 UI（工具条、抽屉、表单）。实现上，公文纸容器 `.gongwen-paper` 内**不使用**任何主题 token（`--background`/`--foreground`/`bg-card` 等），一律用写死的 `#fff` / `#000` / 公文红。
2. **尺寸用物理单位**：版心、页边距、字号一律以 **mm / pt** 表达（CSS 原生支持），保证屏幕预览与打印/PDF **同一套尺寸、所见即所得**。不要用 `rem`（会被根字号和缩放污染）。
3. **字号照标准**：正文三号（16pt）、标题二号（22pt）等，见 §2 字号映射表，禁止"差不多就行"。
4. **文号六角括号**：`〔〕`（U+3014/U+3015），不是方括号 `[]`、不是全角方括号 `【】`。年份用四位全称：`涵韬办〔2026〕15号`。
5. **一页 22 行 × 每行 28 字**：GB/T 9704 正文的硬指标，用行距/字距落地（§4）。

---

## 1. 版心与页边距（A4）

GB/T 9704 采用 **A4（210mm × 297mm）**，公文用纸天头（上白边）、订口（左白边）固定，版心即正文可排区域。

| 项 | 尺寸 | 说明 |
|---|---|---|
| 纸张 | 210mm × 297mm | A4 纵向 |
| 天头（上白边） | **37mm** | 版心上边缘距纸张上边缘 |
| 订口（左白边） | **28mm** | 版心左边缘距纸张左边缘 |
| 版心宽 | **156mm** | = 210 − 28（左）− 26（右） |
| 版心高 | **225mm** | = 297 − 37（上）− 35（下） |
| 版心 | **156mm × 225mm** | 正文、红头、标题、版记全部排布在版心内 |

> 页码：单页码居版心下边缘下 1 行，7 号（≈14px）阿拉伯数字，单页居右（订口在左）、双页居左，两侧各放一条一字线（`—　1　—` 形式）。MVP 预览可只在打印时出页码。

**CSS 落地（页面盒）：**

```css
.gw-page {
  box-sizing: border-box;
  width: 210mm;
  min-height: 297mm;
  padding: 37mm 26mm 35mm 28mm;   /* 上 右 下 左 —— 即版心内缩 */
  margin: 0 auto;
  background: #fff;
  color: #000;
}
.gw-typearea {                     /* 版心：显式给出 156mm，供份号/紧急程度绝对定位参照 */
  position: relative;
  width: 156mm;                    /* = 版心宽 */
  min-height: 225mm;               /* = 版心高 */
}
```

---

## 2. 字体族与字号映射

### 2.1 公文标准字体族（含 Web 回退）

GB/T 9704 常用四种字体。系统未必装齐，给出回退链，最终回退到常见中文字体，**保证不掉成默认无衬线**。

| 用途 | 标准字体 | CSS `font-family` 建议 |
|---|---|---|
| 发文机关标志（红头）、标题 | 方正小标宋 | `"FZXiaoBiaoSong-B05S", "方正小标宋简体", "STZhongsong", "华文中宋", "SimSun", "宋体", serif` |
| 正文、主送、成文日期、附注 | 仿宋（仿宋_GB2312） | `"FangSong", "仿宋", "仿宋_GB2312", "FangSong_GB2312", "STFangsong", "华文仿宋", serif` |
| 一级标题（可选）、版记机关名 | 黑体 | `"SimHei", "黑体", "Microsoft YaHei", "Heiti SC", sans-serif` |
| 领导批示 / 特定强调 | 楷体 | `"KaiTi", "楷体", "KaiTi_GB2312", "STKaiti", "华文楷体", serif` |

> 建议在 `.gongwen-paper` 作用域内定义 4 个 CSS 变量 `--gw-font-song / --gw-font-fs / --gw-font-hei / --gw-font-kai`，组件与模板渲染 HTML 都引用变量，便于集中调整回退链。

### 2.2 中文字号 → pt → px（96dpi）映射表

Chinese "号"制换算，px 仅供屏幕估算参考（预览请用 pt，打印精确）。1pt = 1/72in，96dpi 下 1pt ≈ 1.333px。

| 号 | pt | px(96dpi) | 公文用途 |
|---|---|---|---|
| 小初 | 36 | 48.0 | （超大红头，联合行文可用） |
| 一号 | 26 | 34.7 | 发文机关标志常用（红头字号由机关定，一般≥二号） |
| 二号 | 22 | 29.3 | **标题**（2 号小标宋） |
| 小二 | 18 | 24.0 | 副标题 |
| **三号** | **16** | **21.3** | **正文 / 主送 / 成文日期 / 抄送**（GB/T 默认字号） |
| 小三 | 15 | 20.0 | — |
| 四号 | 14 | 18.7 | 版记（抄送、印发机关和日期） |
| 小四 | 12 | 16.0 | 附注可用 |
| 五号 | 10.5 | 14.0 | — |
| 七号 | 5.25 | 7.0 | 页码 |

**CSS 变量落地：**

```css
.gongwen-paper {
  --gw-size-title: 22pt;   /* 二号 标题 */
  --gw-size-body:  16pt;   /* 三号 正文/主送/日期 */
  --gw-size-fwzh:  16pt;   /* 三号 发文字号 */
  --gw-size-fj:    14pt;   /* 四号 版记 */
  --gw-size-mark:  16pt;   /* 三号 份号/密级/紧急程度 */
}
```

### 2.3 公文红（唯一红色 token）

红头、红色分隔线、电子印章统一使用**公文红**（正红/大红），不用主题 primary。

```css
.gongwen-paper { --gw-red: #e60012; }   /* 公文标准正红；备选 #d7000f。全篇红头/红线/印章统一引用 */
```

---

## 3. 红头（文头）区版式

红头区自上而下：**份号/密级/紧急程度标注 → 发文机关标志 → 发文字号（含签发人）→ 红色分隔线**。

### 3.1 版心右上/左上标注位（份号 / 密级 / 紧急程度）

标注在**版心内**顶部，位于发文机关标志之上（不占红头居中区）。三者定位：

| 项 | 位置 | 字号/字体 | 示例 |
|---|---|---|---|
| 份号 `{copyNo}` | 版心**左上角第 1 行**，顶格 | 三号黑体，6 位阿拉伯数字 | `000123` |
| 密级+保密期限 `{secret}` | 版心**左上角第 2 行**，顶格 | 三号黑体 | `秘密★1年` / `机密★` |
| 紧急程度 `{urgency}` | 版心**右上角**，顶格 | 三号黑体 | `特急` / `加急` |

> 规则：只有涉密公文才有份号/密级；密级与紧急程度可同时出现（密级居左、紧急程度居右同一视觉行）。无值则整块不占位。用绝对定位挂在 `.gw-typearea` 顶部即可，不推高红头。

```html
<div class="gw-marks">
  <div class="gw-marks-left">
    <div class="gw-copyno">{copyNo}</div>        <!-- 份号 -->
    <div class="gw-secret">{secret}</div>          <!-- 密级★期限 -->
  </div>
  <div class="gw-urgency">{urgency}</div>          <!-- 紧急程度，右上 -->
</div>
```

```css
.gw-marks { position: absolute; top: 0; left: 0; right: 0;
  display: flex; justify-content: space-between; align-items: flex-start; }
.gw-copyno, .gw-secret, .gw-urgency {
  font-family: var(--gw-font-hei); font-size: var(--gw-size-mark); line-height: 1.6; color: #000; }
.gw-urgency { color: var(--gw-red); }   /* 紧急程度惯用红字强调（企业习惯，标准未强制，可去红） */
```

### 3.2 发文机关标志（红头文字）

- **红色、居中**，小标宋体，字号由机关自定（一般一号或更大，联合行文可更大）。文字如"涵韬科技有限公司文件""涵韬科技有限公司办公室文件"。
- 上边缘（红头首字上沿）距版心上边缘推荐约 **35mm**（企业化预览可放宽，保持视觉留白即可）。
- "×××文件"整体作为一个红色标志块，居中；"文件"二字与机关名同字号同色。

```html
<div class="gw-header">{issuingOrg}</div>   <!-- 例：涵韬科技有限公司文件 -->
```

```css
.gw-header {
  font-family: var(--gw-font-song);
  font-size: 34pt;                 /* ≈ 一号；模板可按机关名长度在 26–36pt 间调 */
  font-weight: 700;
  color: var(--gw-red);
  text-align: center;
  letter-spacing: 0.05em;
  padding-top: 8mm;                /* 距顶部标注留白，视觉上距版心上边缘约 35mm */
  line-height: 1.2;
}
```

### 3.3 发文字号 与 签发人

- **下行文/平行文**（默认）：发文字号**居中**，编排在发文机关标志下空二行。年份六角括号，序号不足位不补零？—— GB/T：序号不编虚位（即不写 001，写 1），**但企业台账若按 `seq_width` 补零则以磐石规则为准**，版式两者都能渲染，居中即可。
- **上行文**（请示/报告）：发文字号**居左空一字**；同一行**签发人居右空一字**，格式 `签发人：×××`。多签发人时，签发人从左到右、自上而下排，发文字号与最后一个签发人姓名底端对齐。
- 签发人 `{issuer}` **仅上行文**出现（`doc_type ∈ {请示, 报告}` 或磐石传入 `isUpward=true`）。

```html
<!-- 下行文/平行文：居中 -->
<div class="gw-docnum gw-docnum--center">{docNumber}</div>

<!-- 上行文：字号居左，签发人居右 -->
<div class="gw-docnum gw-docnum--upward">
  <span class="gw-docnum-text">{docNumber}</span>
  <span class="gw-issuer">签发人：{issuer}</span>
</div>
```

```css
.gw-docnum {
  font-family: var(--gw-font-fs); font-size: var(--gw-size-fwzh); color: #000;
  margin-top: 2em;                 /* 距红头空二行 */ line-height: 1.9;
}
.gw-docnum--center { text-align: center; }
.gw-docnum--upward { display: flex; justify-content: space-between; align-items: flex-end;
  padding: 0 1em;                  /* 左右各空一字 */ }
.gw-issuer { font-family: var(--gw-font-fs); }
```

### 3.4 红色分隔线（文头线 / 红反线）

发文字号之下、正文之上一条**红色横线**，宽度**等于版心宽 156mm**，居中。上行文时红线位于签发人之下。

```html
<hr class="gw-red-line" />
```

```css
.gw-red-line {
  border: none; height: 0; width: 100%;              /* 撑满版心 */
  border-top: 1.2pt solid var(--gw-red);
  margin: 0.4em 0 0;                                  /* 距发文字号约一行 */
}
```

> 注：标准中"文头线"配合底端的"武线（末线）"构成红头区。MVP 预览用一条红反线即可；如需严谨，可在成文日期区下方另配一条同色细线。

---

## 4. 主体区版式（标题 / 主送 / 正文 / 成文日期 / 附注）

### 4.1 标题

- **2 号小标宋，居中**，红线下空二行。
- 可回行分多行，**回行时词意完整、排列对称、间距恰当**（避免把词拆断、避免上长下短的倒梯形）。
- 标题中除法规、规章名称加书名号外，一般不用标点。

```css
.gw-title {
  font-family: var(--gw-font-song); font-size: var(--gw-size-title); font-weight: 700;
  text-align: center; line-height: 1.5; margin: 2em 0 0;   /* 红线下空二行 */
  word-break: keep-all;                                     /* 中文按词不断（配合手动换行更佳） */
}
```

### 4.2 主送机关

- 标题下空一行，**左顶格**（版心左边缘），三号仿宋。回行仍**顶格**，最后一个机关名后加**全角冒号**`：`。

```css
.gw-recipients {
  font-family: var(--gw-font-fs); font-size: var(--gw-size-body);
  text-align: left; margin-top: 1em; line-height: 1.9;     /* 主送→正文行距见 §4.3 */
}
.gw-recipients::after { content: "："; }   /* 或由渲染端补冒号，二选一，勿重复 */
```

### 4.3 正文（GB/T 硬指标：每面 22 行 × 每行 28 字）

- **三号仿宋**。每自然段**左空二字**（首行缩进 2 字），回行**顶格**。
- 版心高 225mm / 22 行 ⇒ **每行占高约 10.23mm**（≈ 29pt 行距）。三号字高约 5.6mm，故行距明显大于字高，呈舒朗排布。
- 每行 28 字：版心宽 156mm / 28 ≈ 5.57mm/字 ≈ 三号全角字宽，即**字距为 0（正常全角）**，不额外加字距。
- 结构层次序号：一级`一、` 二级`（一）` 三级`1.` 四级`（1）`。一级可用黑体、二级楷体、三四级仿宋（标准建议，可简化为全仿宋）。

```css
.gw-body {
  font-family: var(--gw-font-fs); font-size: var(--gw-size-body); color: #000;
  text-align: justify;
  line-height: 29pt;               /* ≈ 版心高/22 行，落地"每面22行" */
  letter-spacing: 0;               /* 全角字，字距 0 → 每行 28 字 */
}
.gw-body p { margin: 0; text-indent: 2em; }   /* 每段左空二字 */
```

> 若 `{body}` 为富文本 HTML，渲染端务必把段落包成 `<p>`；`.gw-body` 的 `text-indent:2em` 自动实现"左空二字"。表格/图片按版心宽 156mm 约束（`max-width:100%`）。

### 4.4 成文日期

- 阿拉伯数字标全 `2026年7月10日`（年份四位、月日不补零），三号仿宋。
- **右空四字**（右边距内缩 4 个字宽），一般排在正文下空一行。不盖章的电子公文，成文日期即以此定位；**盖章时成文日期位置不变，印章下压于其上**（见 §6）。

```css
.gw-docdate {
  font-family: var(--gw-font-fs); font-size: var(--gw-size-body);
  text-align: right; padding-right: 4em;    /* 右空四字 */
  margin-top: 1em; line-height: 1.9; position: relative;   /* 作为印章定位参照 */
}
```

### 4.5 附注

- 如"（此件公开发布）"。成文日期下空一行，**左空二字**，加**全角圆括号**`（）`，三号仿宋。

```css
.gw-annotation {
  font-family: var(--gw-font-fs); font-size: var(--gw-size-body);
  text-indent: 2em; margin-top: 1em; line-height: 1.9;
}
```

---

## 5. 版记（抄送 / 印发机关和日期）

版记排在公文**最后一面下端**，四号字，上下用分隔线界定。含：抄送机关、印发机关和印发日期。

- **上分隔线**：版记第一条线（粗，通栏 156mm）；**下分隔线**：末条线（与页面底端齐）。中间可有分隔抄送与印发行的细线。
- **抄送机关** `{ccRecipients}`：`抄送：` 左空一字起排，机关间用逗号，回行与冒号后首字对齐，最后一个后加句号。
- **印发机关和印发日期**同一行：印发机关左空一字，印发日期右空一字（加"印发"二字），如 `涵韬科技有限公司办公室　　2026年7月10日印发`。

```html
<div class="gw-record">
  <div class="gw-cc">抄送：{ccRecipients}</div>
  <div class="gw-print-info">
    <span class="gw-print-org">{printOrg}</span>
    <span class="gw-print-date">{printDate}印发</span>
  </div>
</div>
```

```css
.gw-record {
  font-family: var(--gw-font-fs); font-size: var(--gw-size-fj); color: #000;
  border-top: 0.75pt solid #000; border-bottom: 0.75pt solid #000;   /* 上/下分隔线 */
  margin-top: 2em; padding: 0.3em 1em; line-height: 1.8;
}
.gw-cc { border-bottom: 0.5pt solid #000; padding-bottom: 0.2em; }   /* 抄送与印发间细线 */
.gw-print-info { display: flex; justify-content: space-between; padding-top: 0.2em; }
```

---

## 6. 电子印章渲染（半透明红章压成文日期）

**目标**：单一发文机关时，红色印章**端正、居中、下压成文日期**——章的中心大致压在成文日期文字上，做到"骑年盖月"的观感，且**不遮挡到看不清日期**（章为半透明，日期透出）。

### 6.1 定位规则

- 印章是一张**电子印章图片**（磐石 `oa_doc_template.seal_image_id` / 公文 `sealed_by` 后落地），透明背景 PNG，红色圆章。
- 以 **成文日期行 `.gw-docdate` 为定位参照**（相对定位容器），印章绝对定位：**水平中心对准成文日期文字中部，垂直方向章的中心压在日期文字基线附近**。
- 印章**只在 `seal_status = SEALED` 时渲染**；`PENDING` 可显示浅灰"待用印"占位轮廓（仅编辑态，打印不出）。

```html
<div class="gw-docdate">
  {docDate}
  <img class="gw-seal" src="{sealImageUrl}" alt="" aria-hidden="true" />   <!-- {seal} 占位 -->
</div>
```

```css
.gw-seal {
  position: absolute;
  width: 42mm; height: 42mm;               /* 电子章直径约 40–42mm，符合实体公章尺寸 */
  right: 6em;                              /* 使章中心落在"右空四字"的日期文字上方偏左 */
  top: 50%;
  transform: translateY(-55%);            /* 中心略高于基线，压住"年月" */
  opacity: 0.85;                           /* 半透明，日期透出 */
  mix-blend-mode: multiply;                /* 让红章与黑字自然叠印，避免白底方块 */
  pointer-events: none;
  z-index: 2;
}
```

> `mix-blend-mode: multiply` 是关键：印章 PNG 即便带白底也会与纸叠印成透明观感；配合 `opacity:0.85` 得到"盖章"质感。打印机/PDF 对 `mix-blend-mode` 支持良好，但**务必在打印预览验证**；若目标打印环境不支持，退回"透明背景 PNG + opacity"方案（磐石出图时即抠成透明底）。

### 6.2 纯 CSS 兜底章（无印章图片时的占位/演示）

模板未配印章图片时，用 CSS 画一个红圈章占位（仅供预览演示，正式盖章必须用图片）：

```css
.gw-seal--css {
  width: 42mm; height: 42mm; border-radius: 50%;
  border: 1.2mm solid var(--gw-red); color: var(--gw-red);
  display: flex; align-items: center; justify-content: center; text-align: center;
  font-family: var(--gw-font-song); font-size: 10pt; line-height: 1.2;
  opacity: 0.8; mix-blend-mode: multiply;
  /* 中间五角星可用 ::after 放一个红色 ★ */
}
```

---

## 7. 打印 / PDF 版式（@media print）

导出 PDF 走浏览器打印。要点：A4、去掉一切非公文 UI、公文纸铺满、分页正确。

```css
@page {
  size: A4 portrait;
  margin: 0;                 /* 页边距由 .gw-page 的 padding 承担，避免双重边距 */
}

@media print {
  /* 1. 隐藏所有非公文元素：外壳、工具条、抽屉、按钮 */
  body * { visibility: hidden; }
  .gongwen-paper, .gongwen-paper * { visibility: visible; }
  .gongwen-paper { position: absolute; inset: 0; margin: 0; }

  /* 2. 打印时精确还原颜色（红头/红章/红线必须打出来） */
  .gongwen-paper { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* 3. 多页公文分页：每页一张 A4 */
  .gw-page { page-break-after: always; box-shadow: none; }
  .gw-page:last-child { page-break-after: auto; }

  /* 4. 版记不被拦腰截断；标题/段落孤行控制 */
  .gw-record { break-inside: avoid; }
  .gw-body p { orphans: 2; widows: 2; }

  /* 5. 隐藏编辑态占位（待用印虚框、网格线等） */
  .gw-seal--pending, .gw-editing-only { display: none !important; }
}
```

> 屏幕预览时给 `.gw-page` 加 `box-shadow: 0 2px 12px rgba(0,0,0,.15)` 和外层灰底（`#e5e7eb`），模拟"纸张浮在桌面上"；打印时 shadow 与灰底自动去掉。**灰底属于外层预览容器，不进 `.gongwen-paper`**（纸内永远纯白）。

---

## 8. 密级 / 紧急 / 文种 徽标视觉（编辑 UI 用）

区分两个语境：
- **公文纸内**（§3.1）：密级/紧急按 GB/T 用**黑体三号文字**顶格标注，**不是彩色徽标**——公文纸要正规。
- **编辑 UI / 列表 / 台账**（跟随主题）：用彩色 Badge 徽标便于快速识别。以下是列表与办文单里的徽标规范（复用 shadcn `Badge variant="outline"`，与现有 `send.tsx` 的 StatusBadge 风格一致）。

### 8.1 密级徽标

| 密级 | 文案 | 建议类 |
|---|---|---|
| 公开 | 公开 | `text-muted-foreground`（无边框强调） |
| 内部 | 内部 | `border-slate-500/30 bg-slate-500/10 text-slate-600` |
| 秘密 | 秘密★ | `border-amber-500/30 bg-amber-500/10 text-amber-600` |
| 机密 | 机密★ | `border-orange-600/30 bg-orange-600/10 text-orange-700` |
| 绝密 | 绝密★ | `border-red-600/40 bg-red-600/10 text-red-700 font-medium` |

> `★` 是保密期限标志（GB/T：密级与期限间加"★"，如 `秘密★1年`）。徽标 hover/tooltip 展示完整期限。

### 8.2 紧急程度徽标

| 程度 | 文案 | 建议类 |
|---|---|---|
| 平件 | （不显示徽标） | — |
| 加急 | 加急 | `border-amber-500/40 bg-amber-500/10 text-amber-600` |
| 特急 | 特急 | `border-red-500/40 bg-red-500/10 text-red-600 font-medium` |
| 特提 | 特提 | `border-red-600/50 bg-red-600/15 text-red-700 font-semibold`（电报级，最高） |

### 8.3 文种徽标（doc_type）

文种用**低饱和中性徽标**（文种是分类不是告警，勿抢密级/紧急的红），统一 `border-blue-500/30 bg-blue-500/10 text-blue-600`；决定/通知/通报/报告/请示/批复/意见/函/纪要 皆同一视觉，仅文字不同。**上行文文种**（请示、报告）可加一个小箭头图标 `↑` 提示"上行"，联动 §3.3 签发人显示。

---

## 9. 组件结构骨架（完整拼装）

疾风的红头正文预览组件（如 `src/components/gongwen/gongwen-preview.tsx`）建议输出如下 DOM。占位符 `{...}` 由 props 或 `/templates/{id}/render` 返回的 HTML 填充。**外层 `.gongwen-paper` 是"固定白底"边界**，其内不出现任何主题 token。

```html
<!-- 外层：跟随主题的预览容器（灰底 + 工具条），可深浅色 -->
<div class="gw-preview-shell">
  <!-- 固定白底边界：以下全部写死黑白红，脱离主题 -->
  <div class="gongwen-paper">
    <div class="gw-page">
      <div class="gw-typearea">

        <!-- 版心顶部标注：份号/密级（左） 紧急程度（右） -->
        <div class="gw-marks">
          <div class="gw-marks-left">
            <div class="gw-copyno">{copyNo}</div>
            <div class="gw-secret">{secret}</div>
          </div>
          <div class="gw-urgency">{urgency}</div>
        </div>

        <!-- 红头 -->
        <div class="gw-header">{issuingOrg}</div>

        <!-- 发文字号（+上行文签发人） -->
        <div class="gw-docnum gw-docnum--center">{docNumber}</div>
        <!-- 上行文改用 .gw-docnum--upward，内含 {docNumber} 与 签发人：{issuer} -->

        <!-- 红反线 -->
        <hr class="gw-red-line" />

        <!-- 主体 -->
        <div class="gw-title">{title}</div>
        <div class="gw-recipients">{mainRecipients}</div>
        <div class="gw-body">{body}</div>   <!-- 富文本 HTML -->

        <!-- 成文日期 + 电子印章 -->
        <div class="gw-docdate">
          {docDate}
          <img class="gw-seal" src="{seal}" alt="" aria-hidden="true" />
        </div>

        <!-- 附注（可选） -->
        <div class="gw-annotation">{annotation}</div>

        <!-- 版记 -->
        <div class="gw-record">
          <div class="gw-cc">抄送：{ccRecipients}</div>
          <div class="gw-print-info">
            <span>{printOrg}</span><span>{printDate}印发</span>
          </div>
        </div>

      </div>
    </div>
  </div>
</div>
```

### 9.1 占位符 → 数据字段对照（对齐磐石 `oa_document` / 模板占位符）

| 占位符 | 来源字段 | 备注 |
|---|---|---|
| `{copyNo}` | `copy_no` | 涉密才有；6 位 |
| `{secret}` | `secret`(+`secret_expire`) | 组装 `密级★期限` |
| `{urgency}` | `urgency` | 加急/特急/特提 |
| `{issuingOrg}` | `issuing_org` | 红头文字 |
| `{docNumber}` | `code` | 六角括号；签发通过才占正式号 |
| `{issuer}` | `issuer` | **仅上行文** |
| `{title}` | `title` | |
| `{mainRecipients}` | `main_recipients` | `；`分隔 → 渲染为顿号/逗号，末尾补`：` |
| `{body}` | 正文富文本 | HTML，包 `<p>` |
| `{docDate}` | `doc_date` | `YYYY年M月D日` |
| `{seal}` | `oa_doc_template.seal_image_id` 图片 URL | 仅 `seal_status=SEALED` |
| `{ccRecipients}` | `cc_recipients` | 版记 |
| `{printOrg}` / `{printDate}` | 印发机关/日期 | 版记，可取发文机关+成文日期或单列字段 |
| `{annotation}` | `annotation` | 如"此件公开发布" |

> 磐石侧 `POST /templates/{id}/render` 建议**直接返回填好占位符的 `.gw-typearea` 内部 HTML**（用上述 class），前端套 `.gongwen-paper > .gw-page` 外壳即可预览/打印，避免前后端两套版式实现漂移。若模板 `content` 存的是含占位符的富文本，前端与后端**任选一端渲染**，但 class 命名与本文一致。

---

## 10. 落地清单（给疾风）

- [ ] 新建 `src/components/gongwen/gongwen.css`（或在 `index.css` 增 `.gongwen-paper` 作用域），**只用 mm/pt + 写死黑白红**，不引主题 token。
- [ ] 字体变量 `--gw-font-song/fs/hei/kai`、字号变量、`--gw-red` 收在 `.gongwen-paper` 上，一处可调。
- [ ] `GongwenPreview` 组件：props 驱动 or 吃 render HTML；`isUpward` 切换发文字号居中/居左+签发人。
- [ ] 打印按钮 → `window.print()`；`@media print` 隔离 `.gongwen-paper`。
- [ ] 徽标（§8）用于列表/台账/办文单，复用 `Badge`，与 `send.tsx` StatusBadge 同风格。
- [ ] 预览容器 `gw-preview-shell` 用主题灰底 + shadow 模拟桌面；纸内永远纯白。
- [ ] A4 缩放：预览区窄时用 `transform: scale()` 整体缩放 `.gw-page`（保持 mm 尺寸不变，仅视觉缩放），避免改字号破坏版式。

---

## 关键决策摘要

1. **物理单位优先**：版式全用 mm/pt，屏幕与打印同尺寸；px 仅作参考。禁 rem。
2. **固定白底边界 = `.gongwen-paper`**：其内脱离主题 token，写死黑/白/公文红 `#e60012`；主题只作用于外层编辑 UI 与灰底预览壳。
3. **字号照 GB/T**：标题二号 22pt、正文三号 16pt，落地"每面 22 行×28 字"（行距 29pt、字距 0、全角）。
4. **文号六角括号 `〔〕` + 四位年份**；上行文发文字号居左、签发人 `签发人：×××` 居右且仅上行文显示。
5. **印章 = 图片 + `opacity:0.85` + `mix-blend-mode:multiply`**，绝对定位下压成文日期（"骑年盖月"），仅 SEALED 渲染；提供纯 CSS 兜底章。打印须验证 blend 支持。
6. **打印**：`@page A4 margin:0`、边距交给 `.gw-page` padding、`visibility` 隔离公文纸、`print-color-adjust:exact` 保红色、`page-break` 分页、版记 `break-inside:avoid`。
7. **徽标双语境**：公文纸内密级/紧急用黑体三号文字（正规）；编辑 UI/列表用彩色 Badge（密级琥珀→红渐进、紧急红、文种中性蓝）。
8. **前后端一套 class**：磐石 `/templates/{id}/render` 返回本文 class 命名的 HTML，前端只套外壳，杜绝双实现漂移。

# AI 助手统计图 · SVG → shadcn/ui 图表(recharts)迁移规范(丹青)

> 用户定:AI 助手统计图从**纯 SVG 手绘**迁到 **shadcn/ui 官方图表(recharts)**。痛点(截图):月份标签被
> `c.length>6?slice(0,5)+"…"` 粗暴截断成「2026-…」、坐标轴/中心文字偏大不协调。
>
> 现状:`web/src/components/ai-chat/cards/chart-card.tsx`(手写 SVG donut/bar/line)+`chart-math.ts`
> (几何算术)。**只换 ChartCard 内部实现**——数据契约、下钻链路、路由(CardRouter/PartRouter)全不动。
> 疾风做完公文 D 阶段接此实施。只写规范,不改代码。

---

## 0. 现状事实核对(先纠三处偏差)

| coordinator 描述 | 代码实况(`types.ts` L96-104) | 结论 |
|---|---|---|
| `AiChartCard{title, spec:{chartType,categoryField,series}, rows?}` | **flat**:`{type:"chart", chartType, title, categories?:string[], series:AiChartSeries[], drill?}` | 无 `spec`/`categoryField`/`rows`;类目在顶层 `categories`,系列 `series` |
| `datasetId` 在 chart 卡 | `datasetId`(L85)在**列表卡**(带 `page` 分页) | chart 卡**无** datasetId;列表卡分页与本次无关,不动 |
| `series=AiChartSeries[]` | `AiChartSeries = { name, data:number[], percent? }` | ✔ 一致 |

- **渲染单点**:`AiChartCard` 经 `CardRouter`(`case "chart"`)与 V2 `PartRouter` 都汇入 `<ChartCard card>`。
  迁移只改 `ChartCard` 组件体,上游零改动。
- **下钻契约**:`card.drill = {reportCode, paramName}`;点击类目/扇区 → `executeReport(reportCode,
  {[paramName]: category})` → `reportResultToListPart(res.data)` → `useAiChatActions().appendAssistantParts(...)`。
  **onPick 签名 `(category: string) => void` 必须原样保留**(recharts 事件里取出 category 传它)。

---

## 1. 技术落地

### 1.1 安装

```bash
cd web
pnpm add recharts
# shadcn 图表基件(装到 components/ui/chart.tsx)。项目用 shadcn CLI:
pnpm dlx shadcn@latest add chart
```
- `shadcn add chart` 会生成 `web/src/components/ui/chart.tsx`,导出 `ChartContainer` /
  `ChartTooltip` / `ChartTooltipContent` / `ChartLegend` / `ChartLegendContent` / `ChartConfig` /
  `ChartStyle`。**不要手抄**,用 CLI 生成保证与本仓库 shadcn 版本/Tailwind v4 一致。
- 若 CLI 因离线/版本不可用:从 ui.shadcn.com 复制 `chart.tsx` 源码放到 `components/ui/`,确认它引用
  的是本仓库的 `cn`(`@/lib/utils`)。
- recharts 是**运行时依赖**;chart-card 已在懒加载分片内(assistant 懒加载),不额外拆包也可,但建议
  确认 recharts 只被 chart-card import,随 AI 面板懒加载,不进主包(分片纪律)。

### 1.2 组件结构(recharts + shadcn)

```
ChartCard(card)                     ← 卡壳不变:rounded-xl border bg-card p-3.5 + 标题 + role/aria
 ├─ 空/非法 guard → 「暂无数据」     ← 保留 isChartEmpty + 增 spec 兜底
 ├─ ChartContainer config={chartConfig} className="h-44 w-full"
 │    └─ (recharts) ResponsiveContainer  ← ChartContainer 内建,自适应面板宽/全屏
 │         ├─ bar  → <BarChart>  <CartesianGrid/> <XAxis/> <YAxis/> <ChartTooltip/> <Bar/>×series
 │         ├─ line → <AreaChart> <CartesianGrid/> <XAxis/> <YAxis/> <ChartTooltip/> <Area/>×series
 │         └─ pie  → <PieChart>  <ChartTooltip/> <Pie><Cell/>×slice</Pie> <Label 中心合计/>
 ├─ ChartLegend / 自绘 Legend        ← 图例(见 §2.2)
 └─ drilling 态提示(不变)
```

- `ChartContainer` 已接管:`ResponsiveContainer`、主题色注入(把 `chartConfig[key].color` 写成
  `--color-<key>` CSS 变量,light/dark 自动)、tooltip cursor、无障碍容器。
- **响应式**:`ChartContainer className="h-44 w-full"`(176px 高,承 ui-spec §3.5 的 h-44);宽由内部
  `ResponsiveContainer` 100% 自适应——面板拖宽、全屏都跟随,无需手算 viewBox。donut 可用 `h-52`。

---

## 2. 保留全部现有功能(逐项对照)

| # | 现有功能 | recharts 迁移做法 | 不变点 |
|---|---|---|---|
| ① | **下钻**(bar 类目 / pie 扇区点击 → onPick) | bar:`<BarChart onClick={(s)=> s?.activeLabel && onPick(String(s.activeLabel))}>` 或 `<Bar onClick={(d)=>onPick(d.category)} cursor="pointer">`;pie:`<Pie onClick={(d)=>onPick(d.name)}>` | `onPick(category:string)`、`executeReport`、`appendAssistantParts` 链路整段不动 |
| ② | **图例** | shadcn `<ChartLegend content={<ChartLegendContent/>}/>`;或保留现自绘 `Legend`(pie 带 percent 时用自绘更灵活) | pie 显 `percent%`(后端算)→ 自绘 Legend 保留 |
| ③ | **datasetId 分页列表卡** | 与 chart 无关(在列表卡),**不碰** | — |
| ④ | **主题 light/dark** | 颜色一律 `var(--chart-1..5)`(index.css 已定义两态);`chartConfig[key].color = "var(--chart-N)"` → ChartContainer 注入 `--color-<key>`,recharts `fill="var(--color-<key>)"` | 沿用 `chartColor(i)`=`var(--chart-{(i%5)+1})` |
| ⑤ | **role/aria/降级防白屏** | 卡壳 `role="img" aria-label`;recharts 各图加 `accessibilityLayer`;空/非法 spec → 「暂无数据」;组件仍在 `CardBoundary` 内(chat-view),单卡崩不炸消息流 | 三层防白屏规约(CLAUDE.md)不破 |

**降级 guard(强化)**:
```ts
const series = Array.isArray(card.series) ? card.series : []
const categories = Array.isArray(card.categories) ? card.categories : []
const empty = isChartEmpty(series) || (card.chartType !== "pie" && categories.length === 0)
```
- 未知 `chartType` → 落 `default` 空态(不抛)。`series[i].data` 非数组 → 视作 `[]`。

---

## 3. 修用户痛点

### 3.1 类目标签完整、不粗暴截断(核心痛点)

**删** `c.length>6?slice(0,5)+"…"`。改用 `XAxis tickFormatter` + 合理防挤:

```tsx
/** 类目 tick 格式化:时间维友好化,分类维不截断(挤了靠 interval/角度,tooltip 永远全) */
function formatCategoryTick(v: string): string {
  if (/^\d{4}-\d{2}$/.test(v)) return `${Number(v.slice(5, 7))}月`      // 2026-01 → 1月
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}` // 2026-01-05 → 1/5
  if (/^\d{4}$/.test(v)) return `${v}年`
  return v                                                              // 分类维:原样,不 slice
}

<XAxis
  dataKey="category"
  tickFormatter={formatCategoryTick}
  tickLine={false}
  axisLine={false}
  tickMargin={8}
  interval="preserveStartEnd"          // 类目多时自动稀释,不重叠(比隔项 slice 优雅)
  minTickGap={8}
/>
```
- 类目多且长(分类维)仍嫌挤 → 加 `angle={-30} textAnchor="end"` 并 `height={48}`(倾斜 30°),或
  `interval="preserveStartEnd"` 让 recharts 自动隔项。**倾斜方案**保留每个标签全文;**稀释方案**只显首尾+间隔项。
  默认用 `interval="preserveStartEnd"`(不倾斜更干净);类目数 > 8 时切倾斜。
- **tooltip 永远显全类目**:`ChartTooltipContent` 的 `label` 用原始 category(不过 formatter),用户 hover
  看到完整「2026-01」。

### 3.2 字号协调(用户:坐标轴/中心文字偏大)

- **删所有手设 `fontSize`**(现 `fontSize={16}` 中心合计、`fontSize={10}` 轴)。用 shadcn/recharts 默认
  (轴 tick 默认 12px、tooltip/legend 由 shadcn 统一)——协调、随主题。
- 轴刻度色走默认(recharts 用 `fill` 继承);如需与 muted 一致,`<XAxis tick={{ fill: "var(--muted-foreground)" }}/>`。
- **donut 中心合计**:用 recharts `<Label content>` 居中,字号克制:
  ```tsx
  <Label content={({ viewBox }) => {
    if (!viewBox || !("cx" in viewBox)) return null
    const { cx, cy } = viewBox as { cx: number; cy: number }
    return (
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
        <tspan x={cx} y={cy - 2} className="fill-foreground" fontSize={20} fontWeight={600}>{total}</tspan>
        <tspan x={cx} y={cy + 16} className="fill-muted-foreground" fontSize={11}>合计</tspan>
      </text>
    )
  }} />
  ```
  (20/11 比原 16/10 视觉更稳,且随容器不放大。)

### 3.3 响应式 + hover tooltip

- **响应式**:`ChartContainer`(内含 `ResponsiveContainer`)`w-full` → 面板拖宽/全屏自动重排;
  高度 `h-44`(donut `h-52`)。不再依赖 viewBox 缩放。
- **tooltip**:`<ChartTooltip cursor content={<ChartTooltipContent/>} />`——hover 高亮 + 显值,取代原生
  `<title>`。pie 用 `<ChartTooltipContent nameKey="name" hideLabel/>` 更贴。

---

## 4. AiChartSeries → recharts 数据映射

### 4.1 ChartConfig(颜色/图例名,index 稳定 key)

系列名可能是任意中文,用 **index key `s0..s4`** 保证稳定,label 存原名,color 用 `--chart-N`:

```ts
import type { ChartConfig } from "@/components/ui/chart"

const chartConfig: ChartConfig = Object.fromEntries(
  series.map((s, i) => [`s${i}`, { label: s.name, color: `var(--chart-${(i % 5) + 1})` }]),
)
// ChartContainer 会把它变成 --color-s0 … --color-s4(light/dark 均指向 index.css 的 --chart-N)
```

### 4.2 bar / line:类目为行,系列为列

```ts
// 行数据:每个类目一行,系列值铺成 s0/s1/… 列
const data = categories.map((cat, ci) => {
  const row: Record<string, string | number> = { category: cat }
  series.forEach((s, i) => { row[`s${i}`] = s.data[ci] ?? 0 })
  return row
})
```

**bar**:
```tsx
<BarChart accessibilityLayer data={data}
          onClick={onPick ? (s) => s?.activeLabel && onPick(String(s.activeLabel)) : undefined}>
  <CartesianGrid vertical={false} strokeDasharray="3 3" />
  <XAxis dataKey="category" tickFormatter={formatCategoryTick} tickLine={false} axisLine={false}
         tickMargin={8} interval="preserveStartEnd" />
  <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
  <ChartTooltip cursor content={<ChartTooltipContent />} />
  {series.map((s, i) => (
    <Bar key={i} dataKey={`s${i}`} fill={`var(--color-s${i})`} radius={[3, 3, 0, 0]}
         cursor={onPick ? "pointer" : undefined} />
  ))}
</BarChart>
```
- YAxis `allowDecimals={false}` 让整数量(审批量/件数)不出小数刻度;recharts 自动算"好看上限",
  `niceMax` 可弃。

**line(带面积,首系列强填充)**——用 `AreaChart` 单类型即可,勿混 ComposedChart:
```tsx
<AreaChart accessibilityLayer data={data}>
  <CartesianGrid vertical={false} strokeDasharray="3 3" />
  <XAxis dataKey="category" tickFormatter={formatCategoryTick} tickLine={false} axisLine={false}
         tickMargin={8} interval="preserveStartEnd" />
  <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
  <ChartTooltip cursor content={<ChartTooltipContent />} />
  {series.map((s, i) => (
    <Area key={i} dataKey={`s${i}`} type="monotone"
          stroke={`var(--color-s${i})`} strokeWidth={2}
          fill={`var(--color-s${i})`}
          fillOpacity={i === 0 ? 0.12 : 0}          // 首系列面积,其余仅线(对齐现状)
          dot={false} activeDot={{ r: 4 }} />
  ))}
</AreaChart>
```

### 4.3 pie(donut):每系列 = 一个扇区(值取 data[0])

```ts
const pieData = series.map((s, i) => ({
  name: s.name,
  value: Math.max(0, s.data[0] ?? 0),
  percent: s.percent,
  fill: `var(--chart-${(i % 5) + 1})`,
}))
const total = pieData.reduce((sum, d) => sum + d.value, 0)
```
```tsx
<PieChart>
  <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78}
       strokeWidth={2} paddingAngle={1}
       onClick={onPick ? (d) => onPick(String((d as { name: string }).name)) : undefined}>
    {pieData.map((d, i) => (
      <Cell key={i} fill={d.fill} cursor={onPick ? "pointer" : undefined} />
    ))}
    <Label content={/* §3.2 中心合计 */} />
  </Pie>
</PieChart>
```
- `innerRadius=52 outerRadius=78`(donut,留中心放合计);`paddingAngle=1` 出段间细缝(取代原 MVP 省略)。
- pie 图例仍自绘(带 `percent%`),或 `<ChartLegend content={<ChartLegendContent nameKey="name"/>}/>`。

### 4.4 数据映射示例(端到端)

后端给:
```jsonc
{ "type":"chart","chartType":"bar","title":"本月审批量(按流程)",
  "categories":["2026-01","2026-02","2026-03"],
  "series":[{"name":"发起量","data":[12,20,15]},{"name":"办结量","data":[10,18,14]}],
  "drill":{"reportCode":"approval_by_month","paramName":"month"} }
```
映射后:
```jsonc
chartConfig = { s0:{label:"发起量",color:"var(--chart-1)"}, s1:{label:"办结量",color:"var(--chart-2)"} }
data = [ {category:"2026-01", s0:12, s1:10}, {category:"2026-02", s0:20, s1:18}, {category:"2026-03", s0:15, s1:14} ]
// XAxis 显 "1月/2月/3月"(tickFormatter),tooltip hover 显 "2026-01" 全称
// 点柱 → onPick("2026-01") → executeReport("approval_by_month",{month:"2026-01"}) → 追加 list 卡
```

---

## 5. 落地 checklist(疾风)

**装依赖**
- [ ] `pnpm add recharts`;`pnpm dlx shadcn@latest add chart` 生成 `components/ui/chart.tsx`(确认引用 `@/lib/utils` 的 cn)。
- [ ] 确认 recharts 仅被 chart-card import(随 AI 面板懒加载,不进主包)。

**重写 `web/src/components/ai-chat/cards/chart-card.tsx`**
- [ ] 卡壳(rounded-xl border bg-card p-3.5 + BarChart3 标题 + `role="img" aria-label`)不动;drilling 提示不动。
- [ ] 内部 SVG(`Axis/CategoryLabels/BarChart/LineChart/DonutChart/Legend` 五个手绘件)全删,换 §1.2/§4 的 recharts。
- [ ] 加 `chartConfig`(§4.1)+ `data`/`pieData`(§4.2/§4.3)映射 + `formatCategoryTick`(§3.1)。
- [ ] `onPick(category:string)` 保持;bar/pie 的 recharts onClick 取出 category 调它(§2 ①)。
- [ ] 强化空/非法 guard(§2 降级)。
- [ ] 删所有手设 `fontSize`(§3.2);中心合计用 `<Label>` 20/11。

**`chart-math.ts` 收敛**
- [ ] 保留 `chartColor`、`isChartEmpty`(仍被组件/测试用);删 `barLayout/lineLayout/axisLayout/donutSegments/niceMax`(recharts 接管几何)。
- [ ] 更新 `web/src/components/ai-chat/ai-chat.test.ts`「chart 数据映射」用例:从测几何(barLayout/donutSegments/lineLayout/niceMax)改为测**新数据映射**(AiChartSeries → `{category, s0, s1}` 行 / pieData / formatCategoryTick),`chartColor`/`isChartEmpty` 用例保留。

**回归自检**
- [ ] 月份维「2026-01…」→ 轴显「1月/2月」,hover tooltip 显「2026-01」全称,**不再截断成 2026-…**。
- [ ] bar 点类目、pie 点扇区 → 正常下钻追加 list 卡;无 drill 时不可点、无 pointer。
- [ ] light/dark 切换:5 色走 `--chart-N` 两态正确,tooltip/legend 跟随主题。
- [ ] 面板拖宽 / 全屏:图自适应重排(ResponsiveContainer)。
- [ ] 空数据 / `chartType` 非法 / `series` 缺失 → 「暂无数据」,不崩、不白屏(仍在 CardBoundary 内)。
- [ ] 减弱动效:recharts 默认入场动画可关(`isAnimationActive={false}`,或尊重系统——建议 `prefers-reduced-motion` 时置 false)。

---

## 6. 开放项

1. **入场动画与 reduced-motion**:recharts 默认有柱/线生长动画。建议 chart-card 读
   `matchMedia('(prefers-reduced-motion: reduce)')` → 为真时各图 `isAnimationActive={false}`,
   与 ai-chat 其余动效口径一致。
2. **多系列 pie**:现契约 pie 每系列取 `data[0]` 当一个扇区(单值构成)。若后端将来给"单系列多类目"的
   pie(categories + series[0].data[]),需扩映射;本次按现契约(系列即扇区)迁移,不提前设计。
3. **图例点选隐藏系列**:recharts Legend 原生支持点选切换,可作 P1 增强(shadcn ChartLegendContent
   + 受控 hidden 系列);本次保持只读展示,与现状一致。
4. **柱状是否堆叠**:现状是分组柱(多系列并排)。如后端语义需要堆叠(占比构成),Bar 加 `stackId`;
   本次沿用分组柱。
```

# 系统管理 · 布局/交互规范(丹青)

> 依据 `docs/design/system-mgmt-enhance.md`(用户 2026-07-12 需求):用户管理改**左部门树 + 右用户列表**;
> 系统管理各页补**序号列 + 多选批量**。本文出可照做的布局/交互规范,**对齐现有 DataTable / shadcn 视觉,
> 不引新风格**。对照现状:`components/data-table/data-table.tsx`(已含 `selectionColumn`/`enableSelection`/
> `batchSlot` 悬浮胶囊/`serverPagination`)、`pages/system/user.tsx`(单表+部门下拉筛选)、`pages/system/dept.tsx`
> (部门树 CRUD 全套)。只写规范,疾风实施(排在角色 CUSTOM / 知识库批5 / 管理框架 M1 之后)。

---

## 0. 总则与复用清单

| 事项 | 决策 |
|---|---|
| 不造新组件风格 | 一律复用现有 `DataTable`、shadcn `ui/*`、token 配色;新增只有"左树右表布局壳"+`indexColumn` helper |
| 部门 CRUD 不重写 | 把 `dept.tsx` 的树逻辑(`collectParentIds`/`findNode`/`filterTree`/`toggle`/`move`/`toggleEnabled`/`openCreate(parent)`/`openEdit`/`submit`/`confirmDelete`/负责人 RecordPicker + 增删改 Modal/Dialog)**抽成共享 `<DeptTree>` 组件**;用户管理左栏与部门管理页共用它 |
| 多选/批量不新造 | 复用 DataTable 现成 `enableSelection` + `batchSlot(rows, clear)` + 底部悬浮胶囊(已含"已选 N 项"+取消) |
| 分页对齐 | 用户列表数据量大 → 切 `serverPagination`(0-based);序号列按其对齐(§2) |
| 暗色 | 全走 token,`.dark` 自动;分栏边框/选中高亮不写死色值 |
| 防白屏 | 左树、右表各自包一层 ErrorBoundary(重型岛屿规约,CLAUDE.md 反白屏第 1 条) |

---

## 1. 用户管理:左部门树 + 右用户列表

### 1.1 整体布局

```
PageHeader「用户管理」
PermissionBanner(system:user:edit)
┌─ 分栏容器 flex gap-4(md 以上左右;md 以下堆叠/抽屉,§1.4) ─────────────────┐
│ ┌ 左:部门树 ─────────┐ ┌ 右:用户 DataTable ───────────────────────────┐ │
│ │ w-[组织宽] shrink-0  │ │ min-w-0 flex-1                                 │ │
│ │ rounded-lg border    │ │ (DataTable 自带 rounded-lg border bg-card)     │ │
│ │ bg-card              │ │ 工具栏:搜索 + [含子部门]开关 + 新增用户       │ │
│ │ 顶部搜索             │ │ + 序号列 + 多选批量                            │ │
│ │ 工具栏(展开/折叠/新建)│ │                                               │ │
│ │ 树体(滚动)          │ │                                               │ │
│ │ ┊ 可拖分隔条         │ │                                               │ │
│ └─────────────────────┘ └───────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

尺寸/间距/边框:
- 分栏容器:`flex gap-4`(与页内其它 `space-y-4` 同节奏)。整块高度 `min-h-[calc(100dvh-...)]` 或让内容自然撑;
  推荐外层 `flex min-h-0`,左右各自内部滚动(树体 `overflow-y-auto`,表体 DataTable 自管)。
- **左树**:默认宽 **240px**,`shrink-0`;`rounded-lg border bg-card`(与 DataTable 外框同规格,视觉成对)。
- **右表**:`min-w-0 flex-1`(`min-w-0` 必须,否则表格横向撑破分栏)。DataTable 外框自带,不再套卡。
- 左右之间 `gap-4`(16px);可拖分隔条见下。

**可拖宽 + 持久化**:
- 分隔条:左树右缘一根 `w-1 cursor-ew-resize` 竖条(hover `bg-primary/40`),复用 `drawer.tsx` 的
  pointer 拖拽手感(`onPointerDown/Move/Up` + `setPointerCapture`)。范围 `min 200px / max 420px`。
- 持久化:宽度存 `app-store`(zustand persist)新增字段 `sysDeptTreeWidth?: number`(默认 240);
  或复用一个通用 `localStorage` key `oa.sysUserDeptTreeWidth`。**用 app-store 更一致**(已 persist)。
- 暗色:分栏边框 `border`、分隔条 `bg-border`/hover `bg-primary/40` 全 token,两态自适应。

### 1.2 左:`<DeptTree>` 组件(收编 dept.tsx 逻辑)

新建 `web/src/components/system/dept-tree.tsx`,把 dept.tsx 的树+CRUD 收进来,产出可复用组件:

```ts
interface DeptTreeProps {
  /** 受控选中部门 id;null=全部/根 */
  selectedId: number | null
  onSelect: (id: number | null, node: DeptNode | null) => void
  /** 树变动(增删改/排序/启停)后回调,供右表刷新计数等 */
  onChanged?: () => void
  canEdit: boolean
  className?: string
}
```

结构(自上而下):
```
┌ 顶部搜索 px-2 py-2 border-b ─────────────────┐
│ 🔍 [搜索部门名称/编码_______]                │  ← 复用 dept.tsx filterTree + Highlight
├ 工具栏 px-2 py-1.5 border-b ─────────────────┤
│ [展开全部][折叠全部]        ml-auto [+ 新建根]│  ← 复用 expandAll/collapseAll/openCreate(null)
├ 树体 overflow-y-auto flex-1 ─────────────────┤
│ ▸ 全部部门(= 取消筛选,选中即 selectedId=null)│  ← 置顶"全部"项
│ ▾ 总公司            [12]                     │  ← 层级缩进 + 连接线(复用 dept.tsx 缩进方案)
│   ▾ 研发中心   ●    [8]                       │  ← 选中高亮:bg-primary/10 text-primary + 左 2px 主色条
│     · 前端组        [3]                       │
│   ▸ 市场部          [5]                       │
└──────────────────────────────────────────────┘
```

**树节点(行)视觉**(对齐 dept.tsx 现有缩进/箭头,改为"树项"而非表格行):
```tsx
<button
  onClick={() => onSelect(node.id, node)}
  onContextMenu={openRowMenu}                        // 右键菜单(见下)
  className={cn(
    "group flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 text-sm",
    selected ? "bg-primary/10 font-medium text-primary" : "hover:bg-accent",
    !node.enabled && "opacity-60",                    // 停用部门弱化(沿用 dept.tsx)
  )}
>
  {/* 层级缩进连接线:复用 dept.tsx 的 border-l border-dashed 竖线 */}
  {展开箭头 ChevronRight(hasChildren;rotate-90 when open)}
  <span className="min-w-0 flex-1 truncate"><Highlight text={node.name} keyword={kw}/></span>
  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{node.userCount}</span>
</button>
```
- **选中高亮**:`bg-primary/10 text-primary` + 可选左缘 `before:` 2px 主色条;当前部门一眼可辨。
- **展开/选中分离**:点箭头只展开/折叠(`stopPropagation`),点行选中该部门。
- 人数徽标右对齐 `text-[11px] muted tabular-nums`(比 dept.tsx 的 Badge 更轻,树里不喧宾)。
- **停用部门**弱化 `opacity-60`(沿用)。

**CRUD 入口**(全部复用 dept.tsx 逻辑,不重写):
- 工具栏"新建根部门"(`openCreate(null)`)。
- 每项 **hover 显工具按钮** 或 **右键 ContextMenu**(项目有 `ui/context-menu.tsx`)——推荐**右键菜单**
  (树项窄,hover 塞一排按钮挤):
  ```
  新增子部门(FolderPlus)openCreate(node)
  编辑(Pencil)openEdit(node)
  设负责人 → 编辑内含;或单列一项打开负责人 RecordPicker
  上移 / 下移(move(node,-1/1);首尾禁用)
  ─────
  启用/停用(toggleEnabled)
  删除(Trash2,destructive)confirmDelete(有子/有人二次确认拦截,后端已挡)
  ```
  hover 态可再给一个 `⋯` 图标钮兜底(移动/无右键设备)。
- 新增/编辑 Modal、负责人 RecordPicker、删除 Dialog:**原样搬进组件内**(dept.tsx 现成)。
- `onChanged` 在增删改/排序/启停成功后触发,让右表 `reload()`(部门人数、被删部门用户等同步)。

> `dept.tsx` 页可改为薄壳:`<PageHeader/> + <DeptTree standalone/>`(整页版树,右侧不接用户表),
> 与用户管理左栏同组件,避免两处维护。或 dept 页保留、DeptTree 抽公共逻辑二者共享——**推荐前者**(彻底复用)。

### 1.3 右:用户列表(现有能力 + 部门过滤 + 含子部门)

- 复用 user.tsx 的 DataTable 与全部 CRUD/任职/重置/删除 Modal/Drawer,**只改数据源筛选**:
  - `deptFilter` 从"下拉选值"改为**左树 `selectedId`**驱动:选中部门 → `?deptId=<id>`;选"全部部门"
    (`selectedId=null`)→ 不传 deptId。删除现 `filterSlot` 里的部门下拉(树取代它),保留状态下拉。
  - **含子部门开关**:表格工具栏 `filterSlot` 放一个 `Checkbox + Label「含子部门」`;勾选 → 查询加
    `&includeSubDept=true`(磐石加参数,选中部门时把其子树用户一并返回)。默认**勾选**(符合"选研发中心看全研发线"直觉)。
    ```tsx
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Checkbox checked={includeSub} onCheckedChange={(v)=>setIncludeSub(!!v)} /> 含子部门
    </label>
    ```
  - 顶部显示当前范围:表格上方或 filterSlot 首位放一枚 `Badge`「当前:研发中心」(selectedId 有值时),
    点 × 回"全部"。
- **序号列 + 多选批量**:见 §2、§3(用户额外批量:移部门/设角色/启停/删除)。
- 数据量:用户表建议切 **`serverPagination`**(user.tsx 现在 `pageSize=100` 一次拉+前端分页,大组织会慢)
  —— 配合序号列服务端对齐(§2)。此项与磐石分页接口对齐,属功能增强,可与本次一并做或列 P1。

### 1.4 移动端降级(< md)

- 分栏 `md:flex-row flex-col`;**< md 左树收进抽屉**:
  - 表格工具栏左侧加一个按钮「部门:研发中心 ▾」(`variant="outline" size="sm"`),点击开 `Sheet`
    (`ui/sheet.tsx`,`side="left"`)装 `<DeptTree>`;选中即关闭抽屉、刷新右表。
  - 不用上下堆叠(树+表纵向都长,堆叠体验差)——**抽屉**更干净。
- `md` 及以上:左右分栏 + 可拖(§1.1)。
- 断点用 Tailwind `md:`(768px);左树 `hidden md:flex`,移动端按钮 `md:hidden`。

### 1.5 防白屏

- `<DeptTree>` 与右侧 `<DataTable>` **各包一层 ErrorBoundary**(坏树/坏行数据只塌一侧,不炸整页)。
  项目已有路由级 boundary(app-layout),此处按"重型岛屿附加自身 boundary"补(参考 ai-chat 的 `CardBoundary` 模式)。
- 列表响应仍走 `useApiData`/归一化(`{list}` 或 `[]` 兜底),树 `/depts/tree` 空/异常 → 空态「暂无部门」不抛。

---

## 2. DataTable 序号列

### 2.1 helper(加到 `data-table.tsx`,与 `selectionColumn` 并列导出)

```tsx
/** 序号列:窄、居中、muted、不排序不隐藏。序号 = 全局连续(服务端分页对齐,非当前页 1..N 重复) */
export function indexColumn<TData>(): ColumnDef<TData> {
  return {
    id: "index",
    size: 48,
    enableSorting: false,
    enableHiding: false,
    header: () => <span className="block text-center">#</span>,   // 或"序号"
    cell: ({ row, table }) => {
      const { pageIndex, pageSize } = table.getState().pagination
      // 当前页内位置(分页后当前页行的次序)
      const posInPage = table.getRowModel().rows.findIndex((r) => r.id === row.id)
      const n = pageIndex * pageSize + posInPage + 1
      return <span className="block text-center text-xs tabular-nums text-muted-foreground">{n}</span>
    },
  }
}
```
- **自适应版**(推荐):读 `table.getState().pagination` + 当前页行位置——**服务端分页与本地分页都正确**
  (服务端时 `getRowModel().rows` 即当前页那批,pageIndex 由 `serverPagination` 注入)。
- 契约里的 `indexColumn(pageIndex, pageSize)` 显式传参版:仅当调用方完全在 DataTable 外自管分页时用;
  一般用无参自适应版即可,**建议以无参版为准**(少一处易错的手传)。

### 2.2 视觉规范

| 项 | 值 |
|---|---|
| 列宽 | `size: 48`(约 48px,窄) |
| 对齐 | 居中(header + cell 都 `text-center`) |
| 颜色 | `text-muted-foreground`、`text-xs`、`tabular-nums`(数字等宽不跳动) |
| 表头 | `#`(最省);嫌不明确用「序号」 |
| 排序/隐藏 | 均禁用(`enableSorting:false` `enableHiding:false`)——不进列设置面板、不参与 CSV(与 select/actions 一致,`exportCsv` 已按 `accessorFn` 过滤,index 无 accessorFn 天然不导出) |

### 2.3 位置关系(select → index → 数据列)

- DataTable 里 `enableSelection` 自动前置 `selectionColumn`;序号列由各页作为 **`userColumns` 的第一列**传入,
  于是最终顺序 = **选择列 → 序号列 → 数据列 → 操作列**。
  ```tsx
  const columns = useMemo(() => [indexColumn<Row>(), ...业务列, 操作列], [...])
  <DataTable columns={columns} enableSelection ... />
  ```
- 不要把 index 塞进 selectionColumn 之前(选择框永远最左,符合直觉与现状)。

---

## 3. 多选 + 批量操作统一模式

### 3.1 复用现成机制(不新造)

DataTable 已具备:`enableSelection`(自动加选择列)、`batchSlot(rows, clear) => ReactNode`(底部**居中悬浮圆角胶囊**,
已内建"已选 **N** 项"计数 + "取消"按钮 + `resetRowSelection`)、分页栏也显"已选 N 条"。各页要做的只是
**传 `enableSelection` + 写 `batchSlot`**。

### 3.2 batchSlot 按钮组织范式

胶囊内按钮从左到右按"轻→重"排,危险操作最右且醒目;全部 `size="sm" className="h-7 rounded-full"`(贴合胶囊):

```tsx
batchSlot={(rows, clear) => (
  <>
    {/* 常规操作:outline/ghost */}
    <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-full px-2.5 text-xs"
            onClick={() => batchEnable(rows, true, clear)}>
      <CircleCheck className="size-3.5" /> 启用
    </Button>
    <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-full px-2.5 text-xs"
            onClick={() => batchEnable(rows, false, clear)}>
      <CircleSlash className="size-3.5" /> 停用
    </Button>
    {/* 用户额外:移部门/设角色(打开选择弹层) */}
    <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-full px-2.5 text-xs"
            onClick={() => openBatchMoveDept(rows)}>
      <FolderInput className="size-3.5" /> 移部门
    </Button>
    <span className="h-4 w-px bg-border" />
    {/* 危险:destructive,最右 */}
    <Button variant="ghost" size="sm"
            className="h-7 gap-1 rounded-full px-2.5 text-xs text-destructive hover:text-destructive"
            onClick={() => openBatchDelete(rows, clear)}>
      <Trash2 className="size-3.5" /> 删除
    </Button>
  </>
)}
```
- 胶囊已自带"取消"与计数;`batchSlot` 只放**动作**,不重复放计数/取消。
- 语义色:删除 `text-destructive`;启用/停用/移动等中性 `ghost`。用一根 `h-4 w-px bg-border` 分隔常规与危险。
- 操作图标:启用 `CircleCheck`、停用 `CircleSlash`、移部门 `FolderInput`、设角色 `UserCog`、导出 `Download`、删除 `Trash2`(lucide,与全站一致)。

### 3.3 二次确认 + 后端批量 + 结果反馈

- **删除**(及批量停用等破坏性)必走二次确认:用 `ui/alert-dialog.tsx`,标题带**选中数**:
  「删除选中的 **N** 个用户?此操作不可恢复。」确认键 `variant="destructive"`。
- 后端批量 API(磐石):`POST /api/system/users/batch-delete`、`/batch-status`(启停)、`/batch-move-dept`;
  角色/岗位/字典 `batch-delete`;日志 `batch-delete`(清理)。**幂等 + 权限 `@PreAuthorize` + 不误删自己/超管**;
  部分失败**返回逐条结果**。
- 前端结果反馈:成功 `toast.success("已删除 N 项")`;**部分失败**逐条结果 → `toast` 提示"成功 X,失败 Y"
  并保留失败行选中(或列出失败原因);完成后 `clear()` 清选中 + `reload()`。
- 计数一致性:操作按 `rows.length` 计数;`rows` 是 `batchSlot` 传入的已选行原始数据。

### 3.4 选中态视觉(现成,勿改)

- 行选中 `data-state="selected"`(DataTable 已设,选中行有底色)。
- 全选/半选:表头 `selectionColumn` 的 Checkbox `indeterminate`(现成)。
- 计数:胶囊"已选 N 项" + 分页栏"已选 N 条"(现成,双处呼应)。

---

## 4. 逐页 checklist(疾风照勾)

> 通用改动(每页):① `columns` 首列插 `indexColumn<Row>()` ② DataTable 加 `enableSelection` + `batchSlot`
> ③ 批量走后端 batch API + `alert-dialog` 二次确认(删除类)+ 成功 `clear()`&`reload()`。序号列/多选对
> **serverPagination 与本地分页都适用**(§2.1 自适应)。

| 页 | 序号 | 多选批量按钮 | 额外 |
|---|---|---|---|
| **user** | ✓ | 启用/停用 · 移部门 · 设角色 · 删除 | **左树右表重构(§1)** + 含子部门开关 + 部门下拉改树驱动;建议切 serverPagination |
| **role** | ✓ | 启用/停用 · 删除 | CUSTOM 部门配置是另单,不在此 |
| **post** | ✓ | 删除 | |
| **dict** | ✓ | 删除 | 字典**项**表(dict-item)同样加序号+批量删 |
| **job**(xxl) | ✓ | 启用/停用 · 删除 | |
| **log** | ✓ | 批量删除(清理) | 危险确认文案偏"清理 N 条日志" |
| **file** | ✓ | 批量删除 | 删除即删存储对象,确认强提示 |
| **menu** | 可选(树) | — | 树结构;序号意义小,**本次可不加**(菜单靠树序,不做多选) |
| **dept** | — | — | 树 CRUD 已抽 `<DeptTree>`(§1.2),并入用户管理左栏;dept 页改用同组件 |

**user 页专项 checklist**:
- [ ] 抽 `components/system/dept-tree.tsx`(搬 dept.tsx 树+CRUD+负责人 picker+增删改 Dialog)。
- [ ] user 页改左右分栏(§1.1),左 `<DeptTree selectedId onSelect onChanged>`,右 DataTable;可拖宽存 app-store。
- [ ] 删 `filterSlot` 里的部门下拉,改为树 `selectedId` 驱动 `deptId`;加「含子部门」Checkbox(默认勾)+ 当前部门 Badge。
- [ ] `columns` 首列 `indexColumn`;`enableSelection` + `batchSlot`(启停/移部门/设角色/删除)。
- [ ] 批量:`batch-status`/`batch-move-dept`/`batch-delete` + `alert-dialog` 确认 + 成功 `clear()`&`reload()`。
- [ ] 移动端左树进 `Sheet`(§1.4);左树/右表各包 ErrorBoundary(§1.5)。
- [ ] jsdom mount 冒烟(渲染不白屏,反白屏第 4 条)。

**其余页 checklist(role/post/dict/job/log/file 每页)**:
- [ ] `indexColumn` 首列;`enableSelection` + `batchSlot`(按上表按钮)。
- [ ] 危险批量走 `alert-dialog`(带选中数);后端 batch API;成功 `clear()`&`reload()`。
- [ ] 渲染冒烟不白屏。

---

## 5. 开放项(待主控/磐石对齐)

1. **含子部门参数**:右表需要磐石在 `/api/system/users` 支持 `deptId` + `includeSubDept`(选中部门时含子树用户)。
   否则前端需自算子部门 id 列表传 `deptIds`——建议后端加参数(数据权限也更好控)。
2. **用户列表 serverPagination**:现状 `pageSize=100` 前端分页,大组织慢。建议切服务端分页(与序号列自适应天然配合);
   属增强,可与本次一并或列 P1,请主控定。
3. **batch API 部分失败协议**:建议统一返回 `{ successIds:[], failed:[{id,reason}] }`,前端据此提示"成功 X/失败 Y";
   请磐石定形状。
4. **可拖宽持久化落点**:建议存 `app-store`(已 persist)新增 `sysDeptTreeWidth`;若嫌污染 store,用
   localStorage `oa.sysUserDeptTreeWidth`。请主控选一处口径。
5. **menu 树是否加多选**:本文建议不加(菜单靠树序管理);若后续要批量启停菜单,再补。

---
## 附:主控拍板(§5 开放项,2026-07-12)
1. **含子部门**:后端 `GET /api/system/users` 加 `deptId` + `includeSubDept`(默认 true);服务端按部门闭包/
   路径过滤(与数据权限性能设计一致,复用)。
2. **用户列表分页**:先保持本地分页(现状 pageSize=100),切 serverPagination 列 **P1**(数据量大再切,配合
   deptId 服务端过滤)。
3. **batch 部分失败协议**:统一 `{successIds:number[], failed:[{id,reason}]}`;前端 toast 汇总(成功 N/失败 M)
   + 失败明细可展开;成功即 clear()+reload()。所有 batch API 照此。
4. **拖宽持久化**:落 **app-store**(与 AI 面板宽度同一做法,统一持久化层,别用裸 localStorage)。
5. **menu**:不加多选(树结构,批量语义弱);序号列也可不加(树本身有层级)。dept 并入 DeptTree 共享组件后
   dept 页降薄壳。

# 通用富文本组件体系(TipTap)设计

> 主控裁定契约。目标:全站富文本统一到一套可复用组件;审批意见升级富文本;提供高级示例页。
> 底座:TipTap 3.27.3(已装 @tiptap/react + starter-kit + extensions,React 19 兼容)。

## 1. 组件库布局 `web/src/components/rich-text/`

```
rich-text/
├── index.ts          # 导出 RichTextEditor / RichTextViewer / stripHtml / presets
├── editor.tsx        # RichTextEditor(受控 value:HTML / onChange;preset 或自定义 features)
├── viewer.tsx        # RichTextViewer(只读渲染,内部统一 sanitizeHtml,prose 样式,暗色适配)
├── toolbar.tsx       # 工具栏(按启用的 feature 自动出按钮,分组+分隔,shadcn 风格)
├── extensions.ts     # feature → TipTap extension 的组装工厂(纯逻辑,可单测)
└── rich-text.css     # 编辑区/viewer 共用排版(prose 语义,token 化,暗色两态)
```

## 2. 能力分级(preset)

| preset | 面向场景 | 功能 |
|---|---|---|
| `minimal` | 审批/办理意见、评论 | 加粗 斜体 下划线 删除线 · 有序/无序列表 · 撤销重做 · 字数统计/maxLength |
| `standard` | 公文正文、公告 | minimal + 标题(H2/H3) 引用 代码 链接 分隔线 · 对齐 · 高亮 · 清除格式 |
| `full` | 知识文档/示例页 | standard + 表格(增删行列/表头) · 图片(上传→/api/infra/files/upload,插 URL;失败提示) · 任务列表(checkbox) · 上下标 · 文字颜色 |

- `preset="minimal|standard|full"` 一键选;也可 `features={[...]}` 精确定制(preset 是 feature 集合的别名)。
- 缺的扩展按需补装 `@tiptap/extension-*@3.x`(table/image/task-list/character-count/text-align/highlight/color/subscript/superscript…先 `npm view` 核对 3.27 系列版本与 starter-kit 已含项,别重复装)。

## 3. 契约与红线

- **受控**:`value: string`(HTML)/ `onChange(html)`;空文档回传 `""`(非 `<p></p>`);受控回写不重置光标(沿用公文 rich-text 的 value≠getHTML 才 setContent 策略)。
- **产出干净 HTML**:段落 `<p>`,无裸 `<br>` 换行、无内联垃圾样式;粘贴走 TipTap 解析清理。
- **渲染唯一出口 `RichTextViewer`**:内部 `sanitizeHtml`(lib/sanitize,DOMPurify)+ prose 排版;**任何地方展示富文本 HTML 一律用它**,禁止散落 dangerouslySetInnerHTML。
- **`stripHtml(html, maxLen?)`**:HTML → 纯文本摘要(列表列/通知/日志用)。
- 其它:placeholder、readOnly/disabled、minHeight/maxHeight(超出内滚)、字数统计(CharacterCount,可配 maxLength 与超限提示)、暗色两态走主题 token、a11y(工具栏按钮 aria-label + Tooltip)。
- **旧组件迁移**:`web/src/pages/document/gongwen/rich-text.tsx` 删除,公文拟稿正文改用 `<RichTextEditor preset="standard">`;其 css 并入 rich-text.css。对外行为不回归(公文四门+预览不变)。

## 4. 审批意见升级(存 HTML 的连带闭环)

意见输入点(两处)换 `<RichTextEditor preset="minimal" maxLength={2000}>`:
1. **wf 审批**:`wf-op-dialogs.tsx` 的意见 Textarea(同意/驳回/加签/转办…共用的意见框)。
2. **公文办理**:`gongwen/handling.tsx` 办理意见 Textarea。

**展示侧必须同步适配**(意见此后可能是 HTML,也可能是存量纯文本——Viewer 对纯文本原样显示即可):
- 审批时间线(instance-detail 时间线、gongwen OpinionTimeline 的意见框)→ `RichTextViewer`。
- 已办列表 comment 列、通知/消息里的意见摘要 → `stripHtml(comment, 50)`。
- 后端无需改(comment/opinion 本就是 text 列);提交前空 HTML 归一为 ""(校验"意见必填"逻辑不被 `<p></p>` 骗过)。

## 5. 高级示例页(后续富文本的引用范本)

`web/src/pages/demo/rich-text.tsx`,路由/菜单按项目约定(App.tsx lazy + config/menu.ts,挂在组件示例分组):
- 三档 preset 各一个实例(minimal 带 maxLength 演示超限;standard 演示公告场景;full 全功能)。
- full 演示:表格增删行列、图片上传(offline 降级 base64 预览并提示)、任务列表、颜色/高亮、对齐。
- **实时 HTML 输出面板**(格式化显示 + 复制)+ `RichTextViewer` 同步预览(编辑↔渲染对照)。
- 只读切换、暗色对照说明、"如何引用"代码片段(import + preset 用法),作为后续开发的 copy 源。

## 6. 验收

- 四门(tsc/lint/vitest/build)+ 新增单测:extensions 工厂按 preset 组装、空文档归一 ""、stripHtml。
- 手测清单:审批同意/驳回带富文本意见 → 时间线富文本呈现、已办列表摘要无标签字面;公文拟稿正文不回归;示例页三档全功能可用、暗色正常;maxLength 超限拦截。
- bundle:TipTap 相关保持懒加载分片(示例页/办理弹窗 lazy),主包不涨。

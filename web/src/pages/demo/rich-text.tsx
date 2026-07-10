/**
 * 富文本组件示例页（契约 §5）——后续富文本引用的 copy 源。
 *
 * 三档 preset 实例（minimal 带 maxLength 超限演示 / standard 公告场景 / full 全功能）、
 * 实时 HTML 输出面板（格式化 + 复制）+ RichTextViewer 同步预览、只读切换、「如何引用」代码片段。
 */
import { useState } from "react"
import { toast } from "sonner"
import { Copy, Eye, Pencil } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { RichTextEditor, RichTextViewer, stripHtml } from "@/components/rich-text"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const FULL_SEED = `<h2>全功能演示</h2><p>支持<strong>加粗</strong>、<em>斜体</em>、<u>下划线</u>、<mark>高亮</mark>、<span style="color: #dc2626">文字颜色</span>、上标 x<sup>2</sup> 与下标 H<sub>2</sub>O。</p><table><tbody><tr><th><p>季度</p></th><th><p>营收</p></th></tr><tr><td><p>Q1</p></td><td><p>1,200 万</p></td></tr><tr><td><p>Q2</p></td><td><p>1,580 万</p></td></tr></tbody></table><ul data-type="taskList"><li data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>已完成事项</p></div></li><li data-checked="false"><label><input type="checkbox"><span></span></label><div><p>待办事项</p></div></li></ul>`

const USAGE_SNIPPET = `import { RichTextEditor, RichTextViewer, stripHtml } from "@/components/rich-text"

// 编辑（受控 HTML；空文档回传 ""）
<RichTextEditor preset="minimal" maxLength={2000} value={html} onChange={setHtml} />
<RichTextEditor preset="standard" value={html} onChange={setHtml} />   // 公文/公告
<RichTextEditor preset="full" value={html} onChange={setHtml} />       // 知识文档
<RichTextEditor features={["bold", "link"]} value={html} onChange={setHtml} />  // 精确定制

// 展示（唯一渲染出口，内部 sanitize + prose）
<RichTextViewer html={html} />

// 列表列 / 通知摘要
stripHtml(html, 50)`

function DemoBlock({
  title,
  description,
  preset,
  maxLength,
  seed = "",
}: {
  title: string
  description: string
  preset: "minimal" | "standard" | "full"
  maxLength?: number
  seed?: string
}) {
  const [html, setHtml] = useState(seed)
  const [readOnly, setReadOnly] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(html).then(() => toast.success("HTML 已复制"))
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          {title}
          <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
            preset="{preset}"
          </Badge>
          {maxLength != null && (
            <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
              maxLength={maxLength}
            </Badge>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            {readOnly ? <Eye className="size-3.5" /> : <Pencil className="size-3.5" />}
            只读
            <Switch checked={readOnly} onCheckedChange={setReadOnly} />
          </label>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <RichTextEditor
          preset={preset}
          value={html}
          onChange={setHtml}
          maxLength={maxLength}
          readOnly={readOnly}
          minHeight={preset === "full" ? 200 : 96}
        />
        <Tabs defaultValue="viewer">
          <TabsList>
            <TabsTrigger value="viewer">Viewer 预览</TabsTrigger>
            <TabsTrigger value="html">HTML 输出</TabsTrigger>
            <TabsTrigger value="strip">stripHtml 摘要</TabsTrigger>
          </TabsList>
          <TabsContent value="viewer" className="mt-2">
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              {html ? (
                <RichTextViewer html={html} />
              ) : (
                <span className="text-xs text-muted-foreground">（空文档 → value 为 ""）</span>
              )}
            </div>
          </TabsContent>
          <TabsContent value="html" className="mt-2">
            <div className="relative">
              <pre className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-3 pr-10 text-[11px] leading-relaxed whitespace-pre-wrap break-all">
                {html || '""（空文档归一为空串）'}
              </pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1.5 top-1.5 size-7"
                title="复制 HTML"
                onClick={copy}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="strip" className="mt-2">
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              {stripHtml(html, 80) || "（空）"}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

export default function RichTextDemoPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="富文本编辑器"
        description="通用富文本组件体系（TipTap）：三档 preset、受控 HTML、唯一渲染出口 RichTextViewer、纯文本摘要 stripHtml；暗色两态自适应（切主题对照）。"
      />

      <DemoBlock
        title="minimal · 审批意见 / 评论"
        description="加粗 / 斜体 / 下划线 / 删除线 / 列表 / 撤销重做；maxLength=200 演示字数硬限与超限提示（输到上限即无法继续输入）。"
        preset="minimal"
        maxLength={200}
        seed="<p>同意，请<strong>加快推进</strong>。</p>"
      />

      <DemoBlock
        title="standard · 公文正文 / 公告"
        description="minimal + 标题(H2/H3) / 引用 / 行内代码 / 链接 / 分隔线 / 对齐 / 高亮 / 清除格式。公文拟稿单正文即此档。"
        preset="standard"
        seed="<h2>关于开展消防演练的公告</h2><p>定于本周五下午 15:00 开展<mark>全员消防演练</mark>，请各部门<strong>提前安排工作</strong>，准时参加。</p><blockquote><p>集合地点：园区南广场</p></blockquote>"
      />

      <DemoBlock
        title="full · 知识文档（全功能）"
        description="standard + 表格（工具栏插入 3×3，光标进入表格后浮现 +行/+列/-行/-列/删除表格）/ 图片上传（后端未连接时降级 base64 本地预览）/ 任务列表 / 上下标 / 文字颜色。"
        preset="full"
        seed={FULL_SEED}
      />

      {/* 如何引用 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">如何引用</CardTitle>
          <p className="text-xs text-muted-foreground">
            契约见 docs/design/rich-text-component.md：受控 value/onChange、空文档归一 ""、展示一律走
            RichTextViewer（内部 sanitize），列表/通知摘要用 stripHtml。
          </p>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed">
            {USAGE_SNIPPET}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}

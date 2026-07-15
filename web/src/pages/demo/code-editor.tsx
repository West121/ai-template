/**
 * 组件示例 · 统一代码编辑器 <CodeEditor>。展示：多语言切换、明暗自动、只读、换行/行号开关、
 * JSON 实时校验标红、min/max 高度；附复制即用片段。照现有 demo 页范式（rich-text/table）。
 */
import { useState } from "react"
import { toast } from "sonner"
import { Copy } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { CodeEditor, type CodeLanguage } from "@/components/code-editor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const LANGS: { value: CodeLanguage; label: string; sample: string }[] = [
  { value: "json", label: "JSON", sample: '{\n  "name": "星辰 OA",\n  "enabled": true,\n  "tags": ["workflow", "form"]\n}' },
  { value: "javascript", label: "JavaScript", sample: "// 表达式脚本\nconst total = items.reduce((s, i) => s + i.amount, 0)\nreturn total > 1000 ? 'HIGH' : 'LOW'" },
  { value: "groovy", label: "Groovy", sample: "// 审批脚本（后端注入 context）\ndef days = form.days as int\nif (days > 3) approve('总经理')\nelse approve('部门经理')" },
  { value: "python", label: "Python", sample: "# 数据处理\ndef handle(ctx):\n    rows = ctx['rows']\n    return sum(r['amount'] for r in rows)" },
  { value: "sql", label: "SQL", sample: "SELECT dept_id, COUNT(*) AS n\nFROM oa_approval\nWHERE status = 'PENDING'\nGROUP BY dept_id" },
  { value: "expression", label: "表达式", sample: "IF(days > 3, 总经理, 部门经理)" },
  { value: "text", label: "纯文本", sample: "任意文本内容，无语法高亮。" },
]

const USAGE_SNIPPET = `import { CodeEditor } from "@/components/code-editor"

// 受控用法：value + onChange(string)
<CodeEditor
  value={code}
  onChange={setCode}
  language="json"        // json|javascript|sql|groovy|python|expression|text
  minHeight="8rem"
  maxHeight="24rem"
  lineWrap                // 自动换行（默认关）
  // lineNumbers={false}  // 关闭行号（默认开）
  // readOnly             // 只读（禁编辑，仍可选中复制）
  ariaLabel="配置 JSON"
/>`

export default function CodeEditorDemoPage() {
  const [language, setLanguage] = useState<CodeLanguage>("json")
  const [readOnly, setReadOnly] = useState(false)
  const [lineWrap, setLineWrap] = useState(false)
  const [lineNumbers, setLineNumbers] = useState(true)
  const [code, setCode] = useState(LANGS[0].sample)

  const onLangChange = (v: string) => {
    const lang = v as CodeLanguage
    setLanguage(lang)
    setCode(LANGS.find((l) => l.value === lang)?.sample ?? "")
  }

  const copyUsage = () => {
    void navigator.clipboard?.writeText(USAGE_SNIPPET).then(() => toast.success("用法片段已复制"))
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="统一代码编辑器"
        description="全站编代码 / JSON / 表达式统一走 <CodeEditor>：行号 · 语法高亮 · 括号匹配 · 自动缩进 · JSON 实时校验 · 明暗自动"
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">交互演示</CardTitle>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">语言</Label>
              <Select value={language} onValueChange={onLangChange}>
                <SelectTrigger size="sm" className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGS.map((l) => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-1.5 text-xs">
              <Switch checked={readOnly} onCheckedChange={setReadOnly} /> 只读
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <Switch checked={lineWrap} onCheckedChange={setLineWrap} /> 换行
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <Switch checked={lineNumbers} onCheckedChange={setLineNumbers} /> 行号
            </label>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <CodeEditor
            value={code}
            onChange={setCode}
            language={language}
            readOnly={readOnly}
            lineWrap={lineWrap}
            lineNumbers={lineNumbers}
            minHeight="12rem"
            maxHeight="28rem"
            ariaLabel="代码编辑器演示"
          />
          {language === "json" && (
            <p className="text-xs text-muted-foreground">
              提示：把 JSON 改成非法（如删掉引号）会即时出现红色波浪下划线校验提示。
            </p>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{language}</Badge>
            <span>{code.length} 字符 · {code.split("\n").length} 行</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">复制即用</CardTitle>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={copyUsage}>
            <Copy className="size-3.5" /> 复制片段
          </Button>
        </CardHeader>
        <CardContent>
          <CodeEditor value={USAGE_SNIPPET} language="javascript" readOnly minHeight="0" maxHeight="20rem" ariaLabel="用法片段" />
        </CardContent>
      </Card>
    </div>
  )
}

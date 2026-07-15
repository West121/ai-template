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
  {
    value: "javascript",
    label: "JavaScript",
    sample: `// 异步 + 箭头函数 + 解构
async function loadPending(deptId) {
  const res = await fetch(\`/api/wf/tasks?dept=\${deptId}\`)
  const { list = [], total } = await res.json()
  const urgent = list.filter(({ priority }) => priority === "HIGH")
  return { total, urgent: urgent.map((t) => t.title) }
}

const summarize = (rows) =>
  rows.reduce((acc, { amount }) => acc + amount, 0)
`,
  },
  {
    value: "typescript",
    label: "TypeScript",
    sample: `// 接口 + 泛型 + 类型注解
interface Page<T> {
  list: T[]
  total: number
  pageNum: number
}

type Task = { id: number; title: string; priority: "LOW" | "HIGH" }

function firstUrgent<T extends Task>(page: Page<T>): T | undefined {
  return page.list.find((t): t is T => t.priority === "HIGH")
}

const load = async (): Promise<Page<Task>> =>
  (await fetch("/api/wf/tasks")).json()
`,
  },
  {
    value: "tsx",
    label: "TSX",
    sample: `import { useState } from "react"

interface Props { title: string; count?: number }

export function Counter({ title, count = 0 }: Props) {
  const [n, setN] = useState(count)
  return (
    <button className="btn" onClick={() => setN((v) => v + 1)}>
      {title}: {n}
    </button>
  )
}
`,
  },
  {
    value: "java",
    label: "Java",
    sample: `import java.util.List;
import java.util.stream.Collectors;

public class ApprovalService {
    public List<String> urgentTitles(List<Task> tasks) {
        return tasks.stream()
                .filter(t -> t.getPriority() == Priority.HIGH)
                .map(Task::getTitle)
                .collect(Collectors.toList());
    }

    @Override
    public String toString() {
        return "ApprovalService";
    }
}
`,
  },
  {
    value: "python",
    label: "Python",
    sample: `from dataclasses import dataclass
from functools import lru_cache

@dataclass
class Task:
    id: int
    title: str
    amount: float

@lru_cache(maxsize=128)
def total_amount(tasks: tuple[Task, ...]) -> float:
    # 列表推导式
    return sum(t.amount for t in tasks if t.amount > 0)
`,
  },
  {
    value: "groovy",
    label: "Groovy",
    sample: `// 审批脚本（后端注入 context，无官方 lang 包，legacy 词法着色）
def days = form.days as int
if (days > 3) {
  approve('总经理')
} else {
  approve('部门经理')
}`,
  },
  {
    value: "sql",
    label: "SQL",
    sample: `SELECT dept_id, COUNT(*) AS n, SUM(amount) AS total
FROM oa_approval
WHERE status = 'PENDING' AND created_at >= '2026-01-01'
GROUP BY dept_id
HAVING COUNT(*) > 5
ORDER BY total DESC`,
  },
  {
    value: "json",
    label: "JSON",
    sample: `{
  "name": "星辰 OA",
  "enabled": true,
  "tags": ["workflow", "form"],
  "limits": { "maxRows": 1000, "timeoutMs": 30000 }
}`,
  },
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
  const [language, setLanguage] = useState<CodeLanguage>(LANGS[0].value)
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
          {/* IDE 功能速查（默认全启用） */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <span><kbd className="rounded bg-muted px-1 font-mono">Ctrl+F</kbd> 查找</span>
            <span><kbd className="rounded bg-muted px-1 font-mono">Ctrl+H</kbd> 替换</span>
            <span><kbd className="rounded bg-muted px-1 font-mono">Ctrl+Space</kbd> 自动补全</span>
            <span><kbd className="rounded bg-muted px-1 font-mono">Ctrl+D</kbd> 选中下一个同词（多光标）</span>
            <span>行号旁三角 = 代码折叠</span>
          </div>
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

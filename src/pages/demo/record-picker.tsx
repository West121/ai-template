import { useState } from "react"
import { Database, Fingerprint, ListChecks, SearchCheck, Tags } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { OrgPicker, OrgPickerField, type OrgRef } from "@/components/org-picker"
import { RecordPicker, RecordPickerField, type RecordPickerColumn } from "@/components/record-picker"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"

/* ---------- 员工表（唯一字段：工号 empNo，展示字段：姓名 name） ---------- */

interface Employee extends Record<string, unknown> {
  empNo: string
  name: string
  dept: string
  post: string
  phone: string
}

const employees: Employee[] = [
  { empNo: "XC0001", name: "陈建国", dept: "总裁办", post: "总裁", phone: "139****0001" },
  { empNo: "XC0002", name: "林婉清", dept: "总裁办", post: "总裁助理", phone: "138****2210" },
  { empNo: "XC0003", name: "赵天宇", dept: "产品研发部", post: "研发总监", phone: "137****8865" },
  { empNo: "XC0004", name: "王小磊", dept: "前端组", post: "前端组长", phone: "138****1234" },
  { empNo: "XC0005", name: "李思雨", dept: "前端组", post: "前端工程师", phone: "136****4521" },
  { empNo: "XC0006", name: "张浩然", dept: "前端组", post: "前端工程师", phone: "135****7788" },
  { empNo: "XC0008", name: "刘志强", dept: "后端组", post: "后端组长", phone: "139****6672" },
  { empNo: "XC0009", name: "孙铭轩", dept: "后端组", post: "后端工程师", phone: "186****9034" },
  { empNo: "XC0010", name: "周雨桐", dept: "后端组", post: "后端工程师", phone: "158****4470" },
  { empNo: "XC0012", name: "郑雅文", dept: "测试组", post: "测试组长", phone: "135****8841" },
  { empNo: "XC0013", name: "何嘉琪", dept: "测试组", post: "测试工程师", phone: "159****2203" },
  { empNo: "XC0015", name: "黄丽娟", dept: "市场部", post: "市场总监", phone: "138****7015" },
  { empNo: "XC0016", name: "徐子豪", dept: "市场部", post: "市场专员", phone: "151****3348" },
  { empNo: "XC0018", name: "朱国栋", dept: "销售部", post: "销售总监", phone: "139****4456" },
  { empNo: "XC0019", name: "马天成", dept: "销售部", post: "大客户经理", phone: "137****8009" },
  { empNo: "XC0022", name: "刘雅婷", dept: "人力资源部", post: "HRBP", phone: "138****5520" },
  { empNo: "XC0024", name: "杨慧敏", dept: "财务部", post: "财务经理", phone: "139****1177" },
  { empNo: "XC0028", name: "谭凯文", dept: "信息中心", post: "运维工程师", phone: "137****6621" },
]

const employeeColumns: RecordPickerColumn<Employee>[] = [
  {
    key: "name",
    title: "姓名",
    width: 140,
    render: (row) => (
      <span className="flex items-center gap-1.5">
        <Avatar className="size-5">
          <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{row.name.charAt(0)}</AvatarFallback>
        </Avatar>
        {row.name}
      </span>
    ),
  },
  { key: "empNo", title: "工号", width: 110, render: (row) => <span className="font-mono text-xs">{row.empNo}</span> },
  { key: "dept", title: "部门", width: 120 },
  { key: "post", title: "岗位" },
]

/* ---------- 项目表（唯一字段：项目编号 code，展示字段：项目名称 name） ---------- */

interface Project extends Record<string, unknown> {
  code: string
  name: string
  owner: string
  status: string
}

const projects: Project[] = [
  { code: "P-2026-001", name: "OA 平台三期建设", owner: "赵天宇", status: "进行中" },
  { code: "P-2026-002", name: "数据中台指标体系", owner: "谭凯文", status: "进行中" },
  { code: "P-2026-003", name: "移动端 App 重构", owner: "王小磊", status: "进行中" },
  { code: "P-2026-004", name: "CRM 客户管理系统", owner: "朱国栋", status: "已立项" },
  { code: "P-2026-005", name: "财务共享中心", owner: "杨慧敏", status: "已立项" },
  { code: "P-2026-006", name: "智能客服机器人", owner: "刘志强", status: "进行中" },
  { code: "P-2026-007", name: "供应链协同平台", owner: "黄丽娟", status: "已暂停" },
  { code: "P-2026-008", name: "人才盘点系统", owner: "刘雅婷", status: "已立项" },
  { code: "P-2026-009", name: "官网品牌升级", owner: "徐子豪", status: "已完成" },
  { code: "P-2026-010", name: "等保三级合规改造", owner: "谭凯文", status: "进行中" },
  { code: "P-2026-011", name: "BI 报表平台", owner: "郑雅文", status: "已完成" },
  { code: "P-2026-012", name: "电子签章集成", owner: "孙铭轩", status: "进行中" },
]

const statusColor: Record<string, string> = {
  进行中: "border-blue-500/30 bg-blue-500/10 text-blue-600",
  已立项: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  已完成: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  已暂停: "border-border bg-muted text-muted-foreground",
}

const projectColumns: RecordPickerColumn<Project>[] = [
  { key: "name", title: "项目名称" },
  { key: "code", title: "项目编号", width: 130, render: (row) => <span className="font-mono text-xs">{row.code}</span> },
  { key: "owner", title: "负责人", width: 100 },
  {
    key: "status",
    title: "状态",
    width: 90,
    render: (row) => (
      <Badge variant="outline" className={statusColor[row.status]}>
        {row.status}
      </Badge>
    ),
  },
]

/* ---------- 页面 ---------- */

const designPoints = [
  { icon: Fingerprint, title: "唯一字段存储", desc: "value 只存唯一键（工号/编号），提交后端稳定可靠，名称变更不影响引用" },
  { icon: Tags, title: "名称字段展示", desc: "选中标签、回显均按 labelField 渲染，id 找不到记录时回退显示原始值" },
  { icon: ListChecks, title: "单选 / 多选", desc: "multiple 一个开关切换，多选带已选标签栏、逐个移除与清空" },
  { icon: SearchCheck, title: "搜索 + 分页", desc: "searchKeys 指定检索字段，跨页保持选中状态" },
]

export default function RecordPickerDemoPage() {
  // 单选：存工号
  const [ownerIds, setOwnerIds] = useState<string[]>(["XC0003"])
  const [ownerOpen, setOwnerOpen] = useState(false)
  // 多选：存项目编号
  const [projectIds, setProjectIds] = useState<string[]>(["P-2026-001", "P-2026-003"])
  const [projectOpen, setProjectOpen] = useState(false)
  // 混合选择：用户/部门/角色（数据来自后端接口）
  const [orgRefs, setOrgRefs] = useState<OrgRef[]>([])
  const [orgOpen, setOrgOpen] = useState(false)

  const ownerLabels = ownerIds.map((id) => ({
    id,
    label: employees.find((e) => e.empNo === id)?.name ?? id,
  }))
  const projectLabels = projectIds.map((id) => ({
    id,
    label: projects.find((p) => p.code === id)?.name ?? id,
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="弹窗选择"
        description="类 Teable 关系记录弹窗 · 唯一字段存储 + 名称字段展示 · 单选 / 多选 / 搜索 / 分页"
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 单选 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">单选 · 选择负责人</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">
                负责人 <span className="text-muted-foreground">（数据源：员工表）</span>
              </Label>
              <RecordPickerField
                labels={ownerLabels}
                placeholder="点击选择负责人"
                onOpen={() => setOwnerOpen(true)}
                onRemove={() => setOwnerIds([])}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Database className="size-3" />
                实际存储值（提交给后端）
              </Label>
              <pre className="rounded-md bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
                {JSON.stringify({ ownerId: ownerIds[0] ?? null })}
              </pre>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              界面展示「姓名」，存储的是唯一「工号」——员工改名不影响数据引用。
            </p>
          </CardContent>
        </Card>

        {/* 多选 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">多选 · 关联项目</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">
                关联项目 <span className="text-muted-foreground">（数据源：项目表）</span>
              </Label>
              <RecordPickerField
                labels={projectLabels}
                placeholder="点击关联项目"
                multiple
                onOpen={() => setProjectOpen(true)}
                onRemove={(id) => setProjectIds((prev) => prev.filter((v) => v !== id))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Database className="size-3" />
                实际存储值（提交给后端）
              </Label>
              <pre className="overflow-x-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
                {JSON.stringify({ projectCodes: projectIds })}
              </pre>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              展示「项目名称」，存储唯一「项目编号」数组；标签可逐个移除，弹窗内跨页选择不丢失。
            </p>
          </CardContent>
        </Card>

        {/* 混合选择：组织选择 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">混合选择 · 组织选择（用户/部门/角色）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">
                审批人 / 收件人 <span className="text-muted-foreground">（数据源：系统组织接口）</span>
              </Label>
              <OrgPickerField
                value={orgRefs}
                multiple
                placeholder="选择成员 / 部门 / 角色"
                onOpen={() => setOrgOpen(true)}
                onRemove={(ref) =>
                  setOrgRefs((prev) => prev.filter((r) => !(r.type === ref.type && r.id === ref.id)))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Database className="size-3" />
                实际存储值（提交给后端）
              </Label>
              <pre className="max-h-32 overflow-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
                {JSON.stringify(orgRefs, null, 2)}
              </pre>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              审批人、收件人等场景常需混选用户/部门/角色，存储「类型+ID」提交后端统一解析。
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 设计要点 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">设计要点</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {designPoints.map((point) => (
              <div key={point.title} className="flex gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <point.icon className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-medium">{point.title}</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{point.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 单选弹窗 */}
      <RecordPicker
        open={ownerOpen}
        onOpenChange={setOwnerOpen}
        title="选择负责人"
        data={employees}
        columns={employeeColumns}
        idField="empNo"
        labelField="name"
        value={ownerIds}
        searchKeys={["name", "empNo", "dept", "post"]}
        onConfirm={(ids, rows) => {
          setOwnerIds(ids)
          toast.success(ids.length ? `已选择负责人「${rows[0]?.name}」（${ids[0]}）` : "已清空负责人")
        }}
      />

      {/* 多选弹窗 */}
      <RecordPicker
        open={projectOpen}
        onOpenChange={setProjectOpen}
        title="关联项目"
        data={projects}
        columns={projectColumns}
        idField="code"
        labelField="name"
        multiple
        value={projectIds}
        searchKeys={["name", "code", "owner"]}
        onConfirm={(ids) => {
          setProjectIds(ids)
          toast.success(`已关联 ${ids.length} 个项目`)
        }}
      />

      {/* 组织选择弹窗 */}
      <OrgPicker
        open={orgOpen}
        onOpenChange={setOrgOpen}
        title="选择审批人 / 收件人"
        value={orgRefs}
        onConfirm={(refs) => {
          setOrgRefs(refs)
          toast.success(`已选择 ${refs.length} 个组织对象`)
        }}
      />
    </div>
  )
}

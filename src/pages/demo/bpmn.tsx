/**
 * BPMN 设计器 demo：设计器核心已抽至 workflow/designer/bpmn/editor.tsx
 * （与 /workflow/defs 的流程定义 BPMN 模式共用），本页保留原有可玩性：
 * 完整工具栏（新建/导入/导出 XML·SVG）+ 默认请假审批示例流程 + 自定义属性面板。
 */
import { PageHeader } from "@/components/page-header"
import { BpmnDesigner } from "@/pages/workflow/designer/bpmn/editor"
import { DEFAULT_XML } from "./bpmn-default-xml"

export default function BpmnDemoPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="BPMN 流程设计器"
        description="基于 bpmn-js 的标准 BPMN 2.0 建模器 · 左侧组件面板拖拽建模 · 右侧为自定义属性面板"
      />
      <BpmnDesigner initialXml={DEFAULT_XML} />
    </div>
  )
}

/**
 * 表单设计器 demo：设计器核心已抽至 workflow/designer/form/designer-core.tsx
 * （与 /workflow/form-defs 的表单定义编辑共用），本页保留原有可玩性：
 * 预览（真实 zod 校验）/ 导出 Schema / 清空 / 保存到控制台。
 */
import { useState } from "react"
import { Download, Eraser, Eye, Save } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Modal } from "@/components/modal"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  FormDesignerCore,
  FormPreview,
} from "@/pages/workflow/designer/form/designer-core"
import { initialWidgets, type FormWidget } from "./model"

export default function FormDesignerDemoPage() {
  const [widgets, setWidgets] = useState<FormWidget[]>(initialWidgets)
  const [formTitle, setFormTitle] = useState("请假申请表")
  const [previewOpen, setPreviewOpen] = useState(false)

  const exportJson = () => {
    const json = JSON.stringify({ title: formTitle, widgets }, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "form-schema.json"
    link.click()
    URL.revokeObjectURL(url)
    toast.success("已导出表单 Schema")
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="表单设计器"
        description="拖拽/点击添加字段 · 画布内拖拽排序 · 右侧属性配置 · 预览即真实 zod 校验"
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPreviewOpen(true)}>
              <Eye className="size-3.5" />
              预览
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportJson}>
              <Download className="size-3.5" />
              导出 Schema
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setWidgets([])}>
              <Eraser className="size-3.5" />
              清空
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                console.log(JSON.stringify({ title: formTitle, widgets }, null, 2))
                toast.success("表单已保存，Schema 已输出到控制台")
              }}
            >
              <Save className="size-3.5" />
              保存
            </Button>
          </>
        }
      />

      <Card className="gap-0 overflow-hidden p-0">
        <div className="h-[calc(100vh-300px)] min-h-[560px]">
          <FormDesignerCore
            widgets={widgets}
            onWidgetsChange={setWidgets}
            title={formTitle}
            onTitleChange={setFormTitle}
          />
        </div>
      </Card>

      {/* 预览弹窗 */}
      <Modal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={formTitle || "表单预览"}
        description="真实的 react-hook-form + zod 校验，必填项直接点提交可查看错误提示"
        width={620}
      >
        {widgets.filter((w) => w.type !== "divider" && w.type !== "note").length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            画布中还没有可填写的字段
          </div>
        ) : (
          <FormPreview
            widgets={widgets}
            onClose={() => setPreviewOpen(false)}
            onSubmitValues={(named) => {
              console.log("表单提交数据：", JSON.stringify(named, null, 2))
              toast.success("校验通过，提交数据已输出到控制台")
            }}
          />
        )}
      </Modal>
    </div>
  )
}

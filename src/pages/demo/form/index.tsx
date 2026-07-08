import { PageHeader } from "@/components/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StepForm } from "./step-form"
import { MasterDetailForm } from "./master-detail-form"
import { DynamicForm } from "./dynamic-form"

export default function AdvancedFormPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="高级表单"
        description="react-hook-form + zod 的企业级表单模式：分步向导 / 主子表 / 动态联动"
      />
      <Tabs defaultValue="step">
        <TabsList>
          <TabsTrigger value="step">分步表单</TabsTrigger>
          <TabsTrigger value="master-detail">主子表表单</TabsTrigger>
          <TabsTrigger value="dynamic">动态联动</TabsTrigger>
        </TabsList>
        <TabsContent value="step">
          <StepForm />
        </TabsContent>
        <TabsContent value="master-detail">
          <MasterDetailForm />
        </TabsContent>
        <TabsContent value="dynamic">
          <DynamicForm />
        </TabsContent>
      </Tabs>
    </div>
  )
}

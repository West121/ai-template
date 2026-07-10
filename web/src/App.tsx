import { lazy, Suspense, useEffect, type ReactNode } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { AppLayout } from "@/components/layout/app-layout"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { applyTheme } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"
import { useAuthStore } from "@/stores/auth-store"

const LoginPage = lazy(() => import("@/pages/login"))
const DashboardPage = lazy(() => import("@/pages/dashboard"))
const WorkflowTasksPage = lazy(() => import("@/pages/workflow/tasks"))
const WorkflowStartPage = lazy(() => import("@/pages/workflow/start"))
const WorkflowMonitorPage = lazy(() => import("@/pages/workflow/monitor"))
const WorkflowDefsPage = lazy(() => import("@/pages/workflow/defs"))
const WorkflowDesignerPage = lazy(() => import("@/pages/workflow/designer-page"))
const WorkflowFormDefsPage = lazy(() => import("@/pages/workflow/form-defs"))
const WorkflowInstanceDetailPage = lazy(() => import("@/pages/workflow/instance-detail"))
const WorkflowSealsPage = lazy(() => import("@/pages/workflow/seals"))
const DocumentReceivePage = lazy(() => import("@/pages/document/receive"))
const DocumentReceiveDetailPage = lazy(() => import("@/pages/document/receive-detail"))
const DocumentSendPage = lazy(() => import("@/pages/document/send"))
const DocumentSendDetailPage = lazy(() => import("@/pages/document/send-detail"))
const DocumentLedgerPage = lazy(() => import("@/pages/document/ledger"))
const MeetingRoomsPage = lazy(() => import("@/pages/meeting/rooms"))
const MeetingMyPage = lazy(() => import("@/pages/meeting/my"))
const AttendanceRecordPage = lazy(() => import("@/pages/attendance/record"))
const AttendanceLeavePage = lazy(() => import("@/pages/attendance/leave"))
const AttendanceTripPage = lazy(() => import("@/pages/attendance/trip"))
const ContactsPage = lazy(() => import("@/pages/contacts"))
const AnnouncementPage = lazy(() => import("@/pages/announcement"))
const SchedulePage = lazy(() => import("@/pages/schedule"))
const DeptPage = lazy(() => import("@/pages/system/dept"))
const PostPage = lazy(() => import("@/pages/system/post"))
const UserPage = lazy(() => import("@/pages/system/user"))
const RolePage = lazy(() => import("@/pages/system/role"))
const MenuPage = lazy(() => import("@/pages/system/menu"))
const JobPage = lazy(() => import("@/pages/system/job"))
const LogPage = lazy(() => import("@/pages/system/log"))
const FilePage = lazy(() => import("@/pages/system/file"))
const DictPage = lazy(() => import("@/pages/system/dict"))
const ModalDemoPage = lazy(() => import("@/pages/demo/modal"))
const DrawerDemoPage = lazy(() => import("@/pages/demo/drawer"))
const TableDemoPage = lazy(() => import("@/pages/demo/table"))
const EditTableDemoPage = lazy(() => import("@/pages/demo/edit-table"))
const FormDesignerDemoPage = lazy(() => import("@/pages/demo/form-designer"))
const RecordPickerDemoPage = lazy(() => import("@/pages/demo/record-picker"))
const AdvancedFormDemoPage = lazy(() => import("@/pages/demo/form"))
const RichTextDemoPage = lazy(() => import("@/pages/demo/rich-text"))
const ApprovalFlowDemoPage = lazy(() => import("@/pages/demo/approval-flow"))
const FlowDesignerDemoPage = lazy(() => import("@/pages/workflow/designer/flow/flow-designer"))
const NotFoundPage = lazy(() => import("@/pages/not-found"))

function PageLoading() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const themeMode = useAppStore((s) => s.themeMode)
  const primaryColor = useAppStore((s) => s.primaryColor)
  const radius = useAppStore((s) => s.radius)
  const grayscale = useAppStore((s) => s.grayscale)
  const colorWeak = useAppStore((s) => s.colorWeak)

  useEffect(() => {
    applyTheme({ themeMode, primaryColor, radius, grayscale, colorWeak })
  }, [themeMode, primaryColor, radius, grayscale, colorWeak])

  // 跟随系统主题变化
  useEffect(() => {
    if (themeMode !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () =>
      applyTheme({ themeMode, primaryColor, radius, grayscale, colorWeak })
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [themeMode, primaryColor, radius, grayscale, colorWeak])

  return (
    <TooltipProvider delayDuration={200}>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            {/* 审批中心已退役并入流程中心，旧路径统一重定向到「我的审批」 */}
            <Route path="approval/*" element={<Navigate to="/workflow/tasks" replace />} />
            <Route path="workflow">
              <Route index element={<Navigate to="/workflow/tasks" replace />} />
              <Route path="tasks" element={<WorkflowTasksPage />} />
              <Route path="start" element={<WorkflowStartPage />} />
              <Route path="monitor" element={<WorkflowMonitorPage />} />
              <Route path="defs" element={<WorkflowDefsPage />} />
              {/* 流程设计器整页（不进菜单，同 instances/:id 动态路由）：新建 / 编辑设计 */}
              <Route path="defs/new" element={<WorkflowDesignerPage />} />
              <Route path="defs/:code/design" element={<WorkflowDesignerPage />} />
              <Route path="form-defs" element={<WorkflowFormDefsPage />} />
              <Route path="seals" element={<WorkflowSealsPage />} />
              {/* 旧的六个独立菜单 → 合并页对应 Tab；流程治理 → 流程监控 */}
              <Route path="todo" element={<Navigate to="/workflow/tasks?tab=todo" replace />} />
              <Route path="cc" element={<Navigate to="/workflow/tasks?tab=cc" replace />} />
              <Route path="done" element={<Navigate to="/workflow/tasks?tab=done" replace />} />
              <Route path="mine" element={<Navigate to="/workflow/tasks?tab=mine" replace />} />
              <Route path="draft" element={<Navigate to="/workflow/tasks?tab=draft" replace />} />
              <Route path="delegate" element={<Navigate to="/workflow/tasks?tab=delegate" replace />} />
              <Route path="admin" element={<Navigate to="/workflow/monitor" replace />} />
              <Route path="instances/:id" element={<WorkflowInstanceDetailPage />} />
            </Route>
            <Route path="document">
              <Route index element={<Navigate to="/document/receive" replace />} />
              <Route path="receive" element={<DocumentReceivePage />} />
              <Route path="receive/:id" element={<DocumentReceiveDetailPage />} />
              <Route path="send" element={<DocumentSendPage />} />
              <Route path="send/:id" element={<DocumentSendDetailPage />} />
              <Route path="ledger" element={<DocumentLedgerPage />} />
            </Route>
            <Route path="meeting">
              <Route index element={<Navigate to="/meeting/rooms" replace />} />
              <Route path="rooms" element={<MeetingRoomsPage />} />
              <Route path="my" element={<MeetingMyPage />} />
            </Route>
            <Route path="attendance">
              <Route index element={<Navigate to="/attendance/record" replace />} />
              <Route path="record" element={<AttendanceRecordPage />} />
              <Route path="leave" element={<AttendanceLeavePage />} />
              <Route path="trip" element={<AttendanceTripPage />} />
            </Route>
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="announcement" element={<AnnouncementPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="system">
              <Route index element={<Navigate to="/system/user" replace />} />
              <Route path="org">
                <Route index element={<Navigate to="/system/org/dept" replace />} />
                <Route path="dept" element={<DeptPage />} />
                <Route path="post" element={<PostPage />} />
              </Route>
              <Route path="user" element={<UserPage />} />
              <Route path="role" element={<RolePage />} />
              <Route path="menu" element={<MenuPage />} />
              <Route path="job" element={<JobPage />} />
              <Route path="log" element={<LogPage />} />
              <Route path="file" element={<FilePage />} />
              <Route path="dict" element={<DictPage />} />
            </Route>
            <Route path="demo">
              <Route index element={<Navigate to="/demo/modal" replace />} />
              <Route path="modal" element={<ModalDemoPage />} />
              <Route path="drawer" element={<DrawerDemoPage />} />
              <Route path="table" element={<TableDemoPage />} />
              <Route path="edit-table" element={<EditTableDemoPage />} />
              <Route path="form-designer" element={<FormDesignerDemoPage />} />
              <Route path="record-picker" element={<RecordPickerDemoPage />} />
              <Route path="form" element={<AdvancedFormDemoPage />} />
              <Route path="rich-text" element={<RichTextDemoPage />} />
              <Route path="approval-flow" element={<ApprovalFlowDemoPage />} />
              <Route path="flow-designer" element={<FlowDesignerDemoPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster richColors position="top-center" />
    </TooltipProvider>
  )
}

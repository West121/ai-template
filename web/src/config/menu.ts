import type { LucideIcon } from "lucide-react"
import {
  LayoutDashboard,
  FileText,
  Presentation,
  CalendarClock,
  BookUser,
  Megaphone,
  CalendarDays,
  Settings,
  Network,
  SquarePen,
  FileInput,
  FileOutput,
  DoorOpen,
  Video,
  Fingerprint,
  Plane,
  Users,
  ShieldCheck,
  ListTree,
  Boxes,
  AppWindow,
  PanelRight,
  Table2,
  TableProperties,
  TextCursorInput,
  ListChecks,
  FileStack,
  AlarmClock,
  SquareArrowOutUpRight,
  ScrollText,
  FolderOpen,
  BookMarked,
  Workflow,
  GitFork,
  Stamp,
  Route,
  Building2,
  BriefcaseBusiness,
  Inbox,
  Activity,
} from "lucide-react"

export interface MenuItem {
  /** 菜单标题 */
  title: string
  /** 路由路径（external 时为完整 URL），作为菜单/标签页的唯一 key */
  path: string
  icon?: LucideIcon
  /** 徽标数字，如待办数量 */
  badge?: number
  /** 外部链接：点击新窗口打开，不参与路由/标签页 */
  external?: boolean
  children?: MenuItem[]
}

export const menuTree: MenuItem[] = [
  { title: "工作台", path: "/dashboard", icon: LayoutDashboard },
  {
    title: "流程中心",
    path: "/workflow",
    icon: Route,
    children: [
      { title: "我的审批", path: "/workflow/tasks", icon: Inbox },
      { title: "发起申请", path: "/workflow/start", icon: SquarePen },
      { title: "流程监控", path: "/workflow/monitor", icon: Activity },
      { title: "流程定义", path: "/workflow/defs", icon: GitFork },
      { title: "表单定义", path: "/workflow/form-defs", icon: TextCursorInput },
      { title: "电子章", path: "/workflow/seals", icon: Stamp },
    ],
  },
  {
    title: "公文管理",
    path: "/document",
    icon: FileText,
    children: [
      { title: "收文管理", path: "/document/receive", icon: FileInput },
      { title: "发文管理", path: "/document/send", icon: FileOutput },
      { title: "公文台账", path: "/document/ledger", icon: FileStack },
    ],
  },
  {
    title: "会议管理",
    path: "/meeting",
    icon: Presentation,
    children: [
      { title: "会议室预订", path: "/meeting/rooms", icon: DoorOpen },
      { title: "我的会议", path: "/meeting/my", icon: Video },
    ],
  },
  {
    title: "考勤管理",
    path: "/attendance",
    icon: CalendarClock,
    children: [
      { title: "打卡记录", path: "/attendance/record", icon: Fingerprint },
      { title: "请假管理", path: "/attendance/leave", icon: CalendarDays },
      { title: "出差管理", path: "/attendance/trip", icon: Plane },
    ],
  },
  { title: "通讯录", path: "/contacts", icon: BookUser },
  { title: "公告通知", path: "/announcement", icon: Megaphone, badge: 2 },
  { title: "日程管理", path: "/schedule", icon: CalendarDays },
  {
    title: "系统管理",
    path: "/system",
    icon: Settings,
    children: [
      {
        title: "组织架构",
        path: "/system/org",
        icon: Network,
        children: [
          { title: "部门管理", path: "/system/org/dept", icon: Building2 },
          { title: "岗位管理", path: "/system/org/post", icon: BriefcaseBusiness },
        ],
      },
      { title: "用户管理", path: "/system/user", icon: Users },
      { title: "角色管理", path: "/system/role", icon: ShieldCheck },
      { title: "菜单管理", path: "/system/menu", icon: ListTree },
      { title: "定时任务", path: "/system/job", icon: AlarmClock },
      { title: "字典管理", path: "/system/dict", icon: BookMarked },
      { title: "文件管理", path: "/system/file", icon: FolderOpen },
      { title: "日志管理", path: "/system/log", icon: ScrollText },
      {
        title: "XXL-Job 控制台",
        path: "http://localhost:8082/xxl-job-admin",
        icon: SquareArrowOutUpRight,
        external: true,
      },
    ],
  },
  {
    title: "组件示例",
    path: "/demo",
    icon: Boxes,
    children: [
      { title: "高级弹窗", path: "/demo/modal", icon: AppWindow },
      { title: "侧边抽屉", path: "/demo/drawer", icon: PanelRight },
      { title: "高级表格", path: "/demo/table", icon: Table2 },
      { title: "编辑表格", path: "/demo/edit-table", icon: TableProperties },
      { title: "表单设计器", path: "/demo/form-designer", icon: TextCursorInput },
      { title: "弹窗选择", path: "/demo/record-picker", icon: ListChecks },
      { title: "高级表单", path: "/demo/form", icon: FileStack },
      { title: "富文本编辑器", path: "/demo/rich-text", icon: SquarePen },
      { title: "审批流设计器", path: "/demo/approval-flow", icon: GitFork },
      { title: "流程设计器", path: "/demo/flow-designer", icon: Workflow },
    ],
  },
]

/** 统一的菜单打开逻辑：外链新窗口，内部路径走路由 */
export function openMenuItem(item: MenuItem, navigate: (path: string) => void) {
  if (item.external) {
    window.open(item.path, "_blank", "noopener")
  } else {
    navigate(item.path)
  }
}

/** 扁平化菜单树（含所有层级节点） */
export function flattenMenu(items: MenuItem[] = menuTree): MenuItem[] {
  return items.flatMap((item) => [item, ...(item.children ? flattenMenu(item.children) : [])])
}

const flatMenu = flattenMenu()

export function findMenuByPath(path: string): MenuItem | undefined {
  return flatMenu.find((item) => item.path === path)
}

/** 返回从根到当前路径的菜单链，用于面包屑 */
export function findMenuChain(path: string, items: MenuItem[] = menuTree): MenuItem[] {
  for (const item of items) {
    if (item.path === path) return [item]
    if (item.children) {
      const chain = findMenuChain(path, item.children)
      if (chain.length > 0) return [item, ...chain]
    }
  }
  return []
}

/** 查找路径所属的一级菜单（混合布局用） */
export function findRootMenu(path: string): MenuItem | undefined {
  return menuTree.find((item) => path === item.path || path.startsWith(item.path + "/"))
}

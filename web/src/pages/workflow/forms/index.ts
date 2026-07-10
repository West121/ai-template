/**
 * CODE 表单登记入口 —— 集中 import 所有手写 react-hook-form 表单模块，
 * 触发各自的 `registerForm` 副作用。凡需要 CODE 表单清单/渲染的入口（设计器、办理页）
 * 只需 `import "@/pages/workflow/forms"` 即可确保注册就绪。
 */
import "./leave-form"

export { LeaveForm, LEAVE_FORM_KEY, formMeta as leaveFormMeta } from "./leave-form"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Building2,
  ChevronRight,
  Inbox,
  Search,
  ShieldCheck,
  UserRound,
  WifiOff,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api, NetworkError, type PageResult } from "@/lib/api"
import { Modal } from "@/components/modal"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * 组织选择器（钉钉式 用户/部门/角色 混合选择）
 *
 * 存储 OrgRef = { type, id, name }：type+id 提交后端做审批人/收件人解析，
 * name 仅用于回显（后端也可按 id 重新反查最新名称）。
 */

export type OrgRefType = "USER" | "DEPT" | "ROLE"

export interface OrgRef {
  type: OrgRefType
  id: number
  name: string
}

const orgTypeMeta: Record<
  OrgRefType,
  { label: string; icon: typeof UserRound; chip: string }
> = {
  USER: {
    label: "成员",
    icon: UserRound,
    chip: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  DEPT: {
    label: "部门",
    icon: Building2,
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  ROLE: {
    label: "角色",
    icon: ShieldCheck,
    chip: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
}

/** tab key ↔ OrgRefType 映射（tab 用小写，ref 用大写） */
type OrgTab = "user" | "dept" | "role"
const TAB_BY_TYPE: Record<OrgRefType, OrgTab> = { USER: "user", DEPT: "dept", ROLE: "role" }

const sameRef = (a: { type: OrgRefType; id: number }, b: { type: OrgRefType; id: number }) =>
  a.type === b.type && a.id === b.id

/* ---------- 接口数据形状（见 docs/api-contract.md 系统管理） ---------- */

interface UserItem {
  id: number
  name: string
  avatar?: string | null
  primaryDeptName?: string | null
  primaryPostName?: string | null
}

interface DeptNode {
  id: number
  name: string
  userCount?: number
  children?: DeptNode[]
}

interface RoleItem {
  id: number
  name: string
  dataScope: string
}

const SCOPE_LABELS: Record<string, string> = {
  ALL: "全部数据",
  DEPT_AND_CHILD: "本部门及以下",
  DEPT: "本部门",
  SELF: "仅本人",
  CUSTOM: "自定义",
}

/* ---------- 弹窗主体 ---------- */

export interface OrgPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  /** 默认 true；false 时任意 tab 点选即替换唯一值 */
  multiple?: boolean
  /** 允许选择的类型（默认三者全开）；限制后只显示对应 tab，避免"指定人员却能选部门"这类越权选择 */
  types?: OrgRefType[]
  value: OrgRef[]
  onConfirm: (refs: OrgRef[]) => void
}

export function OrgPicker({
  open,
  onOpenChange,
  title = "选择组织对象",
  multiple = true,
  types,
  value,
  onConfirm,
}: OrgPickerProps) {
  const allowedTypes = types && types.length ? types : (["USER", "DEPT", "ROLE"] as OrgRefType[])
  const allowedTabs = allowedTypes.map((t) => TAB_BY_TYPE[t])
  const [tab, setTab] = useState<OrgTab>(allowedTabs[0])
  const [keyword, setKeyword] = useState("")
  const [selected, setSelected] = useState<OrgRef[]>(value)
  const [users, setUsers] = useState<UserItem[]>([])
  const [depts, setDepts] = useState<DeptNode[]>([])
  const [roles, setRoles] = useState<RoleItem[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [netError, setNetError] = useState(false)
  const [loading, setLoading] = useState(false)

  const fetchUsers = useCallback((kw: string) => {
    return api<PageResult<UserItem>>(
      `/api/system/users?keyword=${encodeURIComponent(kw)}&pageNum=1&pageSize=100`,
    ).then((res) => setUsers(res.list))
  }, [])

  const fetchStatic = useCallback(() => {
    return Promise.all([
      api<DeptNode[]>("/api/system/depts/tree").then((tree) => {
        setDepts(tree)
        // 默认全部展开（组织树通常不深）
        const ids = new Set<number>()
        const walk = (nodes: DeptNode[]) => {
          for (const node of nodes) {
            if (node.children?.length) {
              ids.add(node.id)
              walk(node.children)
            }
          }
        }
        walk(tree)
        setExpanded(ids)
      }),
      api<PageResult<RoleItem>>("/api/system/roles?pageNum=1&pageSize=100").then((res) =>
        setRoles(res.list),
      ),
    ])
  }, [])

  const loadAll = useCallback(
    (kw: string) => {
      setLoading(true)
      setNetError(false)
      Promise.all([fetchUsers(kw), fetchStatic()])
        .catch((err: unknown) => {
          if (err instanceof NetworkError) setNetError(true)
        })
        .finally(() => setLoading(false))
    },
    [fetchUsers, fetchStatic],
  )

  // 每次打开重置为外部值并加载数据
  useEffect(() => {
    if (open) {
      setSelected(value)
      setTab(allowedTabs[0])
      setKeyword("")
      loadAll("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 成员搜索：防抖 300ms 走服务端 keyword
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      fetchUsers(keyword.trim()).catch((err: unknown) => {
        if (err instanceof NetworkError) setNetError(true)
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [keyword, open, fetchUsers])

  const toggle = (ref: OrgRef) => {
    setSelected((prev) => {
      const exists = prev.some((s) => sameRef(s, ref))
      if (!multiple) return exists ? [] : [ref]
      return exists ? prev.filter((s) => !sameRef(s, ref)) : [...prev, ref]
    })
  }

  const isChecked = (type: OrgRefType, id: number) => selected.some((s) => sameRef(s, { type, id }))

  const grouped = useMemo(
    () =>
      (["USER", "DEPT", "ROLE"] as const)
        .map((type) => ({ type, refs: selected.filter((s) => s.type === type) }))
        .filter((g) => g.refs.length > 0),
    [selected],
  )

  /* ---------- 各 tab 列表 ---------- */

  const renderCheck = (checked: boolean) =>
    multiple ? (
      <Checkbox checked={checked} className="pointer-events-none" />
    ) : (
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border-2",
          checked ? "border-primary bg-primary" : "border-muted-foreground/40",
        )}
      >
        {checked && <span className="size-1.5 rounded-full bg-primary-foreground" />}
      </span>
    )

  const emptyHint = (text: string) => (
    <div className="flex h-40 flex-col items-center justify-center gap-1.5 text-muted-foreground">
      <Inbox className="size-8 opacity-30" />
      <span className="text-xs">{text}</span>
    </div>
  )

  const renderUserTab = () => (
    <>
      <div className="shrink-0 px-3 pt-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索姓名 / 账号 / 工号 / 手机号"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {users.length === 0 && !loading
          ? emptyHint("未找到匹配成员")
          : users.map((user) => {
              const checked = isChecked("USER", user.id)
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => toggle({ type: "USER", id: user.id, name: user.name })}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50",
                    checked && "bg-primary/5",
                  )}
                >
                  {renderCheck(checked)}
                  <Avatar className="size-6">
                    {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                    <AvatarFallback className="bg-blue-500/10 text-[10px] text-blue-600 dark:text-blue-400">
                      {user.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{user.name}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[user.primaryDeptName, user.primaryPostName].filter(Boolean).join(" · ")}
                  </span>
                </button>
              )
            })}
      </div>
    </>
  )

  const renderDeptNodes = (nodes: DeptNode[], depth: number) =>
    nodes.map((node) => {
      const checked = isChecked("DEPT", node.id)
      const hasChildren = !!node.children?.length
      const isOpen = expanded.has(node.id)
      return (
        <div key={node.id}>
          <div
            className={cn(
              "flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 transition-colors hover:bg-accent/50",
              checked && "bg-primary/5",
            )}
            style={{ paddingLeft: depth * 20 + 8 }}
            onClick={() => toggle({ type: "DEPT", id: node.id, name: node.name })}
          >
            {hasChildren ? (
              <button
                type="button"
                className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation()
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(node.id)) next.delete(node.id)
                    else next.add(node.id)
                    return next
                  })
                }}
              >
                <ChevronRight
                  className={cn("size-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")}
                />
              </button>
            ) : (
              <span className="size-5 shrink-0" />
            )}
            {renderCheck(checked)}
            <Building2 className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="min-w-0 flex-1 truncate text-sm">{node.name}</span>
            {node.userCount != null && (
              <span className="text-xs text-muted-foreground">{node.userCount} 人</span>
            )}
          </div>
          {hasChildren && isOpen && renderDeptNodes(node.children!, depth + 1)}
        </div>
      )
    })

  const renderDeptTab = () => (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {depts.length === 0 && !loading ? emptyHint("暂无部门数据") : renderDeptNodes(depts, 0)}
    </div>
  )

  const renderRoleTab = () => (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {roles.length === 0 && !loading
        ? emptyHint("暂无角色数据")
        : roles.map((role) => {
            const checked = isChecked("ROLE", role.id)
            return (
              <button
                key={role.id}
                type="button"
                onClick={() => toggle({ type: "ROLE", id: role.id, name: role.name })}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50",
                  checked && "bg-primary/5",
                )}
              >
                {renderCheck(checked)}
                <ShieldCheck className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
                <span className="min-w-0 flex-1 truncate text-sm">{role.name}</span>
                <span className="text-xs text-muted-foreground">
                  {SCOPE_LABELS[role.dataScope] ?? role.dataScope}
                </span>
              </button>
            )
          })}
    </div>
  )

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        allowedTypes.length === 1
          ? `选择${orgTypeMeta[allowedTypes[0]].label}`
          : multiple
            ? `可混合选择${allowedTypes.map((t) => orgTypeMeta[t].label).join("、")}`
            : "单选：点选即替换当前值"
      }
      width={760}
      height={560}
      bodyClassName="flex overflow-hidden p-0"
      footer={
        <>
          <span className="mr-auto text-xs text-muted-foreground">
            已选 <span className="font-semibold text-primary">{selected.length}</span> 项
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => {
              onConfirm(selected)
              onOpenChange(false)
            }}
          >
            确定
          </Button>
        </>
      }
    >
      {/* 左侧：Tabs + 列表 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {allowedTabs.length > 1 && (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as OrgTab)}
            className="shrink-0 px-3 pt-3"
          >
            <TabsList className="w-full">
              {allowedTabs.includes("user") && (
                <TabsTrigger value="user" className="gap-1.5">
                  <UserRound className="size-3.5" />
                  成员
                </TabsTrigger>
              )}
              {allowedTabs.includes("dept") && (
                <TabsTrigger value="dept" className="gap-1.5">
                  <Building2 className="size-3.5" />
                  部门
                </TabsTrigger>
              )}
              {allowedTabs.includes("role") && (
                <TabsTrigger value="role" className="gap-1.5">
                  <ShieldCheck className="size-3.5" />
                  角色
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        )}

        {netError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <WifiOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端未启动</div>
            <p className="text-xs text-muted-foreground">
              无法连接后端服务，组织数据（成员 / 部门 / 角色）暂不可用
            </p>
            <Button variant="outline" size="sm" onClick={() => loadAll(keyword.trim())}>
              重试
            </Button>
          </div>
        ) : (
          <>
            {tab === "user" && renderUserTab()}
            {tab === "dept" && renderDeptTab()}
            {tab === "role" && renderRoleTab()}
          </>
        )}
      </div>

      {/* 右侧：已选面板（按类型分组） */}
      <aside className="flex w-60 shrink-0 flex-col border-l bg-muted/20">
        <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
          <span className="text-xs text-muted-foreground">
            已选 <span className="font-semibold text-primary">{selected.length}</span> 项
          </span>
          {selected.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground"
              onClick={() => setSelected([])}
            >
              清空
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {grouped.length === 0 ? (
            <p className="pt-8 text-center text-xs text-muted-foreground">
              尚未选择
              <br />
              从左侧列表勾选成员、部门或角色
            </p>
          ) : (
            grouped.map(({ type, refs }) => {
              const meta = orgTypeMeta[type]
              return (
                <div key={type} className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">
                    {meta.label}（{refs.length}）
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {refs.map((ref) => (
                      <Badge
                        key={`${ref.type}-${ref.id}`}
                        variant="outline"
                        className={cn("gap-1 pr-1 font-normal", meta.chip)}
                      >
                        <meta.icon className="size-3" />
                        {ref.name}
                        <button
                          type="button"
                          className="rounded-full p-0.5 hover:bg-foreground/10"
                          onClick={() => setSelected((prev) => prev.filter((s) => !sameRef(s, ref)))}
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </aside>
    </Modal>
  )
}

/* ================= 触发器：字段样式的选择入口 ================= */

export interface OrgPickerFieldProps {
  value: OrgRef[]
  placeholder?: string
  multiple?: boolean
  onOpen: () => void
  onRemove: (ref: OrgRef) => void
  className?: string
}

/** 表单字段样式的触发器：chips 带类型图标与配色，点击打开选择弹窗 */
export function OrgPickerField({
  value,
  placeholder = "点击选择成员 / 部门 / 角色",
  multiple,
  onOpen,
  onRemove,
  className,
}: OrgPickerFieldProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2.5 py-1.5 text-left text-sm transition-colors hover:border-primary/40",
        className,
      )}
    >
      {value.length === 0 ? (
        <span className="text-muted-foreground">{placeholder}</span>
      ) : (
        value.map((ref) => {
          const meta = orgTypeMeta[ref.type]
          return (
            <Badge
              key={`${ref.type}-${ref.id}`}
              variant="outline"
              className={cn("gap-1 pr-1 font-normal", meta.chip)}
            >
              <meta.icon className="size-3" />
              {ref.name}
              {multiple && (
                <span
                  role="button"
                  tabIndex={0}
                  className="rounded-full p-0.5 hover:bg-foreground/10"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(ref)
                  }}
                  onKeyDown={(e) => e.key === "Enter" && onRemove(ref)}
                >
                  <X className="size-3" />
                </span>
              )}
            </Badge>
          )
        })
      )}
      <Search className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

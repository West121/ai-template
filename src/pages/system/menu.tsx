import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CloudOff,
  FolderPlus,
  Pencil,
  Plus,
  RotateCw,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { api, NetworkError } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAuthStore } from "@/stores/auth-store"

interface PermNode {
  id: number
  code: string
  name: string
  type: "MENU" | "BUTTON"
  children?: PermNode[]
}

interface FlatRow {
  node: PermNode
  depth: number
  sort: number
}

/** 收集所有包含子级的节点 id（可展开节点） */
function collectParentIds(nodes: PermNode[]): number[] {
  return nodes.flatMap((node) =>
    node.children?.length ? [node.id, ...collectParentIds(node.children)] : [],
  )
}

/** 按展开状态扁平化权限树 */
function flattenVisible(nodes: PermNode[], depth: number, expanded: Set<number>, out: FlatRow[]) {
  nodes.forEach((node, index) => {
    out.push({ node, depth, sort: (index + 1) * 10 })
    if (node.children?.length && expanded.has(node.id)) {
      flattenVisible(node.children, depth + 1, expanded, out)
    }
  })
}

export default function MenuPage() {
  const [tree, setTree] = useState<PermNode[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const offline = useAuthStore((s) => s.offline)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await api<PermNode[]>("/api/system/permissions/tree")
      setTree(data)
      // 默认展开一级目录
      setExpanded(new Set(data.filter((node) => node.children?.length).map((node) => node.id)))
    } catch (err) {
      if (err instanceof NetworkError) setLoadError("network")
      else setLoadError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (offline) {
      setLoading(false)
      setLoadError("network")
      return
    }
    void load()
  }, [load, offline])

  const rows = useMemo(() => {
    const out: FlatRow[] = []
    flattenVisible(tree, 0, expanded, out)
    return out
  }, [tree, expanded])

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const expandAll = () => setExpanded(new Set(collectParentIds(tree)))
  const collapseAll = () => setExpanded(new Set())

  return (
    <div className="space-y-4">
      <PageHeader
        title="菜单管理"
        description={
          offline || loadError === "network"
            ? "后端未连接——启动 server/ 后此页展示真实权限点树"
            : "查看系统功能权限点（目录 / 按钮），角色管理中按此树为角色授权"
        }
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1" onClick={expandAll}>
              <ChevronsUpDown className="size-4" />
              展开全部
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={collapseAll}>
              <ChevronsDownUp className="size-4" />
              折叠全部
            </Button>
            <Button size="sm" className="gap-1" onClick={() => toast.info("演示环境：权限点的增删不开放")}>
              <Plus className="size-4" />
              新增权限点
            </Button>
          </>
        }
      />

      {loadError === "network" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CloudOff className="size-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium">后端服务未启动</div>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              此页面已接入真实接口。启动后端：cd server && docker compose up -d && mvn -pl oa-boot spring-boot:run，
              然后用 admin（密码 admin123）重新登录，即可查看真实的功能权限点树。
            </p>
            <Button size="sm" className="gap-1.5" onClick={() => void load()}>
              <RotateCw className="size-3.5" /> 重试连接
            </Button>
          </CardContent>
        </Card>
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="size-8 text-rose-500/60" />
            <div className="text-sm">{loadError}</div>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">名称</TableHead>
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">权限编码</TableHead>
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">类型</TableHead>
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">排序</TableHead>
                <TableHead className="bg-muted/50 text-xs font-medium text-muted-foreground">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-xs text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-xs text-muted-foreground">
                    暂无权限点数据
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(({ node, depth, sort }) => {
                  const hasChildren = !!node.children?.length
                  const isOpen = expanded.has(node.id)
                  return (
                    <TableRow key={node.id}>
                      <TableCell>
                        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 24 }}>
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggle(node.id)}
                              className="flex size-5 items-center justify-center rounded hover:bg-muted"
                              aria-label={isOpen ? "折叠" : "展开"}
                            >
                              <ChevronRight
                                className={cn(
                                  "size-3.5 text-muted-foreground transition-transform",
                                  isOpen && "rotate-90",
                                )}
                              />
                            </button>
                          ) : (
                            <span className="size-5 shrink-0" />
                          )}
                          <span className="text-sm font-medium">{node.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{node.code}</span>
                      </TableCell>
                      <TableCell>
                        {node.type === "MENU" ? (
                          <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600">
                            目录
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                          >
                            按钮
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm tabular-nums text-muted-foreground">{sort}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => toast.info(`演示环境：编辑权限点「${node.name}」仅作展示`)}
                          >
                            <Pencil className="size-3.5" />
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => toast.info(`演示环境：在「${node.name}」下新增子级仅作展示`)}
                          >
                            <FolderPlus className="size-3.5" />
                            新增子级
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-600"
                            onClick={() => toast.info(`演示环境：删除权限点「${node.name}」仅作展示`)}
                          >
                            <Trash2 className="size-3.5" />
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

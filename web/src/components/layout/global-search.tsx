import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { CornerDownLeft } from "lucide-react"
import { filterMenu, flattenMenu, findMenuChain, menuTree, openMenuItem } from "@/config/menu"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { useUiStore } from "@/stores/ui-store"
import { useAuthStore } from "@/stores/auth-store"

export function GlobalSearch() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const open = useUiStore((s) => s.searchOpen)
  const setOpen = useUiStore((s) => s.setSearchOpen)
  // ⌘K 候选随权限动态过滤（hidden + perm；离线 permissions=null 放行）
  const permissions = useAuthStore((s) => s.permissions)
  const searchableItems = useMemo(
    () => flattenMenu(filterMenu(menuTree, permissions)).filter((item) => !item.children?.length),
    [permissions],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!useUiStore.getState().searchOpen)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [setOpen])

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t("全局搜索")} description={t("搜索菜单页面")}>
      <CommandInput placeholder={t("搜索菜单、页面…")} />
      <CommandList>
        <CommandEmpty>{t("未找到相关结果")}</CommandEmpty>
        <CommandGroup heading={t("页面导航")}>
          {searchableItems.map((item) => {
            const chain = findMenuChain(item.path)
            // 匹配用中文源串（path 为键机制不动），展示用译文
            const rawLabel = chain.map((c) => c.title).join(" / ")
            const label = chain.map((c) => t(c.title)).join(" / ")
            return (
              <CommandItem
                key={item.path}
                value={rawLabel + item.path}
                onSelect={() => {
                  setOpen(false)
                  openMenuItem(item, navigate)
                }}
              >
                {item.icon && <item.icon className="size-4 text-muted-foreground" />}
                <span>{label}</span>
                <CornerDownLeft className="ml-auto size-3.5 text-muted-foreground/50" />
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

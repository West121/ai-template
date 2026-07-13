import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { CornerDownLeft } from "lucide-react"
import { flattenMenu, findMenuChain, openMenuItem } from "@/config/menu"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { useUiStore } from "@/stores/ui-store"

const searchableItems = flattenMenu().filter((item) => !item.children?.length && !item.hidden)

export function GlobalSearch() {
  const navigate = useNavigate()
  const open = useUiStore((s) => s.searchOpen)
  const setOpen = useUiStore((s) => s.setSearchOpen)

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
    <CommandDialog open={open} onOpenChange={setOpen} title="全局搜索" description="搜索菜单页面">
      <CommandInput placeholder="搜索菜单、页面…" />
      <CommandList>
        <CommandEmpty>未找到相关结果</CommandEmpty>
        <CommandGroup heading="页面导航">
          {searchableItems.map((item) => {
            const chain = findMenuChain(item.path)
            const label = chain.map((c) => c.title).join(" / ")
            return (
              <CommandItem
                key={item.path}
                value={label + item.path}
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

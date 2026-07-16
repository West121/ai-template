/**
 * 顶栏语言切换器（i18n M1，docs/design/i18n.md §3.3）。
 *
 * 形态照抄 ThemeToggle：DropdownMenu 图标钮（lucide Languages），当前项 bg-accent text-primary。
 * 五项以**母语自显**（简体中文/English/繁體中文/ไทย/日本語，语言名不翻译）。
 * 单一真源 app-store.locale：这里只 setLocale，i18next.changeLanguage/语言包懒加载/<html lang>
 * 由 lib/i18n.ts 的订阅联动完成；settings-drawer 的「语言」节共享同一状态。
 */
import { Languages } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LOCALES, useAppStore } from "@/stores/app-store"

export function LocaleSwitcher() {
  const locale = useAppStore((s) => s.locale)
  const setLocale = useAppStore((s) => s.setLocale)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="切换语言">
          <Languages className="size-4.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((item) => (
          <DropdownMenuItem
            key={item.value}
            className={locale === item.value ? "bg-accent text-primary" : ""}
            onClick={() => setLocale(item.value)}
          >
            {/* 母语自显，不随界面语言翻译 */}
            {item.native}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

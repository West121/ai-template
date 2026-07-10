import { Check, Monitor, Moon, RotateCcw, Sun } from "lucide-react"
import { PRESET_COLORS } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  useAppStore,
  type AppSettings,
  type LayoutMode,
  type TabStyle,
  type ThemeMode,
} from "@/stores/app-store"
import { useUiStore } from "@/stores/ui-store"
import { toast } from "sonner"

/** 布局模式缩略图 */
function LayoutPreview({ mode, active, onClick }: { mode: LayoutMode; active: boolean; onClick: () => void }) {
  const labels: Record<LayoutMode, string> = {
    vertical: "侧边布局",
    horizontal: "顶部布局",
    mixed: "混合布局",
  }
  return (
    <button type="button" onClick={onClick} className="group flex flex-col items-center gap-1.5">
      <div
        className={cn(
          "relative h-14 w-20 overflow-hidden rounded-md border-2 bg-muted transition-colors",
          active ? "border-primary" : "border-border group-hover:border-primary/40",
        )}
      >
        {mode === "vertical" && (
          <>
            <div className="absolute inset-y-0 left-0 w-5 bg-primary/80" />
            <div className="absolute left-6 right-1 top-1 h-2 rounded-sm bg-background" />
            <div className="absolute bottom-1 left-6 right-1 top-4 rounded-sm bg-background/70" />
          </>
        )}
        {mode === "horizontal" && (
          <>
            <div className="absolute inset-x-0 top-0 h-3 bg-primary/80" />
            <div className="absolute bottom-1 left-1 right-1 top-4 rounded-sm bg-background/70" />
          </>
        )}
        {mode === "mixed" && (
          <>
            <div className="absolute inset-x-0 top-0 h-3 bg-primary/80" />
            <div className="absolute bottom-0 left-0 top-3 w-5 bg-primary/30" />
            <div className="absolute bottom-1 left-6 right-1 top-4 rounded-sm bg-background/70" />
          </>
        )}
        {active && (
          <div className="absolute bottom-0.5 right-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-2.5" />
          </div>
        )}
      </div>
      <span className={cn("text-xs", active ? "font-medium text-primary" : "text-muted-foreground")}>
        {labels[mode]}
      </span>
    </button>
  )
}

/** 标签页风格缩略图 */
function TabStylePreview({ style, active, onClick }: { style: TabStyle; active: boolean; onClick: () => void }) {
  const labels: Record<TabStyle, string> = { default: "默认", chrome: "谷歌浏览器" }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border p-2 transition-colors",
        active ? "border-primary bg-primary/5" : "hover:bg-accent",
      )}
    >
      <div className="flex h-6 items-end gap-1 overflow-hidden rounded-sm bg-muted px-1.5">
        {style === "default" ? (
          <>
            <div className="mb-1 h-3.5 w-8 rounded-sm bg-primary/70" />
            <div className="mb-1 h-3.5 w-8 rounded-sm bg-background" />
          </>
        ) : (
          <>
            <div className="h-4 w-9 rounded-t-md bg-primary/70" />
            <div className="h-4 w-9 self-end text-transparent" />
          </>
        )}
      </div>
      <span className={cn("text-xs", active ? "font-medium text-primary" : "text-muted-foreground")}>
        {labels[style]}
      </span>
    </button>
  )
}

const themeModes: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "light", label: "亮色", icon: Sun },
  { value: "dark", label: "暗色", icon: Moon },
  { value: "system", label: "系统", icon: Monitor },
]

const radiusOptions = [0, 0.25, 0.5, 0.75, 1]

function SwitchRow({
  label,
  desc,
  settingKey,
}: {
  label: string
  desc?: string
  settingKey: keyof Pick<
    AppSettings,
    "showTabs" | "showBreadcrumb" | "showFooter" | "accordionMenu" | "contentCompact" | "grayscale" | "colorWeak"
  >
}) {
  const value = useAppStore((s) => s[settingKey])
  const updateSettings = useAppStore((s) => s.updateSettings)
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="text-sm">{label}</div>
        {desc && <div className="text-xs text-muted-foreground">{desc}</div>}
      </div>
      <Switch checked={value} onCheckedChange={(checked) => updateSettings({ [settingKey]: checked })} />
    </div>
  )
}

export function SettingsDrawer() {
  const open = useUiStore((s) => s.settingsOpen)
  const setOpen = useUiStore((s) => s.setSettingsOpen)
  const layout = useAppStore((s) => s.layout)
  const tabStyle = useAppStore((s) => s.tabStyle)
  const themeMode = useAppStore((s) => s.themeMode)
  const primaryColor = useAppStore((s) => s.primaryColor)
  const radius = useAppStore((s) => s.radius)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const resetSettings = useAppStore((s) => s.resetSettings)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="w-80 overflow-y-auto sm:max-w-80">
        <SheetHeader className="pb-0">
          <SheetTitle>偏好设置</SheetTitle>
          <SheetDescription>实时预览，配置持久化保存在本地</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <section>
            <Label className="text-xs text-muted-foreground">布局模式</Label>
            <div className="mt-2 flex gap-4">
              {(["vertical", "horizontal", "mixed"] as const).map((mode) => (
                <LayoutPreview
                  key={mode}
                  mode={mode}
                  active={layout === mode}
                  onClick={() => updateSettings({ layout: mode })}
                />
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <Label className="text-xs text-muted-foreground">主题模式</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {themeModes.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => updateSettings({ themeMode: mode.value })}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border py-2.5 text-xs transition-colors",
                    themeMode === mode.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <mode.icon className="size-4" />
                  {mode.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <Label className="text-xs text-muted-foreground">主题色</Label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {PRESET_COLORS.map((color) => (
                <Tooltip key={color.value}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => updateSettings({ primaryColor: color.value })}
                      style={{ backgroundColor: color.value }}
                      className="flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110"
                    >
                      {primaryColor === color.value && <Check className="size-4 text-white" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{color.name}</TooltipContent>
                </Tooltip>
              ))}
              <Tooltip>
                <TooltipTrigger asChild>
                  <label
                    className="relative flex size-7 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/40 text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    style={
                      PRESET_COLORS.every((c) => c.value !== primaryColor)
                        ? { backgroundColor: primaryColor, color: "#fff", borderStyle: "solid" }
                        : undefined
                    }
                  >
                    自定
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => updateSettings({ primaryColor: e.target.value })}
                      className="absolute inset-0 cursor-pointer opacity-0"
                    />
                  </label>
                </TooltipTrigger>
                <TooltipContent>自定义主题色</TooltipContent>
              </Tooltip>
            </div>
          </section>

          <section>
            <Label className="text-xs text-muted-foreground">圆角大小</Label>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {radiusOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => updateSettings({ radius: option })}
                  className={cn(
                    "rounded-md border py-1.5 text-xs transition-colors",
                    radius === option
                      ? "border-primary bg-primary/5 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <Label className="text-xs text-muted-foreground">标签页风格</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["default", "chrome"] as const).map((style) => (
                <TabStylePreview
                  key={style}
                  style={style}
                  active={tabStyle === style}
                  onClick={() => updateSettings({ tabStyle: style })}
                />
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <Label className="text-xs text-muted-foreground">界面功能</Label>
            <div className="mt-1 divide-y">
              <SwitchRow label="多标签页" settingKey="showTabs" />
              <SwitchRow label="面包屑导航" settingKey="showBreadcrumb" />
              <SwitchRow label="页脚" settingKey="showFooter" />
              <SwitchRow label="手风琴菜单" desc="同级菜单只展开一个" settingKey="accordionMenu" />
              <SwitchRow label="内容紧凑" desc="限制内容区最大宽度" settingKey="contentCompact" />
            </div>
          </section>

          <Separator />

          <section>
            <Label className="text-xs text-muted-foreground">辅助模式</Label>
            <div className="mt-1 divide-y">
              <SwitchRow label="灰色模式" desc="哀悼日等特殊场景" settingKey="grayscale" />
              <SwitchRow label="色弱模式" settingKey="colorWeak" />
            </div>
          </section>

          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => {
              resetSettings()
              toast.success("已恢复默认设置")
            }}
          >
            <RotateCcw className="size-4" />
            恢复默认
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** 预设主题色 */
export const PRESET_COLORS = [
  { name: "拂晓蓝", value: "#2563eb" },
  { name: "科技紫", value: "#7c3aed" },
  { name: "极光绿", value: "#16a34a" },
  { name: "明青", value: "#0891b2" },
  { name: "日暮橙", value: "#ea580c" },
  { name: "薄暮红", value: "#e11d48" },
  { name: "法式洋红", value: "#db2777" },
  { name: "石墨黑", value: "#334155" },
] as const

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "")
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value
  const num = Number.parseInt(full, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

/** 相对亮度，用于决定前景色用黑还是白 */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export interface ThemeOptions {
  themeMode: "light" | "dark" | "system"
  primaryColor: string
  radius: number
  grayscale: boolean
  colorWeak: boolean
}

export function isDarkMode(themeMode: ThemeOptions["themeMode"]): boolean {
  if (themeMode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  }
  return themeMode === "dark"
}

/** 将主题设置应用到 document，供 store 订阅后调用 */
export function applyTheme(options: ThemeOptions) {
  const root = document.documentElement
  const dark = isDarkMode(options.themeMode)
  root.classList.toggle("dark", dark)

  const foreground = luminance(options.primaryColor) > 0.55 ? "#1e293b" : "#ffffff"
  root.style.setProperty("--primary", options.primaryColor)
  root.style.setProperty("--primary-foreground", foreground)
  root.style.setProperty("--ring", options.primaryColor)
  root.style.setProperty("--sidebar-primary", options.primaryColor)
  root.style.setProperty("--sidebar-primary-foreground", foreground)
  root.style.setProperty("--sidebar-ring", options.primaryColor)
  root.style.setProperty("--radius", `${options.radius}rem`)

  root.classList.toggle("grayscale-mode", options.grayscale)
  root.classList.toggle("color-weak-mode", options.colorWeak)
}

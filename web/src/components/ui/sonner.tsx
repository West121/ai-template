import type { CSSProperties } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { isDarkMode } from "@/lib/theme"
import { useAppStore } from "@/stores/app-store"

const Toaster = ({ ...props }: ToasterProps) => {
  const themeMode = useAppStore((s) => s.themeMode)

  return (
    <Sonner
      theme={isDarkMode(themeMode) ? "dark" : "light"}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }

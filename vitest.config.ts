import path from "node:path"
import { defineConfig } from "vitest/config"

// 单测配置（与 vite.config.ts 分离，避免加载 UI 插件链）。
// 复用 @/* → src/* 路径别名，与 tsconfig / vite 一致。
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})

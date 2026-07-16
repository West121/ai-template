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
  // 组件单测用 react-dom/server 的 renderToStaticMarkup（node 环境即可，无需 jsdom）。
  // .tsx 的 JSX 由 vitest 内建转换按 tsconfig(jsx: react-jsx) 处理。
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    // i18n M2：初始化 i18next（zh-CN 空 bundle → t(key)=key+插值），与运行时行为对齐
    setupFiles: ["./src/vitest.setup.ts"],
  },
})

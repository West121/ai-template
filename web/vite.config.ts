import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // 后端 Spring Boot（server/ 目录），见 server/README.md
      "/api": {
        target: "http://localhost:8081",
        changeOrigin: true,
      },
      // 知识库实时协同 WebSocket（批4b，§10）：ws 升级代理到后端
      "/ws/kb": {
        target: "ws://localhost:8081",
        ws: true,
        changeOrigin: true,
      },
    },
  },
})

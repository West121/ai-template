# 星辰 OA · 企业级中后台开发平台

一套**全栈**企业级 OA 基础开发平台：前端 **React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui**，后端 **Spring Boot 4 + Java 21 + PostgreSQL 17 + Flowable 8 工作流引擎**。前端可脱离后端以"离线演示模式"独立运行，也可对接后端跑完整业务。

> 界面为中文，无 i18n。仓库根为前端，`server/` 为后端（Maven 多模块）。

## ✨ 特性

- **多种布局**：侧边 / 顶部 / 混合，实时切换
- **主题系统**：亮 / 暗 / 跟随系统，8 种预设主题色 + 自定义取色器，圆角可调
- **多标签页**：右键菜单、中键关闭、持久化
- **多级菜单**：三级菜单、手风琴、折叠图标栏、徽标数
- **企业级表格**：基于 TanStack Table 封装——排序、多字段搜索、筛选、列显隐、密度、全屏、CSV 导出、行选择与批量操作、分页、骨架屏、空态
- **全局搜索**：⌘K 命令面板
- **OA 业务模块**：工作台、审批中心、公文、会议、考勤、通讯录、公告、日程、系统管理
- **工作流平台**：Flowable 8 引擎 + 仿钉钉流程设计器 + 表单设计器（详见 `docs/`）

## 🚀 快速开始

### 前端（仓库根）

```bash
pnpm install
pnpm dev      # http://localhost:5173，/api 代理到 localhost:8081
pnpm build    # tsc -b && vite build
pnpm lint     # oxlint
```

**后端未启动时**：前端自动进入离线演示模式——登录任意账号密码即可进入（`auth-store` 在 `/api/auth/login` 请求失败时回退为 mock token、权限全放行）。这是"演示态"，非真实鉴权。

### 后端（`server/`）

```bash
cd server
docker compose up -d postgres redis      # 至少起 pg(:15432) 与 redis(:26379)
export OA_JWT_SECRET=$(openssl rand -hex 32)   # 必需：≥32 字符，否则拒绝启动
mvn -pl oa-boot spring-boot:run           # 应用在 :8081，Swagger 在 /swagger-ui.html
```

首启会执行 Flyway 迁移 + 种子数据 + Flowable 部署。种子账号：`admin/admin123`、`manager/admin123`、`zhangsan/admin123`。**后端启动后**，前端登录走真实 `/api/auth/login`，凭据会被校验、数据按权限过滤。详见 `server/README.md`。

### 端到端冒烟

```bash
OA_JWT_SECRET=<同上> node server/smoke-test.mjs   # 需后端在 :8081
```

## 📁 目录结构

```
src/
├── lib/
│   ├── api.ts            # API 客户端：{code,message,data} 信封解包、Bearer 注入、
│   │                     #   401 登出、NetworkError（供页面离线降级）
│   ├── theme.ts          # 主题色运行时应用
│   └── form-runtime.ts   # 动态表单求值运行时
├── stores/               # zustand：app-store/tabs-store/auth-store(含离线降级)/ui-store/badge-store
├── config/menu.ts        # 菜单树（route/icon/badge，改这里增删菜单）
├── components/
│   ├── ui/               # shadcn/ui 基础组件
│   ├── layout/           # 布局系统
│   ├── data-table/       # 企业级表格封装
│   └── form-renderer.tsx # 动态表单渲染器
├── pages/                # 业务页面（多数已对接 src/lib/api，含离线 mock 兜底）
└── App.tsx               # 路由表

server/                   # Spring Boot 4 多模块后端（见 server/README.md）
└── oa-common / oa-module-{infra,system,office,workflow} / oa-boot

docs/                     # 契约与设计文档（api-contract.md 为权威契约）
```

## 🔧 二次开发

- **新增页面**：`src/pages` 建组件 → `App.tsx` 加路由 → `config/menu.ts` 加菜单项（三处 path 一致，标签页/面包屑/搜索自动生效）。
- **新增表格页**：`<DataTable columns={...} data={...} searchKeys={[...]} />`，列 `meta.title` 自动接入列设置与 CSV 导出。
- **对接后端**：调用统一走 `src/lib/api.ts` 的 `api<T>()`；页面用 `NetworkError` 做离线降级。接口契约见 `docs/api-contract.md`。

## 📚 更多文档

- `CLAUDE.md`——面向 AI 与新人的架构总览与命令
- `server/README.md`——后端构建、模块、Flowable、smoke test
- `docs/api-contract.md`——前后端接口契约（权威）
- `docs/remediation-plan.md`——修复与改进计划；`docs/design/`——下一代设计器/公式/脚本设计

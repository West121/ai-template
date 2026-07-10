# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

星辰 OA — a full-stack enterprise OA platform. UI strings are hardcoded Chinese (no i18n). Two halves:

- **Frontend (`web/`)**: React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui. Package manager is **pnpm**; lint is **oxlint** (not ESLint).
- **Backend (`server/`)**: Java 21, Spring Boot 4 modular monolith (Maven multi-module), PostgreSQL 17 + Redis, Flowable 8 workflow engine. Package root `com.xingchen.oa`.

The `docs/` directory holds the authoritative contracts — `api-contract.md` (every endpoint, DTO, permission code), `workflow-design.md`, `flow-designer-v2.md`, `form-designer-v2.md`. Designer/serde code explicitly cites these; keep them in sync when touching workflow.

## Commands

### Frontend (`web/`)

```bash
cd web
pnpm install
pnpm dev        # http://localhost:5173, proxies /api → localhost:8081
pnpm build      # tsc -b && vite build
pnpm lint       # oxlint
```

### Backend (`server/`)

```bash
cd server
docker compose up -d               # postgres(:15432) redis(:26379) xxl-job-admin(:8082) minio
mvn -pl oa-boot spring-boot:run    # app on :8081; Swagger at /swagger-ui.html
```

First boot: Flyway migrates, `DataInitializer` BCrypts seed passwords, `WorkflowInitializer` deploys the seed process. Seed accounts: `admin/admin123`, `manager/admin123`, `zhangsan/admin123`. Frontend login also works with the backend down — auth store falls back to offline demo mode (mock token, allow-all permissions).

### Tests

```bash
node server/smoke-test.mjs                                        # primary test harness — E2E HTTP flows, needs app running on :8081
mvn -pl oa-module-workflow test -Dtest=JsonToBpmnConverterTest    # the only JUnit test (run from server/)
```

The smoke test covers auth, data-permission scoping, all office modules, and extensive workflow scenarios (branches, 加签/并签/减签, transfer, delegate, vote). It truncates `wf_*`/`act_*` tables at the end via `docker exec oa-postgres psql`; set `OA_SMOKE_KEEP=1` to keep data, `OA_BASE` to override the base URL. This is what to run to validate backend behavior — JUnit coverage is essentially absent.

## Frontend Architecture

**Everything is keyed by route `path`.** The route in `App.tsx`, the `MenuItem.path` in `web/src/config/menu.ts`, the tab key, and the breadcrumb key are the same string. To add a page: create component in `web/src/pages/`, add a `lazy()` route in `App.tsx`, add a menu item in `config/menu.ts` — tabs, breadcrumbs, and ⌘K search then work automatically.

- **Stores (`web/src/stores/`)**: zustand. Persisted: `app-store` (layout/theme settings), `tabs-store`, `auth-store` (token, multi-position `assignments`, `permissions`, `offline` flag). Ephemeral: `ui-store` (`refreshKey` remounts the page content = "refresh tab"), `badge-store` (dynamic menu badges by path).
- **API client (`web/src/lib/api.ts`)**: `api<T>(path, init)` unwraps the `{code, message, data}` envelope (`code !== 0` → `ApiError`), injects `Bearer` token from auth-store, logs out on 401, throws `NetworkError` on fetch failure. Pages catch `NetworkError`/check `offline` and degrade to in-file mock data with a banner — follow this pattern in new pages.
- **Permissions**: gate UI with `hasPerm(code)` / `useHasPerm(code)` from auth-store; `permissions === null` (offline) means allow-all.
- **DataTable (`web/src/components/data-table/`)**: TanStack Table wrapper. Column `meta.title` feeds column-visibility panel and CSV export; `searchKeys` for quick search; `serverSearch`/`serverPagination` for backend-driven mode (0-based `pageIndex`); `selectionColumn<T>()` helper for row selection.
- **Forms**: react-hook-form + zod via shadcn `Form` components; dynamic/designer-driven forms go through `web/src/components/form-renderer.tsx` + `web/src/lib/form-runtime.ts`.
- **Theme (`web/src/lib/theme.ts`)**: `applyTheme()` sets CSS custom properties on `<html>` at runtime; preset colors live here.
- **TS config**: `@/*` → `web/src/*`; `verbatimModuleSyntax` is on — type-only imports must use `import type`.

### Workflow Designers (`web/src/pages/workflow/designer/`)

Two parallel process designers share one property panel and node model:

- `designer/types.ts` — the domain contract: `WfNodeProps` (assignee rules, multiMode ANY/ALL/SEQUENCE/VOTE, emptyStrategy, formPerms, events…), the 2D assignee model (`AssigneeKind` × `AssigneeSource`), `BranchCondition`.
- `designer/shared/property-panel.tsx` — used by both designers.
- `designer/dingtalk/` — DingTalk-style linear designer (primary); serializes to `designerJson` compiled server-side by `JsonToBpmnConverter`.
- `designer/bpmn/oa/serde.ts` — the most convention-heavy file. Serializes `WfNodeProps` ↔ BPMN `extensionElements` under the `oa` namespace (`http://oa/bpmn`), one element per field. All property patches must be batched into **one** `modeling.updateProperties` call. SequenceFlow conditions write both `oa:condition` (structured, for re-editing) and `conditionExpression` (UEL, for Flowable). `compileUel`/`parseUel` **mirror the backend's `ConditionCompiler`** — the formats must stay byte-compatible; change both sides together.

## Backend Architecture

Maven modules, dependency direction strictly `oa-boot → oa-module-* → oa-common`:

- **oa-common** — `R<T>` envelope, `PageResult<T>`, `BusinessException`, `GlobalExceptionHandler`, `UserContext`/`DataScope`/`CurrentUserHolder` (ThreadLocal).
- **oa-module-infra** — files (local/MinIO/S3), dictionaries, logs (AOP `@OperLog`).
- **oa-module-system** — org (user/dept/post), RBAC, JWT auth. Business modules depend on it one-way; it must not depend back.
- **oa-module-office** — approval, document, meeting, attendance, leave, trip, announcement, schedule (tables `oa_*`). Business modules must not depend on each other.
- **oa-module-workflow** — Flowable-based engine layer (tables `wf_*`; Flowable owns `act_*`). Key pieces: `convert/JsonToBpmnConverter` (designer JSON → BpmnModel), `convert/ConditionCompiler` (structured conditions → UEL — mirrored by frontend `serde.ts`), `engine/AssigneeResolver`, `service/AddSignService` (PRE/POST serial 加签, distinct from parallel 并签).
- **oa-boot** — launcher: Security config, `JwtAuthFilter`, Flyway migrations, `application.yml`, xxl-job executor.

**Security model**: 功能权限 (function permissions) are the union across all assignments, enforced with `@PreAuthorize("hasAuthority('code')")`. 数据权限 (data scope: ALL/DEPT_AND_CHILD/DEPT/SELF/CUSTOM) comes from the active assignment in the JWT claim and is applied via JPA Specifications; `POST /api/auth/switch` re-signs the token to change identity.

**Migrations**: `server/oa-boot/src/main/resources/db/migration`, `V{n}__{desc}.sql`, covering only `sys_*`/`oa_*`/`wf_*` (Flowable self-manages `act_*`; `ddl-auto=validate`). Add new schema as the next `V{n}`.

**API conventions** (full detail in `docs/api-contract.md`): envelope `{code, message, data}` with 0 = success; pagination via `pageNum`/`pageSize` returning `{list, total, pageNum, pageSize}`; 401 = unauthenticated, 403 = missing permission, 400 = validation/business error, 409 = business conflict (`BusinessException(code, msg)`).

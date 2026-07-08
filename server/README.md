# OA Platform Server

基于 **Spring Boot 4** 的 OA 平台多模块单体后端（modular monolith），按业务域分模块，便于日后平滑演进为微服务。

## 架构

```
                    ┌──────────────────────────┐
                    │         oa-boot          │  启动器 / 安全配置 / Flyway / application.yml
                    └───────┬─────────┬────────┘
                            │         │
                            │      ┌──▼──────────────┐
                            │      │ oa-module-office│  业务域模块：审批流程示例
                            │      └──┬──────┬───────┘
                            │         │      │ （业务域 → 基础域，单向）
              ┌─────────────▼─────────▼──┐   │
              │     oa-module-system     │◄──┘  基础域：用户/部门/岗位/角色/权限/认证
              └─────────────┬────────────┘
                            │
                    ┌───────▼──────────────────┐
                    │        oa-common         │  公共内核：R / PageResult / 异常 / UserContext，不含业务
                    └──────────────────────────┘

依赖方向：boot → module-* → common。
`oa-module-system` 是**基础域**（组织架构 + RBAC），业务域模块（office 等）允许单向依赖它
（读部门名、权限装配等）；禁止 system 反向依赖任何业务域模块，业务域模块之间禁止互相依赖。
```

## 技术栈

| 组件 | 版本 |
| --- | --- |
| Java | 21 (GraalVM) |
| Spring Boot | 4.0.1 |
| Spring Security | 7.x（随 Boot 4） |
| PostgreSQL | 17（docker: postgres:17-alpine） |
| Spring Data JPA / Hibernate | 随 Boot 4（Hibernate 7） |
| Flyway | 随 Boot 4 管理（flyway-core + flyway-database-postgresql） |
| Redis | 7（docker: redis:7-alpine，Lettuce 客户端） |
| JWT | io.jsonwebtoken jjwt 0.12.6（HS256） |
| springdoc-openapi | 3.0.3（Boot 4 适配版，starter-webmvc-ui） |
| Lombok | 1.18.42 |
| Maven | 3.9.x 多模块 |

## 快速启动

```bash
cd server

# 方式一：手动拉起基础设施再启动
docker compose up -d          # postgres:15432 + redis:26379（宿主机端口，避免与本机既有服务冲突）
mvn -pl oa-boot spring-boot:run

# 方式二：直接启动（spring-boot-docker-compose 会自动 docker compose start）
mvn -pl oa-boot spring-boot:run
```

首次启动流程：Flyway 执行 `V1__init.sql`（建表 + 种子）与 `V2__rbac.sql`（RBAC/数据权限/兼任模型）… `V7__workflow.sql`（工作流业务表 wf_*）→ `DataInitializer` 检测到种子用户密码为明文占位（不以 `$2` 开头），自动用 BCrypt 加密回写，保证登录一定可用 → `WorkflowInitializer` 将种子流程「请假审批」转 BPMN 并部署到引擎（幂等）。

> **工作流引擎（Flowable 8.0.0）**：`oa-module-workflow` 内嵌 Flowable process 引擎（官方 starter `flowable-spring-boot-starter-process:8.0.0` 直配 Boot 4，复用平台 DataSource / 事务）。引擎自管的 `ACT_*` 表（约 40+ 张，含 common/engine/history/eventregistry）由引擎首启 `flowable.database-schema-update=true` 自建/升级，**不进 Flyway**（Flyway 只管 `sys_*`/`oa_*`/`wf_*` 业务表，与 `ACT_*` 前缀隔离）。工作流 API 见 `docs/api-contract.md`「工作流域」。

### 登录

```bash
curl -X POST http://localhost:8081/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```

返回：

```json
{
  "code": 0, "message": "ok",
  "data": {
    "token": "eyJ...",
    "user": { "id": 1, "username": "admin", "name": "系统管理员" },
    "assignments": [
      { "id": 1, "deptId": 2, "deptName": "技术部", "postName": "总经理",
        "roleNames": ["系统管理员"], "primary": true }
    ],
    "activeAssignmentId": "1",
    "permissions": ["dashboard", "office:approval", "office:approval:approve", "..."]
  }
}
```

带 token 访问受保护接口：

```bash
TOKEN=$(curl -s -X POST http://localhost:8081/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')

curl http://localhost:8081/api/system/users?pageNum=1\&pageSize=10 -H "Authorization: Bearer $TOKEN"
curl http://localhost:8081/api/office/approvals -H "Authorization: Bearer $TOKEN"
```

### 种子账号

| 用户名 | 密码 | 姓名 | 任职（部门 / 岗位 / 角色） |
| --- | --- | --- | --- |
| admin | admin123 | 系统管理员 | 主任职：技术部 / 总经理 / ADMIN |
| manager | admin123 | 王经理 | 主任职：产品部 / 产品经理 / DEPT_MANAGER；**兼任**：财务部 / 财务总监 / FINANCE |
| zhangsan | admin123 | 张三 | 主任职：人事行政部 / 人事专员 / EMPLOYEE |

## 权限模型（RBAC + 数据权限 + 兼任）

### 表关系

```
sys_user 1 ──── N sys_user_assignment（任职：一条主任职 is_primary，其余兼任）
                      │  dept_id ──► sys_dept（ancestors 祖先链，如 '0,1'）
                      │  post_id ──► sys_post
                      │
                      └── N:M sys_assignment_role ──► sys_role（data_scope）
                                                          │
                                        ┌─────────────────┼──────────────────┐
                                        │                                    │
                              N:M sys_role_permission              N:M sys_role_dept
                                        │                          （CUSTOM 范围的可见部门）
                                        ▼
                                  sys_permission（MENU / BUTTON，code 即 authority）

oa_approval.dept_id / applicant_id  ←— 业务表冗余两列，供数据权限过滤
```

### 功能权限（接口鉴权）

- **功能权限 = 用户所有任职角色权限的并集**（与激活身份无关），登录后作为
  Security authorities 注入，接口用 `@PreAuthorize("hasAuthority('office:approval:approve')")` 鉴权。
- 权限点种子：`dashboard`、`office:approval`（MENU）、`office:approval:list / create / approve`（BUTTON）、`system:user:list`。
- 角色-权限：ADMIN=全部；DEPT_MANAGER=dashboard + office:approval 全部；EMPLOYEE=list/create；FINANCE=list/**approve**。

### 数据权限（查询过滤）

JWT 携带 `assignment` claim（任职 id 或 `"ALL"`=全部身份并集）。`JwtAuthFilter` 每次请求经
`PermissionService` 装配 `UserContext`（含 `DataScope`）放入 `CurrentUserHolder`（ThreadLocal，请求结束清理），
业务查询（`ApprovalService` 的 JPA Specification）按 DataScope 拼接过滤条件：

| 角色 data_scope | 解析结果 |
| --- | --- |
| ALL | `all=true`，查询不加过滤（优先级最高） |
| DEPT_AND_CHILD | 任职部门 + 全部子孙部门（按 `sys_dept.ancestors` 链匹配） |
| DEPT | 仅任职部门 |
| SELF | `selfOnly=true`，仅 `applicant_id = 当前用户` |
| CUSTOM | `sys_role_dept` 中配置的部门集合 |

多角色 / 激活 "ALL" 多任职时取**并集**（出现 ALL 直接全量）。最终 SQL 条件：
`all` → 无；`selfOnly`（无部门范围）→ `applicant_id = :userId`；
否则 → `dept_id IN (:deptIds) OR applicant_id = :userId`。

### 兼任与身份切换

- 一个用户可有 N 条任职（`sys_user_assignment`），一条 `is_primary=true` 主任职，其余兼任。
- 登录默认激活**主任职**；`POST /api/auth/switch` 传本人任职 id 或 `"ALL"` 重签 JWT 切换身份。
- 切换只影响**数据权限**可见范围；功能权限始终是全部任职的并集。

### 验证示例（curl）

```bash
BASE=http://localhost:8081

# manager 登录：2 条任职（主任职产品部 + 兼任财务部），默认激活主任职
MT=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"manager","password":"admin123"}' | jq -r .data.token)

# 主任职（产品部，DEPT_AND_CHILD）：只见产品部 → pending-count = 3
curl -s $BASE/api/office/approvals/pending-count -H "Authorization: Bearer $MT"

# 切到兼任（财务部，FINANCE/CUSTOM→财务部）：pending-count = 2
FT=$(curl -s -X POST $BASE/api/auth/switch -H "Authorization: Bearer $MT" \
  -H 'Content-Type: application/json' -d '{"assignmentId":"3"}' | jq -r .data.token)
curl -s $BASE/api/office/approvals/pending-count -H "Authorization: Bearer $FT"

# 切到 ALL（全部身份并集）：pending-count = 产品部 3 + 财务部 2 = 5
AT=$(curl -s -X POST $BASE/api/auth/switch -H "Authorization: Bearer $FT" \
  -H 'Content-Type: application/json' -d '{"assignmentId":"ALL"}' | jq -r .data.token)
curl -s $BASE/api/office/approvals/pending-count -H "Authorization: Bearer $AT"

# zhangsan（EMPLOYEE/SELF）：只见自己的单子；无 approve 权限 → HTTP 403
ZT=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"zhangsan","password":"admin123"}' | jq -r .data.token)
curl -s $BASE/api/office/approvals -H "Authorization: Bearer $ZT"
curl -s -w '%{http_code}\n' -X POST $BASE/api/office/approvals/1/approve -H "Authorization: Bearer $ZT"

# manager 审批产品部单据（DEPT_MANAGER 有 office:approval:approve）→ 成功
curl -s -X POST $BASE/api/office/approvals/2/approve -H "Authorization: Bearer $MT"
```

### Swagger

- Swagger UI: <http://localhost:8081/swagger-ui.html>（跳转到 /swagger-ui/index.html）
- OpenAPI JSON: <http://localhost:8081/v3/api-docs>

### CORS

已放行 `http://localhost:5173` 与 `http://localhost:5181`（Vite dev server），全方法全头，允许携带凭证。

## API 一览

| Method | Path | 说明 | 鉴权（authority） |
| --- | --- | --- | --- |
| POST | /api/auth/login | 登录，返回 JWT + 任职列表 + 权限 | 否 |
| POST | /api/auth/switch | 身份切换 `{assignmentId:"ALL"或任职id}`，重签 JWT | 登录即可 |
| GET | /api/auth/me | 当前用户上下文（同登录响应结构，token 为 null） | 登录即可 |
| GET | /api/system/users?keyword=&pageNum=1&pageSize=10 | 用户分页 | system:user:list |
| GET | /api/system/users/{id} | 用户详情 | system:user:list |
| GET | /api/office/approvals?status=&pageNum=&pageSize= | 审批单分页（状态过滤 + 数据权限） | office:approval:list |
| GET | /api/office/approvals/pending-count | 数据权限内 PENDING 单量 | office:approval:list |
| POST | /api/office/approvals | 创建审批单（applicant_id/dept_id 取当前身份） | office:approval:create |
| POST | /api/office/approvals/{id}/approve | 通过 | office:approval:approve |
| POST | /api/office/approvals/{id}/reject | 驳回 | office:approval:approve |

统一响应：`{code, message, data}`，`code=0` 成功；分页数据 `{list, total, pageNum, pageSize}`。

## 微服务演进说明

当前是单体分模块，拆分路径已预留：

1. **模块即服务边界**：`oa-module-system`、`oa-module-office` 各自包含完整的 entity/repository/service/controller。业务域模块只单向依赖 system 基础域（组织架构/权限），拆分时该依赖收敛为「用户中心」服务的 REST/Feign 调用即可，未来每个 module 可直接加一个自己的 boot 启动类独立部署。
2. **common 抽 starter**：`oa-common`（统一响应/异常/分页）可发布为内部 `oa-spring-boot-starter`，各服务以依赖方式复用。
3. **按域拆库**：目前共用 `oa_platform` 库，表已按域前缀隔离（`sys_*` / `oa_*`），拆分时按前缀迁移到各自数据库，Flyway 脚本随域拆分。
4. **认证下沉网关**：`JwtTokenProvider` 无状态签发/校验，拆分后可将 JWT 校验前移到 API 网关，各服务只信任网关透传的用户头。
5. **跨域调用**：模块间如出现调用需求，先在单体内以接口 + Spring 事件解耦，拆分时替换为 OpenFeign/REST。

# 家宽节点前缀开关实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户端家宽 IP 控制弹窗增加默认开启的“显示家宽落地标识”开关，并让订阅节点名称仅在开关开启时添加 `家宽落地-`。

**Architecture:** 开关状态持久化到 `user_home_proxy_routes`，由既有家宽 routing 选项和更新接口读写。订阅输出继续实时读取有效家宽权益与绑定记录，同时要求持久化开关开启；UI 只负责回显和提交，不影响真实家宽路由同步。

**Tech Stack:** Node.js、Express、PostgreSQL、Vue 3、Element Plus、Vite

**Spec:** 本对话中已确认的 bounded 设计（无独立规格文件）

## Global Constraints

- 使用简体中文文案，开关文字固定为“显示家宽落地标识”。
- 开关默认开启；旧绑定迁移后也视为开启。
- 关闭开关只影响节点名称，不影响家宽 routing、服务器选择或同步。
- 用户端显式提交布尔值；未传字段的新记录默认开启，更新已有记录时保留原状态。
- 不创建或切换分支、worktree；未经用户明确要求不暂存、提交或推送。
- 新建文件和新增方法必须补充职责、关键参数和核心分支注释。

## Review Focus

- 旧绑定升级后没有显式值时必须继续显示前缀。
- 管理端更新服务器但未传开关时不得覆盖用户选择。
- 字符串、数字和布尔形式的开关值必须归一化为布尔语义。
- 套餐过期、未绑定或同步失败时，无论开关值为何都不得添加前缀。
- 弹窗新增和修改两种状态必须正确默认或回显，移动端保持同一行布局。

---

### Task 1: 持久化家宽节点前缀开关

**Files:**
- Create: `server/db/migrations/032-home-node-prefix-toggle.js`
- Modify: `server/db/schema/tables.js`
- Modify: `server/repositories/user-home-routing-repository.js`
- Modify: `server/services/shared/home-routing-service.js`
- Test: `server/test/test-user-home-routing-service.js`

**Interfaces:**
- Produces: route 字段 `show_home_node_prefix`（数据库整数 `0/1`，服务/API 输出布尔值）。
- Produces: `updateHomeRouting(..., payload)` 接受可选 `payload.show_home_node_prefix`。
- Preserves: 字段缺失时，新记录为 `true`，已有记录保留当前值。

- [ ] **Step 1: 写失败测试**：覆盖默认开启、显式关闭、已有记录在字段缺失时保留关闭状态、`formatRoute()` 返回布尔值。
- [ ] **Step 2: 运行 `node server/test/test-user-home-routing-service.js`**，确认因字段尚未持久化或返回而失败。
- [ ] **Step 3: 新增幂等迁移和 schema 默认值**：`show_home_node_prefix INTEGER NOT NULL DEFAULT 1`。
- [ ] **Step 4: 扩展仓储 upsert 与服务归一化**：只接受明确布尔语义，管理端旧调用不覆盖已有值。
- [ ] **Step 5: 重跑测试**，确认家宽 routing 测试通过。

### Task 2: 订阅输出服从用户开关

**Files:**
- Modify: `server/services/user/subscription-service.js`
- Test: `server/test/test-user-subscription-service.js`

**Interfaces:**
- Consumes: `findUserHomeRoute()` 返回 `show_home_node_prefix`。
- Produces: `getActiveHomeServerIds()` 仅在有效权益、成功绑定且开关开启时返回服务器 ID。

- [ ] **Step 1: 写失败测试**：同一有效绑定在开关为 `1/true` 时添加前缀，在 `0/false` 时通用、Clash、详情均不添加；缺失字段按开启兼容。
- [ ] **Step 2: 运行 `node server/test/test-user-subscription-service.js`**，确认关闭场景仍错误添加前缀。
- [ ] **Step 3: 最小修改有效绑定判定**，将持久化开关纳入实时命名条件。
- [ ] **Step 4: 重跑订阅、公告节点和仓储相关测试**，确认没有回归。

### Task 3: 用户端弹窗与 API

**Files:**
- Modify: `client-user/src/views/user/Subscription.vue`
- Modify: `client-user/src/api/index.js`

**Interfaces:**
- Consumes: `route.show_home_node_prefix` 布尔值。
- Produces: `updateHomeRouting(serverIds, showHomeNodePrefix)` 请求字段 `show_home_node_prefix`。

- [ ] **Step 1: 在表单状态加入 `show_home_node_prefix: true`**；打开新增弹窗默认 `true`，打开修改弹窗读取 route 值且缺失时回退 `true`。
- [ ] **Step 2: 在第二个服务器选择框下增加 `.home-node-prefix-toggle` 行**：左侧“显示家宽落地标识”，右侧 `el-switch`。
- [ ] **Step 3: API 与提交方法传递布尔值**，保持既有超时和错误处理。
- [ ] **Step 4: 增加局部响应式样式**，桌面和移动端均保持文字与开关同一行、两端对齐。
- [ ] **Step 5: 运行 `npm run build`（`client-user/`）**；若 terser 环境缺失，按项目约定运行 `npx vite build --minify esbuild`。

### Task 4: 综合验证与审查

**Files:**
- Verify only: 本计划涉及的全部文件

**Interfaces:**
- Consumes: Tasks 1-3 的数据库、后端和前端接口。
- Produces: 可部署且经过日志验证的完整功能。

- [ ] **Step 1: 运行 `node server/test/test-user-home-routing-service.js`。**
- [ ] **Step 2: 运行 `node server/test/test-user-subscription-service.js`、`node server/test/test-subscription-announcement-nodes.js` 和 `node server/test/test-subscription-repository.js`。**
- [ ] **Step 3: 运行用户端生产构建并记录完整结果。**
- [ ] **Step 4: 运行 `git diff --check` 并进行独立代码审查。**
- [ ] **Step 5: 展示变更和测试日志；提醒执行迁移并重启服务器，不自行启动或推送。**

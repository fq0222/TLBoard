# Telegram Remote Phase 1 Admin Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为独立部署的 Telegram 机器人打通第一阶段闭环：管理员绑定、服务器巡检状态读取、待发送告警拉取、告警发送回执、管理员代查用户概览。

**Architecture:** 继续由当前主业务服务负责 3X-UI 巡检、告警状态和管理员绑定真相，新增 `/api/internal/telegram/*` 内部接口给独立机器人访问。机器人不直接连数据库，只通过签名鉴权后的内部 API 拉取待发送告警和管理员查询数据。

**Tech Stack:** Node.js、Express、PostgreSQL、CommonJS、Vue 3、Element Plus、自定义测试脚本

---

### Task 1: 扩展数据库与初始化结构

**Files:**
- Modify: `server/db/schema/tables.js`
- Modify: `server/db/init.js`
- Create: `server/db/migrations/013-telegram-admin-monitoring.js`

- [ ] **Step 1: 在表结构定义中补齐第一阶段所需数据表**

在 `server/db/schema/tables.js` 增加以下表定义：

- `telegram_admin_bindings`
- `telegram_bind_codes`
- `server_health_checks`
- `telegram_alert_records`
- `telegram_command_logs`

字段至少覆盖独立部署设计文档中第一阶段需要的 `chat_id`、`admin_id`、`alert_type`、`status`、`consecutive_failures`、`last_sent_at`、`result_status` 等列。

- [ ] **Step 2: 在初始化脚本中补上新表创建逻辑**

在 `server/db/init.js` 中注册新表建表逻辑，保证全新环境执行 `npm run init-db` 后可直接拥有 Telegram 第一阶段依赖表。

- [ ] **Step 3: 编写幂等迁移脚本**

在 `server/db/migrations/013-telegram-admin-monitoring.js` 中实现幂等迁移：

1. 检查表是否存在。
2. 不存在则创建。
3. 已存在则跳过。
4. 输出明确日志，便于生产执行时观察。

- [ ] **Step 4: 运行数据库初始化语法检查**

Run: `node --check server/db/init.js`  
Expected: 无输出，退出码为 `0`

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/tables.js server/db/init.js server/db/migrations/013-telegram-admin-monitoring.js
git commit -m "新增Telegram第一阶段数据库结构"
```

### Task 2: 实现 Telegram 内部仓储与鉴权基础

**Files:**
- Create: `server/repositories/telegram-repository.js`
- Create: `server/middleware/auth-internal-telegram.js`
- Modify: `server/config.js`
- Modify: `server/ecosystem.config.js`

- [ ] **Step 1: 先写失败用例，覆盖签名校验和基础仓储行为**

Create `server/test/test-telegram-internal-auth.js`，覆盖：

1. 缺少 `X-Internal-Signature` 被拒绝。
2. 时间戳超时被拒绝。
3. 正确签名通过。
4. 仓储层能正确读取和写入管理员绑定记录。

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node server/test/test-telegram-internal-auth.js`  
Expected: FAIL，提示中间件或仓储尚未实现

- [ ] **Step 3: 实现内部接口签名中间件**

在 `server/middleware/auth-internal-telegram.js` 中实现：

1. 读取 `X-Internal-Client`、`X-Internal-Timestamp`、`X-Internal-Signature`
2. 校验客户端值固定为 `telegram-bot`
3. 校验时间戳窗口
4. 按 `method + path + timestamp + rawBody` 计算 HMAC
5. 使用常量时间比较防止简单时序攻击

- [ ] **Step 4: 在配置中增加内部 API 密钥项**

在 `server/config.js` 和 `server/ecosystem.config.js` 中增加：

- `telegram.internalApiEnabled`
- `telegram.internalApiSecret`

生产示例文件只保留占位符，不写真实秘钥。

- [ ] **Step 5: 实现 Telegram 仓储层**

在 `server/repositories/telegram-repository.js` 中实现第一阶段最小方法：

- `findAdminBindingByChatId`
- `consumeBindCode`
- `createAdminBinding`
- `listPendingAlerts`
- `markAlertSent`
- `createCommandLog`
- `listRecentAlerts`
- `upsertServerHealthCheck`

- [ ] **Step 6: 运行测试，确认通过**

Run: `node server/test/test-telegram-internal-auth.js`  
Expected: PASS，输出类似 `test-telegram-internal-auth: PASS`

- [ ] **Step 7: Commit**

```bash
git add server/repositories/telegram-repository.js server/middleware/auth-internal-telegram.js server/config.js server/ecosystem.config.js server/test/test-telegram-internal-auth.js
git commit -m "新增Telegram内部接口鉴权与仓储基础"
```

### Task 3: 实现管理员绑定与身份查询接口

**Files:**
- Create: `server/services/admin/telegram-admin-service.js`
- Create: `server/controllers/admin/telegram-internal-controller.js`
- Create: `server/routes/internal/telegram.js`
- Modify: `server/bootstrap/register-admin-routes.js`
- Modify: `server/app.js`

- [ ] **Step 1: 先写管理员绑定接口失败用例**

Create `server/test/test-telegram-admin-internal-routes.js`，覆盖：

1. `/api/internal/telegram/admin/bind/verify` 绑定成功
2. 无效绑定码失败
3. `/api/internal/telegram/admin/by-chat/:chatId` 能返回绑定状态
4. 非法签名请求被拒绝

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node server/test/test-telegram-admin-internal-routes.js`  
Expected: FAIL，提示路由或服务未实现

- [ ] **Step 3: 实现管理员服务层**

在 `server/services/admin/telegram-admin-service.js` 中实现：

- `verifyAdminBindCode`
- `getAdminByChatId`
- `logTelegramCommand`

服务层负责绑定码消耗、重复绑定校验和命令日志落库。

- [ ] **Step 4: 实现内部控制器和路由**

在 `server/controllers/admin/telegram-internal-controller.js` 和 `server/routes/internal/telegram.js` 中实现：

- `POST /api/internal/telegram/admin/bind/verify`
- `GET /api/internal/telegram/admin/by-chat/:chatId`
- `GET /api/internal/telegram/health`

所有路由都挂载内部签名中间件。

- [ ] **Step 5: 在启动入口挂载内部路由**

在 `server/app.js` 或现有路由注册入口中挂载 `server/routes/internal/telegram.js`，保持与用户端、管理端路由隔离。

- [ ] **Step 6: 运行测试，确认通过**

Run: `node server/test/test-telegram-admin-internal-routes.js`  
Expected: PASS，输出类似 `test-telegram-admin-internal-routes: PASS`

- [ ] **Step 7: Commit**

```bash
git add server/services/admin/telegram-admin-service.js server/controllers/admin/telegram-internal-controller.js server/routes/internal/telegram.js server/bootstrap/register-admin-routes.js server/app.js server/test/test-telegram-admin-internal-routes.js
git commit -m "实现Telegram管理员绑定与内部健康接口"
```

### Task 4: 打通服务器健康状态与待发送告警接口

**Files:**
- Create: `server/repositories/server-health-repository.js`
- Create: `server/services/shared/telegram-monitor-service.js`
- Modify: `server/jobs/handlers/sync-xui-users.js`
- Modify: `server/jobs/handlers/sync-traffic.js`
- Modify: `server/jobs/index.js`
- Modify: `server/controllers/admin/telegram-internal-controller.js`
- Modify: `server/routes/internal/telegram.js`

- [ ] **Step 1: 先写健康状态与告警接口失败用例**

Create `server/test/test-telegram-monitor-internal-routes.js`，覆盖：

1. `GET /api/internal/telegram/servers/health`
2. `GET /api/internal/telegram/servers/health/:serverId`
3. `GET /api/internal/telegram/alerts`
4. `GET /api/internal/telegram/alerts/pending`
5. `POST /api/internal/telegram/alerts/:alertId/sent`

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node server/test/test-telegram-monitor-internal-routes.js`  
Expected: FAIL，提示健康状态或告警接口未实现

- [ ] **Step 3: 抽出服务器健康仓储**

在 `server/repositories/server-health-repository.js` 中实现：

- `listServerHealthSummary`
- `findServerHealthDetail`
- `listPendingAlerts`
- `markAlertSent`
- `openOrUpdateAlert`
- `resolveAlert`

- [ ] **Step 4: 实现监控服务层**

在 `server/services/shared/telegram-monitor-service.js` 中实现：

- 将 3X-UI 巡检结果归一化为 `panel_api`、`panel_auth`、`xray_runtime`
- 根据连续失败阈值决定是否写入或更新告警
- 为机器人提供待发送告警列表

- [ ] **Step 5: 把现有 jobs 的巡检结果接入监控服务**

在现有相关 job 处理器中调用 `telegram-monitor-service`，不要另起一套巡检逻辑。优先复用现有 3X-UI 调用结果，避免额外重复请求。

- [ ] **Step 6: 暴露内部状态与告警接口**

在内部控制器和路由中补充：

- `GET /api/internal/telegram/servers/health`
- `GET /api/internal/telegram/servers/health/:serverId`
- `GET /api/internal/telegram/alerts`
- `GET /api/internal/telegram/alerts/pending`
- `POST /api/internal/telegram/alerts/:alertId/sent`

- [ ] **Step 7: 运行测试，确认通过**

Run: `node server/test/test-telegram-monitor-internal-routes.js`  
Expected: PASS，输出类似 `test-telegram-monitor-internal-routes: PASS`

- [ ] **Step 8: Commit**

```bash
git add server/repositories/server-health-repository.js server/services/shared/telegram-monitor-service.js server/jobs/handlers/sync-xui-users.js server/jobs/handlers/sync-traffic.js server/jobs/index.js server/controllers/admin/telegram-internal-controller.js server/routes/internal/telegram.js server/test/test-telegram-monitor-internal-routes.js
git commit -m "实现Telegram第一阶段巡检状态与告警接口"
```

### Task 5: 实现管理员代查用户概览与管理端配置入口

**Files:**
- Modify: `server/controllers/admin/telegram-internal-controller.js`
- Modify: `server/routes/internal/telegram.js`
- Create: `server/routes/admin/telegram.js`
- Modify: `server/bootstrap/register-admin-routes.js`
- Modify: `client-admin/src/views/Settings.vue`
- Modify: `client-admin/src/api/index.js`

- [ ] **Step 1: 先写管理员代查接口失败用例**

Create `server/test/test-telegram-admin-user-lookup.js`，覆盖：

1. 已绑定管理员可调用 `GET /api/internal/telegram/admin/users/lookup`
2. 未绑定 chat 调用被拒绝
3. 可按 `email` 和 `user_id` 查询

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node server/test/test-telegram-admin-user-lookup.js`  
Expected: FAIL，提示 lookup 接口未实现

- [ ] **Step 3: 实现用户概览查询接口**

在内部控制器中新增 `GET /api/internal/telegram/admin/users/lookup`，返回：

- `user_id`
- `email`
- `enabled`
- `plan_name`
- `traffic_used`
- `traffic_limit`
- `traffic_used_text`
- `traffic_limit_text`
- `expire_at`
- `sync_status`

- [ ] **Step 4: 为管理端补 Telegram 第一阶段配置入口**

在 `server/routes/admin/telegram.js`、`client-admin/src/api/index.js`、`client-admin/src/views/Settings.vue` 中实现：

- 获取 Telegram 基础配置
- 保存内部 API 开关和签名相关配置说明
- 生成管理员绑定码
- 查看已绑定管理员列表

第一阶段只做最小后台入口，不强行拆独立大页面。

- [ ] **Step 5: 运行后端测试**

Run: `node server/test/test-telegram-admin-user-lookup.js`  
Expected: PASS，输出类似 `test-telegram-admin-user-lookup: PASS`

- [ ] **Step 6: 运行管理端构建验证**

Run: `npm run build`  
Workdir: `F:\web-project\subscription-manager-v1.0.0\client-admin`  
Expected: 构建成功，无报错

- [ ] **Step 7: Commit**

```bash
git add server/controllers/admin/telegram-internal-controller.js server/routes/internal/telegram.js server/routes/admin/telegram.js server/bootstrap/register-admin-routes.js client-admin/src/views/Settings.vue client-admin/src/api/index.js server/test/test-telegram-admin-user-lookup.js
git commit -m "实现Telegram第一阶段管理员查询与配置入口"
```

### Task 6: 全量验证与交付检查

**Files:**
- Modify: `docs/superpowers/specs/2026-06-02-telegram-bot-remote-api-design.md`
- Modify: `docs/superpowers/specs/2026-06-02-telegram-bot-remote-deployment-design.md`

- [ ] **Step 1: 依次运行第一阶段测试脚本**

Run:

- `node server/test/test-telegram-internal-auth.js`
- `node server/test/test-telegram-admin-internal-routes.js`
- `node server/test/test-telegram-monitor-internal-routes.js`
- `node server/test/test-telegram-admin-user-lookup.js`

Expected: 全部 PASS

- [ ] **Step 2: 运行必要的语法检查**

Run:

- `node --check server/routes/internal/telegram.js`
- `node --check server/services/shared/telegram-monitor-service.js`

Expected: 均无输出，退出码为 `0`

- [ ] **Step 3: 补充文档中的实际字段或限制差异**

如果实现过程中与原 spec 有细微差异，在两份 Telegram 远程设计文档中同步更新实际字段、错误码或限制规则。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-02-telegram-bot-remote-api-design.md docs/superpowers/specs/2026-06-02-telegram-bot-remote-deployment-design.md
git commit -m "同步Telegram第一阶段实现文档"
```

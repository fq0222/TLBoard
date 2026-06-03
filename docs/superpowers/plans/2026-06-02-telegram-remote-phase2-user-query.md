# Telegram Remote Phase 2 User Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为独立部署的 Telegram 机器人开放第二阶段用户能力：用户绑定、解绑、身份识别、个人信息查询、流量查询、订阅查询和节点摘要查询。

**Architecture:** 继续由主业务服务维护用户与 Telegram chat 的绑定关系，并通过内部 API 返回经过裁剪的用户可见数据。机器人只做命令入口和消息格式化，不保留业务真相，也不直接拼接数据库查询。

**Tech Stack:** Node.js、Express、PostgreSQL、CommonJS、Vue 3、自定义测试脚本

---

### Task 1: 扩展用户绑定数据结构

**Files:**
- Modify: `server/db/schema/tables.js`
- Modify: `server/db/init.js`
- Create: `server/db/migrations/014-telegram-user-bindings.js`

- [ ] **Step 1: 补充用户绑定相关表或字段**

在 `server/db/schema/tables.js` 中补充第二阶段所需结构：

- `telegram_user_bindings`
- 如阶段一已存在通用绑定码表，则扩展 `target_type=user`

- [ ] **Step 2: 同步数据库初始化逻辑**

在 `server/db/init.js` 中注册新表创建，保证新环境可直接使用用户绑定功能。

- [ ] **Step 3: 编写幂等迁移脚本**

在 `server/db/migrations/014-telegram-user-bindings.js` 中实现幂等迁移，避免影响已上线的第一阶段库。

- [ ] **Step 4: 运行语法检查**

Run: `node --check server/db/migrations/014-telegram-user-bindings.js`  
Expected: 无输出，退出码为 `0`

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/tables.js server/db/init.js server/db/migrations/014-telegram-user-bindings.js
git commit -m "新增Telegram第二阶段用户绑定结构"
```

### Task 2: 实现用户绑定、解绑与身份查询接口

**Files:**
- Modify: `server/repositories/telegram-repository.js`
- Create: `server/services/shared/telegram-auth-service.js`
- Modify: `server/controllers/admin/telegram-internal-controller.js`
- Modify: `server/routes/internal/telegram.js`

- [ ] **Step 1: 先写用户绑定接口失败用例**

Create `server/test/test-telegram-user-binding.js`，覆盖：

1. `POST /api/internal/telegram/user/bind/verify`
2. `GET /api/internal/telegram/user/by-chat/:chatId`
3. `POST /api/internal/telegram/user/unbind`
4. 过期绑定码失败
5. 已绑定用户重复绑定的处理

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node server/test/test-telegram-user-binding.js`  
Expected: FAIL，提示用户绑定接口未实现

- [ ] **Step 3: 扩展仓储层**

在 `server/repositories/telegram-repository.js` 中增加：

- `createUserBinding`
- `findUserBindingByChatId`
- `revokeUserBinding`
- `consumeUserBindCode`

- [ ] **Step 4: 实现认证服务层**

在 `server/services/shared/telegram-auth-service.js` 中实现：

- `verifyUserBindCode`
- `getUserByChatId`
- `unbindUserByChat`

确保一个用户默认只保留一个活跃 Telegram 绑定。

- [ ] **Step 5: 暴露内部接口**

在内部控制器和路由中实现：

- `POST /api/internal/telegram/user/bind/verify`
- `GET /api/internal/telegram/user/by-chat/:chatId`
- `POST /api/internal/telegram/user/unbind`

- [ ] **Step 6: 运行测试，确认通过**

Run: `node server/test/test-telegram-user-binding.js`  
Expected: PASS，输出类似 `test-telegram-user-binding: PASS`

- [ ] **Step 7: Commit**

```bash
git add server/repositories/telegram-repository.js server/services/shared/telegram-auth-service.js server/controllers/admin/telegram-internal-controller.js server/routes/internal/telegram.js server/test/test-telegram-user-binding.js
git commit -m "实现Telegram第二阶段用户绑定接口"
```

### Task 3: 实现用户信息与流量查询接口

**Files:**
- Create: `server/services/shared/telegram-user-query-service.js`
- Modify: `server/controllers/admin/telegram-internal-controller.js`
- Modify: `server/routes/internal/telegram.js`
- Modify: `server/repositories/subscription-repository.js`
- Modify: `server/repositories/traffic-repository.js`

- [ ] **Step 1: 先写 `/me` 与 `/usage` 查询失败用例**

Create `server/test/test-telegram-user-profile-usage.js`，覆盖：

1. `GET /api/internal/telegram/user/me`
2. `GET /api/internal/telegram/user/usage`
3. 未绑定 chat 被拒绝
4. 被禁用用户仍能查阅只读状态但字段受控

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node server/test/test-telegram-user-profile-usage.js`  
Expected: FAIL，提示用户查询服务未实现

- [ ] **Step 3: 实现用户查询服务层**

在 `server/services/shared/telegram-user-query-service.js` 中实现：

- `getTelegramUserProfile`
- `getTelegramUserUsage`

返回字段严格限制为：

- `user_id`
- `email`
- `enabled`
- `plan_name`
- `expire_at`
- `traffic_used`
- `traffic_limit`
- `traffic_remaining`
- `usage_percent`
- 对应格式化文本

- [ ] **Step 4: 暴露 `/me` 与 `/usage` 内部接口**

在控制器和路由中新增：

- `GET /api/internal/telegram/user/me`
- `GET /api/internal/telegram/user/usage`

- [ ] **Step 5: 运行测试，确认通过**

Run: `node server/test/test-telegram-user-profile-usage.js`  
Expected: PASS，输出类似 `test-telegram-user-profile-usage: PASS`

- [ ] **Step 6: Commit**

```bash
git add server/services/shared/telegram-user-query-service.js server/controllers/admin/telegram-internal-controller.js server/routes/internal/telegram.js server/repositories/subscription-repository.js server/repositories/traffic-repository.js server/test/test-telegram-user-profile-usage.js
git commit -m "实现Telegram第二阶段用户资料与流量查询"
```

### Task 4: 实现订阅与节点摘要查询接口

**Files:**
- Modify: `server/services/shared/telegram-user-query-service.js`
- Modify: `server/controllers/admin/telegram-internal-controller.js`
- Modify: `server/routes/internal/telegram.js`
- Modify: `server/routes/user/subscription.js`
- Modify: `server/services/subscription-strategy.js`

- [ ] **Step 1: 先写 `/subscription` 与 `/nodes` 查询失败用例**

Create `server/test/test-telegram-user-subscription-nodes.js`，覆盖：

1. `GET /api/internal/telegram/user/subscription`
2. `GET /api/internal/telegram/user/nodes`
3. 节点摘要返回长度受限
4. 不直接回传超长全量配置

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node server/test/test-telegram-user-subscription-nodes.js`  
Expected: FAIL，提示接口未实现

- [ ] **Step 3: 在查询服务中补充订阅与节点摘要方法**

在 `server/services/shared/telegram-user-query-service.js` 中新增：

- `getTelegramUserSubscription`
- `getTelegramUserNodeSummary`

要求：

1. 订阅接口仅返回通用订阅链接、Clash 链接、启用状态、到期时间。
2. 节点接口只返回总数、可用数、分组统计和最多前若干个样例节点名。

- [ ] **Step 4: 暴露内部接口**

新增：

- `GET /api/internal/telegram/user/subscription`
- `GET /api/internal/telegram/user/nodes`

- [ ] **Step 5: 运行测试，确认通过**

Run: `node server/test/test-telegram-user-subscription-nodes.js`  
Expected: PASS，输出类似 `test-telegram-user-subscription-nodes: PASS`

- [ ] **Step 6: Commit**

```bash
git add server/services/shared/telegram-user-query-service.js server/controllers/admin/telegram-internal-controller.js server/routes/internal/telegram.js server/routes/user/subscription.js server/services/subscription-strategy.js server/test/test-telegram-user-subscription-nodes.js
git commit -m "实现Telegram第二阶段订阅与节点摘要查询"
```

### Task 5: 为用户端补绑定码入口

**Files:**
- Modify: `server/routes/user/auth.js`
- Modify: `client-user/src/api/index.js`
- Modify: `client-user/src/views/user/Profile.vue`

- [ ] **Step 1: 先写用户绑定码生成接口失败用例**

Create `server/test/test-telegram-user-bind-code.js`，覆盖：

1. 已登录用户可生成绑定码
2. 绑定码有有效期
3. 可重复生成时旧码失效

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node server/test/test-telegram-user-bind-code.js`  
Expected: FAIL，提示绑定码生成未实现

- [ ] **Step 3: 实现用户侧生成绑定码接口**

在用户端后端路由中新增类似：

- `POST /api/user/telegram/bind-code`

并在 `client-user/src/api/index.js`、`client-user/src/views/user/Profile.vue` 中新增按钮和提示文案，展示生成后的一次性绑定码。

- [ ] **Step 4: 运行测试与用户端构建**

Run:

- `node server/test/test-telegram-user-bind-code.js`
- `npm run build`

Workdir: `F:\web-project\subscription-manager-v1.0.0\client-user`

Expected: 测试 PASS，用户端构建成功

- [ ] **Step 5: Commit**

```bash
git add server/routes/user/auth.js client-user/src/api/index.js client-user/src/views/user/Profile.vue server/test/test-telegram-user-bind-code.js
git commit -m "新增Telegram第二阶段用户绑定码入口"
```

### Task 6: 全量验证与文档同步

**Files:**
- Modify: `docs/superpowers/specs/2026-06-02-telegram-bot-remote-api-design.md`

- [ ] **Step 1: 依次运行第二阶段测试脚本**

Run:

- `node server/test/test-telegram-user-binding.js`
- `node server/test/test-telegram-user-profile-usage.js`
- `node server/test/test-telegram-user-subscription-nodes.js`
- `node server/test/test-telegram-user-bind-code.js`

Expected: 全部 PASS

- [ ] **Step 2: 运行语法检查**

Run:

- `node --check server/services/shared/telegram-user-query-service.js`
- `node --check server/services/shared/telegram-auth-service.js`

Expected: 均无输出，退出码为 `0`

- [ ] **Step 3: 同步 API 设计文档**

把最终实际返回字段、限制条数、绑定码时效等差异同步到 `docs/superpowers/specs/2026-06-02-telegram-bot-remote-api-design.md`。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-02-telegram-bot-remote-api-design.md
git commit -m "同步Telegram第二阶段接口文档"
```

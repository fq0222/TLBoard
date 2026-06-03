# Telegram Remote Phase 3 Controlled Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为独立部署的 Telegram 机器人开放第三阶段受控写操作，包括修改密码、重新生成订阅、管理员触发单台服务器重检、用户提醒配置，同时补齐审计、限流和二次确认。

**Architecture:** 所有敏感写操作都由主业务服务执行，机器人只作为命令入口和确认过程载体。通过一次性请求、确认码、审计日志和限流把第三阶段风险控制在主业务服务内部，避免机器人直接改库或复刻业务规则。

**Tech Stack:** Node.js、Express、PostgreSQL、CommonJS、Vue 3、自定义测试脚本

---

### Task 1: 扩展敏感操作请求与审计结构

**Files:**
- Modify: `server/db/schema/tables.js`
- Modify: `server/db/init.js`
- Create: `server/db/migrations/015-telegram-sensitive-operations.js`

- [ ] **Step 1: 在表结构中增加第三阶段数据表**

新增或补充：

- `telegram_sensitive_requests`
- `telegram_sensitive_audit_logs`
- `telegram_user_reminder_settings`

用于保存改密码请求、确认码校验过程、写操作审计和提醒设置。

- [ ] **Step 2: 在初始化逻辑中注册新表**

修改 `server/db/init.js`，保证新环境初始化后直接具备第三阶段结构。

- [ ] **Step 3: 编写幂等迁移脚本**

在 `server/db/migrations/015-telegram-sensitive-operations.js` 中实现幂等迁移，避免影响前两个阶段已存在数据。

- [ ] **Step 4: 运行语法检查**

Run: `node --check server/db/migrations/015-telegram-sensitive-operations.js`  
Expected: 无输出，退出码为 `0`

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/tables.js server/db/init.js server/db/migrations/015-telegram-sensitive-operations.js
git commit -m "新增Telegram第三阶段敏感操作结构"
```

### Task 2: 实现改密码请求与确认流程

**Files:**
- Modify: `server/repositories/telegram-repository.js`
- Create: `server/services/shared/telegram-sensitive-operation-service.js`
- Modify: `server/controllers/admin/telegram-internal-controller.js`
- Modify: `server/routes/internal/telegram.js`
- Modify: `server/services/admin/auth-service.js`

- [ ] **Step 1: 先写改密码流程失败用例**

Create `server/test/test-telegram-password-change.js`，覆盖：

1. `POST /api/internal/telegram/user/password/change/request`
2. `POST /api/internal/telegram/user/password/change/confirm`
3. 确认码错误失败
4. 请求过期失败
5. 新密码不符合规则失败
6. 成功修改后原请求失效

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node server/test/test-telegram-password-change.js`  
Expected: FAIL，提示敏感操作服务未实现

- [ ] **Step 3: 扩展仓储与服务层**

在 `server/repositories/telegram-repository.js` 增加：

- `createSensitiveRequest`
- `findSensitiveRequestById`
- `consumeSensitiveRequest`
- `createSensitiveAuditLog`

在 `server/services/shared/telegram-sensitive-operation-service.js` 中实现：

- `requestPasswordChange`
- `confirmPasswordChange`

- [ ] **Step 4: 复用现有密码规则**

不要重新发明密码校验规则，复用现有用户密码更新逻辑或共享校验逻辑，保持网站与 Telegram 改密码规则一致。

- [ ] **Step 5: 暴露内部接口**

实现：

- `POST /api/internal/telegram/user/password/change/request`
- `POST /api/internal/telegram/user/password/change/confirm`

- [ ] **Step 6: 运行测试，确认通过**

Run: `node server/test/test-telegram-password-change.js`  
Expected: PASS，输出类似 `test-telegram-password-change: PASS`

- [ ] **Step 7: Commit**

```bash
git add server/repositories/telegram-repository.js server/services/shared/telegram-sensitive-operation-service.js server/controllers/admin/telegram-internal-controller.js server/routes/internal/telegram.js server/services/admin/auth-service.js server/test/test-telegram-password-change.js
git commit -m "实现Telegram第三阶段改密码确认流程"
```

### Task 3: 实现订阅重生成接口

**Files:**
- Modify: `server/services/shared/telegram-sensitive-operation-service.js`
- Modify: `server/controllers/admin/telegram-internal-controller.js`
- Modify: `server/routes/internal/telegram.js`
- Modify: `server/routes/user/subscription.js`
- Modify: `server/services/xui-sync.js`

- [ ] **Step 1: 先写订阅重生成失败用例**

Create `server/test/test-telegram-subscription-regenerate.js`，覆盖：

1. `POST /api/internal/telegram/user/subscription/regenerate`
2. 未绑定用户被拒绝
3. 正常返回新的订阅结果

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node server/test/test-telegram-subscription-regenerate.js`  
Expected: FAIL，提示接口未实现

- [ ] **Step 3: 在敏感操作服务中补充订阅重生成方法**

实现 `regenerateTelegramUserSubscription`，优先复用现有用户侧“生成订阅链接”链路，不重写一套 XUI 刷新逻辑。

- [ ] **Step 4: 暴露内部接口**

实现：

- `POST /api/internal/telegram/user/subscription/regenerate`

- [ ] **Step 5: 运行测试，确认通过**

Run: `node server/test/test-telegram-subscription-regenerate.js`  
Expected: PASS，输出类似 `test-telegram-subscription-regenerate: PASS`

- [ ] **Step 6: Commit**

```bash
git add server/services/shared/telegram-sensitive-operation-service.js server/controllers/admin/telegram-internal-controller.js server/routes/internal/telegram.js server/routes/user/subscription.js server/services/xui-sync.js server/test/test-telegram-subscription-regenerate.js
git commit -m "实现Telegram第三阶段订阅重生成接口"
```

### Task 4: 实现管理员手动重检接口

**Files:**
- Modify: `server/services/shared/telegram-monitor-service.js`
- Modify: `server/services/shared/telegram-sensitive-operation-service.js`
- Modify: `server/controllers/admin/telegram-internal-controller.js`
- Modify: `server/routes/internal/telegram.js`

- [ ] **Step 1: 先写单台服务器重检失败用例**

Create `server/test/test-telegram-server-recheck.js`，覆盖：

1. `POST /api/internal/telegram/admin/servers/:serverId/recheck`
2. 非管理员调用被拒绝
3. 重检成功进入执行或排队状态

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node server/test/test-telegram-server-recheck.js`  
Expected: FAIL，提示重检接口未实现

- [ ] **Step 3: 实现单台服务器重检方法**

在 `server/services/shared/telegram-monitor-service.js` 中增加单台服务器巡检入口，在 `telegram-sensitive-operation-service.js` 中封装管理员权限检查和审计落库。

- [ ] **Step 4: 暴露内部接口**

实现：

- `POST /api/internal/telegram/admin/servers/:serverId/recheck`

- [ ] **Step 5: 运行测试，确认通过**

Run: `node server/test/test-telegram-server-recheck.js`  
Expected: PASS，输出类似 `test-telegram-server-recheck: PASS`

- [ ] **Step 6: Commit**

```bash
git add server/services/shared/telegram-monitor-service.js server/services/shared/telegram-sensitive-operation-service.js server/controllers/admin/telegram-internal-controller.js server/routes/internal/telegram.js server/test/test-telegram-server-recheck.js
git commit -m "实现Telegram第三阶段管理员手动重检"
```

### Task 5: 实现提醒配置查询与更新接口

**Files:**
- Modify: `server/repositories/telegram-repository.js`
- Modify: `server/services/shared/telegram-sensitive-operation-service.js`
- Modify: `server/controllers/admin/telegram-internal-controller.js`
- Modify: `server/routes/internal/telegram.js`

- [ ] **Step 1: 先写提醒配置接口失败用例**

Create `server/test/test-telegram-reminders.js`，覆盖：

1. `GET /api/internal/telegram/user/reminders`
2. `PUT /api/internal/telegram/user/reminders`
3. 非法阈值失败
4. 未绑定用户被拒绝

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node server/test/test-telegram-reminders.js`  
Expected: FAIL，提示提醒设置接口未实现

- [ ] **Step 3: 实现提醒设置读写**

在仓储和服务层中新增：

- `getUserReminderSettings`
- `saveUserReminderSettings`

校验：

- `expire_reminder_days` 合理范围
- `traffic_reminder_threshold_percent` 在 `1-100`

- [ ] **Step 4: 暴露内部接口**

实现：

- `GET /api/internal/telegram/user/reminders`
- `PUT /api/internal/telegram/user/reminders`

- [ ] **Step 5: 运行测试，确认通过**

Run: `node server/test/test-telegram-reminders.js`  
Expected: PASS，输出类似 `test-telegram-reminders: PASS`

- [ ] **Step 6: Commit**

```bash
git add server/repositories/telegram-repository.js server/services/shared/telegram-sensitive-operation-service.js server/controllers/admin/telegram-internal-controller.js server/routes/internal/telegram.js server/test/test-telegram-reminders.js
git commit -m "实现Telegram第三阶段提醒配置接口"
```

### Task 6: 补齐限流、审计与收尾验证

**Files:**
- Modify: `server/services/shared/telegram-sensitive-operation-service.js`
- Modify: `server/middleware/auth-internal-telegram.js`
- Modify: `docs/superpowers/specs/2026-06-02-telegram-bot-remote-api-design.md`

- [ ] **Step 1: 增加敏感命令限流**

在敏感操作服务中对以下动作加限流：

- 改密码发起
- 改密码确认
- 订阅重生成
- 手动重检

优先使用数据库或现有内存限流模式，保持实现简单但可审计。

- [ ] **Step 2: 补齐敏感审计日志**

确保每次第三阶段写操作都记录：

- 发起 chat_id
- 绑定 user_id 或 admin_id
- 请求类型
- 是否成功
- 错误原因
- 创建时间

- [ ] **Step 3: 依次运行第三阶段测试脚本**

Run:

- `node server/test/test-telegram-password-change.js`
- `node server/test/test-telegram-subscription-regenerate.js`
- `node server/test/test-telegram-server-recheck.js`
- `node server/test/test-telegram-reminders.js`

Expected: 全部 PASS

- [ ] **Step 4: 运行语法检查**

Run:

- `node --check server/services/shared/telegram-sensitive-operation-service.js`
- `node --check server/controllers/admin/telegram-internal-controller.js`

Expected: 无输出，退出码为 `0`

- [ ] **Step 5: 同步 API 设计文档**

把第三阶段最终确认的字段、限流窗口、确认码时效写回 `docs/superpowers/specs/2026-06-02-telegram-bot-remote-api-design.md`。

- [ ] **Step 6: Commit**

```bash
git add server/services/shared/telegram-sensitive-operation-service.js server/middleware/auth-internal-telegram.js docs/superpowers/specs/2026-06-02-telegram-bot-remote-api-design.md
git commit -m "补齐Telegram第三阶段限流审计与文档"
```

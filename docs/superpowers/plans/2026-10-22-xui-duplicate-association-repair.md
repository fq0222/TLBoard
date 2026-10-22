# 3X-UI 重复关联修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻止客户端查询超时被误判为不存在，并让相同身份的重复快照不再阻断订阅生成。

**Architecture:** 3X-UI 服务层提供 `found/not_found/error` 查询语义，订单同步只在明确不存在时新增；订阅生成对相同身份记录去重并继续刷新模板。六小时巡检保持既有只读快照与状态同步逻辑，不承担自动 detach/attach 清理。

**Tech Stack:** Node.js、Express、3X-UI v3.10.2 API、项目现有脚本测试体系

**Spec:** 2026-10-21 至 2026-10-22 对话中已确认的三阶段修复方案

## Global Constraints

- 不创建或切换 Git 分支，不创建 worktree。
- 不新增定时任务；查询错误复用现有 `RENEW_SYNC` 重试队列。
- 只有 3X-UI 明确返回 `(record not found)` 时才允许新增客户端。
- 六小时巡检不自动清理重复 inbound 关联，不调用 detach/attach。
- 只有相同邮箱且 `id/password/auth/subId` 身份一致的重复记录允许在订阅生成阶段去重。
- 新增方法必须补充职责、关键参数和核心分支注释。
- 修改 `server/**/*.js` 后提醒用户重启服务器，不自行启动服务器。

## Review Focus

- API 返回其他 `success=false` 消息时必须归为 error，不能新增用户。
- 同邮箱但身份凭证冲突时不得用于订阅模板刷新。

---

### Task 1: 明确客户端查询状态并阻止超时新增

**Files:**
- Modify: `server/integrations/xui/xui-service.js`
- Modify: `server/services/shared/order-service.js`
- Test: `server/test/test-xui-service-v325.js`
- Test: `server/test/test-order-xui-sync.js`

**Interfaces:**
- Produces: `getServerClientByEmail(email)` 返回 `status: found|not_found|error`。
- Produces: `upsertServerClient(payload)` 仅在 `not_found` 时调用 `addClient`。

- [ ] 写回归测试：明确 `(record not found)` 会新增；超时和未知失败不会新增。
- [ ] 运行测试并确认按预期失败。
- [ ] 实现三态查询结果和 upsert 分支；保留现有调用方所需的 `success` 字段。
- [ ] 为写操作结果未知补充只读核验，无法确认时返回可重试失败。
- [ ] 运行相关 XUI 与订单同步测试并确认通过。

### Task 2: 相同身份重复快照不阻断订阅生成

**Files:**
- Modify: `server/services/user/subscription-service.js`
- Test: `server/test/test-subscription-snapshot-reuse.js`
- Test: `server/test/test-subscription-generation-performance.js`

**Interfaces:**
- Produces: `inspectUserInNodeSnapshot()` 对同身份重复返回可信，对凭证冲突返回不可信。

- [ ] 写回归测试：同身份重复可以刷新模板且不触发用户补偿同步；不同身份重复仍被拒绝。
- [ ] 运行测试并确认按预期失败。
- [ ] 实现按 `id/password/auth/subId` 的身份去重，状态字段差异不构成身份冲突。
- [ ] 调整生成流程，使同身份重复直接进入模板刷新，不执行 `reloadRepairNodeConfigs()`。
- [ ] 运行订阅快照和生成性能测试并确认通过。

### Task 3: 综合验证与代码审查

**Files:**
- Verify: `server/integrations/xui/xui-service.js`
- Verify: `server/services/shared/order-service.js`
- Verify: `server/services/user/subscription-service.js`

- [ ] 运行所有受影响的 `server/test/` 脚本。
- [ ] 运行 `node --check` 检查全部修改的后端文件。
- [ ] 检查 git diff，确认没有真实 Token、用户凭证或无关改动。
- [ ] 请求独立代码审查并处理重要问题。
- [ ] 展示完整测试日志并提醒重启服务器。

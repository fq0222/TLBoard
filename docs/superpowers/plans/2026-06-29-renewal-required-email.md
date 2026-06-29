# 套餐续费提醒邮件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户首次因流量超限或限时套餐到期被禁用时至多尝试发送一次续费提醒，续费后重置提醒资格。

**Architecture:** 在 `users` 表持久化本权益周期的提醒尝试时间和原因，由禁用 SQL 原子领取发送资格。流量管理器只在首次禁用后调用独立邮件服务；邮件服务复用开通提醒的配额、Brevo、站点链接和日志口径，所有失败均吞掉且不重试。

**Tech Stack:** Node.js、PostgreSQL、Express 后端服务、Brevo 邮件客户端、Node `assert` 测试脚本

---

## 文件结构

- Create: `server/db/migrations/019-renewal-notice-state.js`：幂等添加提醒状态字段。
- Modify: `server/db/schema/tables.js`：新数据库初始化字段。
- Modify: `server/repositories/traffic-repository.js`：原子禁用并返回提醒资格。
- Modify: `server/repositories/order-repository.js`：续费或购买完成后清空提醒状态。
- Create: `server/services/shared/renewal-required-email-service.js`：构建并发送续费提醒邮件。
- Modify: `server/services/shared/traffic-manager.js`：首次禁用后触发邮件。
- Create: `server/test/test-renewal-required-email.js`：邮件内容、失败和配额行为测试。
- Create: `server/test/test-renewal-notice-state.js`：禁用去重、套餐类型和续费重置测试。

### Task 1: 数据库提醒状态

**Files:**
- Create: `server/db/migrations/019-renewal-notice-state.js`
- Modify: `server/db/schema/tables.js`
- Test: `server/test/test-renewal-notice-state.js`

- [ ] **Step 1: 编写失败的结构测试**

读取建表定义和迁移源码，断言包含 `renewal_notice_attempted_at BIGINT`、`renewal_notice_reason VARCHAR(50)`，并断言迁移使用 `information_schema.columns` 分别检查字段。

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-renewal-notice-state.js`

Expected: FAIL，提示提醒字段或迁移文件不存在。

- [ ] **Step 3: 实现幂等迁移与建表字段**

迁移使用专用连接和事务：

```javascript
const client = await db.pool.connect();
try {
  await client.query('BEGIN');
  // 分别查询字段是否存在，不存在时执行 ALTER TABLE。
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

在 `users` 建表定义的 `disable_reason` 后加入两个可空字段。

- [ ] **Step 4: 运行结构测试**

Run: `node server/test/test-renewal-notice-state.js`

Expected: 结构测试 PASS。

### Task 2: 原子领取提醒资格与续费重置

**Files:**
- Modify: `server/repositories/traffic-repository.js`
- Modify: `server/repositories/order-repository.js`
- Test: `server/test/test-renewal-notice-state.js`

- [ ] **Step 1: 增加失败测试**

测试以下 SQL 语义：

```javascript
assert.ok(trafficDisableSql.includes('renewal_notice_attempted_at'));
assert.ok(trafficDisableSql.includes('IS NULL'));
assert.ok(expiredDisableSql.includes("COALESCE(p.plan_type, 'lifetime') = 'timed'"));
assert.ok(orderUpdateSql.includes('renewal_notice_attempted_at = NULL'));
assert.ok(orderUpdateSql.includes('renewal_notice_reason = NULL'));
```

模拟 `run()` 返回 `rows: [{ notification_claimed: true }]`，断言两个禁用方法返回 `{ disabled: true, notificationClaimed: true }`；重复调用返回 `notificationClaimed: false`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-renewal-notice-state.js`

Expected: FAIL，现有方法只返回 `void` 或布尔值。

- [ ] **Step 3: 实现仓储层**

将流量禁用和到期禁用 SQL 改为条件写入提醒字段，并通过 `RETURNING` 返回状态。方法统一返回：

```javascript
{
  disabled: Number(result?.changes || 0) > 0,
  notificationClaimed: result?.rows?.[0]?.notification_claimed === true
}
```

`findLatestUserDisableState` 同时读取提醒字段。`updateUserAfterPaidOrder` 无条件清空两个提醒字段，使每次支付完成开启新提醒周期。

- [ ] **Step 4: 运行状态测试**

Run: `node server/test/test-renewal-notice-state.js`

Expected: 仓储层相关用例 PASS。

### Task 3: 续费提醒邮件服务

**Files:**
- Create: `server/services/shared/renewal-required-email-service.js`
- Test: `server/test/test-renewal-required-email.js`

- [ ] **Step 1: 编写失败测试**

覆盖：

```javascript
assert.strictEqual(
  subject,
  '【天澜大陆消息】亲爱的 demo，您的魔法传送能量已经耗尽！'
);
assert.ok(trafficHtml.includes('套餐流量已经耗尽'));
assert.ok(expiredHtml.includes('限时套餐已经到期'));
assert.ok(html.includes('&lt;script&gt;'));
```

另外模拟配额不足和 Brevo 失败，断言函数返回未发送状态且不抛异常。

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-renewal-required-email.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现邮件服务**

服务导出：

```javascript
module.exports = {
  sendRenewalRequiredEmail,
  buildRenewalRequiredEmailContent,
  buildRenewalRequiredEmailSubject
};
```

复用 `order-activation-email-service` 导出的 `checkDailyEmailQuota`、格式化及用户名函数，复用共享邮件服务和 `emailRepository.createEmailLog()`。HTML 使用相同的绿色标题区、白色信息卡、用户中心按钮和自动邮件页脚；原因文案严格按 `traffic_limit`/`expired` 分支生成。

- [ ] **Step 4: 运行邮件测试**

Run: `node server/test/test-renewal-required-email.js`

Expected: 全部 PASS。

### Task 4: 接入首次禁用路径

**Files:**
- Modify: `server/services/shared/traffic-manager.js`
- Test: `server/test/test-renewal-notice-state.js`
- Test: `server/test/test-traffic-disabled-compensation.js`

- [ ] **Step 1: 编写失败测试**

注入邮件服务桩并覆盖：

- 首次流量禁用调用一次，3X-UI 同步失败也不改变调用次数。
- 已禁用用户补偿同步不调用。
- 首次到期禁用调用一次。
- 锁忙和二次校验未命中不调用。
- lifetime 套餐不会出现在到期列表。

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-renewal-notice-state.js`

Expected: FAIL，流量管理器尚未调用邮件服务。

- [ ] **Step 3: 实现触发逻辑**

在状态锁内只完成数据库状态转换并返回：

```javascript
{
  success: true,
  action: 'disabled',
  notificationClaimed: disableResult.notificationClaimed
}
```

离开锁后，当 `notificationClaimed === true` 时调用：

```javascript
await renewalRequiredEmailService.sendRenewalRequiredEmail(db, {
  userId: Number(userId),
  reason: DISABLE_REASONS.TRAFFIC_LIMIT
});
```

到期路径传入 `DISABLE_REASONS.EXPIRED`。邮件服务异常必须被自身吸收，3X-UI 立即同步或队列补偿与邮件互不依赖。

- [ ] **Step 4: 运行流量相关测试**

Run:

```powershell
node server/test/test-renewal-notice-state.js
node server/test/test-renewal-required-email.js
node server/test/test-traffic-disabled-compensation.js
node server/test/test-traffic-manager.js
```

Expected: 全部 PASS。

### Task 5: 回归验证

**Files:**
- Verify only

- [ ] **Step 1: 检查代码和迁移**

Run:

```powershell
git diff --check
node --check server/services/shared/renewal-required-email-service.js
node --check server/services/shared/traffic-manager.js
node --check server/repositories/traffic-repository.js
node --check server/repositories/order-repository.js
node --check server/db/migrations/019-renewal-notice-state.js
```

Expected: 无输出错误，所有命令退出码为 0。

- [ ] **Step 2: 执行后端测试日志**

Run:

```powershell
node server/test/test-renewal-notice-state.js
node server/test/test-renewal-required-email.js
node server/test/test-traffic-disabled-compensation.js
node server/test/test-traffic-manager.js
node server/test/test-referral-service.js
```

Expected: 全部 PASS，并在交付回复中展示测试日志摘要。

- [ ] **Step 3: 检查未暂存变更**

Run: `git status --short`

Expected: 仅显示本功能相关代码和测试文件；不执行 `git add`，除非用户明确要求提交。

- [ ] **Step 4: 提醒部署动作**

交付时明确提醒：先运行 `019-renewal-notice-state.js` 迁移，再重启后端服务；不得自行启动服务器。

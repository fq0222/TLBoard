# 个人提现与余额流水实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为用户端和管理端交付安全、可审计的个人提现功能，并让推广奖励、余额支付、提现扣款与退款全部进入统一余额流水。

**Architecture:** 保留 `users.balance` 作为实时余额，新建不可变余额流水、用户收款码和提现申请表。所有余额变化通过接收专用 PostgreSQL 事务连接的 `BalanceService` 完成；二维码原图只在内存中解析，内容经 AES-256-GCM 加密后入库，管理端由服务端重新生成二维码图片。

**Tech Stack:** Node.js 18+、Express 4、PostgreSQL、Vue 3、Vite、Element Plus、Multer、Sharp、ZXing、QRCode、Node.js `crypto`。

**Spec:** `docs/superpowers/specs/2026-09-21-personal-withdrawal-design.md`

## Global Constraints

- 使用简体中文编写界面文案、注释、日志和提交信息。
- 金额在数据库和 API 内统一使用整数分；用户输入和界面展示使用元，最多两位小数。
- 最低提现金额保存为 `system_settings.minimum_withdrawal_amount`，默认 2000 分。
- 同一用户最多一笔 `pending` 提现；提交时立即扣款，确认时不再扣款，驳回时原子退款。
- 原始二维码图片不得落盘；二维码明文不得写入数据库、JSON 响应或日志。
- 二维码加密密钥只允许来自 `WITHDRAWAL_QR_ENCRYPTION_KEY` 环境变量，不在仓库提供真实值或不安全默认值。
- 所有余额写入必须在同一专用数据库连接的事务中同步写入流水。
- 新建文件和新增方法必须补充职责、关键参数和核心分支注释。
- 不创建或切换分支，不创建 worktree；直接在当前分支实施。
- 后端修改后不自行启动服务，交付时提醒用户重启。
- 文档不随代码推测更新；本计划只实现已批准规格。

## Review Focus

- 两个并发提现请求命中同一余额时，只允许一笔成功，另一笔返回“已有处理中申请”或余额业务错误，且不能重复扣款。
- 两名管理员同时处理同一申请时，只允许一个状态转换成功，驳回退款最多发生一次。
- 加密密钥缺失、长度错误或密文被篡改时，接口必须失败且不得降级为明文保存或输出敏感内容。
- 伪造 MIME、超大图片、无二维码、多二维码和平台协议不匹配必须被拒绝，临时缓冲区不得持久化。
- 金额边界（0、负数、三位小数、恰好最低额、恰好余额、超出安全整数）必须使用整数分校验，不能依赖浮点比较。

---

## 文件结构

### 后端新增文件

- `server/db/migrations/019-wallet-withdrawals.js`：创建三张业务表、索引、默认设置和幂等期初流水。
- `server/repositories/balance-repository.js`：用户余额行锁、余额更新、流水插入与分页查询。
- `server/repositories/withdrawal-repository.js`：当前收款码、提现申请、管理端汇总查询。
- `server/services/shared/balance-service.js`：统一余额变更和流水格式化。
- `server/services/shared/payment-qr-service.js`：图片解析、平台校验、加解密和二维码 PNG 生成。
- `server/services/user/wallet-service.js`：用户收款码、提现概览、申请与流水用例。
- `server/services/admin/wallet-service.js`：管理端用户余额汇总、详情、确认和驳回用例。
- `server/controllers/user/wallet-controller.js`、`server/routes/user/wallet.js`：用户端钱包 HTTP 层。
- `server/controllers/admin/wallet-controller.js`、`server/routes/admin/wallet.js`：管理端钱包 HTTP 层。
- `server/test/test-wallet-migration.js`：迁移与期初流水测试。
- `server/test/test-payment-qr-service.js`：二维码解析、平台校验、加解密测试。
- `server/test/test-balance-service.js`：统一余额服务测试。
- `server/test/test-wallet-service.js`：用户提现与并发测试。
- `server/test/test-admin-wallet-service.js`：管理端确认、驳回和并发测试。
- `server/test/test-wallet-routes.js`：鉴权、上传限制、参数校验和响应测试。

### 后端修改文件

- `server/package.json`、`server/package-lock.json`：加入二维码解析、图片解码和二维码生成依赖。
- `server/db/schema/tables.js`、`server/db/schema/indexes.js`：让全新数据库直接具备新表和索引。
- `server/config.js`、`server/ecosystem.config.js`：声明加密密钥读取方式和无敏感值的 PM2 占位配置。
- `server/services/referral-service.js`、`server/repositories/referral-repository.js`：推广奖励接入统一余额事务。
- `server/services/user/renew-service.js`、`server/repositories/order-repository.js`：余额支付接入统一流水。
- `server/services/admin/system-settings-service.js`、`server/controllers/admin/system-settings-controller.js`、`server/routes/admin/system-settings.js`：最低提现金额设置。
- `server/bootstrap/register-user-routes.js`、`server/bootstrap/register-admin-routes.js`：挂载钱包路由。

### 用户端新增/修改文件

- 新建 `client-user/src/views/user/Withdraw.vue`：独立提现与余额明细页。
- 修改 `client-user/src/views/user/My.vue`：首卡替换为收款信息卡。
- 修改 `client-user/src/api/index.js`：钱包 API。
- 修改 `client-user/src/router/index.js`、`client-user/src/views/user/Layout.vue`：注册并预加载提现页。

### 管理端新增/修改文件

- 新建 `client-admin/src/views/Wallets.vue`：用户余额管理与提现处理页。
- 修改 `client-admin/src/api/index.js`：管理端钱包和最低提现设置 API。
- 修改 `client-admin/src/router/index.js`、`client-admin/src/views/Layout.vue`：新增余额管理菜单和路由。
- 修改 `client-admin/src/views/Settings.vue`：新增最低提现金额设置。

---

### Task 1: 数据库迁移与全新数据库表结构

**Files:**
- Create: `server/db/migrations/019-wallet-withdrawals.js`
- Modify: `server/db/schema/tables.js`
- Modify: `server/db/schema/indexes.js`
- Test: `server/test/test-wallet-migration.js`

**Interfaces:**
- Produces: `balance_transactions`、`user_payment_qr_codes`、`withdrawal_requests` 表和 `minimum_withdrawal_amount` 设置。
- Produces: 部分唯一索引 `idx_withdrawal_requests_one_pending_per_user`。
- Produces: 期初流水引用 `reference_type='opening_balance'`、`reference_id=users.id`，用于幂等唯一约束。

- [ ] **Step 1: 编写迁移失败测试**

在 `server/test/test-wallet-migration.js` 使用可记录 SQL 的假连接池，断言迁移开启事务、创建三张表、创建 pending 部分唯一索引、插入默认 2000 分设置，并使用 `ON CONFLICT DO NOTHING` 写入期初流水；补充模拟中途失败后执行 `ROLLBACK` 的测试。

```js
assert.match(sql, /CREATE TABLE IF NOT EXISTS balance_transactions/);
assert.match(sql, /WHERE status = 'pending'/);
assert.match(sql, /minimum_withdrawal_amount/);
assert.match(sql, /ON CONFLICT \(reference_type, reference_id, type\) DO NOTHING/);
assert.deepStrictEqual(events.slice(0, 1), ['BEGIN']);
assert.equal(events.at(-1), 'COMMIT');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node server/test/test-wallet-migration.js`

Expected: FAIL，提示找不到 `../db/migrations/019-wallet-withdrawals`。

- [ ] **Step 3: 实现幂等迁移**

创建导出 `{ up, migrate, createMigrationPool }` 的迁移脚本。数据库约束至少包含：`amount <> 0`、`balance_after >= 0`、提现 `amount > 0`、合法状态/支付类型、驳回状态必须有原因。所有 DDL、默认设置和期初流水在同一事务中执行。

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawal_requests_one_pending_per_user
ON withdrawal_requests(user_id)
WHERE status = 'pending';

INSERT INTO balance_transactions
  (user_id, type, amount, balance_after, reference_type, reference_id, description)
SELECT id, 'opening_balance', balance, balance, 'opening_balance', id, '期初余额'
FROM users
WHERE COALESCE(balance, 0) > 0
ON CONFLICT (reference_type, reference_id, type) DO NOTHING;
```

- [ ] **Step 4: 同步初始化表定义并验证**

把同样的表、约束和索引同步到 `tables.js`、`indexes.js`，确保新安装无需按历史迁移逐个执行。

Run: `node server/test/test-wallet-migration.js`

Expected: PASS，日志包含迁移成功、幂等和回滚测试。

### Task 2: 二维码解析、平台校验和加密模块

**Files:**
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Modify: `server/config.js`
- Modify: `server/ecosystem.config.js`
- Create: `server/services/shared/payment-qr-service.js`
- Test: `server/test/test-payment-qr-service.js`

**Interfaces:**
- Produces: `new PaymentQrService({ encryptionKey, imageDecoder, qrDecoder, qrEncoder })`。
- Produces: `parseAndEncrypt(buffer, paymentType) -> Promise<{encryptedPayload:string,digest:string}>`。
- Produces: `decryptPayload(encryptedPayload) -> string`。
- Produces: `renderQrPng(encryptedPayload) -> Promise<Buffer>`。
- Produces: `validatePaymentPayload(payload, paymentType) -> void`，失败抛出带 `status=400` 的业务错误。

- [ ] **Step 1: 安装服务器依赖**

Run: `npm install sharp @zxing/library qrcode`

Workdir: `server`

Expected: `package.json` 和 lockfile 出现三个依赖，无安装错误。

- [ ] **Step 2: 编写加解密和协议校验失败测试**

测试固定 32 字节密钥下密文不包含原文、可解密、随机 IV 使同一原文产生不同密文、篡改认证标签失败、错误长度密钥失败；覆盖微信与支付宝允许协议以及跨平台、普通网址、超长内容拒绝。

```js
const service = createService({ encryptionKey: Buffer.alloc(32, 7).toString('base64') });
const encrypted = service.encryptPayload('wxp://f2f/example');
assert.equal(service.decryptPayload(encrypted), 'wxp://f2f/example');
assert.ok(!encrypted.includes('wxp://'));
assert.throws(() => service.validatePaymentPayload('https://example.com', 'alipay'), /不受支持/);
```

- [ ] **Step 3: 运行测试并确认失败**

Run: `node server/test/test-payment-qr-service.js`

Expected: FAIL，提示模块不存在。

- [ ] **Step 4: 实现类和依赖注入边界**

用 `class PaymentQrService` 封装内部状态，避免闭包保存密钥。加密输出使用版本化字符串 `v1.<iv>.<tag>.<ciphertext>`；摘要使用 SHA-256。图片处理限制 5 MB 和合理像素总量，通过 Sharp 转 RGBA，再由 ZXing 解析所有结果并要求结果数恰好为 1。`renderQrPng()` 只返回 PNG Buffer。

```js
class PaymentQrService {
  constructor({ encryptionKey, imageDecoder, qrDecoder, qrEncoder } = {}) { /* 校验并保存依赖 */ }
  async parseAndEncrypt(buffer, paymentType) { /* 图片校验 -> 解码 -> 平台校验 -> 加密 */ }
  encryptPayload(payload) { /* AES-256-GCM */ }
  decryptPayload(value) { /* 版本、IV、tag、认证校验 */ }
  async renderQrPng(encryptedPayload) { /* 解密后直接生成 Buffer */ }
}
```

- [ ] **Step 5: 补齐恶意图片和多二维码测试并验证**

通过注入的 `imageDecoder`、`qrDecoder` 覆盖伪造 MIME、空 Buffer、超 5 MB、像素炸弹、无结果和两个结果。断言所有失败均不调用加密存储回调且错误信息不包含二维码内容。

Run: `node server/test/test-payment-qr-service.js`

Expected: PASS。

### Task 3: 统一余额仓储与服务

**Files:**
- Create: `server/repositories/balance-repository.js`
- Create: `server/services/shared/balance-service.js`
- Test: `server/test/test-balance-service.js`

**Interfaces:**
- Produces: `new BalanceService({ repository })`。
- Produces: `credit(transactionDb, { userId, amount, type, referenceType, referenceId, description })`。
- Produces: `debit(transactionDb, { userId, amount, type, referenceType, referenceId, description })`。
- Produces: `listTransactions(db, { userId, type, keyword, limit, offset }) -> {items,total}`。
- Consumes: `transactionDb` 是绑定专用 `pg.Client` 的数据库适配器，所有 SQL 必须走同一连接。

- [ ] **Step 1: 编写余额服务失败测试**

覆盖正数入账、余额充足扣款、余额不足、0/负数/非安全整数拒绝、业务引用重复、金额恰好等于余额、关键词转义和分页边界。断言更新余额后使用 SQL 返回的最新余额写入 `balance_after`。

```js
await service.debit(db, {
  userId: 7,
  amount: 2000,
  type: 'withdrawal',
  referenceType: 'withdrawal_request',
  referenceId: 9,
  description: '提现申请'
});
assert.deepStrictEqual(calls.map(call => call.name), ['lockUser', 'decrementBalance', 'insertTransaction']);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node server/test/test-balance-service.js`

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现仓储和 `BalanceService` 类**

仓储实现 `SELECT ... FOR UPDATE`、带余额条件的更新、流水插入、计数和分页查询。服务只接受正整数绝对金额，并根据 credit/debit 决定流水符号；数据库唯一冲突转换为明确幂等错误。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node server/test/test-balance-service.js`

Expected: PASS。

### Task 4: 将推广奖励与余额支付接入统一流水

**Files:**
- Modify: `server/services/referral-service.js`
- Modify: `server/repositories/referral-repository.js`
- Modify: `server/services/user/renew-service.js`
- Modify: `server/repositories/order-repository.js`
- Modify: `server/test/test-referral-service.js`
- Modify: `server/test/test-renew.js`

**Interfaces:**
- Consumes: Task 3 的 `BalanceService.credit()` 与 `BalanceService.debit()`。
- Produces: 每条 `referral_rewards` 对应唯一 `referral_reward` 流水；每个余额支付订单对应唯一 `plan_payment` 流水。

- [ ] **Step 1: 扩展推广奖励测试并确认失败**

把现有奖励测试改为断言同一专用事务中依次写入奖励记录、增加余额和流水；重复订单只保留一笔奖励及流水；流水失败导致事务回滚。

Run: `node server/test/test-referral-service.js`

Expected: FAIL，缺少余额流水调用。

- [ ] **Step 2: 改造推广奖励事务**

删除仓储中直接操作 `users.balance` 的入口。奖励服务获取 `db.pool.connect()`，通过当前项目的连接适配方式让奖励 SQL 和 `BalanceService.credit()` 使用同一 `client.query()`，并在 finally 释放连接。

- [ ] **Step 3: 扩展余额支付测试并确认失败**

断言订单创建、`BalanceService.debit()` 和订单完成在同一事务；余额恰好等于套餐价格成功；余额不足及流水冲突全部回滚。

Run: `node server/test/test-renew.js`

Expected: FAIL，缺少 `plan_payment` 流水。

- [ ] **Step 4: 改造余额支付并运行回归**

用 `BalanceService.debit()` 替换 `decrementUserBalance()`，流水描述包含套餐名和订单号但不包含敏感数据。

Run: `node server/test/test-referral-service.js`

Run: `node server/test/test-renew.js`

Expected: 两个脚本均 PASS。

- [ ] **Step 5: 提交后端账务核心**

```powershell
git add server/db server/repositories/balance-repository.js server/repositories/referral-repository.js server/repositories/order-repository.js server/services/shared/balance-service.js server/services/referral-service.js server/services/user/renew-service.js server/services/shared/payment-qr-service.js server/config.js server/ecosystem.config.js server/package.json server/package-lock.json server/test/test-wallet-migration.js server/test/test-payment-qr-service.js server/test/test-balance-service.js server/test/test-referral-service.js server/test/test-renew.js
git commit -m "功能：建立统一余额流水与收款码安全基础"
```

### Task 5: 用户端钱包服务与 API

**Files:**
- Create: `server/repositories/withdrawal-repository.js`
- Create: `server/services/user/wallet-service.js`
- Create: `server/controllers/user/wallet-controller.js`
- Create: `server/routes/user/wallet.js`
- Modify: `server/bootstrap/register-user-routes.js`
- Test: `server/test/test-wallet-service.js`
- Test: `server/test/test-wallet-routes.js`

**Interfaces:**
- Produces: `getSummary(db, userId)`。
- Produces: `savePaymentQr(db, userId, {paymentType,fileBuffer})`。
- Produces: `getWithdrawalOverview(db, userId)`。
- Produces: `createWithdrawal(db, userId, {amount})`，`amount` 为整数分。
- Produces: `listUserTransactions(db, userId, filters)`。
- Produces routes under `/api/user/wallet`：`GET /summary`、`PUT /payment-qr`、`GET /withdrawal`、`POST /withdrawals`、`GET /transactions`。

- [ ] **Step 1: 编写用户钱包服务失败测试**

覆盖摘要、保存二维码、默认最低金额、精确最低额成功、低于最低额、余额不足、无收款码、有 pending 申请、三位小数在 HTTP 层拒绝，以及两个并发申请只成功一个。断言申请事务保存二维码密文快照、扣款和流水。

```js
await assert.rejects(
  () => service.createWithdrawal(db, 7, { amount: 1999 }),
  /最低提现金额为20.00元/
);
assert.equal(createdRequest.qrPayloadEncrypted, savedQr.qr_payload_encrypted);
```

- [ ] **Step 2: 运行服务测试并确认失败**

Run: `node server/test/test-wallet-service.js`

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现用户钱包服务和仓储**

用 `class UserWalletService` 组合 withdrawal repository、balance service 和 payment QR service。`createWithdrawal()` 在事务中依次锁用户、检查 pending、读取当前收款码、创建申请、调用 `debit()`；把部分唯一索引冲突映射为“已有处理中提现申请”。

- [ ] **Step 4: 编写路由失败测试**

测试未登录 401、上传字段名 `qr_code`、非 multipart、超 5 MB、非法 `payment_type`、金额字符串到整数分的严格转换、分页上限和统一响应结构。

Run: `node server/test/test-wallet-routes.js`

Expected: FAIL，提示路由模块不存在。

- [ ] **Step 5: 实现控制器、路由和上传中间件**

Multer 使用 `memoryStorage()` 和 `limits.fileSize = 5 * 1024 * 1024`。金额转换必须先用正则 `/^\d+(\.\d{1,2})?$/` 校验元字符串，再转换成分并检查 `Number.isSafeInteger`，禁止 `parseFloat` 截断。

- [ ] **Step 6: 挂载路由并验证**

Run: `node server/test/test-wallet-service.js`

Run: `node server/test/test-wallet-routes.js`

Expected: 两个脚本均 PASS。

### Task 6: 管理端钱包 API 与最低提现设置

**Files:**
- Create: `server/services/admin/wallet-service.js`
- Create: `server/controllers/admin/wallet-controller.js`
- Create: `server/routes/admin/wallet.js`
- Modify: `server/bootstrap/register-admin-routes.js`
- Modify: `server/services/admin/system-settings-service.js`
- Modify: `server/controllers/admin/system-settings-controller.js`
- Modify: `server/routes/admin/system-settings.js`
- Test: `server/test/test-admin-wallet-service.js`
- Modify: `server/test/test-system-settings-subscription-config.js`
- Modify: `server/test/test-wallet-routes.js`

**Interfaces:**
- Produces routes under `/api/admin/wallets`：`GET /users`、`GET /users/:userId`、`GET /users/:userId/transactions`、`GET /withdrawals/:id/qr`、`POST /withdrawals/:id/complete`、`POST /withdrawals/:id/reject`。
- Produces settings routes: `GET /api/admin/system-settings/withdrawal`、`PUT /api/admin/system-settings/withdrawal`。
- Consumes: Task 2 的 `renderQrPng()`；Task 3 的 `credit()` 和流水分页。

- [ ] **Step 1: 编写管理端处理失败测试**

覆盖用户汇总、累计奖励、详情、二维码 PNG、确认、必须填写驳回原因、驳回退款，以及两名管理员并发确认/驳回只允许一次状态转换且最多一次退款。

```js
const [first, second] = await Promise.allSettled([
  service.rejectWithdrawal(db, 12, { adminId: 1, reason: '信息不符' }),
  service.completeWithdrawal(db, 12, { adminId: 2 })
]);
assert.equal([first, second].filter(item => item.status === 'fulfilled').length, 1);
assert.equal(refundTransactions.length <= 1, true);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node server/test/test-admin-wallet-service.js`

Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 实现管理端服务和路由**

用 `class AdminWalletService` 封装查询与处理。确认使用 `UPDATE ... WHERE status='pending' RETURNING *`；驳回在事务中先锁定申请，再状态转换、调用 `BalanceService.credit()`，退款引用提现申请 ID。二维码响应设置 `Content-Type: image/png`、`Cache-Control: no-store, private`、`Pragma: no-cache`。

- [ ] **Step 4: 扩展最低提现设置测试并确认失败**

覆盖缺失配置返回 2000、保存 2000、0/负数/小数分/超安全整数拒绝，并保证现有系统设置字段不受影响。

Run: `node server/test/test-system-settings-subscription-config.js`

Expected: FAIL，缺少提现设置方法。

- [ ] **Step 5: 实现设置接口并运行后端钱包测试**

Run: `node server/test/test-admin-wallet-service.js`

Run: `node server/test/test-wallet-routes.js`

Run: `node server/test/test-system-settings-subscription-config.js`

Expected: 三个脚本均 PASS。

- [ ] **Step 6: 提交后端提现 API**

```powershell
git add server/repositories/withdrawal-repository.js server/services/user/wallet-service.js server/services/admin/wallet-service.js server/controllers/user/wallet-controller.js server/controllers/admin/wallet-controller.js server/routes/user/wallet.js server/routes/admin/wallet.js server/bootstrap/register-user-routes.js server/bootstrap/register-admin-routes.js server/services/admin/system-settings-service.js server/controllers/admin/system-settings-controller.js server/routes/admin/system-settings.js server/test/test-wallet-service.js server/test/test-admin-wallet-service.js server/test/test-wallet-routes.js server/test/test-system-settings-subscription-config.js
git commit -m "功能：新增用户提现与管理端处理接口"
```

### Task 7: 用户端收款信息卡

**Files:**
- Modify: `client-user/src/api/index.js`
- Modify: `client-user/src/views/user/My.vue`

**Interfaces:**
- Consumes: `GET /wallet/summary`、`PUT /wallet/payment-qr`。
- Produces API: `api.user.getWalletSummary()`、`api.user.savePaymentQr(formData)`。
- Produces: “我的”页第一张卡的收款码选择、上传、保存、余额、奖励和提现入口。

- [ ] **Step 1: 添加 API 方法并实现卡片状态模型**

API 上传必须让浏览器自动生成 multipart boundary，不手工写死 `Content-Type`。在 `My.vue` 增加 `walletSummary`、`paymentType`、`qrFile`、`qrPreviewUrl`、`savingQr` 状态，并在组件卸载或换图时 `URL.revokeObjectURL()`。

```js
savePaymentQr(formData) {
  return apiClient.put('/wallet/payment-qr', formData, { timeout: 20000 })
}
```

- [ ] **Step 2: 替换第一张卡片**

按参考图实现“收款信息”卡，保留当前页面其余推广、我的服务和常用管理卡片。显示余额、奖励总额、当前类型/已设置状态、微信/支付宝选择、上传预览、保存/更换和提现按钮。未设置收款码时提现按钮禁用并显示原因。

- [ ] **Step 3: 实现前端上传校验和错误恢复**

仅允许 PNG/JPEG/WebP 且不超过 5 MB；后端失败时保留用户选择以便重新上传，成功后刷新摘要并清理本地预览。前端提示不能暴露二维码内容。

- [ ] **Step 4: 构建用户端确认无编译错误**

Run: `npm run build`

Workdir: `client-user`

Expected: Vite build 成功，无 Vue 模板或导入错误。

### Task 8: 用户端独立提现与余额明细页

**Files:**
- Create: `client-user/src/views/user/Withdraw.vue`
- Modify: `client-user/src/api/index.js`
- Modify: `client-user/src/router/index.js`
- Modify: `client-user/src/views/user/Layout.vue`

**Interfaces:**
- Consumes: `GET /wallet/withdrawal`、`POST /wallet/withdrawals`、`GET /wallet/transactions`。
- Produces API: `getWithdrawalOverview()`、`createWithdrawal({amount})`、`getBalanceTransactions(params)`。
- Produces route: `/user/withdraw`，name `UserWithdraw`。

- [ ] **Step 1: 注册路由、预加载与 API 方法**

提现请求传递严格的元字符串，由后端转换为分；列表参数包含 `page`、`limit`、`type`、`keyword`。

- [ ] **Step 2: 实现桌面端参考布局**

左侧余额卡显示余额、奖励、最低提现金额、输入框和提交按钮；右侧显示搜索、类型筛选、分页流水表。金额正负采用不同颜色，类型使用中文标签，余额展示固定两位小数。

- [ ] **Step 3: 实现 pending 状态与确认交互**

存在处理中申请时展示金额与状态并禁用再次提交。提交前用 `ElMessageBox.confirm` 中文按钮确认金额和收款方式；成功后同时刷新概览和第一页流水。

- [ ] **Step 4: 实现移动端布局**

小于 768px 时左右布局改为上下布局，流水表改为卡片列表；搜索和筛选控件保持可操作，不依赖横向滚动。

- [ ] **Step 5: 构建用户端**

Run: `npm run build`

Workdir: `client-user`

Expected: PASS。

### Task 9: 管理端余额管理与系统设置页面

**Files:**
- Create: `client-admin/src/views/Wallets.vue`
- Modify: `client-admin/src/api/index.js`
- Modify: `client-admin/src/router/index.js`
- Modify: `client-admin/src/views/Layout.vue`
- Modify: `client-admin/src/views/Settings.vue`

**Interfaces:**
- Consumes: Task 6 的管理端钱包及提现设置接口。
- Produces route: `/admin/wallets`，name `Wallets`。
- Produces API: `getWalletUsers(params)`、`getWalletUserDetail(userId)`、`getWalletTransactions(userId, params)`、`getWithdrawalQr(id)`、`completeWithdrawal(id)`、`rejectWithdrawal(id, reason)`、`getWithdrawalSettings()`、`saveWithdrawalSettings(data)`。

- [ ] **Step 1: 添加 API、菜单和路由**

二维码接口使用 `responseType: 'blob'`，展示后及时释放 Object URL。导航文字使用“余额管理”。

- [ ] **Step 2: 实现用户余额列表**

列表显示邮箱、余额、累计奖励、处理中金额和状态，提供防抖邮箱搜索、分页及“查看详情”操作；移动端复用项目现有卡片列表模式。

- [ ] **Step 3: 实现详情抽屉与流水**

详情抽屉显示用户概览、类型筛选、分页流水和 pending 提现。二维码图片只在抽屉打开且存在 pending 申请时请求，关闭抽屉时清理 blob URL。

- [ ] **Step 4: 实现确认和驳回**

确认使用中文二次确认；驳回使用带非空校验的输入框，成功后刷新用户列表、详情和流水。提交期间禁用两个按钮，避免客户端重复请求，同时以后端状态条件作为最终保护。

- [ ] **Step 5: 扩展系统设置**

新增“最低提现金额”设置卡，单位元，默认 20，使用精度 2 的数值输入；保存时发送规范化两位小数字符串，错误时保留用户输入。

- [ ] **Step 6: 构建管理端**

Run: `npm run build`

Workdir: `client-admin`

Expected: PASS。

- [ ] **Step 7: 提交两端页面**

```powershell
git add client-user/src client-admin/src
git commit -m "功能：新增个人提现与余额管理页面"
```

### Task 10: 全量验证、迁移说明与最终审查

**Files:**
- Modify only if tests reveal a defect in files listed above.

**Interfaces:**
- Consumes: Tasks 1-9 的全部实现。
- Produces: 可交付的测试日志、构建日志和部署提醒。

- [ ] **Step 1: 运行钱包专项后端测试**

Run:

```powershell
node server/test/test-wallet-migration.js
node server/test/test-payment-qr-service.js
node server/test/test-balance-service.js
node server/test/test-wallet-service.js
node server/test/test-admin-wallet-service.js
node server/test/test-wallet-routes.js
```

Expected: 全部 PASS；输出包含迁移幂等、并发防重、加密篡改检测、提现确认和驳回退款用例。

- [ ] **Step 2: 运行受影响业务回归测试**

Run:

```powershell
node server/test/test-referral-service.js
node server/test/test-renew.js
node server/test/test-system-settings-subscription-config.js
node server/test/test-user-payment-service.js
```

Expected: 全部 PASS。

- [ ] **Step 3: 构建两个前端**

Run: `npm run build` in `client-user`

Run: `npm run build` in `client-admin`

Expected: 两个构建均成功。

- [ ] **Step 4: 做静态安全检查**

Run:

```powershell
rg -n "qr_payload|WITHDRAWAL_QR_ENCRYPTION_KEY|console\.(log|error)" server client-user client-admin -g "!**/node_modules/**" -g "!**/dist/**"
git diff --check
git status --short
```

Expected: 无二维码明文日志、无真实密钥、无空白错误；状态只包含本功能预期修改。

- [ ] **Step 5: 核对部署前置条件**

向用户明确提供：

1. 生成 32 字节随机密钥并以 Base64 写入生产环境 `WITHDRAWAL_QR_ENCRYPTION_KEY`。
2. 部署后运行 `node server/db/migrations/019-wallet-withdrawals.js`。
3. 因修改了 `server/**/*.js` 和依赖，执行 `npm install` 后由用户重启服务器。
4. 不在响应中展示或记录真实密钥。

- [ ] **Step 6: 最终审查并按审查结论修正**

检查所有已批准规则均有实现和测试证据：单 pending、提交即扣款、确认不扣款、驳回退款、最低金额设置、无手续费、收款码快照、期初流水、用户端无独立提现历史、管理端无人工调账、移动端布局。

- [ ] **Step 7: 整理最终功能提交**

若验证阶段产生修复，将相关测试与实现合并进对应功能提交或形成一笔清晰的中文修复提交，避免保留零碎“修测试”提交。未经用户确认不得 `git push`。


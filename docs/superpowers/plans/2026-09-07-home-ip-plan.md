# 家宽 IP 套餐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增家宽 IP 套餐类型，让管理员可绑定 `home_proxies.tag`，并让已购买流量套餐的用户购买后单独保存家宽套餐权益。

**Architecture:** 在现有 `plans.plan_type` 上扩展 `home_ip`，给 `plans` 和 `users` 增加附加字段。管理端套餐服务负责家宽套餐校验和展示，支付完成服务按套餐类型分流：流量套餐走原有主套餐逻辑，家宽 IP 套餐只更新 `users.home_plan_id/home_expire_at` 且不触发 3X-UI 同步。

**Tech Stack:** Node.js Express、PostgreSQL、Vue 3、Vite、Element Plus。

**Spec:** `docs/superpowers/specs/2026-09-07-home-ip-plan-design.md`

## Global Constraints

- 未经用户明确指示，禁止创建或切换新分支、禁止创建 Git worktree。
- 家宽 IP 套餐仅支持已购买流量套餐的用户购买。
- 家宽 IP 套餐不限制流量，只限制时间。
- 本次不实现用户面板中的 3X-UI routing 绑定操作。
- 本次不自动修改 3X-UI routing 规则。
- 修改 `server/**/*.js` 后，完成时提醒用户重启后端服务。
- 前端构建使用 `cd client-admin && npx vite build --minify esbuild`。

---

## File Structure

- Modify `server/services/shared/plan-type.js`: 增加 `home_ip` 类型、类型归一化、判断函数和时长校验。
- Modify `server/db/schema/tables.js`: 新部署表结构包含 `plans.home_proxy_tag`、`users.home_plan_id`、`users.home_expire_at`。
- Create `server/db/migrations/028-home-ip-plan.js`: 幂等迁移新增字段。
- Modify `server/repositories/plans-repository.js`: 管理端套餐 CRUD 读写 `home_proxy_tag`。
- Modify `server/repositories/plan-repository.js`: 用户端套餐列表和续费列表读出 `home_proxy_tag`，支持查询家宽套餐。
- Modify `server/services/admin/plans-service.js`: 管理端家宽套餐校验、格式化和 `tag` 关联校验。
- Modify `server/services/user/plans-service.js`: 用户端套餐展示新增家宽字段和流量文案。
- Modify `server/services/user/renew-service.js`: 允许已有主套餐用户购买家宽套餐，禁止无主套餐用户购买。
- Modify `server/services/user/auth-service.js`: 注册首单禁止家宽 IP 套餐。
- Modify `server/repositories/order-repository.js`: 支付上下文读取和写入用户家宽权益。
- Modify `server/services/shared/order-service.js`: 支付完成时按 `home_ip` 分流，不触发 3X-UI 同步。
- Modify `client-admin/src/views/Plans.vue`: 管理端套餐表单和列表支持家宽类型与 tag。
- Test `server/test/test-home-ip-plan.js`: 覆盖服务层关键规则。

---

### Task 1: 数据模型与套餐类型基础

**Files:**
- Modify: `server/services/shared/plan-type.js`
- Modify: `server/db/schema/tables.js`
- Create: `server/db/migrations/028-home-ip-plan.js`
- Modify: `server/repositories/plans-repository.js`
- Modify: `server/repositories/plan-repository.js`
- Test: `server/test/test-home-ip-plan.js`

**Interfaces:**
- Produces: `PLAN_TYPES.HOME_IP = 'home_ip'`
- Produces: `isHomeIpPlan(plan): boolean`
- Produces: `validatePlanDuration(plan)` 支持 `home_ip` 必须 `duration_days > 0`
- Produces: `plans.home_proxy_tag`
- Produces: `users.home_plan_id`
- Produces: `users.home_expire_at`

- [ ] **Step 1: 写失败测试，覆盖套餐类型归一化与家宽时长规则**

Add to `server/test/test-home-ip-plan.js`:

```javascript
const assert = require('assert');
const {
  PLAN_TYPES,
  normalizePlanType,
  isHomeIpPlan,
  validatePlanDuration
} = require('../services/shared/plan-type');

function testHomeIpPlanTypeHelpers() {
  assert.strictEqual(PLAN_TYPES.HOME_IP, 'home_ip');
  assert.strictEqual(normalizePlanType('home_ip'), 'home_ip');
  assert.strictEqual(isHomeIpPlan({ plan_type: 'home_ip' }), true);
  assert.strictEqual(isHomeIpPlan({ plan_type: 'timed' }), false);
  assert.deepStrictEqual(validatePlanDuration({ plan_type: 'home_ip', duration_days: 30 }), { valid: true });
  assert.strictEqual(validatePlanDuration({ plan_type: 'home_ip', duration_days: 0 }).valid, false);
}

async function main() {
  testHomeIpPlanTypeHelpers();
  console.log('家宽 IP 套餐类型辅助函数测试通过');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-home-ip-plan.js`

Expected: FAIL，错误包含 `HOME_IP` 或 `isHomeIpPlan` 未定义。

- [ ] **Step 3: 实现 `plan-type.js`**

Update `PLAN_TYPES`:

```javascript
const PLAN_TYPES = {
  LIFETIME: 'lifetime',
  TIMED: 'timed',
  HOME_IP: 'home_ip'
};
```

Update `normalizePlanType`:

```javascript
function normalizePlanType(value) {
  if (value === PLAN_TYPES.TIMED) return PLAN_TYPES.TIMED;
  if (value === PLAN_TYPES.HOME_IP) return PLAN_TYPES.HOME_IP;
  return PLAN_TYPES.LIFETIME;
}
```

Add:

```javascript
function isHomeIpPlan(plan) {
  return normalizePlanType(plan?.plan_type) === PLAN_TYPES.HOME_IP;
}
```

Update `validatePlanDuration` before the lifetime branch:

```javascript
if (planType === PLAN_TYPES.HOME_IP && (!Number.isFinite(durationDays) || durationDays <= 0)) {
  return {
    valid: false,
    message: '家宽 IP 套餐的有效天数必须大于 0'
  };
}
```

Export `isHomeIpPlan`.

- [ ] **Step 4: 增加表结构字段**

In `server/db/schema/tables.js` users table add:

```sql
home_plan_id INTEGER,
home_expire_at BIGINT,
```

In plans table add:

```sql
home_proxy_tag VARCHAR(255),
```

- [ ] **Step 5: 新增幂等迁移脚本**

Create `server/db/migrations/028-home-ip-plan.js`:

```javascript
/**
 * 数据库迁移脚本 028-home-ip-plan
 * 职责：为家宽 IP 套餐补充套餐 tag 字段和用户家宽套餐权益字段。
 * 关键参数：无，直接使用本地数据库配置。
 * 核心分支：所有 ALTER TABLE 使用 IF NOT EXISTS，重复执行不会破坏已有数据。
 */

const db = require('../init');

async function migrate() {
  try {
    console.log('=== 迁移 028: home-ip-plan ===\n');

    console.log('[1/3] 检查 plans.home_proxy_tag 字段...');
    await db.exec(`
      ALTER TABLE plans
      ADD COLUMN IF NOT EXISTS home_proxy_tag VARCHAR(255)
    `);
    console.log('  plans.home_proxy_tag 已就绪');

    console.log('\n[2/3] 检查 users.home_plan_id 字段...');
    await db.exec(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS home_plan_id INTEGER
    `);
    console.log('  users.home_plan_id 已就绪');

    console.log('\n[3/3] 检查 users.home_expire_at 字段...');
    await db.exec(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS home_expire_at BIGINT
    `);
    console.log('  users.home_expire_at 已就绪');

    console.log('\n迁移完成');
  } catch (error) {
    console.error('迁移失败:', error);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

migrate();
```

- [ ] **Step 6: 仓储查询和写入包含 `home_proxy_tag`**

Update `server/repositories/plans-repository.js`:

```javascript
const { homeProxyTag } = payload;

INSERT INTO plans (name, description, price, duration_days, traffic_limit, plan_type, home_proxy_tag, show_on_home, sort_order, enabled, sales_limit)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

Run with `homeProxyTag` between `planType` and `showOnHome`.

Update dynamic field support:

```javascript
if (payload.home_proxy_tag !== undefined) {
  updates.push('home_proxy_tag = ?');
  values.push(payload.home_proxy_tag);
}
```

Update `server/repositories/plan-repository.js` SELECT lists to include `home_proxy_tag`.

- [ ] **Step 7: 运行测试确认通过**

Run: `node server/test/test-home-ip-plan.js`

Expected: PASS，输出 `家宽 IP 套餐类型辅助函数测试通过`。

---

### Task 2: 管理端套餐服务和 UI

**Files:**
- Modify: `server/services/admin/plans-service.js`
- Modify: `server/routes/admin/plans.js`
- Modify: `client-admin/src/api/index.js` only if home proxy list method is missing
- Modify: `client-admin/src/views/Plans.vue`
- Test: `server/test/test-home-ip-plan.js`

**Interfaces:**
- Consumes: `PLAN_TYPES.HOME_IP`
- Consumes: `plans.home_proxy_tag`
- Produces: 管理端套餐响应字段 `home_proxy_tag`

- [ ] **Step 1: 写失败测试，覆盖管理端家宽套餐创建校验**

Append to `server/test/test-home-ip-plan.js`:

```javascript
const plansService = require('../services/admin/plans-service');

function createMockDb() {
  const homeProxies = [{ id: 1, tag: 'home-lax' }];
  const plans = [];
  return {
    prepare(sql) {
      return {
        all(...params) {
          if (sql.includes('FROM plans')) return plans;
          return [];
        },
        get(...params) {
          if (sql.includes('FROM home_proxies WHERE tag')) {
            return homeProxies.find((item) => item.tag === params[0]);
          }
          if (sql.includes('SELECT * FROM plans WHERE id')) {
            return plans.find((item) => Number(item.id) === Number(params[0]));
          }
          return undefined;
        },
        run(...params) {
          if (sql.includes('INSERT INTO plans')) {
            const plan = {
              id: plans.length + 1,
              name: params[0],
              description: params[1],
              price: params[2],
              duration_days: params[3],
              traffic_limit: params[4],
              plan_type: params[5],
              home_proxy_tag: params[6],
              show_on_home: params[7],
              sort_order: params[8],
              enabled: params[9],
              sales_limit: params[10],
              sales_count: 0
            };
            plans.push(plan);
            return { lastInsertRowid: plan.id, changes: 1 };
          }
          return { changes: 1 };
        }
      };
    }
  };
}

async function testAdminCreateHomeIpPlan() {
  const db = createMockDb();
  const plan = await plansService.createPlan(db, {
    name: '洛杉矶家宽 IP',
    description: '30 天家宽 IP',
    price: 9900,
    plan_type: 'home_ip',
    duration_days: 30,
    traffic_limit: 999,
    home_proxy_tag: 'home-lax',
    show_on_home: true,
    enabled: true,
    sales_limit: 1
  });

  assert.strictEqual(plan.plan_type, 'home_ip');
  assert.strictEqual(plan.traffic_limit, 0);
  assert.strictEqual(plan.home_proxy_tag, 'home-lax');
}
```

Call `await testAdminCreateHomeIpPlan();` in `main`.

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-home-ip-plan.js`

Expected: FAIL，`home_ip` 被旧归一化逻辑或 `home_proxy_tag` 未输出。

- [ ] **Step 3: 更新管理端套餐服务**

In `plans-service.js` import `isHomeIpPlan` and add:

```javascript
function getPlanTypeText(planType) {
  const normalized = normalizePlanType(planType);
  if (normalized === PLAN_TYPES.HOME_IP) return '家宽IP套餐';
  return normalized === PLAN_TYPES.TIMED ? '限时套餐' : '不限时套餐';
}

function normalizeHomeProxyTag(value) {
  return String(value || '').trim();
}

async function validateHomeIpPlan(db, plan) {
  if (!isHomeIpPlan(plan)) {
    return null;
  }

  const tag = normalizeHomeProxyTag(plan.home_proxy_tag);
  if (!tag) {
    throw createLegacyBusinessError('家宽 IP 套餐必须绑定 tag');
  }

  const homeProxy = await db.prepare('SELECT * FROM home_proxies WHERE tag = ?').get(tag);
  if (!homeProxy) {
    throw createLegacyBusinessError('绑定的家宽 IP tag 不存在');
  }

  return tag;
}
```

Before create:

```javascript
const homeProxyTag = await validateHomeIpPlan(db, {
  plan_type: normalizedPlanType,
  home_proxy_tag: payload.home_proxy_tag
});
const trafficLimit = normalizedPlanType === PLAN_TYPES.HOME_IP ? 0 : payload.traffic_limit;
```

Before update build next plan and validate:

```javascript
const homeProxyTag = await validateHomeIpPlan(db, nextPlan);
```

When non-home plan:

```javascript
const nextHomeProxyTag = normalizedPlanType === PLAN_TYPES.HOME_IP ? homeProxyTag : null;
```

Format output:

```javascript
home_proxy_tag: plan.home_proxy_tag || ''
```

- [ ] **Step 4: 更新路由校验**

In `server/routes/admin/plans.js`, extend `plan_type` validation to allow `home_ip` and allow `home_proxy_tag` as optional string.

- [ ] **Step 5: 更新管理端 UI 表单**

In `client-admin/src/views/Plans.vue`:

Add table column:

```vue
<el-table-column label="家宽 tag" min-width="140">
  <template #default="scope">
    {{ scope.row.plan_type === 'home_ip' ? (scope.row.home_proxy_tag || '-') : '-' }}
  </template>
</el-table-column>
```

Update type buttons:

```vue
<el-radio-button label="home_ip">家宽IP套餐</el-radio-button>
```

Add conditional tag field:

```vue
<el-form-item v-if="planForm.plan_type === 'home_ip'" label="家宽 tag" prop="home_proxy_tag">
  <el-input v-model="planForm.home_proxy_tag" placeholder="请输入家宽 IP 管理中的 tag" />
</el-form-item>
```

Hide traffic input:

```vue
<el-form-item v-if="planForm.plan_type !== 'home_ip'" label="流量上限" prop="traffic_limit">
```

Update form model:

```javascript
home_proxy_tag: ''
```

Update watchers and submit:

```javascript
if (planForm.plan_type === 'home_ip') {
  planForm.traffic_limit = 0;
  if (Number(planForm.duration_days) <= 0) planForm.duration_days = 30;
}
```

- [ ] **Step 6: 运行后端测试和管理端构建**

Run: `node server/test/test-home-ip-plan.js`

Expected: PASS。

Run: `cd client-admin && npx vite build --minify esbuild`

Expected: build completes without errors.

---

### Task 3: 已登录用户购买家宽 IP 套餐

**Files:**
- Modify: `server/services/user/auth-service.js`
- Modify: `server/services/user/renew-service.js`
- Modify: `server/services/user/plans-service.js`
- Modify: `server/repositories/order-repository.js`
- Modify: `server/services/shared/order-service.js`
- Test: `server/test/test-home-ip-plan.js`

**Interfaces:**
- Consumes: `isHomeIpPlan(plan)`
- Produces: `orderRepository.updateUserHomePlanAfterPaidOrder(db, payload)`
- Produces: `calculatePaidOrderEntitlement(order, plan, now)` for home IP returns `{ homePlanId, homeExpireAt, isHomeIp: true }`

- [ ] **Step 1: 写失败测试，覆盖家宽权益时间计算**

Append to `server/test/test-home-ip-plan.js`:

```javascript
const orderService = require('../services/shared/order-service');

function testHomeIpPaidOrderEntitlement() {
  const now = 2000;
  const plan = { id: 9, plan_type: 'home_ip', duration_days: 30, traffic_limit: 0 };
  const expiredOrder = { out_trade_no: 'REN001', current_home_expire_at: 1000 };
  const activeOrder = { out_trade_no: 'REN002', current_home_expire_at: 3000 };

  const expiredEntitlement = orderService.calculatePaidOrderEntitlement(expiredOrder, plan, now);
  assert.strictEqual(expiredEntitlement.isHomeIp, true);
  assert.strictEqual(expiredEntitlement.homePlanId, 9);
  assert.strictEqual(expiredEntitlement.homeExpireAt, 2000 + 30 * 86400);

  const activeEntitlement = orderService.calculatePaidOrderEntitlement(activeOrder, plan, now);
  assert.strictEqual(activeEntitlement.homeExpireAt, 3000 + 30 * 86400);
}
```

Call `testHomeIpPaidOrderEntitlement();` in `main`.

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-home-ip-plan.js`

Expected: FAIL，`isHomeIp` 或 `homeExpireAt` 未实现。

- [ ] **Step 3: 注册首单禁止家宽 IP 套餐**

In `server/services/user/auth-service.js`, after loading selected plan:

```javascript
if (isHomeIpPlan(plan)) {
  throw createLegacyBusinessError('家宽 IP 套餐仅支持已购买流量套餐的用户购买', {
    code: 1004
  });
}
```

Import `isHomeIpPlan`.

- [ ] **Step 4: 续费接口允许家宽 IP 附加购买**

In `server/services/user/renew-service.js`:

```javascript
if (isHomeIpPlan(plan)) {
  if (!user.plan_id) {
    throw createLegacyBusinessError('请先购买流量套餐后再购买家宽 IP 套餐', { code: 2004 });
  }
} else {
  const currentPlanType = normalizePlanType(currentPlan.plan_type);
  const targetPlanType = normalizePlanType(plan.plan_type);
  if (currentPlanType !== targetPlanType) {
    throw createLegacyBusinessError('不能跨套餐类型续费，请选择当前套餐类型下的套餐', { code: 1003 });
  }
}
```

Import `isHomeIpPlan`.

Update `listRenewPlans` to include current主套餐类型 plans plus `home_ip` plans:

```javascript
const plans = [
  ...await planRepository.findEnabledPlansByType(db, currentPlanType),
  ...await planRepository.findEnabledPlansByType(db, PLAN_TYPES.HOME_IP)
];
```

- [ ] **Step 5: 支付上下文读取家宽字段**

In `order-repository.js` SELECT add:

```sql
u.home_plan_id as current_home_plan_id,
u.home_expire_at as current_home_expire_at,
```

Add function:

```javascript
/**
 * 写入支付完成后的家宽 IP 附加套餐权益。
 * @param {Object} db - 数据库代理对象
 * @param {{userId:number,homePlanId:number,homeExpireAt:number,updatedAt:number}} payload - 家宽权益数据
 * @returns {Promise<void>}
 */
async function updateUserHomePlanAfterPaidOrder(db, payload) {
  await db.prepare(`
    UPDATE users SET
      home_plan_id = ?,
      home_expire_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(payload.homePlanId, payload.homeExpireAt, payload.updatedAt, payload.userId);
}
```

Export it.

- [ ] **Step 6: 支付完成按家宽套餐分流**

In `order-service.js` import `isHomeIpPlan`.

Update `calculatePaidOrderEntitlement` top:

```javascript
if (isHomeIpPlan(plan)) {
  const currentHomeExpireAt = Number(order.current_home_expire_at || 0);
  const baseExpireAt = currentHomeExpireAt > now ? currentHomeExpireAt : now;
  return {
    isHomeIp: true,
    homePlanId: plan.id,
    homeExpireAt: baseExpireAt + (Number(plan.duration_days) * 24 * 60 * 60),
    resetTrafficUsed: false,
    resetClientTraffic: false
  };
}
```

In `completePaidOrder`, after entitlement:

```javascript
if (entitlement.isHomeIp) {
  const transaction = db.transaction(async (transactionDb) => {
    await orderRepository.markOrderPaid(transactionDb, {
      outTradeNo,
      tradeNo: finalTradeNo,
      paidAt: now
    });

    await orderRepository.updateUserHomePlanAfterPaidOrder(transactionDb, {
      userId: order.user_id,
      homePlanId: entitlement.homePlanId,
      homeExpireAt: entitlement.homeExpireAt,
      updatedAt: now
    });

    await orderRepository.incrementPlanSalesCount(transactionDb, plan.id);
  });

  await transaction();
  return { handled: true, alreadyPaid: false, order, plan, expireAt: entitlement.homeExpireAt };
}
```

Ensure this branch returns before creating any XUI sync task.

- [ ] **Step 7: 用户套餐列表输出家宽 tag 和流量文案基础字段**

In `server/services/user/plans-service.js` and `renew-service.js` formatters add:

```javascript
home_proxy_tag: plan.home_proxy_tag || '',
traffic_text: isHomeIpPlan(plan) ? '不限制流量' : formatTraffic(plan.traffic_limit),
```

- [ ] **Step 8: 运行后端测试**

Run: `node server/test/test-home-ip-plan.js`

Expected: PASS，输出包含家宽测试通过日志。

---

### Task 4: 最终验证和整理

**Files:**
- Modify only files touched by Tasks 1-3 if verification reveals issues.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: passing backend test log and admin frontend build log.

- [ ] **Step 1: 运行后端家宽 IP 套餐测试**

Run: `node server/test/test-home-ip-plan.js`

Expected: PASS。

- [ ] **Step 2: 运行管理端构建**

Run: `cd client-admin && npx vite build --minify esbuild`

Expected: PASS。

- [ ] **Step 3: 查看变更**

Run: `git diff --stat`

Expected: 只包含本需求相关文件。

- [ ] **Step 4: 提交实现**

Run:

```bash
git add server client-admin
git commit -m "feat: 添加家宽 IP 套餐"
```

Expected: 生成一笔中文提交，包含功能实现和测试。

- [ ] **Step 5: 完成说明**

最终回复包含：

- 变更摘要。
- 测试命令和关键日志。
- 迁移脚本路径和执行命令 `node server/db/migrations/028-home-ip-plan.js`。
- 提醒修改了 `server/**/*.js`，需要重启后端服务。

---

## Self-Review

- Spec coverage: 已覆盖数据库字段、管理端录入、注册首单禁止、已登录购买、支付完成分流、验证要求。
- Placeholder scan: 未发现占位词、未完成标记或空泛步骤。
- Type consistency: `home_ip`、`home_proxy_tag`、`home_plan_id`、`home_expire_at` 在任务间命名一致。

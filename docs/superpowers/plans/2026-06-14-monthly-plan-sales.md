# Monthly Plan Sales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增月卡等限时套餐销售能力，同时保证现有不限时套餐的购买、续费、流量累加、到期和 3X-UI 同步逻辑不被改变。

**Architecture:** 在 `plans` 表显式增加套餐类型和首页展示开关，用独立的续费套餐接口按当前用户套餐类型过滤。支付成功处理按 `plan_type` 分支：`lifetime` 继续走现有累加逻辑，`timed` 才进入流量与时间重置逻辑；到期禁用作为新增路径复用现有 3X-UI 状态同步队列。

**Tech Stack:** Node.js Express, PostgreSQL, Vue 3, Vite, Element Plus, 3X-UI integration.

---

## File Map

- Create: `server/services/shared/plan-type.js`
  套餐类型常量、归一化、展示文案和限时套餐续费重置预览函数。
- Create: `server/db/migrations/017-plan-type-home-visibility.js`
  幂等迁移 `plans.plan_type`、`plans.show_on_home`。
- Modify: `server/db/schema/tables.js`
  新库初始化时带上两个新字段。
- Modify: `server/repositories/plan-repository.js`
  首页套餐只查 `show_on_home = 1`，并新增按类型查续费套餐。
- Modify: `server/repositories/plans-repository.js`
  管理端套餐 CRUD 读写 `plan_type`、`show_on_home`。
- Modify: `server/services/admin/plans-service.js`
  管理端格式化和校验套餐类型。
- Modify: `server/routes/admin/plans.js`
  管理端参数校验新增 `plan_type`、`show_on_home`。
- Modify: `server/services/user/plans-service.js`
  首页套餐格式化返回 `plan_type` 和 `show_on_home`。
- Modify: `server/controllers/user/plans-controller.js`
  保持首页接口响应结构。
- Modify: `server/routes/user/renew.js`
  新增 `GET /api/user/renew/plans`，`POST /api/user/renew` 增加 `confirm_reset`。
- Modify: `server/controllers/user/renew-controller.js`
  新增续费套餐列表控制器。
- Modify: `server/services/user/renew-service.js`
  续费套餐过滤、类型一致性、限时套餐重置确认。
- Modify: `server/services/shared/renew-policy.js`
  新增 `expired` 禁用原因，允许到期用户续费。
- Modify: `server/repositories/order-repository.js`
  支付成功上下文增加当前已用流量、当前套餐类型；用户权益更新支持限时套餐重置 `traffic_used`。
- Modify: `server/services/shared/order-service.js`
  支付成功按 `plan_type` 分支处理；不限时套餐保持现有累加。
- Modify: `server/repositories/traffic-repository.js`
  新增到期禁用用户查询和写入。
- Modify: `server/services/shared/traffic-manager.js`
  增加到期禁用检查，复用现有状态同步队列。
- Modify: `server/repositories/user-repository.js`
  用户资料查询带 `plan_type`，订阅和登录所需查询保留兼容。
- Modify: `server/services/user/auth-service.js`
  用户端状态展示支持 `expired`，到期禁用用户可登录续费。
- Modify: `server/repositories/subscription-repository.js`
  订阅查询带 `plan_type`。
- Modify: `server/services/user/subscription-service.js`
  已到期限时套餐拒绝继续返回节点内容。
- Modify: `client-admin/src/views/Plans.vue`
  套餐类型和首页展示开关。
- Modify: `client-user/src/api/index.js`
  新增续费套餐接口和 `confirm_reset` 提交字段说明。
- Modify: `client-user/src/components/RenewDialog.vue`
  调用续费套餐接口，并给限时套餐未用完续费增加确认弹窗。
- Modify: `client-user/src/views/user/Profile.vue`
  续费提交透传 `confirm_reset`，处理后端要求确认的响应。
- Test: `server/test/test-monthly-plan-sales.js`
  覆盖套餐过滤、续费确认、限时重置、不限时不变、到期禁用。

---

### Task 1: 套餐类型常量和数据库迁移

**Files:**
- Create: `server/services/shared/plan-type.js`
- Create: `server/db/migrations/017-plan-type-home-visibility.js`
- Modify: `server/db/schema/tables.js`
- Test: `server/test/test-monthly-plan-sales.js`

- [ ] **Step 1: 写失败测试覆盖套餐类型辅助函数**

Create `server/test/test-monthly-plan-sales.js`:

```javascript
const assert = require('assert');
const { test } = require('node:test');

const {
  PLAN_TYPES,
  normalizePlanType,
  isLifetimePlan,
  isTimedPlan,
  validatePlanDuration,
  buildTimedRenewResetPreview
} = require('../services/shared/plan-type');

test('plan type helpers normalize old records to lifetime', () => {
  assert.equal(normalizePlanType(null), PLAN_TYPES.LIFETIME);
  assert.equal(normalizePlanType(''), PLAN_TYPES.LIFETIME);
  assert.equal(normalizePlanType('timed'), PLAN_TYPES.TIMED);
  assert.equal(isLifetimePlan({ plan_type: null }), true);
  assert.equal(isTimedPlan({ plan_type: 'timed' }), true);
});

test('plan duration validation protects lifetime and timed semantics', () => {
  assert.deepEqual(validatePlanDuration({ plan_type: 'lifetime', duration_days: 0 }), {
    valid: true
  });
  assert.deepEqual(validatePlanDuration({ plan_type: 'lifetime', duration_days: 30 }), {
    valid: false,
    message: '不限时套餐的有效天数必须为 0'
  });
  assert.deepEqual(validatePlanDuration({ plan_type: 'timed', duration_days: 30 }), {
    valid: true
  });
  assert.deepEqual(validatePlanDuration({ plan_type: 'timed', duration_days: 0 }), {
    valid: false,
    message: '限时套餐的有效天数必须大于 0'
  });
});

test('timed renew preview reports remaining traffic and time', () => {
  const preview = buildTimedRenewResetPreview(
    {
      traffic_used: 3 * 1024,
      traffic_limit: 10 * 1024,
      expire_at: 1700003600
    },
    {
      traffic_limit: 20 * 1024,
      duration_days: 30
    },
    1700000000
  );

  assert.equal(preview.requires_confirm, true);
  assert.equal(preview.remaining_traffic, 7 * 1024);
  assert.equal(preview.remaining_seconds, 3600);
  assert.equal(preview.reset_traffic_limit, 20 * 1024);
  assert.equal(preview.reset_expire_at, 1702592000);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-monthly-plan-sales.js`

Expected: FAIL，报错包含 `Cannot find module '../services/shared/plan-type'`。

- [ ] **Step 3: 新增套餐类型辅助模块**

Create `server/services/shared/plan-type.js`:

```javascript
/**
 * 套餐类型辅助模块。
 * 职责：统一 plan_type 取值、限时/不限时判断、套餐天数校验和限时续费重置预览。
 */

const { formatTraffic } = require('../../shared/utils/format-traffic');

const PLAN_TYPES = {
  LIFETIME: 'lifetime',
  TIMED: 'timed'
};

function normalizePlanType(value) {
  return value === PLAN_TYPES.TIMED ? PLAN_TYPES.TIMED : PLAN_TYPES.LIFETIME;
}

function isLifetimePlan(plan) {
  return normalizePlanType(plan?.plan_type) === PLAN_TYPES.LIFETIME;
}

function isTimedPlan(plan) {
  return normalizePlanType(plan?.plan_type) === PLAN_TYPES.TIMED;
}

function validatePlanDuration(plan) {
  const planType = normalizePlanType(plan?.plan_type);
  const durationDays = Number(plan?.duration_days || 0);

  if (planType === PLAN_TYPES.LIFETIME && durationDays !== 0) {
    return {
      valid: false,
      message: '不限时套餐的有效天数必须为 0'
    };
  }

  if (planType === PLAN_TYPES.TIMED && durationDays <= 0) {
    return {
      valid: false,
      message: '限时套餐的有效天数必须大于 0'
    };
  }

  return { valid: true };
}

function buildTimedRenewResetPreview(user, plan, now = Math.floor(Date.now() / 1000)) {
  const trafficUsed = Number(user?.traffic_used || 0);
  const trafficLimit = Number(user?.traffic_limit || 0);
  const expireAt = Number(user?.expire_at || 0);
  const remainingTraffic = Math.max(0, trafficLimit - trafficUsed);
  const remainingSeconds = expireAt > now ? expireAt - now : 0;
  const resetTrafficLimit = Number(plan?.traffic_limit || 0);
  const durationSeconds = Number(plan?.duration_days || 0) * 24 * 60 * 60;
  const resetExpireAt = now + durationSeconds;

  return {
    requires_confirm: remainingTraffic > 0 && remainingSeconds > 0,
    remaining_traffic: remainingTraffic,
    remaining_traffic_text: formatTraffic(remainingTraffic),
    remaining_seconds: remainingSeconds,
    reset_traffic_limit: resetTrafficLimit,
    reset_traffic_limit_text: formatTraffic(resetTrafficLimit),
    reset_expire_at: resetExpireAt
  };
}

module.exports = {
  PLAN_TYPES,
  normalizePlanType,
  isLifetimePlan,
  isTimedPlan,
  validatePlanDuration,
  buildTimedRenewResetPreview
};
```

- [ ] **Step 4: 新增幂等迁移脚本**

Create `server/db/migrations/017-plan-type-home-visibility.js`:

```javascript
/**
 * 数据库迁移脚本 017-plan-type-home-visibility
 *
 * 变更内容：
 * 1. plans 表新增 plan_type 字段，默认 lifetime。
 * 2. plans 表新增 show_on_home 字段，默认 1。
 * 3. 历史套餐统一回填为 lifetime，避免改变现有不限时套餐逻辑。
 *
 * 使用方法：node server/db/migrations/017-plan-type-home-visibility.js
 */

const { Pool } = require('pg');
const config = require('../../config');

async function migrate() {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database
  });

  const client = await pool.connect();

  try {
    console.log('=== 迁移 017: plan-type-home-visibility ===\n');

    await client.query('BEGIN');

    console.log('[1/3] 检查 plans.plan_type 字段...');
    await client.query(`
      ALTER TABLE plans
      ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20) DEFAULT 'lifetime'
    `);
    await client.query(`
      UPDATE plans
      SET plan_type = 'lifetime'
      WHERE plan_type IS NULL OR plan_type = ''
    `);
    console.log('  plan_type 字段已就绪');

    console.log('\n[2/3] 检查 plans.show_on_home 字段...');
    await client.query(`
      ALTER TABLE plans
      ADD COLUMN IF NOT EXISTS show_on_home INTEGER DEFAULT 1
    `);
    await client.query(`
      UPDATE plans
      SET show_on_home = 1
      WHERE show_on_home IS NULL
    `);
    console.log('  show_on_home 字段已就绪');

    console.log('\n[3/3] 验证套餐类型统计...');
    const summary = await client.query(`
      SELECT plan_type, show_on_home, COUNT(*) AS count
      FROM plans
      GROUP BY plan_type, show_on_home
      ORDER BY plan_type, show_on_home
    `);

    for (const row of summary.rows) {
      console.log(`  plan_type=${row.plan_type}, show_on_home=${row.show_on_home}: ${row.count}`);
    }

    await client.query('COMMIT');
    console.log('\n=== 迁移完成 ===');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n迁移失败:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().then(() => {
  console.log('\n脚本执行成功');
  process.exit(0);
}).catch(error => {
  console.error('\n脚本执行失败:', error);
  process.exit(1);
});
```

- [ ] **Step 5: 更新新库表结构**

Modify `server/db/schema/tables.js` in the `plans` table definition:

```javascript
      CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price INTEGER NOT NULL,
        duration_days INTEGER NOT NULL,
        traffic_limit BIGINT NOT NULL,
        plan_type VARCHAR(20) DEFAULT 'lifetime',
        show_on_home INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        sales_limit INTEGER DEFAULT -1,
        sales_count INTEGER DEFAULT 0,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
```

- [ ] **Step 6: 运行测试确认辅助函数通过**

Run: `node server/test/test-monthly-plan-sales.js`

Expected: PASS，输出 node:test 的通过结果。

- [ ] **Step 7: 提交迁移与辅助模块**

```bash
git add server/services/shared/plan-type.js server/db/migrations/017-plan-type-home-visibility.js server/db/schema/tables.js server/test/test-monthly-plan-sales.js
git commit -m "feat: 增加套餐类型和首页展示字段"
```

---

### Task 2: 管理端套餐 CRUD 支持套餐类型和首页展示

**Files:**
- Modify: `server/repositories/plans-repository.js`
- Modify: `server/services/admin/plans-service.js`
- Modify: `server/routes/admin/plans.js`
- Test: `server/test/test-monthly-plan-sales.js`

- [ ] **Step 1: 写失败测试覆盖管理端套餐格式化和校验**

Append to `server/test/test-monthly-plan-sales.js`:

```javascript
test('admin plan service formats plan type and show on home', async () => {
  const plansService = require('../services/admin/plans-service');
  const db = {
    prepare(sql) {
      return {
        all() {
          assert.match(sql, /SELECT \*/);
          return [{
            id: 1,
            name: '月卡',
            description: '',
            price: 990,
            duration_days: 30,
            traffic_limit: 1024,
            plan_type: 'timed',
            show_on_home: 1,
            sort_order: 0,
            enabled: 1,
            sales_limit: -1,
            sales_count: 0,
            updated_at: 1700000000,
            created_at: 1700000000
          }];
        }
      };
    }
  };

  const result = await plansService.listPlans(db);
  assert.equal(result.list[0].plan_type, 'timed');
  assert.equal(result.list[0].plan_type_text, '限时套餐');
  assert.equal(result.list[0].show_on_home, 1);
});

test('admin plan service rejects lifetime plans with duration days', async () => {
  const plansService = require('../services/admin/plans-service');
  await assert.rejects(
    () => plansService.createPlan({}, {
      name: '不限时套餐',
      price: 1000,
      duration_days: 30,
      traffic_limit: 1024,
      plan_type: 'lifetime',
      show_on_home: 0
    }),
    /不限时套餐的有效天数必须为 0/
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-monthly-plan-sales.js`

Expected: FAIL，`plan_type_text` 或校验断言失败。

- [ ] **Step 3: 更新管理端仓储读写字段**

Modify `server/repositories/plans-repository.js`.

Replace `createPlan()` payload destructuring and INSERT:

```javascript
  const {
    name,
    description,
    price,
    durationDays,
    trafficLimit,
    planType,
    showOnHome,
    sortOrder,
    enabled,
    salesLimit
  } = payload;

  return db.prepare(`
    INSERT INTO plans (name, description, price, duration_days, traffic_limit, plan_type, show_on_home, sort_order, enabled, sales_limit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    description,
    price,
    durationDays,
    trafficLimit,
    planType,
    showOnHome,
    sortOrder,
    enabled,
    salesLimit
  );
```

Keep `listPlans()` and `findPlanById()` as `SELECT *` so new fields are returned automatically.

- [ ] **Step 4: 更新管理端服务格式化和校验**

Modify `server/services/admin/plans-service.js`.

Add import:

```javascript
const {
  PLAN_TYPES,
  normalizePlanType,
  validatePlanDuration
} = require('../shared/plan-type');
```

Add helper:

```javascript
function getPlanTypeText(planType) {
  return normalizePlanType(planType) === PLAN_TYPES.TIMED ? '限时套餐' : '不限时套餐';
}
```

Modify `formatPlan(plan)` return object to include:

```javascript
    plan_type: normalizePlanType(plan.plan_type),
    plan_type_text: getPlanTypeText(plan.plan_type),
    show_on_home: plan.show_on_home === undefined ? 1 : Number(plan.show_on_home),
```

In `createPlan(db, payload)`, before repository call:

```javascript
  const normalizedPlanType = normalizePlanType(payload.plan_type);
  const durationCheck = validatePlanDuration({
    plan_type: normalizedPlanType,
    duration_days: payload.duration_days
  });

  if (!durationCheck.valid) {
    throw createLegacyBusinessError(durationCheck.message);
  }
```

Then pass:

```javascript
    planType: normalizedPlanType,
    showOnHome: payload.show_on_home === undefined ? 1 : (payload.show_on_home ? 1 : 0),
```

In `updatePlan(db, planId, payload)`, compute the next plan snapshot before validation:

```javascript
  const nextPlan = {
    ...existingPlan,
    plan_type: payload.plan_type === undefined ? existingPlan.plan_type : normalizePlanType(payload.plan_type),
    duration_days: payload.duration_days === undefined ? existingPlan.duration_days : payload.duration_days
  };
  const durationCheck = validatePlanDuration(nextPlan);
  if (!durationCheck.valid) {
    throw createLegacyBusinessError(durationCheck.message);
  }
```

Add update branches:

```javascript
  if (payload.plan_type !== undefined) {
    updates.push('plan_type = ?');
    values.push(normalizePlanType(payload.plan_type));
  }
  if (payload.show_on_home !== undefined) {
    updates.push('show_on_home = ?');
    values.push(payload.show_on_home ? 1 : 0);
  }
```

- [ ] **Step 5: 更新管理端路由参数校验**

Modify `server/routes/admin/plans.js`.

In both POST and PUT validators add:

```javascript
  body('plan_type')
    .optional()
    .isIn(['lifetime', 'timed'])
    .withMessage('套餐类型无效'),
  body('show_on_home')
    .optional()
    .isBoolean()
    .withMessage('show_on_home必须是布尔值'),
```

- [ ] **Step 6: 运行测试确认管理端服务通过**

Run: `node server/test/test-monthly-plan-sales.js`

Expected: PASS。

- [ ] **Step 7: 提交管理端后端套餐字段支持**

```bash
git add server/repositories/plans-repository.js server/services/admin/plans-service.js server/routes/admin/plans.js server/test/test-monthly-plan-sales.js
git commit -m "feat: 管理端支持套餐类型配置"
```

---

### Task 3: 首页套餐过滤和续费套餐专用接口

**Files:**
- Modify: `server/repositories/plan-repository.js`
- Modify: `server/services/user/plans-service.js`
- Modify: `server/routes/user/renew.js`
- Modify: `server/controllers/user/renew-controller.js`
- Modify: `server/services/user/renew-service.js`
- Test: `server/test/test-monthly-plan-sales.js`

- [ ] **Step 1: 写失败测试覆盖首页隐藏和续费类型过滤**

Append to `server/test/test-monthly-plan-sales.js`:

```javascript
test('user home plans query filters show_on_home', async () => {
  const planRepository = require('../repositories/plan-repository');
  let capturedSql = '';
  const db = {
    prepare(sql) {
      capturedSql = sql;
      return {
        all() {
          return [];
        }
      };
    }
  };

  await planRepository.findEnabledPlans(db);
  assert.match(capturedSql, /show_on_home = 1/);
});

test('renew plan list filters by current user plan type', async () => {
  const renewService = require('../services/user/renew-service');
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users WHERE id')) {
        return {
          get() {
            return { id: 9, email: 'timed@example.com', plan_id: 2 };
          }
        };
      }
      if (sql.includes('FROM plans WHERE id')) {
        return {
          get() {
            return { id: 2, plan_type: 'timed', duration_days: 30 };
          }
        };
      }
      if (sql.includes('plan_type = ?')) {
        return {
          all(planType) {
            assert.equal(planType, 'timed');
            return [{
              id: 3,
              name: '月卡',
              description: '',
              price: 990,
              duration_days: 30,
              traffic_limit: 1024,
              plan_type: 'timed',
              show_on_home: 1,
              sort_order: 0,
              sales_limit: -1,
              sales_count: 0
            }];
          }
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  const plans = await renewService.listRenewPlans(db, 9);
  assert.equal(plans[0].plan_type, 'timed');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-monthly-plan-sales.js`

Expected: FAIL，`show_on_home` 查询断言或 `listRenewPlans` 不存在。

- [ ] **Step 3: 更新用户端套餐仓储**

Modify `server/repositories/plan-repository.js`.

Replace `findEnabledPlans()` SQL:

```javascript
    SELECT id, name, description, price, duration_days, traffic_limit, plan_type, show_on_home, sort_order, sales_limit, sales_count
    FROM plans
    WHERE enabled = 1 AND show_on_home = 1
    ORDER BY sort_order ASC, id ASC
```

Add:

```javascript
async function findEnabledPlansByType(db, planType) {
  return db.prepare(`
    SELECT id, name, description, price, duration_days, traffic_limit, plan_type, show_on_home, sort_order, sales_limit, sales_count
    FROM plans
    WHERE enabled = 1 AND plan_type = ?
    ORDER BY sort_order ASC, id ASC
  `).all(planType);
}
```

Export `findEnabledPlansByType`.

- [ ] **Step 4: 更新用户端套餐格式化**

Modify `server/services/user/plans-service.js`.

Add import:

```javascript
const { normalizePlanType } = require('../shared/plan-type');
```

In mapped object add:

```javascript
    plan_type: normalizePlanType(plan.plan_type),
    show_on_home: plan.show_on_home === undefined ? 1 : Number(plan.show_on_home),
```

- [ ] **Step 5: 新增续费套餐列表服务**

Modify `server/services/user/renew-service.js`.

Add imports:

```javascript
const { formatTraffic } = require('../../shared/utils/format-traffic');
const planRepository = require('../../repositories/plan-repository');
const { normalizePlanType } = require('../shared/plan-type');
```

Add function:

```javascript
function formatRenewPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    price_text: (Number(plan.price) / 100).toFixed(2),
    duration_days: plan.duration_days,
    traffic_limit: plan.traffic_limit,
    traffic_text: formatTraffic(plan.traffic_limit),
    plan_type: normalizePlanType(plan.plan_type),
    show_on_home: plan.show_on_home === undefined ? 1 : Number(plan.show_on_home),
    sort_order: plan.sort_order,
    sales_limit: plan.sales_limit,
    sales_count: plan.sales_count,
    is_soldout: plan.sales_limit !== -1 && Number(plan.sales_count) >= Number(plan.sales_limit)
  };
}

async function listRenewPlans(db, userId) {
  const user = await orderRepository.findUserById(db, userId);
  if (!user || !user.plan_id) {
    throw createLegacyBusinessError('请先购买套餐后再续费', { code: 2004 });
  }

  const currentPlan = await orderRepository.findPlanById(db, user.plan_id);
  if (!currentPlan) {
    throw createLegacyBusinessError('当前套餐不存在，请联系管理员', { code: 2004 });
  }

  const currentPlanType = normalizePlanType(currentPlan.plan_type);
  const plans = await planRepository.findEnabledPlansByType(db, currentPlanType);

  return plans.map(formatRenewPlan);
}
```

Export `listRenewPlans`.

- [ ] **Step 6: 新增续费套餐控制器和路由**

Modify `server/controllers/user/renew-controller.js`.

Add:

```javascript
async function listRenewPlans(req, res) {
  try {
    const plans = await renewService.listRenewPlans(req.app.locals.db, req.user.id);
    logger.info(`获取续费套餐列表成功: user=${req.user.id}, count=${plans.length}`);
    return res.json({
      code: 0,
      message: 'ok',
      data: { plans }
    });
  } catch (error) {
    return handleControllerError(res, '续费套餐列表接口', error);
  }
}
```

Export:

```javascript
  listRenewPlans,
  createRenewOrder
```

Modify `server/routes/user/renew.js`.

Add before `router.post('/')`:

```javascript
router.get('/plans', authenticateUser, renewController.listRenewPlans);
```

- [ ] **Step 7: 运行测试确认通过**

Run: `node server/test/test-monthly-plan-sales.js`

Expected: PASS。

- [ ] **Step 8: 提交续费套餐列表接口**

```bash
git add server/repositories/plan-repository.js server/services/user/plans-service.js server/routes/user/renew.js server/controllers/user/renew-controller.js server/services/user/renew-service.js server/test/test-monthly-plan-sales.js
git commit -m "feat: 按套餐类型展示续费套餐"
```

---

### Task 4: 续费下单校验类型一致和限时重置确认

**Files:**
- Modify: `server/routes/user/renew.js`
- Modify: `server/services/shared/renew-policy.js`
- Modify: `server/services/user/renew-service.js`
- Test: `server/test/test-monthly-plan-sales.js`

- [ ] **Step 1: 写失败测试覆盖续费类型校验和限时确认**

Append to `server/test/test-monthly-plan-sales.js`:

```javascript
test('renew service rejects changing between lifetime and timed plans', async () => {
  const renewService = require('../services/user/renew-service');
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users WHERE id')) {
        return { get: () => ({ id: 1, email: 'a@example.com', plan_id: 1, enabled: 1 }) };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ? AND enabled = 1')) {
        return { get: () => ({ id: 2, plan_type: 'timed', duration_days: 30, sales_limit: -1, sales_count: 0 }) };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ?')) {
        return { get: () => ({ id: 1, plan_type: 'lifetime', duration_days: 0 }) };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await assert.rejects(
    () => renewService.createRenewOrder(db, 1, { plan_id: 2, pay_type: 9 }),
    /不能跨套餐类型续费/
  );
});

test('timed active renew requires reset confirmation', async () => {
  const renewService = require('../services/user/renew-service');
  const now = Math.floor(Date.now() / 1000);
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users WHERE id')) {
        return {
          get: () => ({
            id: 2,
            email: 'timed@example.com',
            plan_id: 3,
            enabled: 1,
            traffic_used: 1024,
            traffic_limit: 4096,
            expire_at: now + 86400,
            balance: 0
          })
        };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ? AND enabled = 1')) {
        return {
          get: () => ({
            id: 3,
            price: 990,
            traffic_limit: 4096,
            duration_days: 30,
            plan_type: 'timed',
            sales_limit: -1,
            sales_count: 0
          })
        };
      }
      if (sql.includes('SELECT * FROM plans WHERE id = ?')) {
        return {
          get: () => ({
            id: 3,
            plan_type: 'timed',
            duration_days: 30
          })
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await assert.rejects(
    () => renewService.createRenewOrder(db, 2, { plan_id: 3, pay_type: 9 }),
    (error) => {
      assert.equal(error.code, 4091);
      assert.equal(error.data.requires_confirm, true);
      return /续费会重置当前剩余流量和时间/.test(error.message);
    }
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-monthly-plan-sales.js`

Expected: FAIL，服务尚未拒绝跨类型或未返回确认错误。

- [ ] **Step 3: 扩展禁用原因**

Modify `server/services/shared/renew-policy.js`:

```javascript
const DISABLE_REASONS = {
  ADMIN: 'admin',
  TRAFFIC_LIMIT: 'traffic_limit',
  EXPIRED: 'expired'
};
```

Inside `evaluateRenewEligibility()`, replace the disabled branch:

```javascript
    if (disableReason !== DISABLE_REASONS.TRAFFIC_LIMIT && disableReason !== DISABLE_REASONS.EXPIRED) {
      return {
        allowed: false,
        code: 2003,
        message: '账号当前状态异常，请联系管理员'
      };
    }
```

- [ ] **Step 4: 更新续费路由允许确认字段**

Modify `server/routes/user/renew.js`.

In POST validators add:

```javascript
  body('confirm_reset')
    .optional()
    .isBoolean()
    .withMessage('confirm_reset必须是布尔值')
```

- [ ] **Step 5: 更新续费服务类型校验和限时确认**

Modify `server/services/user/renew-service.js`.

Add imports:

```javascript
const {
  PLAN_TYPES,
  normalizePlanType,
  isTimedPlan,
  buildTimedRenewResetPreview
} = require('../shared/plan-type');
```

Inside `createRenewOrder()` after target `plan` is loaded:

```javascript
  const currentPlan = await orderRepository.findPlanById(db, user.plan_id);
  if (!currentPlan) {
    throw createLegacyBusinessError('当前套餐不存在，请联系管理员', { code: 2004 });
  }

  const currentPlanType = normalizePlanType(currentPlan.plan_type);
  const targetPlanType = normalizePlanType(plan.plan_type);
  if (currentPlanType !== targetPlanType) {
    throw createLegacyBusinessError('不能跨套餐类型续费，请选择当前套餐类型下的套餐', {
      code: 1003
    });
  }

  if (isTimedPlan(plan)) {
    const preview = buildTimedRenewResetPreview(user, plan);
    if (preview.requires_confirm && payload.confirm_reset !== true) {
      throw createLegacyBusinessError('续费会重置当前剩余流量和时间，请确认后再续费', {
        statusCode: 409,
        code: 4091,
        data: {
          plan_type: PLAN_TYPES.TIMED,
          ...preview
        }
      });
    }
  }
```

Leave the existing `evaluateRenewEligibility(user, plan)` call in place after this block.

- [ ] **Step 6: 运行测试确认通过**

Run: `node server/test/test-monthly-plan-sales.js`

Expected: PASS。

- [ ] **Step 7: 提交续费下单校验**

```bash
git add server/routes/user/renew.js server/services/shared/renew-policy.js server/services/user/renew-service.js server/test/test-monthly-plan-sales.js
git commit -m "feat: 限制续费套餐类型并确认限时重置"
```

---

### Task 5: 支付成功按套餐类型处理权益

**Files:**
- Modify: `server/repositories/order-repository.js`
- Modify: `server/services/shared/order-service.js`
- Test: `server/test/test-monthly-plan-sales.js`

- [ ] **Step 1: 写失败测试保护不限时续费逻辑不变**

Append to `server/test/test-monthly-plan-sales.js`:

```javascript
test('paid lifetime renew keeps existing traffic accumulation contract', async () => {
  const { calculatePaidOrderEntitlement } = require('../services/shared/order-service');
  const now = 1700000000;
  const result = calculatePaidOrderEntitlement({
    out_trade_no: 'REN123',
    current_traffic_limit: 1024,
    current_expire_at: 0
  }, {
    id: 1,
    plan_type: 'lifetime',
    duration_days: 0,
    traffic_limit: 2048
  }, now);

  assert.equal(result.trafficLimit, 3072);
  assert.equal(result.expireAt, 0);
  assert.equal(result.resetTrafficUsed, false);
});

test('paid timed renew resets traffic and starts expiry from payment time', async () => {
  const { calculatePaidOrderEntitlement } = require('../services/shared/order-service');
  const now = 1700000000;
  const result = calculatePaidOrderEntitlement({
    out_trade_no: 'REN456',
    current_traffic_limit: 8192,
    current_expire_at: now + 86400
  }, {
    id: 2,
    plan_type: 'timed',
    duration_days: 30,
    traffic_limit: 4096
  }, now);

  assert.equal(result.trafficLimit, 4096);
  assert.equal(result.expireAt, 1702592000);
  assert.equal(result.resetTrafficUsed, true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-monthly-plan-sales.js`

Expected: FAIL，`calculatePaidOrderEntitlement` 尚未导出。

- [ ] **Step 3: 更新订单仓储查询和用户权益更新**

Modify `server/repositories/order-repository.js`.

Replace `findPaidOrderContextByOutTradeNo()` SELECT with:

```javascript
    SELECT o.*, o.id, o.referrer_user_id,
           u.expire_at as current_expire_at, u.traffic_limit as current_traffic_limit,
           u.traffic_used as current_traffic_used,
           u.email, u.subscription_token, u.plan_id as current_plan_id, u.enabled as current_enabled,
           u.disable_reason as current_disable_reason, u.payment_count as current_payment_count,
           cp.plan_type as current_plan_type
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN plans cp ON u.plan_id = cp.id
    WHERE o.out_trade_no = ?
```

Replace `updateUserAfterPaidOrder()` SQL with a dynamic update:

```javascript
  const updates = [
    'enabled = 1',
    'plan_id = ?',
    'traffic_limit = ?',
    'traffic_used_at = NULL',
    'disable_reason = NULL',
    'expire_at = ?',
    'payment_count = payment_count + 1',
    'updated_at = ?'
  ];
  const values = [planId, trafficLimit, expireAt, updatedAt];

  if (payload.resetTrafficUsed) {
    updates.splice(3, 0, 'traffic_used = 0');
  }

  values.push(userId);
  await db.prepare(`
    UPDATE users SET
      ${updates.join(',\n      ')}
    WHERE id = ?
  `).run(...values);
```

- [ ] **Step 4: 提取并使用权益计算函数**

Modify `server/services/shared/order-service.js`.

Add import:

```javascript
const { isTimedPlan } = require('./plan-type');
```

Add before `completePaidOrder()`:

```javascript
function calculatePaidOrderEntitlement(order, plan, now = Math.floor(Date.now() / 1000)) {
  const isRenewOrder = order.out_trade_no.startsWith('REN');

  if (isRenewOrder && isTimedPlan(plan)) {
    return {
      trafficLimit: Number(plan.traffic_limit || 0),
      expireAt: now + (Number(plan.duration_days) * 24 * 60 * 60),
      resetTrafficUsed: true
    };
  }

  const currentExpireAt = Number(order.current_expire_at || 0);
  const baseExpireAt = currentExpireAt > now ? currentExpireAt : now;
  const expireAt = plan.duration_days === 0 ? 0 : baseExpireAt + (Number(plan.duration_days) * 24 * 60 * 60);

  if (isRenewOrder) {
    const currentTrafficLimit = Number(order.current_traffic_limit || 0);
    const planTrafficLimit = Number(plan.traffic_limit || 0);
    return {
      trafficLimit: currentTrafficLimit + planTrafficLimit,
      expireAt,
      resetTrafficUsed: false
    };
  }

  return {
    trafficLimit: Number(plan.traffic_limit || 0),
    expireAt,
    resetTrafficUsed: false
  };
}
```

Inside `completePaidOrder()`, replace existing `currentExpireAt/baseExpireAt/expireAt/newTrafficLimit` block with:

```javascript
  const entitlement = calculatePaidOrderEntitlement(order, plan, now);
  const expireAt = entitlement.expireAt;
  const newTrafficLimit = entitlement.trafficLimit;
  const resetTrafficUsed = entitlement.resetTrafficUsed;
  const finalTradeNo = tradeNo || order.trade_no;
  const isRenewOrder = order.out_trade_no.startsWith('REN');

  if (isRenewOrder && resetTrafficUsed) {
    logger.info(`限时套餐续费重置权益: traffic_limit=${newTrafficLimit}, expire_at=${expireAt}`);
  } else if (isRenewOrder) {
    logger.info(`续费订单流量累加: traffic_limit=${newTrafficLimit}, expire_at=${expireAt}`);
  }
```

Pass `resetTrafficUsed` to repository:

```javascript
      resetTrafficUsed,
```

Export:

```javascript
  calculatePaidOrderEntitlement,
```

- [ ] **Step 5: 运行测试确认通过且不限时断言通过**

Run: `node server/test/test-monthly-plan-sales.js`

Expected: PASS。

- [ ] **Step 6: 提交支付成功权益分支**

```bash
git add server/repositories/order-repository.js server/services/shared/order-service.js server/test/test-monthly-plan-sales.js
git commit -m "feat: 限时套餐续费重置权益"
```

---

### Task 6: 时间到期自动禁用与状态展示

**Files:**
- Modify: `server/repositories/traffic-repository.js`
- Modify: `server/services/shared/traffic-manager.js`
- Modify: `server/repositories/user-repository.js`
- Modify: `server/services/user/auth-service.js`
- Test: `server/test/test-monthly-plan-sales.js`
- Test: `server/test/test-user-onboarding.js`

- [ ] **Step 1: 写失败测试覆盖到期禁用和到期用户可登录续费**

Append to `server/test/test-monthly-plan-sales.js`:

```javascript
test('traffic manager disables expired timed users locally and queues sync', async () => {
  const trafficManager = require('../services/shared/traffic-manager');
  const now = 1700000000;
  const updated = [];
  const db = {
    prepare(sql) {
      if (sql.includes('FROM users u') && sql.includes('expire_at <= ?')) {
        return {
          all(receivedNow) {
            assert.equal(receivedNow, now);
            return [{ id: 7, email: 'expired@example.com', expire_at: now - 1 }];
          }
        };
      }
      if (sql.includes('UPDATE users SET enabled = 0')) {
        return {
          run(disableReason, userId) {
            updated.push({ disableReason, userId });
          }
        };
      }
      if (sql.includes('SELECT email FROM users')) {
        return { get: () => ({ email: 'expired@example.com' }) };
      }
      if (sql.includes('FROM xui_servers')) {
        return { all: () => [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  const result = await trafficManager.checkAndDisableExpiredUsers(db, now);
  assert.equal(result.disabledCount, 1);
  assert.deepEqual(updated[0], { disableReason: 'expired', userId: 7 });
});
```

Append to `server/test/test-user-onboarding.js`:

```javascript
test('user profile marks expired disabled account as renew status', async () => {
  const restoreRepository = replaceMethods(userRepository, {
    findUserProfileById: async () => ({
      id: 10,
      email: 'expired@example.com',
      plan_id: 2,
      plan_name: '月卡',
      plan_type: 'timed',
      sub_id: 'abcdef1234567892',
      traffic_used: 1024,
      traffic_limit: 4096,
      referral_traffic_limit: 0,
      expire_at: 1710000000,
      enabled: 0,
      disable_reason: 'expired',
      created_at: 1700000000,
      payment_count: 1,
      sync_status: 2,
      onboarding_completed: 0
    }),
    hasUserCfIps: async () => false,
    hasUserSubscriptionCache: async () => false,
    findSystemSettingByKey: async () => null
  });

  try {
    const profile = await authService.getProfile({}, 10);
    assert.equal(profile.status, 'renew');
    assert.equal(profile.status_text, '续费');
    assert.equal(profile.disable_reason, 'expired');
  } finally {
    restoreRepository();
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-monthly-plan-sales.js`

Expected: FAIL，`checkAndDisableExpiredUsers` 尚未导出。

Run: `node server/test/test-user-onboarding.js`

Expected: FAIL，到期禁用用户状态仍显示禁用。

- [ ] **Step 3: 增加到期禁用仓储方法**

Modify `server/repositories/traffic-repository.js`.

Add:

```javascript
async function listExpiredEnabledUsers(db, now) {
  return db.prepare(`
    SELECT u.id, u.email, u.expire_at
    FROM users u
    JOIN plans p ON u.plan_id = p.id
    WHERE u.enabled = 1
      AND COALESCE(p.plan_type, 'lifetime') = 'timed'
      AND u.expire_at IS NOT NULL
      AND u.expire_at != 0
      AND u.expire_at <= ?
  `).all(now);
}

async function disableUserByExpired(db, userId, disableReason) {
  await db.prepare(`
    UPDATE users SET enabled = 0, disable_reason = ? WHERE id = ?
  `).run(disableReason, userId);
}
```

Export both functions.

- [ ] **Step 4: 增加到期禁用服务**

Modify `server/services/shared/traffic-manager.js`.

Add function before `syncTrafficAndHandleDisable()`:

```javascript
async function checkAndDisableExpiredUsers(db, now = Math.floor(Date.now() / 1000)) {
  try {
    const expiredUsers = await trafficRepository.listExpiredEnabledUsers(db, now);
    if (expiredUsers.length === 0) {
      logger.info('没有需要按时间到期禁用的用户');
      return { disabledCount: 0, retryCount: 0 };
    }

    let disabledCount = 0;
    let retryCount = 0;

    for (const user of expiredUsers) {
      const lockedResult = await withUserStatusLock(db, Number(user.id), async () => {
        await trafficRepository.disableUserByExpired(db, user.id, DISABLE_REASONS.EXPIRED);
        return { success: true, action: 'disabled' };
      });

      if (lockedResult.retryable) {
        retryCount++;
        logger.warn(`用户 ${user.email} 到期禁用状态锁忙，等待下轮检查`);
        continue;
      }

      if (lockedResult.success && lockedResult.action === 'disabled') {
        disabledCount++;
        const syncResult = await enqueueUserStatusSync(db, user.id, true);
        if (syncResult.retryable) {
          retryCount++;
        }
        logger.info(`用户 ${user.email} 已因时间到期禁用`);
      }
    }

    return { disabledCount, retryCount };
  } catch (error) {
    logger.error(`检查时间到期禁用错误: ${error.message}`);
    return { disabledCount: 0, retryCount: 0 };
  }
}
```

In `syncTrafficAndHandleDisable()`, call after traffic disable:

```javascript
    await checkAndDisableExpiredUsers(db);
```

Export `checkAndDisableExpiredUsers`.

- [ ] **Step 5: 更新用户资料查询和状态展示**

Modify `server/repositories/user-repository.js`.

In `findUserProfileById()` SELECT add:

```sql
      p.name as plan_name, p.plan_type as plan_type
```

Modify `server/services/user/auth-service.js`.

Replace `shouldBlockDisabledUserLogin()` return:

```javascript
  return user.disable_reason !== DISABLE_REASONS.TRAFFIC_LIMIT
    && user.disable_reason !== DISABLE_REASONS.EXPIRED;
```

Replace `buildUserProfileStatus()` disabled branch:

```javascript
  if (user.disable_reason === DISABLE_REASONS.TRAFFIC_LIMIT || user.disable_reason === DISABLE_REASONS.EXPIRED) {
    return {
      status: 'renew',
      status_text: '续费'
    };
  }
```

Include `plan_type: user.plan_type` in `getProfile()` return object.

- [ ] **Step 6: 运行到期禁用和用户状态测试**

Run: `node server/test/test-monthly-plan-sales.js`

Expected: PASS。

Run: `node server/test/test-user-onboarding.js`

Expected: PASS。

- [ ] **Step 7: 提交到期禁用**

```bash
git add server/repositories/traffic-repository.js server/services/shared/traffic-manager.js server/repositories/user-repository.js server/services/user/auth-service.js server/test/test-monthly-plan-sales.js server/test/test-user-onboarding.js
git commit -m "feat: 支持限时套餐到期禁用"
```

---

### Task 7: 订阅接口拒绝已到期限时套餐

**Files:**
- Modify: `server/repositories/subscription-repository.js`
- Modify: `server/services/user/subscription-service.js`
- Test: `server/test/test-user-subscription-service.js`

- [ ] **Step 1: 写失败测试覆盖已到期限时订阅**

Append to `server/test/test-user-subscription-service.js`:

```javascript
test('subscription content rejects expired timed users', async () => {
  const subscription = {
    sub_id: 'expired-timed-token',
    email: 'expired@example.com',
    nodes_data: '[]',
    traffic_used: 0,
    traffic_limit: 4096,
    referral_traffic_limit: 0,
    expire_at: 1,
    enabled: 1,
    plan_type: 'timed'
  };

  await assert.rejects(
    () => subscriptionService.getSubscriptionContent(
      createFakeDb(subscription),
      'expired-timed-token',
      false
    ),
    /订阅已到期/
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-user-subscription-service.js`

Expected: FAIL，当前仍返回订阅内容或错误信息不匹配。

- [ ] **Step 3: 更新订阅仓储查询 plan_type**

Modify `server/repositories/subscription-repository.js`.

In `findSubscriptionContentByToken()` SELECT add:

```sql
      p.plan_type
```

and join:

```sql
    LEFT JOIN plans p ON u.plan_id = p.id
```

If the query already joins `users`, keep existing fields and only add `plans` join.

- [ ] **Step 4: 增加订阅过期判断**

Modify `server/services/user/subscription-service.js`.

Add import:

```javascript
const { isTimedPlan } = require('../shared/plan-type');
```

In `getSubscriptionContent()` after `if (!subscription.enabled)` branch add:

```javascript
  const now = Math.floor(Date.now() / 1000);
  const expireAt = Number(subscription.expire_at || 0);
  if (isTimedPlan(subscription) && expireAt > 0 && expireAt <= now) {
    const error = new Error('订阅已到期，请续费后再使用');
    error.statusCode = 403;
    throw error;
  }
```

- [ ] **Step 5: 运行订阅测试**

Run: `node server/test/test-user-subscription-service.js`

Expected: PASS。

- [ ] **Step 6: 提交订阅过期保护**

```bash
git add server/repositories/subscription-repository.js server/services/user/subscription-service.js server/test/test-user-subscription-service.js
git commit -m "feat: 限时套餐到期后停止订阅内容"
```

---

### Task 8: 管理端套餐页面增加类型和首页展示控件

**Files:**
- Modify: `client-admin/src/views/Plans.vue`

- [ ] **Step 1: 更新表格列**

Modify `client-admin/src/views/Plans.vue` table columns after 套餐名称:

```vue
        <el-table-column label="套餐类型" width="110">
          <template #default="scope">
            <el-tag :type="scope.row.plan_type === 'timed' ? 'warning' : 'success'">
              {{ scope.row.plan_type === 'timed' ? '限时套餐' : '不限时套餐' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="首页展示" width="100">
          <template #default="scope">
            <el-tag :type="scope.row.show_on_home ? 'success' : 'info'">
              {{ scope.row.show_on_home ? '展示' : '隐藏' }}
            </el-tag>
          </template>
        </el-table-column>
```

- [ ] **Step 2: 更新表单控件**

Add before 有效天数:

```vue
        <el-form-item label="套餐类型" prop="plan_type">
          <el-radio-group v-model="planForm.plan_type" @change="handlePlanTypeChange">
            <el-radio-button label="lifetime">不限时套餐</el-radio-button>
            <el-radio-button label="timed">限时套餐</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="首页展示" prop="show_on_home">
          <el-switch v-model="planForm.show_on_home" />
        </el-form-item>
```

- [ ] **Step 3: 更新表单状态和校验**

Modify `planForm`:

```javascript
const planForm = reactive({
  name: '',
  description: '',
  price: 0,
  duration_days: 30,
  traffic_limit: 0,
  plan_type: 'timed',
  show_on_home: true,
  sort_order: 0,
  enabled: true,
  sales_limit: -1
})
```

Modify `planRules`:

```javascript
const planRules = {
  name: [{ required: true, message: '请输入套餐名称', trigger: 'blur' }],
  price: [{ required: true, message: '请输入价格', trigger: 'blur' }],
  duration_days: [{ required: true, message: '请输入有效天数', trigger: 'blur' }],
  plan_type: [{ required: true, message: '请选择套餐类型', trigger: 'change' }]
}
```

Add function:

```javascript
function handlePlanTypeChange(value) {
  if (value === 'lifetime') {
    planForm.duration_days = 0
  } else if (Number(planForm.duration_days) === 0) {
    planForm.duration_days = 30
  }
}
```

- [ ] **Step 4: 更新编辑和重置赋值**

In `showEditDialog(plan)` add:

```javascript
  planForm.plan_type = plan.plan_type || (Number(plan.duration_days) === 0 ? 'lifetime' : 'timed')
  planForm.show_on_home = plan.show_on_home === undefined ? true : !!plan.show_on_home
```

In `resetForm()` add:

```javascript
  planForm.plan_type = 'timed'
  planForm.show_on_home = true
```

Before submit after traffic assignment add:

```javascript
    if (planForm.plan_type === 'lifetime') {
      planForm.duration_days = 0
    }
    if (planForm.plan_type === 'timed' && Number(planForm.duration_days) <= 0) {
      ElMessage.warning('限时套餐的有效天数必须大于 0')
      return
    }
```

- [ ] **Step 5: 构建管理端**

Run: `cd client-admin; npx vite build --minify esbuild`

Expected: build succeeds without Vue compile errors.

- [ ] **Step 6: 提交管理端页面**

```bash
git add client-admin/src/views/Plans.vue
git commit -m "feat: 管理端配置套餐类型和首页展示"
```

---

### Task 9: 用户端续费弹窗支持限时套餐确认

**Files:**
- Modify: `client-user/src/api/index.js`
- Modify: `client-user/src/components/RenewDialog.vue`
- Modify: `client-user/src/views/user/Profile.vue`

- [ ] **Step 1: 新增用户端 API 方法**

Modify `client-user/src/api/index.js`.

Add after `getPlans()`:

```javascript
  /**
   * 获取当前用户可续费套餐列表
   * @returns {Promise<Object>} 响应数据
   */
  getRenewPlans() {
    return apiClient.get('/renew/plans')
  },
```

Update renew comment:

```javascript
   * @param {boolean} [data.confirm_reset] - 限时套餐未用完续费时确认重置权益
```

- [ ] **Step 2: 续费弹窗改用专用接口**

Modify `client-user/src/components/RenewDialog.vue`.

Replace:

```javascript
      <p>续费会在现有套餐基础上累加流量，流量用完后 3 天内仍可续费当前套餐。</p>
```

with:

```javascript
      <p>{{ renewTipText }}</p>
```

Add computed:

```javascript
const selectedPlan = computed(() =>
  plans.value.find((plan) => Number(plan.id) === Number(selectedPlanId.value)) || null
)

const renewTipText = computed(() => {
  const hasTimed = plans.value.some((plan) => plan.plan_type === 'timed')
  if (hasTimed) {
    return '限时套餐续费会重置流量和到期时间，未用完时会先提示确认。'
  }
  return '不限时套餐续费会在现有套餐基础上累加流量，流量用完后 3 天内仍可续费当前套餐。'
})
```

In `displayPlans`, replace `durationText`:

```javascript
    durationText: plan.plan_type === 'timed' ? `${plan.duration_days} 天周期` : '不限时套餐'
```

In `fetchPlans()` replace API call:

```javascript
    const result = await api.user.getRenewPlans()
```

- [ ] **Step 3: 续费弹窗提交 plan_type**

Modify `handleRenew()` emit:

```javascript
    emit('renew', {
      planId: selectedPlanId.value,
      payType: payType.value,
      planType: selectedPlan.value?.plan_type || 'lifetime'
    })
```

- [ ] **Step 4: Profile 处理确认重置响应**

Modify `client-user/src/views/user/Profile.vue`.

Replace `handleRenew` body around API call with:

```javascript
async function handleRenew({ planId, payType, confirmReset = false }) {
  try {
    const response = await api.user.renew({
      plan_id: planId,
      pay_type: payType,
      confirm_reset: confirmReset
    })

    if (response.code === 0) {
      renewDialogVisible.value = false
      const data = response.data || {}
      if (data.paid) {
        ElMessage.success('续费成功')
        await fetchUserInfo()
        return
      }
      if (data.payment_url) {
        window.location.href = data.payment_url
      }
      return
    }

    ElMessage.error(response.message || '续费失败')
  } catch (error) {
    const response = error.response?.data
    if (Number(response?.code) === 4091 && response.data?.requires_confirm) {
      const remainingTraffic = response.data.remaining_traffic_text || '0 B'
      const remainingSeconds = Number(response.data.remaining_seconds || 0)
      const remainingDays = Math.floor(remainingSeconds / 86400)
      const remainingHours = Math.floor((remainingSeconds % 86400) / 3600)
      const confirmed = await ElMessageBox.confirm(
        `当前还有 ${remainingTraffic} 流量和 ${remainingDays} 天 ${remainingHours} 小时未使用。续费后流量和到期时间将重置，确定继续吗？`,
        '确认重置续费',
        {
          confirmButtonText: '确定续费',
          cancelButtonText: '取消',
          type: 'warning'
        }
      ).then(() => true).catch(() => false)

      if (confirmed) {
        await handleRenew({ planId, payType, confirmReset: true })
      }
      return
    }

    console.error('续费失败:', error)
    ElMessage.error(response?.message || '续费失败，请重试')
  }
}
```

Ensure `ElMessageBox` is imported from `element-plus` in the same file:

```javascript
import { ElMessage, ElMessageBox } from 'element-plus'
```

- [ ] **Step 5: 构建用户端**

Run: `cd client-user; npx vite build --minify esbuild`

Expected: build succeeds without Vue compile errors.

- [ ] **Step 6: 提交用户端续费体验**

```bash
git add client-user/src/api/index.js client-user/src/components/RenewDialog.vue client-user/src/views/user/Profile.vue
git commit -m "feat: 用户端支持限时套餐续费确认"
```

---

### Task 10: 最终验证和回归

**Files:**
- Verify only

- [ ] **Step 1: 后端语法检查**

Run:

```bash
node --check server/services/shared/plan-type.js
node --check server/db/migrations/017-plan-type-home-visibility.js
node --check server/services/user/renew-service.js
node --check server/services/shared/order-service.js
node --check server/services/shared/traffic-manager.js
node --check server/services/user/subscription-service.js
```

Expected: each command exits 0 with no syntax error.

- [ ] **Step 2: 后端测试**

Run:

```bash
node server/test/test-monthly-plan-sales.js
node server/test/test-user-onboarding.js
node server/test/test-user-subscription-service.js
node server/test/test-traffic-manager.js
```

Expected: all pass. `test-traffic-manager.js` may depend on reachable database and configured 3X-UI servers; if environment is unavailable, capture the exact connection or service error in the final report.

- [ ] **Step 3: 前端构建**

Run:

```bash
cd client-user
npx vite build --minify esbuild
cd ../client-admin
npx vite build --minify esbuild
```

Expected: both builds succeed.

- [ ] **Step 4: 检查不限时套餐关键差异**

Run:

```bash
git diff -- server/services/shared/order-service.js server/services/user/renew-service.js server/services/shared/traffic-manager.js
```

Expected:

- `lifetime` 分支仍执行流量累加。
- `duration_days = 0` 仍产生 `expire_at = 0`。
- 限时重置只在 `isTimedPlan(plan)` 时发生。
- 到期禁用查询限制 `COALESCE(p.plan_type, 'lifetime') = 'timed'`。

- [ ] **Step 5: 最终提交**

```bash
git status --short
git add docs/superpowers/specs/2026-06-14-monthly-plan-sales-design.md docs/superpowers/plans/2026-06-14-monthly-plan-sales.md
git commit -m "docs: 增加月卡套餐销售实施方案"
```

If prior task commits were already created, this final commit only contains docs. If the implementation was done without intermediate commits, stage only reviewed implementation files and use:

```bash
git commit -m "feat: 支持月卡套餐销售"
```

---

## Self-Review

- Spec coverage: 数据字段、首页隐藏、续费按类型展示、限时确认、限时重置、到期禁用、订阅过期保护、管理端配置、前端确认和验证命令均有对应任务。
- 不限时保护: Task 4 禁止跨类型续费，Task 5 有不限时续费累加测试，Task 6 到期禁用只查 `timed`，Task 10 明确检查不限时关键差异。
- Type consistency: 文档统一使用 `plan_type`、`show_on_home`、`lifetime`、`timed`、`confirm_reset`、`expired`。
- Execution note: 修改 `server/**/*.js` 后需要提醒用户重启服务器，不在实施过程中自行启动后端服务。

/** 订单并发完结回归：真实仓储 SQL 驱动数据库替身，验证同一 pending 快照只能由一方完成。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const orderService = require('../services/shared/order-service');
const ordersService = require('../services/user/orders-service');
const referralService = require('../services/referral-service');
const taskService = require('../integrations/xui/xui-sync-task-service');
const emailService = require('../services/shared/order-activation-email-service');
const vmqService = require('../integrations/vmq/vmq-service');

/** 模拟订单行锁；是否抢占成功由实际 SQL 的 pending 条件决定，不能天然只让首个调用成功。 */
class ConcurrentOrderDb {
  /** concurrent 控制两个初始读取屏障；finalStatus 模拟抢占前订单已被其他入口改为终态。 */
  constructor({ concurrent = false, finalStatus = null } = {}) {
    this.concurrent = concurrent;
    this.finalStatus = finalStatus;
    this.order = { id: 41, out_trade_no: 'ORD-41', trade_no: 'VMQ-41', user_id: 7,
      email: 'paid@example.com', plan_id: 3, current_expire_at: 0, current_traffic_limit: 100,
      current_traffic_used: 20, current_plan_type: 'lifetime', subscription_token: 'test-token', referrer_user_id: 8 };
    this.plan = { id: 3, name: '测试套餐', traffic_limit: 200, duration_days: 0, plan_type: 'lifetime' };
    this.state = { status: 'pending', paymentCount: 0, userUpdates: 0, rewards: 0 };
    this.reads = 0;
    this.claimAttempts = 0;
    this.tail = Promise.resolve();
    this.readGate = new Promise(resolve => { this.releaseReads = resolve; });
  }

  /** 执行真实仓储 SQL；transactional 标记区分根代理和事务代理，更新不得绕开专用事务。 */
  prepare(sql, transactional = false) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      get: async () => {
        if (normalized.includes('FROM orders')) {
          const snapshot = { ...this.order, status: this.state.status, current_payment_count: this.state.paymentCount };
          this.reads++;
          if (this.concurrent && this.reads <= 2) {
            if (this.reads === 2) this.releaseReads();
            await this.readGate;
          }
          return snapshot;
        }
        if (normalized.includes('FROM plans')) return this.plan;
        throw new Error(`Unexpected get: ${normalized}`);
      },
      run: async (...values) => {
        assert.equal(transactional, true, '订单与权益更新必须使用事务代理');
        if (normalized.startsWith('UPDATE orders')) {
          this.claimAttempts++;
          if (this.finalStatus) this.state.status = this.finalStatus;
          if (normalized.includes("AND status = 'pending'") && this.state.status !== 'pending') {
            return { changes: 0, lastInsertRowid: 0 };
          }
          this.state.status = 'paid';
          return { changes: 1, lastInsertRowid: 41 };
        }
        if (normalized.startsWith('UPDATE users')) {
          this.state.userUpdates++;
          this.state.trafficLimit = values[1];
          if (normalized.includes('payment_count = payment_count + 1')) this.state.paymentCount++;
          return { changes: 1 };
        }
        throw new Error(`Unexpected run: ${normalized}`);
      }
    };
  }

  /** 按订单行锁顺序执行 callback；失败回滚，成功释放后下一事务才能继续。 */
  transaction(callback) {
    return async () => {
      const previous = this.tail;
      let release;
      this.tail = new Promise(resolve => { release = resolve; });
      await previous;
      const snapshot = { ...this.state };
      try {
        return await callback({ prepare: sql => this.prepare(sql, true), root: this });
      } catch (error) {
        this.state = snapshot;
        throw error;
      } finally {
        release();
      }
    };
  }
}

/** 只替换推广/邮件/同步边界；保留订单服务、权益计算、仓储 SQL 和提交后编排。 */
async function withEffects(db, callback) {
  const effects = { tasks: 0, syncAttempts: 0, emails: 0 };
  const overrides = [
    [referralService, 'issueFirstPaymentReward', async transactionDb => {
      assert.equal(transactionDb.root, db);
      db.state.rewards++;
    }],
    [taskService, 'enqueueTask', async receivedDb => {
      assert.equal(receivedDb, db, '入队必须在提交后使用根代理');
      effects.tasks++;
      return 91;
    }],
    [taskService, 'processTask', async () => { effects.syncAttempts++; return { success: true }; }],
    [emailService, 'sendOrderActivationEmail', async receivedDb => {
      assert.equal(receivedDb, db, '发信必须在提交后使用根代理');
      effects.emails++;
      return { sent: true };
    }]
  ];
  const originals = overrides.map(([object, key]) => object[key]);
  overrides.forEach(([object, key, value]) => { object[key] = value; });
  try {
    await callback(effects);
  } finally {
    overrides.forEach(([object, key], index) => { object[key] = originals[index]; });
  }
}

test('两个 completePaidOrder 同时读取 pending 时，仅抢占者更新权益并执行原有副作用', async () => {
  const db = new ConcurrentOrderDb({ concurrent: true });
  await withEffects(db, async effects => {
    const results = await Promise.all([
      orderService.completePaidOrder(db, 'ORD-41'),
      orderService.completePaidOrder(db, 'ORD-41')
    ]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(db.claimAttempts, 2);
    assert.equal(db.state.userUpdates, 1, '无条件订单更新会让两个调用重复落库');
    assert.equal(db.state.paymentCount, 1);
    assert.equal(db.state.trafficLimit, 200);
    assert.equal(db.state.rewards, 1);
    assert.deepEqual(effects, { tasks: 1, syncAttempts: 1, emails: 1 });
    assert.deepEqual(results.map(result => result.handled).sort(), [false, true]);
    const loser = results.find(result => !result.handled);
    assert.equal(loser.reason, 'order_not_pending');
    assert.equal(loser.order.status, 'paid');
  });
});

test('主动查单未取得处理权时使用回读状态，不能把 expired 误报为 paid', async () => {
  const originalCheckOrder = vmqService.checkOrder;
  vmqService.checkOrder = async () => ({ code: 1 });
  try {
    for (const finalStatus of ['paid', 'expired']) {
      for (const entry of ['public', 'user']) {
        const db = new ConcurrentOrderDb({ finalStatus });
        await withEffects(db, async effects => {
          const result = entry === 'public'
            ? await ordersService.getPublicOrderStatus(db, 'ORD-41', null)
            : await ordersService.getUserOrderStatus(db, 7, 'ORD-41');
          assert.equal(result.status, finalStatus);
          assert.equal(db.claimAttempts, 1);
          assert.equal(db.state.userUpdates, 0);
          assert.deepEqual(effects, { tasks: 0, syncAttempts: 0, emails: 0 });
        });
      }
    }
  } finally {
    vmqService.checkOrder = originalCheckOrder;
  }
});

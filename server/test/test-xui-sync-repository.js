const test = require('node:test');
const assert = require('node:assert/strict');

const xuiSyncRepository = require('../repositories/xui-sync-repository');

/**
 * 构造只服务于 listUsersForXuiSync 的假数据库。
 * 职责：根据 repository 传入的 SQL 模拟真实数据库筛选行为。
 * 关键参数：rows 是候选用户快照，now 是 all() 调用传入的当前时间戳。
 * 核心分支：SQL 若仍限制 enabled = 1 会排除禁用用户；若要求 payment_count > 0 会排除未支付用户。
 *
 * @param {Array<Object>} rows - 候选用户快照列表。
 * @returns {Object} 兼容 repository.prepare().all() 的假数据库对象。
 */
function createXuiSyncDb(rows) {
  return {
    prepare(sql) {
      return {
        all(now) {
          return rows.filter((row) => {
            const expireAt = row.expire_at;
            const notExpired = expireAt === 0 || expireAt === '0' || expireAt === null || expireAt === undefined || Number(expireAt) > now;
            const matchesEnabled = !sql.includes('enabled = 1') || Number(row.enabled) === 1;
            const matchesPaid = !sql.includes('payment_count > 0') || Number(row.payment_count) > 0;
            return notExpired && matchesEnabled && matchesPaid;
          });
        }
      };
    }
  };
}

test('xui sync patrol includes paid disabled users without including unpaid or expired users', async () => {
  const now = 1000;
  const db = createXuiSyncDb([
    {
      id: 1,
      email: 'enabled-paid@example.com',
      enabled: 1,
      payment_count: 1,
      expire_at: 0
    },
    {
      id: 2,
      email: 'disabled-paid@example.com',
      enabled: 0,
      payment_count: 1,
      expire_at: 0
    },
    {
      id: 3,
      email: 'disabled-unpaid@example.com',
      enabled: 0,
      payment_count: 0,
      expire_at: 0
    },
    {
      id: 4,
      email: 'disabled-expired@example.com',
      enabled: 0,
      payment_count: 1,
      expire_at: 999
    }
  ]);

  const users = await xuiSyncRepository.listUsersForXuiSync(db, now);

  assert.deepEqual(users.map((user) => user.email), [
    'enabled-paid@example.com',
    'disabled-paid@example.com'
  ]);
});

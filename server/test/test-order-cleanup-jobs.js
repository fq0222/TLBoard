const assert = require('node:assert/strict');
const { test } = require('node:test');

/**
 * 在固定时间内运行异步断言。
 * 职责：临时替换 Date.now，让清理任务的时间阈值可重复验证。
 * 关键参数：timestampMs 为毫秒级当前时间，callback 为被测任务调用。
 * 核心分支：无论断言成功或失败，finally 都恢复全局 Date.now。
 *
 * @param {number} timestampMs - 固定的当前毫秒时间戳。
 * @param {Function} callback - 在固定时间内执行的异步函数。
 * @returns {Promise<void>} callback 执行完成后恢复时间函数。
 */
async function withFixedNow(timestampMs, callback) {
  const originalNow = Date.now;
  Date.now = () => timestampMs;

  try {
    await callback();
  } finally {
    Date.now = originalNow;
  }
}

test('删除过期订单只删除超过 12 小时的 expired 订单', async () => {
  const { runDeleteExpired } = require('../jobs/handlers/delete-expired-orders');
  const now = 1700000000;
  let capturedSql = '';
  let capturedCutoff = null;

  const db = {
    prepare(sql) {
      capturedSql = sql;
      return {
        run(cutoff) {
          capturedCutoff = cutoff;
          return { changes: 0 };
        }
      };
    }
  };

  await withFixedNow(now * 1000, async () => {
    await runDeleteExpired(db);
  });

  assert.match(capturedSql, /status = 'expired'/);
  assert.match(capturedSql, /created_at < \?/);
  assert.equal(capturedCutoff, now - 12 * 60 * 60);
});

test('清理僵尸用户只删除未支付且超过 12 小时的禁用用户', async () => {
  const { runCleanZombieUsers } = require('../jobs/handlers/clean-zombie-users');
  const now = 1700000000;
  let capturedSql = '';
  let capturedCutoff = null;

  const db = {
    prepare(sql) {
      capturedSql = sql;
      return {
        run(cutoff) {
          capturedCutoff = cutoff;
          return { changes: 0 };
        }
      };
    }
  };

  await withFixedNow(now * 1000, async () => {
    await runCleanZombieUsers(db);
  });

  assert.match(capturedSql, /enabled = 0/);
  assert.match(capturedSql, /payment_count = 0/);
  assert.match(capturedSql, /created_at < \?/);
  assert.equal(capturedCutoff, now - 12 * 60 * 60);
});

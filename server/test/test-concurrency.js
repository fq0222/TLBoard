const assert = require('assert');
const { runWithConcurrency } = require('../utils/concurrency');

/**
 * 验证任务池限制并发数，并保持 allSettled 结果语义和输入顺序。
 *
 * @returns {Promise<void>}
 */
async function testConcurrencyAndSettledResults() {
  const items = Array.from({ length: 25 }, (_, index) => index);
  let active = 0;
  let maxActive = 0;
  const completed = [];

  const results = await runWithConcurrency(items, 10, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active -= 1;

    if (item === 6) {
      throw new Error('第7项失败');
    }

    completed.push(item);
    return `result-${item}`;
  });

  assert.strictEqual(maxActive, 10);
  assert.strictEqual(completed.length, 24);
  assert.strictEqual(results.length, items.length);
  assert.deepStrictEqual(
    results.map(result => result.status),
    items.map((_, index) => index === 6 ? 'rejected' : 'fulfilled')
  );
  assert.strictEqual(results[6].reason.message, '第7项失败');
  assert.deepStrictEqual(
    results.map((result, index) => result.status === 'fulfilled' ? result.value : `error-${index}`),
    items.map((item, index) => index === 6 ? 'error-6' : `result-${item}`)
  );
}

/**
 * 验证空数组不会调用工作函数。
 *
 * @returns {Promise<void>}
 */
async function testEmptyItems() {
  let called = false;
  const results = await runWithConcurrency([], 3, async () => {
    called = true;
  });

  assert.deepStrictEqual(results, []);
  assert.strictEqual(called, false);
}

/**
 * 验证公开参数的类型和取值约束。
 *
 * @returns {Promise<void>}
 */
async function testArgumentValidation() {
  await assert.rejects(() => runWithConcurrency(null, 1, async () => {}), TypeError);
  await assert.rejects(() => runWithConcurrency([], 0, async () => {}), RangeError);
  await assert.rejects(() => runWithConcurrency([], 1.5, async () => {}), RangeError);
  await assert.rejects(() => runWithConcurrency([], 1, null), TypeError);
}

/**
 * 运行通用并发任务池测试；任一断言失败时以非零状态退出。
 *
 * @returns {Promise<void>}
 */
async function main() {
  await testConcurrencyAndSettledResults();
  await testEmptyItems();
  await testArgumentValidation();
  console.log('concurrency tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

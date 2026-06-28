/**
 * 按指定并发上限执行任务，并以 allSettled 语义收集每项结果。
 *
 * @param {Array<*>} items 待处理的输入项，结果位置与输入索引一致。
 * @param {number} limit 最大并发任务数，必须为正整数。
 * @param {Function} worker 单项异步处理函数；抛错或拒绝时仅将该项记为 rejected。
 * @returns {Promise<Array<{status: string, value?: *, reason?: *}>>} 每项的完成状态。
 * @throws {TypeError|RangeError} 参数类型或并发上限不合法时拒绝执行。
 */
async function runWithConcurrency(items, limit, worker) {
  if (!Array.isArray(items)) {
    throw new TypeError('items 必须是数组');
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError('limit 必须是正整数');
  }
  if (typeof worker !== 'function') {
    throw new TypeError('worker 必须是函数');
  }

  const results = new Array(items.length);
  let nextIndex = 0;

  /**
   * 持续领取下一项任务，单项失败仅记录原因，不中断其他消费者。
   *
   * @returns {Promise<void>}
   */
  async function consume() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        const value = await worker(items[currentIndex], currentIndex, items);
        results[currentIndex] = { status: 'fulfilled', value };
      } catch (reason) {
        results[currentIndex] = { status: 'rejected', reason };
      }
    }
  }

  const consumers = Array.from(
    { length: Math.min(limit, items.length) },
    () => consume()
  );
  await Promise.all(consumers);

  return results;
}

module.exports = {
  runWithConcurrency
};

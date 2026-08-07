const assert = require('assert');
const { Readable } = require('stream');
const { createGlobalThrottle } = require('../services/shared/global-throttle-stream');

function assertOk(condition, message) {
  assert.strictEqual(Boolean(condition), true, message);
  console.log(`✓ ${message}`);
}

async function drain(stream) {
  for await (const _chunk of stream) {
    // Consume stream.
  }
}

async function main() {
  console.log('=== 全局限速流测试 ===');

  const throttleA = createGlobalThrottle();
  const throttleB = createGlobalThrottle();

  throttleA.updateSpeed(1024);
  throttleB.updateSpeed(2048);

  assertOk(throttleA.getActiveStreamCount() === 0, '新建限速器默认没有活跃流');
  assertOk(throttleA !== throttleB, '可以创建互相独立的限速器实例');

  const limitedStream = throttleA.createStream();
  assertOk(throttleA.getActiveStreamCount() === 1, '创建限速流后活跃流数量增加');

  await drain(Readable.from([Buffer.from('hello')]).pipe(limitedStream));
  assertOk(throttleA.getActiveStreamCount() === 0, '限速流结束后活跃流数量归零');
  assertOk(throttleB.getActiveStreamCount() === 0, '另一个限速器实例不受影响');

  throttleA.stopRefill();
  throttleB.stopRefill();

  console.log('\n=== 测试通过 ===');
}

main().catch((error) => {
  console.error('\n测试失败:', error.message);
  console.error(error.stack);
  process.exitCode = 1;
});

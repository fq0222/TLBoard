/**
 * 可重置流量计数器测试。
 * 职责：固定 3X-UI 服务器级累计流量在正常增长、重置、归零和未变化时的增量语义。
 */

const assert = require('assert');
const { calculateTrafficCounterIncrement } = require('../utils/traffic-counter');

/**
 * 运行可重置计数器的四个核心分支断言。
 * @returns {void}
 */
function run() {
  assert.deepStrictEqual(calculateTrafficCounterIncrement(200, 100, 2.5), {
    rawIncrement: 100,
    increment: 250,
    resetDetected: false
  });
  assert.deepStrictEqual(calculateTrafficCounterIncrement(100, 200, 2.5), {
    rawIncrement: 100,
    increment: 250,
    resetDetected: true
  });
  assert.deepStrictEqual(calculateTrafficCounterIncrement(0, 200, 2.5), {
    rawIncrement: 0,
    increment: 0,
    resetDetected: true
  });
  assert.deepStrictEqual(calculateTrafficCounterIncrement(200, 200, 2.5), {
    rawIncrement: 0,
    increment: 0,
    resetDetected: false
  });

  console.log('test-traffic-counter-reset: PASS');
}

try {
  run();
} catch (error) {
  console.error('test-traffic-counter-reset: FAIL');
  console.error(error);
  process.exitCode = 1;
}

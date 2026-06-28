/**
 * CF IP 测速共享配置回归测试。
 * 确保所有优选入口使用约定的测试次数、单次超时和请求间隔。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CF_IP_TEST_COUNT,
  CF_IP_TEST_TIMEOUT,
  CF_IP_TEST_INTERVAL
} from '../src/utils/cf-ip-test-config.js'

test('CF IP 测速使用统一的次数、超时和间隔配置', () => {
  assert.equal(CF_IP_TEST_COUNT, 2)
  assert.equal(CF_IP_TEST_TIMEOUT, 2000)
  assert.equal(CF_IP_TEST_INTERVAL, 200)
})

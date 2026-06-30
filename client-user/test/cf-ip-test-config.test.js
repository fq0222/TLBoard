/**
 * CF IP 测速共享配置回归测试。
 * 确保所有优选入口使用约定的测试次数、单次超时、请求间隔和最大并发数。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CF_IP_TEST_COUNT,
  CF_IP_TEST_TIMEOUT,
  CF_IP_TEST_INTERVAL,
  CF_IP_TEST_CONCURRENCY
} from '../src/utils/cf-ip-test-config.js'

test('CF IP 测速参数符合优选策略', () => {
  assert.equal(CF_IP_TEST_COUNT, 5)
  assert.equal(CF_IP_TEST_TIMEOUT, 1500)
  assert.equal(CF_IP_TEST_INTERVAL, 200)
  assert.equal(CF_IP_TEST_CONCURRENCY, 10)
})

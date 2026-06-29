/**
 * 订阅生成错误提示回归测试。
 * 确保页面优先展示后端业务提示，并在提示缺失时使用生成失败兜底文案。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { getSubscriptionGenerationErrorMessage } from '../src/utils/subscription-error.js'

test('生成订阅失败时优先展示拦截器保留的后端业务提示', () => {
  const error = {
    userMessage: '套餐已到期，请续费后使用订阅',
    response: {
      data: {
        message: '服务器返回的旧提示'
      }
    }
  }

  assert.equal(
    getSubscriptionGenerationErrorMessage(error),
    '套餐已到期，请续费后使用订阅'
  )
})

test('生成订阅失败且没有业务提示时返回通用兜底文案', () => {
  assert.equal(getSubscriptionGenerationErrorMessage(new Error()), '生成订阅链接失败')
})

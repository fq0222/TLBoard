/**
 * API 错误提示回归测试。
 * 确保 503 业务错误由调用页面展示，避免响应拦截器与页面重复弹出提示。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const apiSource = readFileSync(
  fileURLToPath(new URL('../src/api/index.js', import.meta.url)),
  'utf8'
)
const rateLimiterSource = readFileSync(
  fileURLToPath(new URL('../../server/middleware/rate-limiter.js', import.meta.url)),
  'utf8'
)

test('503 错误交给调用页面展示', () => {
  assert.match(
    apiSource,
    /case\s+503:\s*\/\/[^\r\n]*\r?\n\s*break/
  )
})

test('登录限流错误交给登录页展示', () => {
  assert.match(
    apiSource,
    /case\s+429:[\s\S]*Number\(data\?\.code\)\s*!==\s*1003[\s\S]*ElMessage\.error\('请求过于频繁，请稍后再试'\)[\s\S]*break/
  )
})

test('登录限流返回明确等待提示', () => {
  assert.match(
    rateLimiterSource,
    /message\s*=\s*\{\s*code:\s*1003,\s*message:\s*'您已连续输入3次错误密码，请15分钟后重试'/
  )
})

test('注册限流使用登录页单一提示通道', () => {
  assert.match(
    rateLimiterSource,
    /userRegisterLimiter[\s\S]*message:\s*\{\s*code:\s*1003,\s*message:\s*'您已连续尝试3次，请15分钟后重试'/
  )
})

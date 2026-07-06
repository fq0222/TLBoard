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

test('503 错误交给调用页面展示', () => {
  assert.match(
    apiSource,
    /case\s+503:\s*\/\/[^\r\n]*\r?\n\s*break/
  )
})

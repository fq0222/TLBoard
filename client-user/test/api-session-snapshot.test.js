import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initializeSessionAfterRouterReady } from '../src/utils/app-startup.js'

const apiSource = readFileSync(fileURLToPath(new URL('../src/api/index.js', import.meta.url)), 'utf8')

test('请求记录所用 token，401 仅处理当前登录周期的响应', () => {
  assert.match(apiSource, /config\.authTokenSnapshot\s*=\s*token\s*\|\|\s*null/)
  assert.match(apiSource, /isRequestFromCurrentSession\(error\.config\?\.authTokenSnapshot,\s*localStorage\.getItem\('user_token'\)\)/)
})

test('冷启动等待初始路由守卫完成后才启动生命周期监听', async () => {
  let resolveReady
  let initialized = 0
  const ready = new Promise(resolve => { resolveReady = resolve })
  const initialization = initializeSessionAfterRouterReady(
    { isReady: () => ready },
    () => { initialized += 1 }
  )

  await Promise.resolve()
  assert.equal(initialized, 0)
  resolveReady()
  await initialization
  assert.equal(initialized, 1)
})

test('路由初始化失败时捕获错误且不启动监听', async () => {
  const expectedError = new Error('router failed')
  let capturedError
  let initialized = 0
  await initializeSessionAfterRouterReady(
    { isReady: () => Promise.reject(expectedError) },
    () => { initialized += 1 },
    error => { capturedError = error }
  )
  assert.equal(initialized, 0)
  assert.equal(capturedError, expectedError)
})

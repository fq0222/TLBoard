import test from 'node:test'
import assert from 'node:assert/strict'

import { SessionValidator, SESSION_VALIDATION_CACHE_MS } from '../src/stores/session-validator.js'

function createValidator(options = {}) {
  let now = options.now || 1000
  let userInfo = options.userInfo ?? null
  const calls = []
  const validator = new SessionValidator({
    getToken: () => options.token ?? 'token',
    getUserInfo: () => userInfo,
    fetchProfile: async () => {
      calls.push(now)
      return options.response || { code: 0, data: { email: 'user@example.com' } }
    },
    setUserInfo: options.setUserInfo || ((profile) => {
      userInfo = profile
    }),
    clearToken: options.clearToken || (() => {}),
    now: () => now
  })

  return {
    calls,
    validator,
    advance(ms) {
      now += ms
    }
  }
}

test('无 token 时不会请求 profile', async () => {
  const { calls, validator } = createValidator({ token: '' })

  const result = await validator.ensureValidSession()

  assert.equal(result, false)
  assert.equal(calls.length, 0)
})

test('10 分钟缓存窗口内复用上次成功校验结果', async () => {
  const { calls, validator, advance } = createValidator()

  assert.equal(await validator.ensureValidSession(), true)
  advance(SESSION_VALIDATION_CACHE_MS - 1)
  assert.equal(await validator.ensureValidSession(), true)

  assert.equal(calls.length, 1)
})

test('超过 10 分钟缓存窗口后重新请求 profile', async () => {
  const { calls, validator, advance } = createValidator()

  assert.equal(await validator.ensureValidSession(), true)
  advance(SESSION_VALIDATION_CACHE_MS + 1)
  assert.equal(await validator.ensureValidSession(), true)

  assert.equal(calls.length, 2)
})

test('并发会话校验复用同一个 profile 请求', async () => {
  let resolveProfile
  let requestCount = 0
  const validator = new SessionValidator({
    getToken: () => 'token',
    getUserInfo: () => null,
    fetchProfile: async () => {
      requestCount += 1
      return new Promise(resolve => {
        resolveProfile = resolve
      })
    },
    setUserInfo: () => {},
    clearToken: () => {},
    now: () => 1000
  })

  const first = validator.ensureValidSession()
  const second = validator.ensureValidSession()

  assert.equal(requestCount, 1)
  resolveProfile({ code: 0, data: { email: 'user@example.com' } })
  assert.deepEqual(await Promise.all([first, second]), [true, true])
})

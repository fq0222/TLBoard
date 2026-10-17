import test from 'node:test'
import assert from 'node:assert/strict'

import { SessionValidator, getJwtExpiresAt } from '../src/stores/session-validator.js'

function createToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encoded}.signature`
}

test('解析 JWT 的 exp 为毫秒时间戳', () => {
  assert.equal(getJwtExpiresAt(createToken({ exp: 1234 })), 1234000)
})

test('格式错误或缺少 exp 的 token 返回 null', () => {
  assert.equal(getJwtExpiresAt('invalid-token'), null)
  assert.equal(getJwtExpiresAt(createToken({ sub: 1 })), null)
  assert.equal(getJwtExpiresAt(createToken({ exp: Number.MAX_VALUE })), null)
})

test('有效 token 通过本地校验且不请求 profile', async () => {
  let cleared = 0
  const validator = new SessionValidator({
    getToken: () => createToken({ exp: 2 }),
    clearSession: () => { cleared += 1 },
    now: () => 1000
  })

  assert.equal(await validator.ensureValidSession(), true)
  assert.equal(cleared, 0)
})

test('无 token、格式无效或已过期时清理完整会话', async () => {
  const tokens = ['', 'invalid-token', createToken({ exp: 1 })]

  for (const token of tokens) {
    let cleared = 0
    const validator = new SessionValidator({
      getToken: () => token,
      clearSession: () => { cleared += 1 },
      now: () => 1000
    })
    assert.equal(await validator.ensureValidSession(), false)
    assert.equal(cleared, 1)
  }
})

test('已有无效 token 标记不会被紧随其后的无 token 校验覆盖', async () => {
  let token = 'invalid-token'
  const validator = new SessionValidator({
    getToken: () => token,
    clearSession: () => { token = '' },
    now: () => 1000
  })

  assert.equal(await validator.ensureValidSession(), false)
  assert.equal(await validator.ensureValidSession(), false)
  assert.equal(validator.consumeInvalidToken(), true)
  assert.equal(validator.consumeInvalidToken(), false)
})

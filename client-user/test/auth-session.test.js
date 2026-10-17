import test from 'node:test'
import assert from 'node:assert/strict'

import {
  UnauthorizedCoordinator,
  getSafeRedirect,
  getSessionExpiredMessage,
  getSessionExpiredNavigation,
  isRequestFromCurrentSession
} from '../src/utils/auth-session.js'

test('仅接受单斜杠开头的站内 redirect', () => {
  assert.equal(getSafeRedirect('/user/orders?tab=all'), '/user/orders?tab=all')
  assert.equal(getSafeRedirect('//evil.example.com'), '/user')
  assert.equal(getSafeRedirect('/\\evil.example.com'), '/user')
  assert.equal(getSafeRedirect('https://evil.example.com'), '/user')
  assert.equal(getSafeRedirect('javascript:alert(1)'), '/user')
  assert.equal(getSafeRedirect(['/', '//evil.example.com']), '/user')
})

test('受保护页过期时保留当前路径，公开页不跳转', () => {
  assert.deepEqual(getSessionExpiredNavigation('/user/tickets/3?tab=reply'), {
    name: 'Login', query: { redirect: '/user/tickets/3?tab=reply' }
  })
  assert.equal(getSessionExpiredNavigation('/'), null)
  assert.equal(getSessionExpiredNavigation('/login'), null)
})

test('迟到 401 仅能影响发出请求时的同一登录周期', () => {
  assert.equal(isRequestFromCurrentSession('token-a', 'token-a'), true)
  assert.equal(isRequestFromCurrentSession('token-a', 'token-b'), false)
  assert.equal(isRequestFromCurrentSession(null, 'token-b'), false)
  assert.equal(isRequestFromCurrentSession(null, null), true)
})

test('跨标签页主动退出使用状态变更文案而不是过期文案', () => {
  assert.equal(getSessionExpiredMessage('storage'), '登录状态已变更，请重新登录')
  assert.equal(getSessionExpiredMessage('expiry'), '登录已过期，请重新登录')
  assert.equal(getSessionExpiredMessage('api'), '登录已过期，请重新登录')
})

test('并发 401 只执行一次会话失效处理和提示', async () => {
  let handled = 0
  let resolveHandler
  const coordinator = new UnauthorizedCoordinator({
    onUnauthorized: () => {
      handled += 1
      return new Promise(resolve => { resolveHandler = resolve })
    }
  })
  const first = coordinator.handle()
  const second = coordinator.handle()
  assert.equal(handled, 1)
  resolveHandler()
  await Promise.all([first, second])
  await coordinator.handle()
  assert.equal(handled, 1)
  coordinator.reset()
  const third = coordinator.handle()
  resolveHandler()
  await third
  assert.equal(handled, 2)
})

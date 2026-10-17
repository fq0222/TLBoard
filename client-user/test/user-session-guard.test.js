import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveUserNavigation } from '../src/router/user-session-guard.js'

function createRoute(overrides) {
  return {
    path: '/',
    fullPath: '/',
    meta: {},
    ...overrides
  }
}

function createUserStore(authenticated) {
  return {
    ensureValidSession: async () => authenticated
  }
}

test('有效登录态访问根目录时跳转到用户中心', async () => {
  const redirect = await resolveUserNavigation(createRoute({ path: '/', fullPath: '/' }), createUserStore(true))

  assert.deepEqual(redirect, { path: '/user' })
})

test('未登录或无效登录态访问根目录时停留在首页', async () => {
  const redirect = await resolveUserNavigation(createRoute({ path: '/', fullPath: '/' }), createUserStore(false))

  assert.equal(redirect, null)
})

test('未登录或无效登录态访问用户页时跳转登录并保留原目标', async () => {
  const redirect = await resolveUserNavigation(
    createRoute({
      path: '/user/subscription',
      fullPath: '/user/subscription?tab=clash',
      meta: { requiresAuth: true }
    }),
    createUserStore(false)
  )

  assert.deepEqual(redirect, {
    name: 'Login',
    query: { redirect: '/user/subscription?tab=clash' }
  })
})

test('有效登录态访问访客页时跳转到用户中心', async () => {
  const redirect = await resolveUserNavigation(
    createRoute({
      path: '/login',
      fullPath: '/login',
      meta: { guest: true }
    }),
    createUserStore(true)
  )

  assert.deepEqual(redirect, { path: '/user' })
})

test('无效 token 访问公开访客页时留在当前页面', async () => {
  const redirect = await resolveUserNavigation(
    createRoute({ path: '/login', fullPath: '/login', meta: { guest: true } }),
    createUserStore(false)
  )
  assert.equal(redirect, null)
})

test('首次加载受保护页发现已有 token 过期时保留目标并触发一次失效提示', async () => {
  let notified = 0
  const store = {
    ensureValidSession: async () => false,
    consumeInvalidToken: () => true
  }
  const route = createRoute({
    path: '/user/orders',
    fullPath: '/user/orders?page=2',
    meta: { requiresAuth: true }
  })

  const redirect = await resolveUserNavigation(route, store, fullPath => {
    notified += 1
    assert.equal(fullPath, '/user/orders?page=2')
  })

  assert.equal(notified, 1)
  assert.deepEqual(redirect, { name: 'Login', query: { redirect: '/user/orders?page=2' } })
})

test('公开页静默消费无效 token 标记，后续无 token 访问保护页不误报过期', async () => {
  let invalidPending = true
  let notified = 0
  const store = {
    ensureValidSession: async () => false,
    consumeInvalidToken: () => {
      const pending = invalidPending
      invalidPending = false
      return pending
    }
  }

  await resolveUserNavigation(createRoute({ path: '/', fullPath: '/' }), store, () => { notified += 1 })
  await resolveUserNavigation(
    createRoute({ path: '/user/orders', fullPath: '/user/orders', meta: { requiresAuth: true } }),
    store,
    () => { notified += 1 }
  )

  assert.equal(notified, 0)
})

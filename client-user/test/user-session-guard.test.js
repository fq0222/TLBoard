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

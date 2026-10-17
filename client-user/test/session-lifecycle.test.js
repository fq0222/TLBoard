import test from 'node:test'
import assert from 'node:assert/strict'

import { SessionLifecycle } from '../src/stores/session-lifecycle.js'

function createToken(exp) {
  return `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
}

class FakeEventTarget {
  constructor() { this.listeners = new Map(); this.hidden = false }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(listener)
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event)
  }
}

function createLifecycle({ token = createToken(2), now = 1000 } = {}) {
  const windowTarget = new FakeEventTarget()
  const documentTarget = new FakeEventTarget()
  const timers = []
  let currentToken = token
  const expiredEvents = []
  const lifecycle = new SessionLifecycle({
    getToken: () => currentToken,
    onExpired: context => { expiredEvents.push(context) },
    now: () => now,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => { timer.cleared = true },
    windowTarget,
    documentTarget
  })
  return { lifecycle, timers, windowTarget, documentTarget, getExpired: () => expiredEvents.length,
    getExpiredEvents: () => expiredEvents,
    setToken: value => { currentToken = value }, setNow: value => { now = value } }
}

test('初始化仅注册一次监听并为有效 token 设置单次定时器', () => {
  const context = createLifecycle()
  context.lifecycle.initialize()
  context.lifecycle.initialize()
  assert.equal(context.timers.length, 1)
  assert.equal(context.timers[0].delay, 1000)
  assert.equal(context.windowTarget.listeners.get('focus').size, 1)
  assert.equal(context.windowTarget.listeners.get('storage').size, 1)
  assert.equal(context.documentTarget.listeners.get('visibilitychange').size, 1)
})

test('定时器触发时处理 token 到期', () => {
  const context = createLifecycle()
  context.lifecycle.initialize()
  context.setNow(2000)
  context.timers[0].callback()
  assert.equal(context.getExpired(), 1)
  assert.deepEqual(context.getExpiredEvents()[0], { source: 'expiry' })
})

test('页面重新可见或获得焦点时补查过期状态且只处理一次', () => {
  const context = createLifecycle()
  context.lifecycle.initialize()
  context.setNow(2000)
  context.documentTarget.dispatch('visibilitychange')
  context.windowTarget.dispatch('focus')
  assert.equal(context.getExpired(), 1)
})

test('storage 中 token 变化时重设定时器，删除时同步退出', () => {
  const context = createLifecycle()
  context.lifecycle.initialize()
  context.setToken(createToken(3))
  context.windowTarget.dispatch('storage', { key: 'user_token', newValue: createToken(3) })
  assert.equal(context.timers.length, 2)
  assert.equal(context.timers[0].cleared, true)
  context.setToken('')
  context.windowTarget.dispatch('storage', { key: 'user_token', newValue: null })
  assert.equal(context.getExpired(), 1)
  assert.deepEqual(context.getExpiredEvents()[0], { source: 'storage' })
})

test('销毁时清理定时器和全部监听', () => {
  const context = createLifecycle()
  context.lifecycle.initialize()
  context.lifecycle.destroy()
  assert.equal(context.timers[0].cleared, true)
  assert.equal(context.windowTarget.listeners.get('focus').size, 0)
  assert.equal(context.windowTarget.listeners.get('storage').size, 0)
  assert.equal(context.documentTarget.listeners.get('visibilitychange').size, 0)
})

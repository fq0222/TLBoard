import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TICKET_UNREAD_ROUTE_REFRESH_COOLDOWN_MS,
  TICKET_UNREAD_POLL_INTERVAL_MS,
  UnreadTicketRefresher
} from '../src/utils/unread-ticket-refresher.js'

function createRefresher(options = {}) {
  let now = options.now || 1000
  const calls = []
  const counts = []
  const refresher = new UnreadTicketRefresher({
    fetchUnreadCount: async () => {
      calls.push(now)
      return options.response || { code: 0, data: { count: 3 } }
    },
    setUnreadCount: (count) => counts.push(count),
    now: () => now
  })

  return {
    calls,
    counts,
    refresher,
    advance(ms) {
      now += ms
    }
  }
}

test('未读工单轮询间隔为 10 分钟', () => {
  assert.equal(TICKET_UNREAD_POLL_INTERVAL_MS, 10 * 60 * 1000)
})

test('路由切换刷新在 30 秒冷却内不会重复请求', async () => {
  const { calls, refresher, advance } = createRefresher()

  await refresher.refreshAfterRouteChange()
  advance(TICKET_UNREAD_ROUTE_REFRESH_COOLDOWN_MS - 1)
  await refresher.refreshAfterRouteChange()

  assert.equal(calls.length, 1)
})

test('路由切换刷新超过 30 秒冷却后会重新请求', async () => {
  const { calls, refresher, advance } = createRefresher()

  await refresher.refreshAfterRouteChange()
  advance(TICKET_UNREAD_ROUTE_REFRESH_COOLDOWN_MS + 1)
  await refresher.refreshAfterRouteChange()

  assert.equal(calls.length, 2)
})

test('强制刷新不受路由冷却限制', async () => {
  const { calls, refresher } = createRefresher()

  await refresher.refreshAfterRouteChange()
  await refresher.refresh({ force: true })

  assert.equal(calls.length, 2)
})

test('并发刷新复用同一个未读数量请求', async () => {
  let resolveUnreadCount
  let requestCount = 0
  const updatedCounts = []
  const refresher = new UnreadTicketRefresher({
    fetchUnreadCount: async () => {
      requestCount += 1
      return new Promise(resolve => {
        resolveUnreadCount = resolve
      })
    },
    setUnreadCount: (count) => updatedCounts.push(count),
    now: () => 1000
  })

  const first = refresher.refresh({ force: true })
  const second = refresher.refresh({ force: true })

  assert.equal(requestCount, 1)
  resolveUnreadCount({ code: 0, data: { count: 5 } })
  await Promise.all([first, second])

  assert.deepEqual(updatedCounts, [5])
})

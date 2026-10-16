import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TICKET_UNREAD_REFRESH_INTERVAL_MS,
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

test('未读工单刷新间隔为 2 分钟', () => {
  assert.equal(TICKET_UNREAD_REFRESH_INTERVAL_MS, 2 * 60 * 1000)
})

test('任意刷新触发在 2 分钟间隔内不会重复请求', async () => {
  const { calls, refresher, advance } = createRefresher()

  await refresher.refresh()
  advance(TICKET_UNREAD_REFRESH_INTERVAL_MS - 1)
  await refresher.refresh()

  assert.equal(calls.length, 1)
})

test('超过 2 分钟间隔后允许重新请求', async () => {
  const { calls, refresher, advance } = createRefresher()

  await refresher.refresh()
  advance(TICKET_UNREAD_REFRESH_INTERVAL_MS)
  await refresher.refresh()

  assert.equal(calls.length, 2)
})

test('连续刷新也遵守 2 分钟间隔', async () => {
  const { calls, refresher } = createRefresher()

  await refresher.refresh()
  await refresher.refresh()

  assert.equal(calls.length, 1)
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

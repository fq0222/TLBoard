import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = name => fs.readFileSync(path.resolve(root, `src/views/${name}.vue`), 'utf8')

test('用户、订单和工单复用原集合提供移动卡片', () => {
  const users = read('Users')
  const orders = read('Orders')
  const tickets = read('Tickets')

  for (const page of [users, orders, tickets]) {
    assert.match(page, /tw-hidden md:tw-block/)
    assert.match(page, /md:tw-hidden/)
  }
  assert.match(users, /v-for="user in users"/)
  assert.match(users, /@click="showEditDialog\(user\)"/)
  assert.match(orders, /v-for="order in orders"/)
  assert.match(tickets, /v-for="ticket in tickets"/)
  assert.match(tickets, /handleDelete\(ticket\)/)
})

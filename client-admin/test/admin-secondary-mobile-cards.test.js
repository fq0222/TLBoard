import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = name => fs.readFileSync(path.resolve(root, `src/views/${name}.vue`), 'utf8')

test('公告、套餐、CF IP 和服务器用户列表提供移动卡片', () => {
  const cases = [
    ['Announcements', 'announcement', 'announcements'],
    ['Plans', 'plan', 'plans'],
    ['CfIps', 'ipItem', 'ips']
  ]

  for (const [name, item, collection] of cases) {
    const page = read(name)
    assert.match(page, /tw-hidden md:tw-block/)
    assert.match(page, /md:tw-hidden/)
    assert.match(page, new RegExp(`v-for="${item} in ${collection}"`))
  }

  const detail = read('ServerDetail')
  assert.match(detail, /v-for="user in node\.users"/)
  assert.match(detail, /editUser\(node, user\)/)
  assert.match(detail, /md:tw-hidden/)
})

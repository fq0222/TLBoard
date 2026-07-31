/**
 * 在线客服链接用户参数回归测试。
 * 职责：锁定个人中心在线客服入口会把当前登录用户 email 写入 user 查询参数。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const profileSource = readFileSync(new URL('../src/views/user/Profile.vue', import.meta.url), 'utf8')

test('个人中心在线客服链接追加当前用户 email 作为 user 参数', () => {
  assert.match(profileSource, /:href="onlineCustomerServiceHref"/)
  assert.match(profileSource, /const onlineCustomerServiceHref = computed\(\(\) => \{/)
  assert.match(profileSource, /const userEmail = String\(userInfo\.value\.email \|\| ''\)\.trim\(\)/)
  assert.match(profileSource, /url\.searchParams\.set\('user', userEmail\)/)
  assert.match(profileSource, /return url\.toString\(\)/)
})

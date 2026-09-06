/**
 * 工单提醒铃铛回归测试。
 * 职责：确保用户中心提供全局工单未读提醒，并在有管理员回复时用红点和轻微动画提示用户查看。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const layoutSource = readFileSync(new URL('../src/views/user/Layout.vue', import.meta.url), 'utf8')

test('用户中心布局提供全局工单提醒铃铛并跳转到工单列表', () => {
  assert.match(layoutSource, /class="ticket-reminder-button"/)
  assert.match(layoutSource, /<Bell\s*\/>/)
  assert.match(layoutSource, /@click="goToTickets"/)
  assert.match(layoutSource, /router\.push\('\/user\/tickets'\)/)
})

test('工单提醒铃铛读取未读数并在路由变化后刷新', () => {
  assert.match(layoutSource, /const unreadTicketCount = ref\(0\)/)
  assert.match(layoutSource, /api\.user\.getTicketUnreadCount\(\)/)
  assert.match(layoutSource, /response\.data\.count/)
  assert.match(layoutSource, /watch\(\(\) => route\.path/)
  assert.match(layoutSource, /fetchUnreadTicketCount\(\)/)
})

test('有未读工单时铃铛显示红点和晃动动画', () => {
  assert.match(layoutSource, /:class="\{ shaking: unreadTicketCount > 0 \}"/)
  assert.match(layoutSource, /v-if="unreadTicketCount > 0"/)
  assert.match(layoutSource, /class="ticket-reminder-dot"/)
  assert.match(layoutSource, /animation:\s*ticket-bell-shake/)
  assert.match(layoutSource, /@keyframes ticket-bell-shake/)
})

test('移动端工单提醒铃铛避开底部导航', () => {
  assert.match(layoutSource, /\.ticket-reminder-button\s*\{[\s\S]*position:\s*fixed/)
  assert.match(
    layoutSource,
    /@media \(max-width: 768px\)\s*\{[\s\S]*\.ticket-reminder-button\s*\{[\s\S]*bottom:\s*calc\(92px \+ env\(safe-area-inset-bottom\)\)/
  )
})

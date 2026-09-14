import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

test('管理端布局提供可访问的移动导航和桌面隔离样式', () => {
  const layout = fs.readFileSync(path.resolve(root, 'src/views/Layout.vue'), 'utf8')

  assert.match(layout, /const mobileSidebarOpen = ref\(false\)/)
  assert.match(layout, /function openMobileSidebar\(\)/)
  assert.match(layout, /function closeMobileSidebar\(\)/)
  assert.match(layout, /aria-label="打开导航菜单"/)
  assert.match(layout, /:aria-expanded="mobileSidebarOpen"/)
  assert.match(layout, /aria-label="关闭导航菜单"/)
  assert.match(layout, /@click="closeMobileSidebar"/)
  assert.match(layout, /event\.key === 'Escape'/)
  assert.match(layout, /document\.body\.style\.overflow/)
  assert.match(layout, /md:tw-hidden/)
  assert.match(layout, /tw-hidden md:tw-inline-flex/)
  assert.match(layout, /@media \(max-width: 767px\)/)
  assert.match(layout, /margin-left:\s*0/)
  assert.match(layout, /v-if="!isCollapsed \|\| mobileSidebarOpen"/)
})

test('工单提醒铃铛显示在右上角用户菜单左侧', () => {
  const layout = fs.readFileSync(path.resolve(root, 'src/views/Layout.vue'), 'utf8')
  const headerRight = layout.match(/<div class="header-right">([\s\S]*?)<\/div>\s*<\/header>/)?.[1] ?? ''

  assert.match(headerRight, /class="ticket-reminder-button"[\s\S]*?<el-dropdown/)
  assert.doesNotMatch(layout, /\.ticket-reminder-button\s*\{[^}]*position:\s*fixed/)
  assert.doesNotMatch(layout, /\.ticket-reminder-button\s*\{[^}]*bottom:/)
})

test('工单提醒铃铛使用醒目的蓝底白色图标', () => {
  const layout = fs.readFileSync(path.resolve(root, 'src/views/Layout.vue'), 'utf8')
  const buttonStyles = layout.match(/\.ticket-reminder-button\s*\{([^}]*)\}/)?.[1] ?? ''

  assert.match(buttonStyles, /background:\s*#409eff/)
  assert.match(buttonStyles, /color:\s*#fff/)
  assert.match(buttonStyles, /box-shadow:/)
})

test('当前位于工单列表时点击铃铛会刷新列表与统计数据', () => {
  const layout = fs.readFileSync(path.resolve(root, 'src/views/Layout.vue'), 'utf8')
  const tickets = fs.readFileSync(path.resolve(root, 'src/views/Tickets.vue'), 'utf8')

  assert.match(layout, /currentRoute\.path === '\/admin\/tickets'[\s\S]*?ticket-list-refresh-requested/)
  assert.match(tickets, /function handleTicketListRefresh\(\)[\s\S]*?fetchStats\(\)[\s\S]*?fetchTickets\(\)/)
  assert.match(tickets, /addEventListener\('ticket-list-refresh-requested', handleTicketListRefresh\)/)
  assert.match(tickets, /removeEventListener\('ticket-list-refresh-requested', handleTicketListRefresh\)/)
})

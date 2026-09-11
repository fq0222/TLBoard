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

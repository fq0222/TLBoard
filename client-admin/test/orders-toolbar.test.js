import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 读取订单页面源码，用于验证筛选工具栏的交互与响应式布局契约。
 */
function readOrdersView() {
  return fs.readFileSync(path.resolve(root, 'src/views/Orders.vue'), 'utf8')
}

test('订单邮箱筛选提供可点击搜索按钮', () => {
  const orders = readOrdersView()

  assert.match(orders, /<el-button[^>]*class="email-search-button"[^>]*@click="fetchOrders"[^>]*>/)
  assert.match(orders, /<el-icon><Search\s*\/><\/el-icon>/)
})

test('订单筛选项桌面端按 2:1:3 排列且移动端切换为单列', () => {
  const orders = readOrdersView()

  assert.match(orders, /grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*3fr\)/)
  assert.match(orders, /@media \(max-width: 767px\)[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/)
})

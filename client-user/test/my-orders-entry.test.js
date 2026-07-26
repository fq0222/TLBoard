/**
 * 我的服务订单入口回归测试。
 * 职责：锁定“我的订单”入口排序、旧入口移除、订单路由和订单列表 API 调用。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const mySource = readFileSync(new URL('../src/views/user/My.vue', import.meta.url), 'utf8')
const routerSource = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')

test('我的服务第一项是我的订单，并移除帮助中心、订阅信息、套餐与续费入口', () => {
  const serviceSection = mySource.match(
    /<h2 class="section-title">我的服务<\/h2>[\s\S]*?<section class="content-card">/
  )?.[0]

  assert.ok(serviceSection, '应存在我的服务区块')
  assert.match(serviceSection, /<router-link to="\/user\/orders" class="action-item">/)
  assert.ok(
    serviceSection.indexOf('我的订单') < serviceSection.indexOf('工单支持'),
    '我的订单应排在工单支持前面'
  )
  assert.ok(
    serviceSection.indexOf('工单支持') < serviceSection.indexOf('线路优选'),
    '工单支持应排在线路优选前面'
  )
  assert.doesNotMatch(serviceSection, /帮助中心|订阅信息|套餐与续费/)
})

test('用户端存在我的订单路由并加载订单列表页', () => {
  assert.match(routerSource, /path:\s*'orders'/)
  assert.match(routerSource, /name:\s*'UserOrders'/)
  assert.match(routerSource, /import\('@\/views\/user\/UserOrders\.vue'\)/)
})

test('我的订单页复用当前登录用户订单列表接口', () => {
  const ordersSource = readFileSync(
    new URL('../src/views/user/UserOrders.vue', import.meta.url),
    'utf8'
  )

  assert.match(ordersSource, /api\.user\.getOrders/)
  assert.match(ordersSource, /订单号/)
  assert.match(ordersSource, /套餐/)
  assert.match(ordersSource, /金额/)
  assert.match(ordersSource, /状态/)
})

test('我的订单页移动端使用紧凑卡片，避免表格横向滑动', () => {
  const ordersSource = readFileSync(
    new URL('../src/views/user/UserOrders.vue', import.meta.url),
    'utf8'
  )

  assert.match(ordersSource, /class="mobile-order-list"/)
  assert.match(ordersSource, /class="mobile-order-card"/)
  assert.match(ordersSource, /订单号/)
  assert.match(ordersSource, /套餐/)
  assert.match(ordersSource, /金额/)
  assert.match(ordersSource, /状态/)
  assert.match(ordersSource, /创建/)
  assert.match(ordersSource, /支付/)
  assert.match(ordersSource, /\.orders-table\s*\{[\s\S]*display:\s*none/)
  assert.match(ordersSource, /\.mobile-order-list\s*\{[\s\S]*display:\s*flex/)
  assert.match(ordersSource, /\.orders-page\s*\{[\s\S]*overflow-x:\s*hidden/)
})

test('我的订单页支持复制订单文字信息并显示带年份时间', () => {
  const ordersSource = readFileSync(
    new URL('../src/views/user/UserOrders.vue', import.meta.url),
    'utf8'
  )

  assert.match(ordersSource, /<el-table-column label="操作"/)
  assert.match(ordersSource, /@click="copyOrderText\(row\)"/)
  assert.match(ordersSource, /@touchstart="startLongPress\(order\)"/)
  assert.match(ordersSource, /@contextmenu\.prevent="copyOrderText\(order\)"/)
  assert.match(ordersSource, /function buildOrderCopyText\(order\)/)
  assert.match(ordersSource, /function copyToClipboard\(text\)/)
  assert.match(ordersSource, /ElMessage\.success\(['"]订单信息已复制['"]\)/)
  assert.match(ordersSource, /getFullYear\(\)/)
  assert.match(ordersSource, /formatCompactTime\(order\.created_at\)/)
  assert.match(ordersSource, /formatCompactTime\(order\.paid_at\)/)
})

test('我的订单页移动端提示长按可复制，桌面端保留原说明', () => {
  const ordersSource = readFileSync(
    new URL('../src/views/user/UserOrders.vue', import.meta.url),
    'utf8'
  )

  assert.match(ordersSource, /class="page-subtitle desktop-subtitle"/)
  assert.match(ordersSource, /查看当前账号的套餐购买、续费和支付记录/)
  assert.match(ordersSource, /class="page-subtitle mobile-subtitle"/)
  assert.match(ordersSource, /长按订单可复制完整文字信息/)
  assert.match(ordersSource, /\.desktop-subtitle\s*\{[\s\S]*display:\s*block/)
  assert.match(ordersSource, /\.mobile-subtitle\s*\{[\s\S]*display:\s*none/)
  assert.match(ordersSource, /\.desktop-subtitle\s*\{[\s\S]*display:\s*none/)
  assert.match(ordersSource, /\.mobile-subtitle\s*\{[\s\S]*display:\s*block/)
})

test('我的订单页会把秒级订单时间戳转换为毫秒再显示', () => {
  const ordersSource = readFileSync(
    new URL('../src/views/user/UserOrders.vue', import.meta.url),
    'utf8'
  )

  assert.match(ordersSource, /const numericValue = Number\(value\)/)
  assert.match(ordersSource, /numericValue < 100000000000/)
  assert.match(ordersSource, /new Date\(numericValue \* 1000\)/)
})

test('我的订单刷新按钮不会把点击事件当作页码请求', () => {
  const ordersSource = readFileSync(
    new URL('../src/views/user/UserOrders.vue', import.meta.url),
    'utf8'
  )

  assert.match(ordersSource, /@click="fetchOrders\(\)"[\s\S]*>刷新<\/el-button>/)
})

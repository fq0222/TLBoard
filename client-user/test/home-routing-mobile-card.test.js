/**
 * 家宽 IP 控制移动端卡片布局回归测试。
 * 职责：约束状态标签位置、移动端字段文案和操作按钮尺寸，避免卡片高度再次膨胀。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../src/views/user/Subscription.vue', import.meta.url), 'utf8')

test('家宽 IP 移动端状态标签显示在卡片右上角且不再展示状态字段', () => {
  const mobileBlock = source.match(/<div v-if="homeRoutingRoute" class="home-routing-mobile-list">[\s\S]*?<el-empty v-else/)?.[0] || ''

  assert.match(mobileBlock, /class="home-routing-mobile-status"/)
  assert.doesNotMatch(mobileBlock, /home-routing-mobile-label">状态/)
})

test('家宽 IP 移动端右侧可容纳状态标签和紧凑操作按钮', () => {
  assert.match(source, /\.home-routing-mobile-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) 82px/)
  assert.match(source, /\.home-routing-mobile-actions\s*\{[\s\S]*grid-row:\s*2/)
  assert.match(source, /\.home-routing-mobile-status\s*\{[\s\S]*grid-column:\s*2/)
  assert.match(source, /\.home-routing-mobile-actions :deep\(\.el-button\)\s*\{[\s\S]*min-height:\s*32px/)
  assert.match(source, /\.home-routing-mobile-actions :deep\(\.el-button\)\s*\{[\s\S]*font-size:\s*13px/)
})

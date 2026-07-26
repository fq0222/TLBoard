/**
 * 订阅节点移动端列表密度回归测试。
 * 职责：确保移动端节点卡片采用紧凑信息行，PC 表格结构保持可用。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../src/views/user/Subscription.vue', import.meta.url), 'utf8')

test('订阅节点移动端使用紧凑卡片展示完整节点信息', () => {
  assert.match(source, /class="nodes-table-wrap"/)
  assert.match(source, /class="nodes-mobile-list"/)
  assert.match(source, /class="node-mobile-card"/)
  assert.match(source, /class="node-mobile-top"/)
  assert.match(source, /class="node-mobile-title"/)
  assert.match(source, /class="node-mobile-tags"/)
  assert.match(source, /class="node-mobile-grid"/)
  assert.match(source, /地址/)
  assert.match(source, /端口/)
  assert.match(source, /备注/)
})

test('订阅节点移动端压缩卡片高度且不影响 PC 表格', () => {
  assert.match(source, /\.nodes-table-wrap\s*\{[\s\S]*width:\s*100%/)
  assert.match(source, /\.nodes-mobile-list\s*\{[\s\S]*display:\s*none/)
  assert.match(source, /@media \(max-width: 768px\)[\s\S]*\.nodes-table-wrap\s*\{[\s\S]*display:\s*none/)
  assert.match(source, /@media \(max-width: 768px\)[\s\S]*\.nodes-mobile-list\s*\{[\s\S]*display:\s*flex/)
  assert.match(source, /@media \(max-width: 768px\)[\s\S]*\.node-mobile-card\s*\{[\s\S]*padding:\s*8px 10px/)
  assert.match(source, /@media \(max-width: 768px\)[\s\S]*\.node-mobile-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/)
  assert.match(source, /@media \(max-width: 768px\)[\s\S]*\.node-mobile-value\s*\{[\s\S]*white-space:\s*nowrap/)
})

/**
 * 工单列表移动端卡片回归测试。
 * 职责：确保移动端完整展示工单标题、状态、创建时间、查看入口和未读标记，同时压缩单条高度。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const ticketsSource = readFileSync(new URL('../src/views/user/Tickets.vue', import.meta.url), 'utf8')

/**
 * 按大括号深度提取指定媒体查询块。
 *
 * @param {string} source - 待检查源码。
 * @param {string} query - 不含 @media 的媒体查询条件。
 * @returns {string} 完整媒体查询块。
 */
function extractMediaBlock(source, query) {
  const mediaStart = source.indexOf(`@media ${query}`)
  if (mediaStart === -1) return ''

  const blockStart = source.indexOf('{', mediaStart)
  if (blockStart === -1) return ''

  let depth = 0
  for (let index = blockStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(mediaStart, index + 1)
    }
  }

  return ''
}

test('工单列表桌面端保留表格视图', () => {
  assert.match(ticketsSource, /<el-table[\s\S]*:data="tickets"/)
  assert.match(ticketsSource, /<el-table-column prop="title" label="工单标题"/)
  assert.match(ticketsSource, /<el-table-column prop="status" label="状态"/)
  assert.match(ticketsSource, /<el-table-column prop="created_at" label="创建时间"/)
})

test('工单列表移动端提供紧凑卡片并展示完整信息', () => {
  assert.match(ticketsSource, /class="mobile-ticket-list"/)
  assert.match(ticketsSource, /class="mobile-ticket-card"/)
  assert.match(ticketsSource, /class="mobile-ticket-title"/)
  assert.match(ticketsSource, /class="mobile-ticket-status"/)
  assert.match(ticketsSource, /class="mobile-ticket-field"/)
  assert.match(ticketsSource, />\s*创建\s*</)
  assert.match(ticketsSource, /formatCompactTime\(ticket\.created_at\)/)
  assert.match(ticketsSource, />\s*查看\s*</)
  assert.match(ticketsSource, /v-if="ticket\.is_unread"/)
})

test('工单列表移动端隐藏表格并显示卡片列表', () => {
  const mobileStyles = extractMediaBlock(ticketsSource, '(max-width: 768px)')

  assert.ok(mobileStyles, '应存在工单列表移动端样式')
  assert.match(mobileStyles, /\.tickets-table\s*\{[\s\S]*display:\s*none/)
  assert.match(mobileStyles, /\.mobile-ticket-list\s*\{[\s\S]*display:\s*flex/)
  assert.match(mobileStyles, /\.mobile-ticket-card\s*\{[\s\S]*padding:\s*10px 12px/)
  assert.match(mobileStyles, /\.mobile-ticket-meta\s*\{[\s\S]*grid-template-columns/)
})

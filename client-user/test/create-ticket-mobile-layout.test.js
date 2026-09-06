/**
 * 创建工单移动端布局回归测试。
 * 职责：确保移动端表单标签位于输入框上方，避免标题和描述输入区横向挤压。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const createTicketSource = readFileSync(
  new URL('../src/views/user/CreateTicket.vue', import.meta.url),
  'utf8'
)

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

test('创建工单桌面端保留横向表单标签宽度', () => {
  assert.match(createTicketSource, /<el-form[\s\S]*label-width="100px"/)
  assert.match(createTicketSource, /<el-form-item label="工单标题" prop="title">/)
  assert.match(createTicketSource, /<el-form-item label="问题描述" prop="description">/)
})

test('创建工单移动端表单标签显示在输入框上方', () => {
  const mobileStyles = extractMediaBlock(createTicketSource, '(max-width: 768px)')

  assert.ok(mobileStyles, '应存在创建工单移动端样式')
  assert.match(
    mobileStyles,
    /:deep\(\.el-form-item\)\s*\{[\s\S]*display:\s*block/
  )
  assert.match(
    mobileStyles,
    /:deep\(\.el-form-item__label\)\s*\{[\s\S]*display:\s*block[\s\S]*text-align:\s*left/
  )
  assert.match(
    mobileStyles,
    /:deep\(\.el-form-item__content\)\s*\{[\s\S]*margin-left:\s*0\s*!important/
  )
})

test('创建工单移动端输入框和提交按钮使用完整宽度', () => {
  const mobileStyles = extractMediaBlock(createTicketSource, '(max-width: 768px)')

  assert.match(mobileStyles, /:deep\(\.el-input\)\s*\{[\s\S]*width:\s*100%/)
  assert.match(mobileStyles, /:deep\(\.el-textarea\)\s*\{[\s\S]*width:\s*100%/)
  assert.match(mobileStyles, /:deep\(\.el-button--primary\)\s*\{[\s\S]*width:\s*100%/)
})

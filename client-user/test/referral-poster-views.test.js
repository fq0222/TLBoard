import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 读取用户端源码。
 * @param {string} relativePath - 相对 client-user 目录的源码路径。
 * @returns {string} UTF-8 文本。
 */
function readClientSource(relativePath) {
  return readFileSync(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    'utf8'
  )
}

/**
 * 按大括号深度提取指定媒体查询块。
 * @param {string} source - 待检查的 Vue 源码。
 * @param {string} query - 不含 @media 的媒体查询条件。
 * @returns {string} 完整媒体查询块，未找到或块不完整时返回空文本。
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

const componentPath = fileURLToPath(
  new URL('../src/components/ReferralPosterDialog.vue', import.meta.url)
)
const componentExists = existsSync(componentPath)
const componentSource = componentExists ? readFileSync(componentPath, 'utf8') : ''
const mySource = readClientSource('src/views/user/My.vue')
const profileSource = readClientSource('src/views/user/Profile.vue')
const profileMobileSource = extractMediaBlock(profileSource, '(max-width: 768px)')
const profilePosterTag =
  profileSource.match(/<ReferralPosterDialog\b[^>]*>/)?.[0] || ''

test('共享海报弹窗暴露打开方法并生成推广二维码', () => {
  assert.ok(componentExists, `共享海报组件不存在：${componentPath}`)
  assert.match(componentSource, /defineExpose\(\{\s*open\s*\}\)/)
  assert.match(componentSource, /QRCode\.toDataURL\(\s*referralUrl/)
})

test('共享海报弹窗支持复制推广链接并提示成功', () => {
  assert.ok(componentExists, `共享海报组件不存在：${componentPath}`)
  assert.match(componentSource, /@click\s*=\s*["']copyReferralLink["']/)
  assert.match(componentSource, /ElMessage\.success\(\s*["']推广链接已复制["']\s*\)/)
})

test('共享海报弹窗使用当前打开请求的链接快照生成并复制', () => {
  assert.ok(componentExists, `共享海报组件不存在：${componentPath}`)
  assert.match(componentSource, /const\s+activeReferralUrl\s*=\s*ref\(/)
  assert.match(componentSource, /copyToClipboard\(\s*activeReferralUrl\.value\s*\)/)
  assert.match(componentSource, /const\s+openRequestId\s*=\s*ref\(/)
  assert.match(componentSource, /const\s+requestId\s*=\s*\+\+openRequestId\.value/)
  assert.match(componentSource, /requestId\s*!==\s*openRequestId\.value/)
})

test('我的页面复用共享海报弹窗且不再自行生成二维码', () => {
  assert.match(mySource, /<ReferralPosterDialog/)
  assert.doesNotMatch(mySource, /QRCode\.toDataURL/)
})

test('个人中心订阅工作区提供分享好友入口', () => {
  assert.match(
    profileSource,
    /class\s*=\s*["']panel-head subscription-workspace-head["']/
  )
  assert.match(profileSource, />\s*分享给好友\s*</)
  assert.match(profileSource, /<ReferralPosterDialog/)
  assert.match(
    profilePosterTag,
    /\bref\s*=\s*["']referralPosterRef["']/
  )
  assert.match(
    profilePosterTag,
    /:referral-url\s*=\s*["']referralUrl["']/
  )
  assert.match(
    profileSource,
    /@click\s*=\s*["']referralPosterRef\s*\?\.\s*open\(\s*\)["']/
  )
})

test('个人中心加载推广信息并适配移动端分享按钮', () => {
  assert.match(profileSource, /api\.user\.getReferralSummary\(\s*\)/)
  assert.match(profileMobileSource, /\.share-friend-button\b/)
})

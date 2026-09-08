/**
 * 用户端首页四卡工作台结构回归测试。
 * 锁定首页首屏卡片、迷你订阅复制和公告标题弹窗的关键 UI 语义。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const viewPath = fileURLToPath(new URL('../src/views/user/Profile.vue', import.meta.url))
const viewSource = readFileSync(viewPath, 'utf8')

test('首页顶部使用四张仪表盘卡片承载核心信息', () => {
  assert.match(viewSource, /<section class="dashboard-card-grid">/)
  assert.match(viewSource, /class="panel-card dashboard-card referral-card"/)
  assert.match(viewSource, /class="panel-card dashboard-card package-card"/)
  assert.match(viewSource, /class="panel-card dashboard-card mini-subscription-card"/)
  assert.match(viewSource, /class="panel-card dashboard-card announcement-card"/)
  assert.match(viewSource, /推广奖励总额/)
})

test('账户信息卡内展示四个纯文字快捷入口并移除推广余额文案', () => {
  const referralCardSource = viewSource.match(
    /<article class="panel-card dashboard-card referral-card">([\s\S]*?)<\/article>/
  )?.[1] || ''
  assert.ok(referralCardSource, '应存在账户信息卡')
  assert.match(referralCardSource, /<dt>余额<\/dt>/)
  assert.doesNotMatch(referralCardSource, /推广余额/)
  assert.match(referralCardSource, /class="referral-action-row"/)
  assert.match(referralCardSource, /新手引导/)
  assert.match(referralCardSource, /分享给好友/)
  assert.match(referralCardSource, /加入电报频道/)
  assert.match(referralCardSource, /在线客服/)
  assert.match(viewSource, /\.referral-action-row\s*\{[\s\S]*display:\s*flex/)
  assert.match(viewSource, /\.referral-action-row\s+\.text-link-button\s*\{[\s\S]*margin-top:\s*0/)
  assert.doesNotMatch(viewSource, /<section class="quick-action-row">/)
  assert.doesNotMatch(viewSource, /官方电报频道/)
})

test('账户信息卡四个纯文字快捷入口悬停时统一显示下划线', () => {
  assert.match(
    viewSource,
    /\.referral-action-row\s+\.text-link-button:hover,[\s\S]*\.referral-action-row\s+\.text-link-button:focus-visible\s*\{[\s\S]*text-decoration:\s*underline/
  )
})

test('移动端账户信息卡四个快捷入口保持同一行和同字号', () => {
  const mobileSource = viewSource.match(
    /@media \(max-width:\s*768px\)\s*\{([\s\S]*)\n\}/
  )?.[1] || ''

  assert.ok(mobileSource, '应存在移动端样式')
  assert.match(mobileSource, /\.referral-action-row\s*\{[\s\S]*flex-wrap:\s*nowrap/)
  assert.match(mobileSource, /\.referral-action-row\s*\{[\s\S]*margin-top:\s*18px/)
  assert.match(mobileSource, /\.referral-action-row\s*\{[\s\S]*margin-bottom:\s*0/)
  assert.match(mobileSource, /\.referral-card\s*\{[\s\S]*padding-bottom:\s*12px/)
  assert.match(mobileSource, /\.referral-action-row\s+\.text-link-button\s*\{[\s\S]*font-size:\s*13px/)
  assert.match(mobileSource, /\.referral-action-row\s+\.text-link-button\s*\{[\s\S]*padding:\s*0/)
  assert.doesNotMatch(mobileSource, /\.share-friend-button\s*\{[\s\S]*font-size:\s*12px/)
})

test('套餐信息卡隐藏套餐名百分比和流量括号明细', () => {
  assert.match(viewSource, /{{ compactTrafficUsageText }}/)
  assert.doesNotMatch(viewSource, /{{ userInfo\.plan_name \|\| '流量套餐' }}/)
  assert.doesNotMatch(viewSource, /{{ userInfo\.traffic_percent \|\| 0 }}%/)
  assert.doesNotMatch(viewSource, /套餐：/)
})

test('套餐信息卡进度条展示在到期时间上方', () => {
  const packageCardSource = viewSource.match(
    /<article class="panel-card dashboard-card package-card">([\s\S]*?)<\/article>/
  )?.[1] || ''

  assert.ok(packageCardSource, '应存在套餐信息卡')
  assert.ok(
    packageCardSource.indexOf('<el-progress') < packageCardSource.indexOf('<dt>到期时间</dt>'),
    '流量进度条应位于到期时间上方'
  )
})

test('套餐信息卡右上角用账号状态标志替代套餐图标', () => {
  const packageCardSource = viewSource.match(
    /<article class="panel-card dashboard-card package-card">([\s\S]*?)<\/article>/
  )?.[1] || ''

  assert.ok(packageCardSource, '应存在套餐信息卡')
  assert.match(packageCardSource, /class="package-status-tag"/)
  assert.match(packageCardSource, /:type="accountStatusType"/)
  assert.match(packageCardSource, /{{ accountStatusText }}/)
  assert.doesNotMatch(packageCardSource, /DataAnalysis/)
  assert.doesNotMatch(viewSource, /DataAnalysis,\s*/)
  assert.match(viewSource, /\.package-status-tag\s*\{[\s\S]*height:\s*24px/)
  assert.match(viewSource, /\.package-status-tag\s*\{[\s\S]*font-size:\s*13px/)
  assert.match(viewSource, /\.package-status-tag\s*\{[\s\S]*font-weight:\s*700/)
})

test('首页四张卡片高度比首版四卡布局减少四分之一', () => {
  assert.match(viewSource, /height:\s*clamp\(188px,\s*18vw,\s*260px\)/)
  assert.doesNotMatch(viewSource, /min-height:\s*30vh/)
})

test('首页四卡在大屏下限制整体宽度避免卡片过宽', () => {
  assert.match(viewSource, /max-width:\s*1680px/)
  assert.match(viewSource, /margin:\s*0 auto/)
})

test('订阅工作区大屏下用上下分布平衡空白', () => {
  assert.match(viewSource, /\.mini-subscription-card\s*\{[\s\S]*justify-content:\s*space-between/)
  assert.match(viewSource, /@media \(min-width:\s*1600px\)[\s\S]*\.mini-copy-list/)
})

test('首页四卡在大屏下通过间距和顶部留白增强呼吸感', () => {
  const wideScreenSource = viewSource.match(
    /@media \(min-width:\s*1600px\)\s*\{([\s\S]*?)\n\}/
  )?.[1] || ''

  assert.ok(wideScreenSource, '应存在 1600px 以上的大屏样式')
  assert.match(wideScreenSource, /\.profile-container\s*\{[\s\S]*padding-top:\s*clamp\(12px,\s*1\.5vw,\s*28px\)/)
  assert.match(wideScreenSource, /\.dashboard-card-grid\s*\{[\s\S]*gap:\s*32px/)
})

test('首页迷你订阅区只展示复制入口而不渲染订阅链接输入框', () => {
  const miniCopyRowSource = viewSource.match(
    /\.mini-copy-row\s*\{([\s\S]*?)\n\}/
  )?.[1] || ''
  const miniCopyDescSource = viewSource.match(
    /\.mini-copy-desc\s*\{([\s\S]*?)\n\}/
  )?.[1] || ''
  const miniCopyDescSpanSelector = '.mini-copy-row .mini-copy-desc span'
  const miniCopyDescSpanSource = viewSource.match(
    /\.mini-copy-row\s+\.mini-copy-desc\s+span\s*\{([\s\S]*?)\n\}/
  )?.[1] || ''

  assert.match(viewSource, /class="mini-subscription-actions"/)
  assert.match(viewSource, /class="mini-copy-row"/)
  assert.match(viewSource, /适用于 v2rayN、v2rayNG、Shadowrocket等客户端/)
  assert.match(viewSource, /适用于 FlClash、Clash Verge、Clash Mi等客户端/)
  assert.match(viewSource, /class="mini-copy-desc"/)
  assert.ok(miniCopyRowSource, '应存在订阅复制行样式')
  assert.match(miniCopyRowSource, /height:\s*42px/)
  assert.match(miniCopyRowSource, /padding:\s*5px 10px/)
  assert.match(miniCopyRowSource, /box-sizing:\s*border-box/)
  assert.ok(miniCopyDescSource, '应存在订阅说明文字样式')
  assert.match(miniCopyDescSource, /margin-left:\s*12px/)
  assert.match(miniCopyDescSource, /font-size:\s*10px/)
  assert.match(miniCopyDescSource, /line-height:\s*1\.15/)
  assert.doesNotMatch(miniCopyDescSource, /text-overflow:\s*ellipsis/)
  assert.doesNotMatch(miniCopyDescSource, /-webkit-line-clamp/)
  assert.ok(miniCopyDescSpanSource, '说明文字内部两行应使用高权重规则，避免被通用 span 样式覆盖')
  assert.ok(
    viewSource.indexOf(miniCopyDescSpanSelector) > viewSource.indexOf('.mini-copy-row span'),
    '说明文字内部 span 覆盖规则应位于通用 span 规则之后'
  )
  assert.match(miniCopyDescSpanSource, /font-size:\s*inherit/)
  assert.match(miniCopyDescSpanSource, /font-weight:\s*inherit/)
  assert.match(miniCopyDescSpanSource, /line-height:\s*inherit/)
  assert.match(viewSource, /copyLink\(userInfo\.subscription_url\)/)
  assert.match(viewSource, /copyLink\(userInfo\.clash_url\)/)
  assert.match(viewSource, /ElMessage\.warning\('没有订阅链接，需要先生成'\)/)
  assert.doesNotMatch(viewSource, /:model-value="userInfo\.subscription_url"/)
  assert.doesNotMatch(viewSource, /:model-value="userInfo\.clash_url"/)
})

test('订阅工作区动作按钮显示步骤文案且首页不再展示续费套餐按钮', () => {
  const miniSubscriptionSource = viewSource.match(
    /<article class="panel-card dashboard-card mini-subscription-card">([\s\S]*?)<\/article>/
  )?.[1] || ''

  assert.ok(miniSubscriptionSource, '应存在订阅工作区卡片')
  assert.match(miniSubscriptionSource, /<span class="step-action-index">步骤1<\/span>/)
  assert.match(miniSubscriptionSource, /<span class="step-action-index">步骤2<\/span>/)
  assert.doesNotMatch(viewSource, /续费套餐/)
})

test('首页公告列表点击标题后使用同圆角弹窗展示详情', () => {
  assert.match(viewSource, /@click="openAnnouncementDetail\(announcement\)"/)
  assert.match(viewSource, /class="announcement-dot"[\s\S]*pinned:\s*announcement\.pinned/)
  assert.match(viewSource, /class="announcement-detail-dialog"/)
  assert.match(viewSource, /border-radius:\s*var\(--dashboard-card-radius\)/)
})

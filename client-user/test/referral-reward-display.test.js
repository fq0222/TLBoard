import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateReferralRewardAmount,
  normalizeReferralRewardPercent
} from '../src/utils/referral-reward-display.js'
import { readFileSync } from 'node:fs'

const myPageSource = readFileSync(new URL('../src/views/user/My.vue', import.meta.url), 'utf8')
const referralPageSource = readFileSync(new URL('../src/views/user/Referral.vue', import.meta.url), 'utf8')

test('推广奖励展示会根据接口系数动态计算百分比', () => {
  assert.equal(normalizeReferralRewardPercent({ reward_coefficient: 0.5 }), 50)
  assert.equal(normalizeReferralRewardPercent({ reward_percent: 33.33 }), 33.33)
  assert.equal(normalizeReferralRewardPercent({}), 0)
})

test('推广奖励示例金额会按接口系数计算而不是写死50元', () => {
  assert.equal(calculateReferralRewardAmount(100, { reward_coefficient: 0.5 }), 50)
  assert.equal(calculateReferralRewardAmount(100, { reward_coefficient: 0.3 }), 30)
  assert.equal(calculateReferralRewardAmount(100, {}), 0)
})

test('我的页面推广提示不重复展示右侧百元奖励示例卡', () => {
  assert.doesNotMatch(myPageSource, /class="reward-example"/)
})

test('我的页面删除推广标题说明并把该文案移入奖励卡', () => {
  assert.doesNotMatch(myPageSource, /<p class="section-subtitle">/)
  assert.match(
    myPageSource,
    /class="reward-callout"[\s\S]*?<p>邀请好友完成首购，你可获得订单实付金额\{\{ rewardPercent \}\}%的奖励余额<\/p>/
  )
})

test('推广详情页的奖励计算卡在移动端占满可用宽度', () => {
  assert.match(
    referralPageSource,
    /@media \(max-width: 768px\)[\s\S]*?\.reward-calculation\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?box-sizing:\s*border-box;/
  )
})

test('推广详情页双端不再展示奖励自动到账提示文案', () => {
  assert.doesNotMatch(referralPageSource, /无需申请，符合条件的奖励将在好友付款成功后自动到账/)
})

test('推广详情页电脑端把复制按钮放在推广链接右侧', () => {
  assert.match(referralPageSource, /\.link-box\s*\{[\s\S]*?grid-column:\s*1;/)
  assert.match(referralPageSource, /\.link-card-action\s*\{[\s\S]*?grid-column:\s*2;/)
})

test('推广详情页双端删除异常订单不发放奖励规则', () => {
  assert.doesNotMatch(referralPageSource, /退款、取消、异常或违规订单不发放奖励/)
})

test('推广详情页移动端奖励规则分割线在折叠时保持全宽', () => {
  assert.match(
    referralPageSource,
    /@media \(max-width: 768px\)[\s\S]*?\.reward-rules\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?box-sizing:\s*border-box;/
  )
})

test('推广详情页主卡片圆角与我的页面保持一致', () => {
  assert.match(
    referralPageSource,
    /\.hero-card,\s*\.panel-card\s*\{[\s\S]*?border-radius:\s*8px;/
  )
  assert.match(
    referralPageSource,
    /@media \(max-width: 768px\)[\s\S]*?\.hero-card,\s*\.panel-card\s*\{[\s\S]*?border-radius:\s*8px;/
  )
})

test('推广详情页移动端使用紧凑卡片展示全部奖励字段', () => {
  assert.match(referralPageSource, /class="mobile-reward-list"/)
  assert.match(referralPageSource, /class="mobile-reward-card"/)
  assert.match(referralPageSource, /付款用户[\s\S]*?订单号[\s\S]*?奖励金额[\s\S]*?付款金额[\s\S]*?奖励时间/)
  assert.match(
    referralPageSource,
    /@media \(max-width: 768px\)[\s\S]*?\.reward-table\s*\{[\s\S]*?display:\s*none;[\s\S]*?\.mobile-reward-list\s*\{[\s\S]*?display:\s*flex;/
  )
})

test('推广详情页移动端奖励卡沿用我的订单字号和紧凑间距', () => {
  assert.match(referralPageSource, /\.mobile-reward-card\s*\{[\s\S]*?padding:\s*8px 10px;[\s\S]*?border-radius:\s*8px;/)
  assert.match(referralPageSource, /\.mobile-reward-label[\s\S]*?font-size:\s*11px;/)
  assert.match(referralPageSource, /\.mobile-reward-user[\s\S]*?font-size:\s*13px;/)
  assert.match(referralPageSource, /\.mobile-reward-value[\s\S]*?font-size:\s*12px;/)
})

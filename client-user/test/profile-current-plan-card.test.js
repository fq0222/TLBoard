/**
 * 个人中心我的套餐区域结构测试。
 * 锁定套餐卡片的核心字段、状态分支、临期样式和续费入口。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const profilePath = fileURLToPath(new URL('../src/views/user/Profile.vue', import.meta.url))
const profileSource = readFileSync(profilePath, 'utf8')

test('个人中心首页展示我的套餐分区、类型标签和当前套餐卡片', () => {
  assert.match(profileSource, /class="current-plan-section"/)
  assert.match(profileSource, />\s*我的套餐\s*</)
  assert.match(profileSource, /class="current-plan-count"/)
  assert.match(profileSource, /class="current-plan-filter"/)
  assert.match(profileSource, /v-for="filter in currentPlanFilters"/)
  assert.match(profileSource, /selectedCurrentPlanFilter/)
  assert.match(profileSource, />\s*全部\s*</)
  assert.match(profileSource, /v-for="plan in filteredCurrentPlanCards"/)
  assert.match(profileSource, /class="[^"]*\bcurrent-plan-card\b[^"]*"/)
  assert.match(profileSource, /plan\.name/)
  assert.match(profileSource, /plan\.priceText/)
  assert.match(profileSource, /plan\.trafficText/)
  assert.match(profileSource, /plan\.durationText/)
})

test('我的套餐卡片展示正常和过期状态，并在临近到期时高亮到期时间', () => {
  assert.match(profileSource, /getPlanStatusText\(plan\)/)
  assert.match(profileSource, /getPlanStatusType\(plan\)/)
  assert.match(profileSource, /isPlanExpired\(plan\)/)
  assert.match(profileSource, /isPlanExpiringSoon\(plan\)/)
  assert.match(profileSource, /isPlanExpireWarning\(plan\)/)
  assert.match(profileSource, /class="\{ warning: isPlanExpireWarning\(plan\) \}"/)
  assert.match(profileSource, />\s*到期时间：\s*\{\{\s*plan\.expireText\s*\}\}/)
  assert.match(profileSource, /过期/)
  assert.match(profileSource, /正常/)
})

test('我的套餐卡片提供浅绿色续费按钮并跳转套餐页', () => {
  assert.match(profileSource, /class="renew-plan-button"/)
  assert.match(profileSource, /:to="getCurrentPlanRenewRoute\(plan\)"/)
  assert.match(profileSource, /function getCurrentPlanRenewRoute\(plan\)/)
  assert.match(profileSource, /path:\s*'\/user\/plans'/)
  assert.match(profileSource, /plan_id:\s*plan\.planId/)
  assert.match(profileSource, /plan_type:\s*plan\.planType/)
  assert.match(profileSource, />\s*续费\s*</)
  assert.match(profileSource, /\.renew-plan-button\s*\{[\s\S]*background:\s*#e9f9ef/)
  assert.match(profileSource, /\.renew-plan-button\s*\{[\s\S]*color:\s*#009b51/)
})

test('我的套餐卡片保持上方单卡宽度，右侧价格使用同色绿色样式，指标上下排布', () => {
  assert.match(profileSource, /\.current-plan-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(profileSource, /class="current-plan-side"/)
  assert.match(profileSource, /<div class="current-plan-side">[\s\S]*<el-tag[\s\S]*class="current-plan-price"/)
  assert.match(profileSource, /class="current-plan-price"/)
  assert.match(profileSource, /class="current-plan-currency"/)
  assert.match(profileSource, /class="current-plan-amount"/)
  assert.match(profileSource, /\.current-plan-currency\s*\{[\s\S]*font-size:\s*13px/)
  assert.match(profileSource, /\.current-plan-currency\s*\{[\s\S]*color:\s*#0f766e/)
  assert.match(profileSource, /\.current-plan-amount\s*\{[\s\S]*color:\s*#0f766e/)
  assert.match(profileSource, /\.current-plan-price\s*\{[\s\S]*margin-top:\s*16px/)
  assert.match(profileSource, /\.current-plan-body\s*\{[\s\S]*grid-template-columns:\s*1fr/)
})

test('我的套餐到期时间使用横杠年月日和时分秒格式', () => {
  assert.match(profileSource, /function formatCurrentPlanExpireTime\(timestamp\)/)
  assert.match(profileSource, /padStart\(2,\s*'0'\)/)
  assert.match(profileSource, /\$\{year\}-\$\{month\}-\$\{day\} \$\{hour\}:\$\{minute\}:\$\{second\}/)
  assert.match(profileSource, /formatCurrentPlanExpireTime\(expireAt\)/)
})

test('我的套餐同时展示流量套餐和家宽套餐，家宽流量使用显示无限制', () => {
  assert.match(profileSource, /const currentPlanCards = computed\(\(\) =>/)
  assert.match(profileSource, /if \(userInfo\.value\.plan_id\)/)
  assert.match(profileSource, /if \(userInfo\.value\.home_plan_id\)/)
  assert.match(profileSource, /type:\s*'traffic'/)
  assert.match(profileSource, /type:\s*'home_ip'/)
  assert.match(profileSource, /planId:\s*userInfo\.value\.plan_id/)
  assert.match(profileSource, /planId:\s*userInfo\.value\.home_plan_id/)
  assert.match(profileSource, /name:\s*userInfo\.value\.home_plan_name/)
  assert.match(profileSource, /trafficText:\s*'无限制'/)
  assert.match(profileSource, /expireAt:\s*userInfo\.value\.home_expire_at/)
})

test('我的套餐类型标签按数据库套餐类型映射并默认选择全部', () => {
  assert.match(profileSource, /const selectedCurrentPlanFilter = ref\('all'\)/)
  assert.match(profileSource, /const CURRENT_PLAN_FILTER_ALL = 'all'/)
  assert.match(profileSource, /const CURRENT_PLAN_TYPE_LABELS = \{/)
  assert.match(profileSource, /timed:\s*'限时套餐'/)
  assert.match(profileSource, /lifetime:\s*'不限时套餐'/)
  assert.match(profileSource, /home_ip:\s*'家宽套餐'/)
  assert.match(profileSource, /const currentPlanFilters = computed\(\(\) =>/)
  assert.match(profileSource, /new Set\(currentPlanCards\.value\.map\(\(plan\) => plan\.planType\)\)/)
  assert.match(profileSource, /const filteredCurrentPlanCards = computed\(\(\) =>/)
  assert.match(profileSource, /selectedCurrentPlanFilter\.value === CURRENT_PLAN_FILTER_ALL/)
  assert.match(profileSource, /plan\.planType === selectedCurrentPlanFilter\.value/)
})

test('我的套餐类型缺省时按历史不限时套餐处理，避免误显示限时标签', () => {
  assert.match(profileSource, /function resolveCurrentPlanType\(planType\)/)
  assert.match(profileSource, /return 'lifetime'/)
  assert.match(profileSource, /planType:\s*resolveCurrentPlanType\(userInfo\.value\.plan_type\)/)
  assert.doesNotMatch(profileSource, /planType:\s*userInfo\.value\.plan_type/)
  assert.doesNotMatch(profileSource, /planType:\s*options\.planType \|\| 'timed'/)
})

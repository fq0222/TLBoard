/**
 * 用户端套餐页面入口回归测试。
 * 职责：锁定续费弹窗迁移为独立套餐页后的路由、导航顺序和原续费流程复用约束。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const layoutSource = readFileSync(new URL('../src/views/user/Layout.vue', import.meta.url), 'utf8')
const routerSource = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
const profileSource = readFileSync(new URL('../src/views/user/Profile.vue', import.meta.url), 'utf8')
const plansPageUrl = new URL('../src/views/user/Plans.vue', import.meta.url)

test('用户中心提供套餐页面路由并加载套餐页', () => {
  assert.match(routerSource, /path:\s*'plans'/)
  assert.match(routerSource, /name:\s*'UserPlans'/)
  assert.match(routerSource, /meta:\s*\{\s*title:\s*'套餐页面'\s*\}/)
  assert.match(routerSource, /import\('@\/views\/user\/Plans\.vue'\)/)
  assert.ok(existsSync(plansPageUrl), '应存在独立套餐页面')
})

test('电脑端和移动端导航都把套餐放在订阅与教程中间', () => {
  const navItemsBlock = layoutSource.match(/const navItems = \[[\s\S]*?\]/)?.[0]

  assert.ok(navItemsBlock, '应存在 navItems 配置')
  assert.match(navItemsBlock, /key:\s*'plans'/)
  assert.match(navItemsBlock, /label:\s*'套餐'/)
  assert.match(navItemsBlock, /to:\s*'\/user\/plans'/)
  assert.ok(
    navItemsBlock.indexOf("key: 'subscription'") < navItemsBlock.indexOf("key: 'plans'"),
    '套餐应排在订阅后面'
  )
  assert.ok(
    navItemsBlock.indexOf("key: 'plans'") < navItemsBlock.indexOf("key: 'help'"),
    '套餐应排在教程前面'
  )
  assert.match(layoutSource, /const mobileNavItems = navItems/)
  assert.match(layoutSource, /import\('@\/views\/user\/Plans\.vue'\)/)
})

test('个人首页续费套餐按钮跳转到套餐页面并移除弹窗入口', () => {
  assert.match(profileSource, /@click="goToPlansPage"/)
  assert.match(profileSource, /router\.push\('\/user\/plans'\)/)
  assert.doesNotMatch(profileSource, /<RenewDialog/)
  assert.doesNotMatch(profileSource, /showRenewDialog/)
  assert.doesNotMatch(profileSource, /import RenewDialog/)
})

test('套餐页复用续费接口与支付跳转逻辑，并保留家宽 IP 未获取区域', () => {
  const plansSource = readFileSync(plansPageUrl, 'utf8')

  assert.match(plansSource, /api\.user\.getRenewPlans/)
  assert.match(plansSource, /api\.user\.renew/)
  assert.match(plansSource, /path:\s*'\/payment\/callback'/)
  assert.match(plansSource, /confirm_reset:\s*confirmReset/)
  assert.match(plansSource, /isRenewResetConfirmError/)
  assert.match(plansSource, /余额支付成功，续费已完成/)
  assert.match(plansSource, /流量套餐/)
  assert.match(plansSource, /家宽IP套餐/)
  assert.match(plansSource, /未获取/)
})

test('套餐页不再展示顶部标题和当前套餐概览区域', () => {
  const plansSource = readFileSync(plansPageUrl, 'utf8')

  assert.doesNotMatch(plansSource, /class="plans-header"/)
  assert.doesNotMatch(plansSource, /class="page-kicker"/)
  assert.doesNotMatch(plansSource, /class="current-plan"/)
})

test('套餐页已选摘要保留套餐名、流量和时长语义块', () => {
  const plansSource = readFileSync(plansPageUrl, 'utf8')

  assert.match(plansSource, /class="summary-name"/)
  assert.match(plansSource, /class="summary-traffic"/)
  assert.match(plansSource, /class="summary-duration"/)
  assert.match(plansSource, /formatTraffic\(selectedPlan\.traffic_limit\)/)
  assert.match(plansSource, /selectedPlan\.durationText/)
  assert.doesNotMatch(plansSource, /formatTraffic\(selectedPlan\.traffic_limit\)} \/ \$\{selectedPlan\.durationText/)
})

test('套餐页已选摘要使用紧凑套餐卡片展示价格、流量和时长', () => {
  const plansSource = readFileSync(plansPageUrl, 'utf8')

  assert.match(plansSource, /class="[^"]*summary-card[^"]*"/)
  assert.match(plansSource, /class="summary-price"/)
  assert.match(plansSource, /formatPrice\(selectedPlan\.price\)/)
  assert.match(plansSource, /class="summary-metrics"/)
  assert.match(plansSource, /class="summary-metric"[\s\S]*流量/)
  assert.match(plansSource, /class="summary-metric"[\s\S]*时长/)
})

test('套餐页不再展示优先推荐角标', () => {
  const plansSource = readFileSync(plansPageUrl, 'utf8')

  assert.doesNotMatch(plansSource, /优先推荐/)
  assert.doesNotMatch(plansSource, /plan-badge recommend/)
})

test('套餐页展示指定的套餐选择说明和支付说明文案', () => {
  const plansSource = readFileSync(plansPageUrl, 'utf8')

  assert.match(plansSource, /每次支付每种套餐只能选择一个进行购买，不能够组合支付。/)
  assert.match(plansSource, /如果想要购买的套餐已经售罄，请联系客服进行处理。/)
  assert.match(plansSource, /余额大于套餐价格就可以直接支付。/)
  assert.match(plansSource, /微信或支付宝手机用户支付时，请把待支付二维码截图，去微信或支付宝中使用扫码支付，选择刚才的截图去支付。/)
})

test('余额支付卡片右侧展示推广余额金额且不使用强调样式', () => {
  const plansSource = readFileSync(plansPageUrl, 'utf8')

  assert.match(plansSource, /class="pay-balance-amount"/)
  assert.match(plansSource, /¥\{\{\s*formatPrice\(userInfo\.balance\)\s*\}\}/)
  assert.match(plansSource, /\.pay-balance-amount\s*\{[\s\S]*?color:\s*var\(--text-main\);/)
  assert.match(plansSource, /\.pay-balance-amount\s*\{[\s\S]*?font-weight:\s*400;/)
})

test('移动端支付面板按选中的套餐类型插入到对应套餐大区块下方', () => {
  const plansSource = readFileSync(plansPageUrl, 'utf8')

  assert.match(plansSource, /const selectedPlanCategory = ref\('traffic'\)/)
  assert.match(plansSource, /selectedPlanCategory\.value = 'traffic'/)
  assert.match(plansSource, /class="mobile-payment-panel traffic-mobile-payment"[\s\S]*?v-if="selectedPlanCategory === 'traffic'"/)
  assert.match(plansSource, /class="mobile-payment-panel broadband-mobile-payment"[\s\S]*?v-if="selectedPlanCategory === 'broadband'"/)
  assert.match(plansSource, /class="desktop-payment-panel payment-panel"/)
  assert.match(plansSource, /@media \(max-width: 768px\)[\s\S]*?\.desktop-payment-panel\s*\{[\s\S]*?display:\s*none;/)
  assert.match(plansSource, /@media \(max-width: 768px\)[\s\S]*?\.mobile-payment-panel\s*\{[\s\S]*?display:\s*flex;/)
})

/**
 * 首页推广套餐的静态契约测试。
 * 校验当前 URL 推广码的传参与空值分支，并保留独立的推广归因流程。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const apiSource = readFileSync(new URL('../src/api/index.js', import.meta.url), 'utf8')
const homeSource = readFileSync(new URL('../src/views/Home.vue', import.meta.url), 'utf8')
const plansMethod = apiSource.match(/  getPlans\([^]*?\n  \},/)?.[0] || ''
const fetchPlans = homeSource.match(/async function fetchPlans\(\)[^]*?\n\}/)?.[0] || ''
const tracking = homeSource.match(/async function initializeReferralTracking\(\)[^]*?\n\}/)?.[0] || ''
const mounted = homeSource.match(/onMounted\(\(\) => \{[^]*?\n\}\)/)?.[0] || ''

test('套餐 API 仅对归一化后非空的推广码发送 ref 参数', () => {
  assert.match(plansMethod, /getPlans\(referralCode = ''\)/)
  assert.match(plansMethod, /const ref = String\(referralCode \|\| ''\)\.trim\(\)/)
  assert.match(plansMethod, /if \(ref\)\s*\{\s*return apiClient\.get\('\/plans', \{ params: \{ ref \} \}\)\s*\}/)
  assert.match(plansMethod, /\n\s*return apiClient\.get\('\/plans'\)\s*\n\s*\},/)
})

test('每轮首页套餐加载仅从当前路由归一化一次推广码并供重试复用', () => {
  assert.match(fetchPlans, /const referralCode = String\(route\.query\.ref \|\| ''\)\.trim\(\)/)
  assert.equal((fetchPlans.match(/route\.query\.ref/g) || []).length, 1)
  assert.match(fetchPlans, /loadPlansWithRetry\(\(\) => api\.user\.getPlans\(referralCode\)\)/)
  assert.doesNotMatch(fetchPlans, /sessionStorage|initializeReferralTracking|recordReferralClick/)
  assert.doesNotMatch(homeSource, /sessionStorage\.getItem\(['"]referral_code['"]\)/)
})

test('推广缓存和点击上报仍由独立初始化负责且不阻塞套餐加载', () => {
  assert.match(tracking, /const referralCode = String\(route\.query\.ref \|\| ''\)\.trim\(\)/)
  assert.match(tracking, /if \(!referralCode\)\s*\{\s*return\s*\}/)
  assert.match(tracking, /sessionStorage\.setItem\('referral_code', referralCode\)/)
  assert.match(tracking, /await api\.user\.recordReferralClick\(referralCode\)/)
  assert.match(mounted, /\{\s*initializeReferralTracking\(\)\s*fetchPlans\(\)\s*\}/)
})

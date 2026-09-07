/**
 * 用户端套餐页分类回归测试。
 * 覆盖流量套餐与家宽 IP 套餐同时存在时的分类和默认推荐规则。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDisplayPlans,
  filterHomeIpPlans,
  filterTrafficPlans,
  resolveRecommendedTrafficPlanId
} from '../src/utils/plan-categories.js'

const mixedPlans = [
  { id: 1, name: '基础套餐', plan_type: 'lifetime', duration_days: 0, is_soldout: false },
  { id: 6, name: '月卡套餐', plan_type: 'timed', duration_days: 30, is_soldout: false },
  { id: 10, name: '美国洛杉矶-1', plan_type: 'home_ip', duration_days: 30, is_soldout: false }
]

test('filterTrafficPlans 保留流量套餐并排除家宽 IP 套餐', () => {
  assert.deepEqual(filterTrafficPlans(mixedPlans).map((plan) => plan.id), [1, 6])
})

test('filterHomeIpPlans 只返回家宽 IP 套餐', () => {
  assert.deepEqual(filterHomeIpPlans(mixedPlans).map((plan) => plan.id), [10])
})

test('resolveRecommendedTrafficPlanId 只从流量套餐中选择默认套餐', () => {
  assert.equal(resolveRecommendedTrafficPlanId(mixedPlans), 1)
})

test('buildDisplayPlans 不依赖分类 computed 循环也能标记推荐套餐', () => {
  const displayPlans = buildDisplayPlans(mixedPlans, 6)

  assert.deepEqual(filterTrafficPlans(displayPlans).map((plan) => plan.id), [1, 6])
  assert.equal(displayPlans.find((plan) => plan.id === 6).isRecommended, true)
  assert.equal(displayPlans.find((plan) => plan.id === 10).isRecommended, false)
  assert.equal(displayPlans.find((plan) => plan.id === 10).durationText, '30 天周期')
})

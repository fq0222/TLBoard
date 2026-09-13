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
  paginatePlans,
  resolvePlanPage,
  resolveRecommendedTrafficPlanId,
  sortPlansWithCurrentFirst
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

test('sortPlansWithCurrentFirst 将当前套餐置顶并按权重和 ID 排序其余套餐', () => {
  const plans = [
    { id: 3, sort_order: 10 },
    { id: 2, sort_order: 10 },
    { id: 4, sort_order: 20 },
    { id: 1, sort_order: 30 }
  ]

  assert.deepEqual(sortPlansWithCurrentFirst(plans, 4).map((plan) => plan.id), [4, 2, 3, 1])
  assert.deepEqual(plans.map((plan) => plan.id), [3, 2, 4, 1])
})

test('paginatePlans 按设备每页数量返回对应套餐', () => {
  const plans = Array.from({ length: 6 }, (_, index) => ({ id: index + 1 }))

  assert.deepEqual(paginatePlans(plans, 1, 4).map((plan) => plan.id), [1, 2, 3, 4])
  assert.deepEqual(paginatePlans(plans, 2, 4).map((plan) => plan.id), [5, 6])
  assert.deepEqual(paginatePlans(plans, 2, 2).map((plan) => plan.id), [3, 4])
})

test('resolvePlanPage 返回指定套餐所在页且找不到时回到第一页', () => {
  const plans = Array.from({ length: 6 }, (_, index) => ({ id: index + 1 }))

  assert.equal(resolvePlanPage(plans, 6, 4), 2)
  assert.equal(resolvePlanPage(plans, 99, 4), 1)
})

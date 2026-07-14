/**
 * 首页套餐分类筛选回归测试。
 * 覆盖全部、限时、不限时三类导航对应的套餐展示规则。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { filterPlansByDurationType } from '../src/utils/plan-filter.js'

const plans = [
  { id: 1, name: '试用套餐', duration_days: 5 },
  { id: 2, name: '基础套餐', duration_days: 0 },
  { id: 3, name: '月卡套餐', duration_days: '30' }
]

test('filterPlansByDurationType 默认返回全部套餐', () => {
  assert.deepEqual(filterPlansByDurationType(plans, 'all').map((plan) => plan.id), [1, 2, 3])
})

test('filterPlansByDurationType 筛选限时套餐', () => {
  assert.deepEqual(filterPlansByDurationType(plans, 'limited').map((plan) => plan.id), [1, 3])
})

test('filterPlansByDurationType 筛选不限时套餐', () => {
  assert.deepEqual(filterPlansByDurationType(plans, 'unlimited').map((plan) => plan.id), [2])
})

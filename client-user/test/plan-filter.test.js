/**
 * 首页套餐分类筛选回归测试。
 * 使用混合类型数据验证首页四类导航的归属和原始顺序。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { filterPlansByDurationType } from '../src/utils/plan-filter.js'

const plans = [
  { id: 1, name: '试用套餐', plan_type: 'timed', duration_days: 5 },
  { id: 2, name: '住宅套餐', plan_type: 'home_ip', duration_days: 30 },
  { id: 3, name: '永久套餐', plan_type: 'lifetime', duration_days: 365 },
  { id: 4, name: '历史空类型', plan_type: null, duration_days: 30 },
  { id: 5, name: '历史缺省类型', duration_days: 0 },
  { id: 6, name: '历史空字符串类型', plan_type: '', duration_days: 0 },
  { id: 7, name: '月卡套餐', plan_type: 'timed', duration_days: 0 }
]

test('all 保留全部套餐及原始顺序，包括住宅 IP', () => {
  assert.deepEqual(filterPlansByDurationType(plans, 'all').map((plan) => plan.id), [1, 2, 3, 4, 5, 6, 7])
})

test('limited 只包含 timed，不按时长误收住宅 IP', () => {
  assert.deepEqual(filterPlansByDurationType(plans, 'limited').map((plan) => plan.id), [1, 7])
})

test('unlimited 包含 lifetime 与三种历史空类型', () => {
  assert.deepEqual(filterPlansByDurationType(plans, 'unlimited').map((plan) => plan.id), [3, 4, 5, 6])
})

test('home_ip 只包含住宅 IP 套餐', () => {
  assert.deepEqual(filterPlansByDurationType(plans, 'home_ip').map((plan) => plan.id), [2])
})

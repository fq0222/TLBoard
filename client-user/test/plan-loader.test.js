/**
 * 首页套餐加载重试逻辑回归测试。
 * 覆盖首次成功、失败后重试成功、失败后仅重试一次三个分支。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadPlansWithRetry } from '../src/utils/plan-loader.js'

test('loadPlansWithRetry 首次成功时直接返回套餐列表', async () => {
  let calls = 0
  const plans = [{ id: 1, name: '基础套餐' }]

  const result = await loadPlansWithRetry(async () => {
    calls += 1
    return { code: 0, data: { plans } }
  })

  assert.equal(calls, 1)
  assert.deepEqual(result, plans)
})

test('loadPlansWithRetry 首次失败后自动重试一次', async () => {
  let calls = 0
  const plans = [{ id: 2, name: '月卡套餐' }]

  const result = await loadPlansWithRetry(async () => {
    calls += 1
    if (calls === 1) throw new Error('network failed')
    return { code: 0, data: { plans } }
  })

  assert.equal(calls, 2)
  assert.deepEqual(result, plans)
})

test('loadPlansWithRetry 连续失败时只重试一次', async () => {
  let calls = 0
  const error = new Error('network failed')

  await assert.rejects(
    loadPlansWithRetry(async () => {
      calls += 1
      throw error
    }),
    error
  )

  assert.equal(calls, 2)
})

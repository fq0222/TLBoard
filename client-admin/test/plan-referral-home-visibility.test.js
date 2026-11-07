// 校验管理端推广首页展示契约，防止漏传独立开关或遗漏桌面、移动端状态。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const page = fs.readFileSync(fileURLToPath(new URL('../src/views/Plans.vue', import.meta.url)), 'utf8')

test('推广首页展示开关位于首页展示和是否上架之间并绑定独立字段', () => {
  assert.match(page, /<el-form-item label="首页展示"[\s\S]*?<\/el-form-item>\s*<el-form-item label="推广首页展示" prop="show_on_referral_home">\s*<el-switch v-model="planForm\.show_on_referral_home" \/>\s*<\/el-form-item>\s*<el-form-item label="是否上架"/)
})

test('新增与重置默认关闭推广首页展示，编辑时将数字转换为布尔值', () => {
  const initialForm = page.match(/const planForm = reactive\(\{([\s\S]*?)\}\)/)?.[1] || ''
  const resetForm = page.match(/function resetForm\(\) \{([\s\S]*?)\n\}/)?.[1] || ''
  const editForm = page.match(/function showEditDialog\(plan\) \{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(initialForm, /show_on_referral_home:\s*false/)
  assert.match(resetForm, /planForm\.show_on_referral_home\s*=\s*false/)
  assert.match(editForm, /planForm\.show_on_referral_home\s*=\s*!!plan\.show_on_referral_home/)
  assert.match(page, /api\.admin\.updatePlan\(editingId\.value, planForm\)/)
  assert.match(page, /api\.admin\.addPlan\(planForm\)/)
})

test('桌面列表与移动卡片同时展示首页和推广首页的独立状态', () => {
  const desktop = page.match(/<el-table[\s\S]*?<\/el-table>/)?.[0] || ''
  const mobile = page.match(/<article v-for="plan in plans"[\s\S]*?<\/article>/)?.[0] || ''
  assert.match(desktop, /label="首页展示"[\s\S]*?scope\.row\.show_on_home \? '展示' : '隐藏'/)
  assert.match(desktop, /label="推广展示"[\s\S]*?scope\.row\.show_on_referral_home \? '展示' : '隐藏'/)
  assert.match(mobile, /<dt>首页展示<\/dt>[\s\S]*?plan\.show_on_home \? '展示' : '隐藏'/)
  assert.match(mobile, /<dt>推广展示<\/dt>[\s\S]*?plan\.show_on_referral_home \? '展示' : '隐藏'/)
})

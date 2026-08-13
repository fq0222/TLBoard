import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const usersVuePath = path.resolve(__dirname, '../src/views/Users.vue')
const source = fs.readFileSync(usersVuePath, 'utf8')

test('编辑用户弹窗提供已用流量、倍数步进和重置基本信息入口', () => {
  assert.match(source, /label="已用流量"/)
  assert.match(source, /used_traffic_value/)
  assert.match(source, /used_traffic_unit/)
  assert.match(source, /used_traffic_bytes/)
  assert.match(source, /trafficStepSize\('limit'\)/)
  assert.match(source, /trafficStepSize\('used'\)/)
  assert.match(source, /toggleTrafficStepMultiplier\('limit'\)/)
  assert.match(source, /toggleTrafficStepMultiplier\('used'\)/)
  assert.match(source, /resetBasicInfoChanges/)
  assert.match(source, /@click="resetBasicInfoChanges"/)
})

test('用户列表展示 IP 归属地列', () => {
  assert.match(source, /prop="ip_location_text"/)
  assert.match(source, /label="IP归属地"/)
  assert.match(source, /<el-table-column prop="ip_location_text" label="IP归属地" \/>/)
  assert.doesNotMatch(source, /prop="ip_location_text" label="IP归属地" width=/)
  assert.doesNotMatch(source, /prop="ip_location_text" label="IP归属地" min-width=/)
})

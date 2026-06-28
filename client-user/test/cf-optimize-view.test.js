/**
 * CF IP 优选页面源码结构测试。
 * 锁定测速期间的交互隔离，以及并发测速异常后的状态恢复语义。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const viewPath = fileURLToPath(new URL('../src/views/user/CfOptimize.vue', import.meta.url))
const viewSource = readFileSync(viewPath, 'utf8')
const startTestSource = viewSource.match(
  /async function startTest\(\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nasync function testSingleIp/
)?.[1]
const fetchIpPoolSource = viewSource.match(
  /async function fetchIpPool\(\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nasync function refreshRandom/
)?.[1]
const refreshRandomSource = viewSource.match(
  /async function refreshRandom\(\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nasync function startTest/
)?.[1]

test('IP 池请求期间禁用测速和刷新操作', () => {
  assert.match(
    viewSource,
    /class="toolbar-button primary-action"[^>]*:disabled="poolLoading \|\| ipList\.length === 0"/
  )
  assert.match(
    viewSource,
    /class="toolbar-button refresh-action"[^>]*:loading="poolLoading"[^>]*:disabled="testing \|\| poolLoading"/
  )
})

test('fetchIpPool 管理加载状态并拒绝重复请求', () => {
  assert.ok(fetchIpPoolSource, '应存在 fetchIpPool 函数')
  assert.match(fetchIpPoolSource, /if \(poolLoading\.value\) return false/)
  assert.match(fetchIpPoolSource, /poolLoading\.value = true/)
  assert.match(fetchIpPoolSource, /response\.code === 0[\s\S]*return true/)
  assert.match(fetchIpPoolSource, /catch[\s\S]*return false/)
  assert.match(fetchIpPoolSource, /finally\s*\{[\s\S]*poolLoading\.value = false[\s\S]*\}/)
})

test('refreshRandom 按 IP 池请求结果显示刷新反馈', () => {
  assert.ok(refreshRandomSource, '应存在 refreshRandom 函数')
  assert.match(refreshRandomSource, /const refreshed = await fetchIpPool\(\)/)
  assert.match(refreshRandomSource, /if \(refreshed\)[\s\S]*ElMessage\.success\(['"]已刷新['"]\)/)
  assert.match(refreshRandomSource, /ElMessage\.error\(['"]刷新失败，请重试['"]\)/)
})

test('测速期间禁用随机刷新按钮', () => {
  assert.match(
    viewSource,
    /class="toolbar-button refresh-action"[^>]*:disabled="testing \|\| poolLoading"[^>]*@click="refreshRandom"/
  )
})

test('startTest 仅在测速成功后标记完成并始终恢复 testing', () => {
  assert.ok(startTestSource, '应存在 startTest 函数')
  assert.match(startTestSource, /try\s*\{[\s\S]*await runWithConcurrency/)
  assert.match(startTestSource, /await runWithConcurrency[\s\S]*tested\.value = true[\s\S]*\}\s*catch/)
  assert.match(startTestSource, /finally\s*\{[\s\S]*testing\.value = false[\s\S]*\}/)
})

test('startTest 失败时反馈用户并将未完成测速项标记为不可用', () => {
  assert.ok(startTestSource, '应存在 startTest 函数')
  assert.match(startTestSource, /catch\s*\([^)]*\)\s*\{[\s\S]*ElMessage\.error\(['"]测速失败，请重试['"]\)/)
  assert.match(
    startTestSource,
    /testStatus === 'testing'[\s\S]*latency = -1[\s\S]*avgLatency = 0[\s\S]*packetLoss = 100[\s\S]*testStatus = 'done'/
  )
  assert.match(startTestSource, /catch\s*\([^)]*\)\s*\{[\s\S]*tested\.value = false/)
})

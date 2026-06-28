/**
 * 用户端 CF IP 自动推荐入口结构回归测试。
 * 锁定个人中心、订阅页和优选页统一调用公共推荐策略的参数语义。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 读取用户端视图源码。
 * @param {string} fileName - user 视图目录下的 Vue 文件名。
 * @returns {string} UTF-8 编码的视图源码。
 */
function readUserView(fileName) {
  const viewPath = fileURLToPath(new URL(`../src/views/user/${fileName}`, import.meta.url))
  return readFileSync(viewPath, 'utf8')
}

/**
 * 按大括号深度提取完整函数体，避免嵌套分支导致非贪婪正则提前结束。
 * @param {string} source - 待扫描的源码。
 * @param {string} declaration - 包含函数名和参数的函数声明。
 * @returns {string|null} 不含最外层大括号的函数体，未找到时返回 null。
 */
function extractFunctionBody(source, declaration) {
  const declarationIndex = source.indexOf(declaration)
  if (declarationIndex === -1) return null

  const bodyStart = source.indexOf('{', declarationIndex + declaration.length)
  if (bodyStart === -1) return null

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(bodyStart + 1, index)
    }
  }

  return null
}

const profileSource = readUserView('Profile.vue')
const subscriptionSource = readUserView('Subscription.vue')
const cfOptimizeSource = readUserView('CfOptimize.vue')
const optimizerImportPattern =
  /import\s*\{[^}]*\bselectRecommendedCfIps\b[^}]*\}\s*from\s*['"]@\/utils\/cf-ip-optimizer['"]/
const profileStartOptimizeSource = extractFunctionBody(
  profileSource,
  'async function startOptimize()'
)
const subscriptionStartOptimizeSource = extractFunctionBody(
  subscriptionSource,
  'async function startOptimize()'
)
const profileTestSingleIpSource = extractFunctionBody(
  profileSource,
  'async function testSingleIp(ipData)'
)
const subscriptionTestSingleIpSource = extractFunctionBody(
  subscriptionSource,
  'async function testSingleIp(ipData)'
)
const selectTop5Source = extractFunctionBody(cfOptimizeSource, 'function selectTop5()')

test('个人中心一键优选使用公共推荐策略处理完整测速结果', () => {
  assert.match(profileSource, optimizerImportPattern)
  assert.ok(profileStartOptimizeSource, 'Profile.vue 应存在 startOptimize 函数')
  assert.match(profileStartOptimizeSource, /testStatus:\s*['"]pending['"]/)
  assert.match(profileStartOptimizeSource, /selectRecommendedCfIps\(ipTestData\)/)
  assert.ok(profileTestSingleIpSource, 'Profile.vue 应存在 testSingleIp 函数')
  assert.match(profileTestSingleIpSource, /ipData\.testStatus\s*=\s*['"]done['"]\s*$/)
})

test('订阅页一键优选使用公共推荐策略处理完整测速结果', () => {
  assert.match(subscriptionSource, optimizerImportPattern)
  assert.ok(subscriptionStartOptimizeSource, 'Subscription.vue 应存在 startOptimize 函数')
  assert.match(subscriptionStartOptimizeSource, /testStatus:\s*['"]pending['"]/)
  assert.match(subscriptionStartOptimizeSource, /selectRecommendedCfIps\(ipTestData\)/)
  assert.ok(subscriptionTestSingleIpSource, 'Subscription.vue 应存在 testSingleIp 函数')
  assert.match(subscriptionTestSingleIpSource, /ipData\.testStatus\s*=\s*['"]done['"]\s*$/)
})

test('CF 优选页使用公共推荐策略并传入最大选择数', () => {
  assert.match(cfOptimizeSource, optimizerImportPattern)
  assert.ok(selectTop5Source, 'CfOptimize.vue 应存在 selectTop5 函数')
  assert.match(
    selectTop5Source,
    /selectRecommendedCfIps\(sortedIpList\.value,\s*MAX_SELECTED\)/
  )
})

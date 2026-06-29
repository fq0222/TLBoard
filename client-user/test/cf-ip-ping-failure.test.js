/**
 * CF IP 测速失败判定回归测试。
 * 确保所有用户端测速入口都不会把耗时较长的 fetch 异常误判为成功延迟。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const viewNames = ['Profile.vue', 'Subscription.vue', 'CfOptimize.vue']

/**
 * 读取用户端视图源码并提取 pingIp 函数。
 * @param {string} fileName - user 视图目录下的 Vue 文件名。
 * @returns {string} pingIp 函数到下一个函数声明之间的源码。
 */
function readPingIpSource(fileName) {
  const viewPath = fileURLToPath(new URL(`../src/views/user/${fileName}`, import.meta.url))
  const source = readFileSync(viewPath, 'utf8')
  const start = source.indexOf('function pingIp(ip)')
  const end = source.indexOf('\nfunction ', start + 1)

  assert.notEqual(start, -1, `${fileName} 应存在 pingIp 函数`)
  return source.slice(start, end === -1 ? source.length : end)
}

for (const viewName of viewNames) {
  test(`${viewName} 的 fetch 异常统一判定为测速失败`, () => {
    const pingIpSource = readPingIpSource(viewName)

    assert.match(pingIpSource, /\.catch\(\(\)\s*=>\s*\{[\s\S]*?resolve\(-1\)/)
    assert.doesNotMatch(pingIpSource, /elapsed\s*<\s*50/)
  })
}

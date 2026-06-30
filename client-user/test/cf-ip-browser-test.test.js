import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCfTraceUrl, createCfLatencySample } from '../src/utils/cf-ip-browser-test.js'

test('buildCfTraceUrl 将 IPv4 转成 gotl 泛域名地址', () => {
  const url = buildCfTraceUrl('104.16.0.1', '12345')
  assert.equal(url, 'https://104-16-0-1.gotl.xyz/cdn-cgi/trace?rel=12345')
})

test('buildCfTraceUrl 遇到 IPv6 时报错', () => {
  const url = buildCfTraceUrl('2606:4700::1', '1')
  assert.equal(url, 'https://ipv6-test.gotl.xyz/cdn-cgi/trace?rel=1')
})

test('createCfLatencySample 为成功样本返回正延迟', async () => {
  const fetchImpl = async () => ({ ok: true })
  const value = await createCfLatencySample('1.1.1.1', {
    fetchImpl,
    now: (() => {
      let current = 0
      return () => (current += 25)
    })()
  })

  assert.equal(value, 25)
})

test('createCfLatencySample 请求失败时返回 -1', async () => {
  const fetchImpl = async () => {
    throw new Error('network failed')
  }

  const value = await createCfLatencySample('1.1.1.1', {
    fetchImpl,
    now: () => 0
  })

  assert.equal(value, -1)
})

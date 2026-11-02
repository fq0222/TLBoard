import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = name => fs.readFileSync(path.resolve(root, `src/views/${name}.vue`), 'utf8')

test('服务器、家宽和推广页面限制窄屏宽度与长文本', () => {
  for (const name of ['Servers', 'HomeProxies', 'Referrals']) {
    const page = read(name)
    assert.match(page, /tw-min-w-0/)
    assert.match(page, /overflow-wrap:\s*anywhere/)
    assert.match(page, /@media \(max-width: 767px\)/)
  }
})

test('服务器页面移动端顶部操作按钮等宽对齐', () => {
  const page = read('Servers')

  assert.match(
    page,
    /@media \(max-width: 767px\)[\s\S]*\.toolbar \.el-button\s*\{[\s\S]*width:\s*100%[\s\S]*margin-left:\s*0/
  )
})

test('家宽卡片同步时间使用较小字号并允许分两行完整显示', () => {
  const page = read('HomeProxies')

  assert.match(page, /class="sync-value sync-time"/)
  assert.match(
    page,
    /\.sync-time\s*\{[\s\S]*font-size:\s*11px[\s\S]*white-space:\s*normal[\s\S]*text-overflow:\s*clip/
  )
})

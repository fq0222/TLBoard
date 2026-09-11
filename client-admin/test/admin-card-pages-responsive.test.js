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

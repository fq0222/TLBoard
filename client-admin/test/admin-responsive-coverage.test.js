import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('全部管理端路由页面声明窄屏保护', () => {
  const router = fs.readFileSync(path.resolve(root, 'src/router/index.js'), 'utf8')
  const names = [...router.matchAll(/import\('@\/views\/([^']+\.vue)'\)/g)].map(match => match[1])

  assert.ok(names.length >= 18)
  for (const name of names) {
    const page = fs.readFileSync(path.resolve(root, 'src/views', name), 'utf8')
    assert.match(page, /(?:@media\s*\(max-width:|tw-min-w-0|width:\s*min\(100%)/, `${name} 缺少窄屏保护`)
  }
})

test('博客编辑器在移动端使用安全宽度和单栏', () => {
  const page = fs.readFileSync(path.resolve(root, 'src/views/Blogs.vue'), 'utf8')
  assert.match(page, /tw-min-w-0/)
  assert.match(page, /@media \(max-width: 767px\)/)
  assert.match(page, /width:\s*calc\(100vw - 24px\)/)
  assert.match(page, /overflow-wrap:\s*anywhere/)
})

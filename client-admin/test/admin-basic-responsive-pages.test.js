import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = name => fs.readFileSync(path.resolve(root, `src/views/${name}.vue`), 'utf8')

test('基础页面在窄屏降列且长内容不撑宽', () => {
  assert.match(read('Dashboard'), /@media \(max-width: 767px\)[\s\S]*grid-template-columns:\s*1fr/)
  assert.match(read('TrafficStats'), /@media \(max-width: 767px\)/)
  assert.match(read('TrafficStats'), /min-width:\s*0/)
  assert.match(read('Feedback'), /overflow-wrap:\s*anywhere/)
  assert.match(read('TicketDetail'), /overflow-wrap:\s*anywhere/)
  assert.match(read('Login'), /width:\s*min\(100%,\s*400px\)/)
  assert.match(read('NotFound'), /@media \(max-width: 767px\)/)
})

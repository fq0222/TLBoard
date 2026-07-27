import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.resolve(root, relativePath), 'utf8')
}

test('Element Plus is registered on demand and keeps required icons', () => {
  const main = read('src/main.js')
  const viteConfig = read('vite.config.js')
  const srcFiles = fs
    .readdirSync(path.resolve(root, 'src'), { recursive: true })
    .filter(file => String(file).endsWith('.js') || String(file).endsWith('.vue'))
    .map(file => read(path.join('src', String(file))))
    .join('\n')

  assert.doesNotMatch(main, /import\s+ElementPlus\s+from\s+'element-plus'/)
  assert.doesNotMatch(main, /import\s+\*\s+as\s+ElementPlusIconsVue/)
  assert.doesNotMatch(main, /element-plus\/dist\/index\.css/)
  assert.doesNotMatch(srcFiles, /from 'element-plus'/)
  assert.match(main, /ELEMENT_PLUS_COMPONENTS/)
  assert.match(main, /ELEMENT_PLUS_ICONS/)
  assert.match(main, /app\.use\(ElLoading\)/)
  assert.match(main, /el-overlay\.css/)
  assert.match(main, /el-popper\.css/)
  assert.match(main, /el-scrollbar\.css/)
  assert.match(main, /el-tooltip\.css/)
  assert.match(main, /el-date-picker-panel\.css/)
  assert.match(main, /el-time-picker\.css/)
  assert.match(viteConfig, /manualChunks/)
  assert.match(viteConfig, /element-plus/)
  assert.match(viteConfig, /echarts/)
  assert.match(viteConfig, /zrender/)

  for (const component of [
    'ElButton',
    'ElForm',
    'ElInput',
    'ElTable',
    'ElDialog',
    'ElUpload',
    'ElDatePicker',
    'ElEmpty'
  ]) {
    assert.match(main, new RegExp(`\\b${component}\\b`))
  }

  for (const icon of [
    'User',
    'Lock',
    'DataBoard',
    'DataAnalysis',
    'Monitor',
    'Goods',
    'Document',
    'Refresh',
    'Search',
    'Upload',
    'SwitchButton'
  ]) {
    assert.match(main, new RegExp(`\\b${icon}\\b`))
  }
})

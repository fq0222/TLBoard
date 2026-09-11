import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

/**
 * 读取管理端项目文件。
 * @param {string} relativePath 相对于管理端根目录的文件路径。
 * @returns {string} 文件内容。
 */
function read(relativePath) {
  return fs.readFileSync(path.resolve(root, relativePath), 'utf8')
}

test('Tailwind 使用前缀且不重置 Element Plus 样式', () => {
  const config = read('tailwind.config.js')
  const postcss = read('postcss.config.js')
  const entry = read('src/main.js')
  const css = read('src/styles/tailwind.css')

  assert.match(config, /prefix:\s*['"]tw-['"]/)
  assert.match(config, /preflight:\s*false/)
  assert.match(config, /md:\s*['"]768px['"]/)
  assert.match(config, /lg:\s*['"]960px['"]/)
  assert.match(postcss, /tailwindcss:\s*\{\}/)
  assert.match(postcss, /autoprefixer:\s*\{\}/)
  assert.match(entry, /import ['"]\.\/styles\/tailwind\.css['"]/)
  assert.match(css, /@tailwind components;/)
  assert.match(css, /@tailwind utilities;/)
  assert.doesNotMatch(css, /@tailwind base;/)
})

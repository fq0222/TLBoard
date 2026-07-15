/**
 * 帮助文章图片懒加载回归测试。
 * 职责：确认用户端帮助文章渲染前会给 Markdown 图片补充浏览器原生懒加载属性。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'

/**
 * 读取帮助文章组件脚本内容。
 * @returns {string} 组件 script setup 源码。
 */
function readHelpArticleScript() {
  const source = readFileSync(new URL('../src/views/user/HelpArticle.vue', import.meta.url), 'utf8')
  const descriptor = parse(source).descriptor
  return descriptor.scriptSetup?.content || ''
}

test('帮助文章渲染会给 Markdown 图片添加懒加载属性', () => {
  const script = readHelpArticleScript()

  assert.match(script, /querySelectorAll\(['"]img['"]\)/)
  assert.match(script, /setAttribute\(['"]loading['"],\s*['"]lazy['"]\)/)
  assert.match(script, /setAttribute\(['"]decoding['"],\s*['"]async['"]\)/)
  assert.match(script, /setAttribute\(['"]fetchpriority['"],\s*['"]low['"]\)/)
})

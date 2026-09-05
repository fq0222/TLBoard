import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 读取 Vue 单文件组件并返回模板内容，用于验证首页核心语义没有回退到模板示例。
 *
 * @param {string} relativePath - 相对 client-user-new 根目录的组件路径
 * @returns {string} 组件模板源码
 */
function readVueSource(relativePath) {
  const source = readFileSync(resolve(rootDir, relativePath), 'utf8')
  const { descriptor, errors } = parseSfc(source)
  assert.deepEqual(errors, [], `${relativePath} 应能被 Vue SFC 解析`)
  assert.ok(descriptor.template?.content, `${relativePath} 应包含模板`)
  return source
}

const homeSource = readVueSource('src/views/Ecommerce.vue')
const sidebarSource = readFileSync(resolve(rootDir, 'src/components/layout/AppSidebar.vue'), 'utf8')
const headerSource = readVueSource('src/components/layout/AppHeader.vue')

assert.match(homeSource, /欢迎回来/, '首页应展示欢迎回来文案')
assert.match(homeSource, /推广余额/, '首页应展示推广余额卡片')
assert.match(homeSource, /账号状态/, '首页应展示账号状态卡片')
assert.match(homeSource, /套餐类型/, '首页应展示套餐类型卡片')
assert.match(homeSource, /系统公告/, '首页应展示系统公告卡片')
assert.match(homeSource, /我的套餐/, '首页下半区应展示我的套餐')
assert.match(homeSource, /续费价格/, '套餐详情卡应展示续费价格')

assert.match(sidebarSource, /name:\s*["']属性面板["']/, '侧边栏一级菜单应直接命名为属性面板')
assert.doesNotMatch(sidebarSource, /name:\s*["']Dashboard["']/, '侧边栏不应保留 Dashboard 文案')
assert.doesNotMatch(sidebarSource, /name:\s*["']Ecommerce["']/, '侧边栏不应保留 Ecommerce 下拉项')

assert.doesNotMatch(homeSource, /<p[^>]*>\s*属性面板\s*<\/p>/, '欢迎语上方不应保留独立属性面板标签')
assert.doesNotMatch(homeSource, /续费套餐/, '首页右上角不应保留续费套餐按钮')
assert.doesNotMatch(headerSource, /<SearchBar\s*\/>/, '顶部导航不应渲染搜索框')
assert.doesNotMatch(headerSource, /import SearchBar/, '移除搜索框后不应继续导入 SearchBar 组件')

console.log('属性面板首页契约验证通过')

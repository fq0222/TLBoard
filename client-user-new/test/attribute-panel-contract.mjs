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
const plansSubscriptionSource = readVueSource('src/views/PlansSubscription.vue')
const routerSource = readFileSync(resolve(rootDir, 'src/router/index.ts'), 'utf8')
const viteConfigSource = readFileSync(resolve(rootDir, 'vite.config.ts'), 'utf8')
const sidebarSource = readFileSync(resolve(rootDir, 'src/components/layout/AppSidebar.vue'), 'utf8')
const headerSource = readVueSource('src/components/layout/AppHeader.vue')
const residentialIpSectionSource = plansSubscriptionSource.slice(
  plansSubscriptionSource.indexOf('家宽静态 IP 套餐')
)

assert.match(homeSource, /欢迎回来/, '首页应展示欢迎回来文案')
assert.match(homeSource, /推广余额/, '首页应展示推广余额卡片')
assert.match(homeSource, /账号状态/, '首页应展示账号状态卡片')
assert.match(homeSource, /套餐类型/, '首页应展示套餐类型卡片')
assert.match(homeSource, /系统公告/, '首页应展示系统公告卡片')
assert.match(homeSource, /我的套餐/, '首页下半区应展示我的套餐')
assert.match(homeSource, /续费价格/, '套餐详情卡应展示续费价格')

assert.match(sidebarSource, /name:\s*["']属性面板["']/, '侧边栏一级菜单应直接命名为属性面板')
assert.match(sidebarSource, /name:\s*["']套餐订阅["']/, '属性面板后的第二个页面应命名为套餐订阅')
assert.match(sidebarSource, /path:\s*["']\/plans["']/, '套餐订阅菜单应指向 /plans')
assert.doesNotMatch(sidebarSource, /name:\s*["']Dashboard["']/, '侧边栏不应保留 Dashboard 文案')
assert.doesNotMatch(sidebarSource, /name:\s*["']Ecommerce["']/, '侧边栏不应保留 Ecommerce 下拉项')

assert.match(routerSource, /path:\s*["']\/plans["']/, '路由应注册套餐订阅页面')
assert.match(routerSource, /title:\s*["']套餐订阅["']/, '套餐订阅路由标题应为套餐订阅')

assert.match(plansSubscriptionSource, /套餐订阅/, '套餐订阅页面应展示页面标题')
assert.match(plansSubscriptionSource, /限时/, '普通套餐区域应支持限时筛选')
assert.match(plansSubscriptionSource, /不限时/, '普通套餐区域应支持不限时筛选')
assert.doesNotMatch(plansSubscriptionSource, />\s*Subscription\s*</, '套餐订阅标题上方不应展示英文小标签')
assert.doesNotMatch(plansSubscriptionSource, />\s*推荐\s*</, '套餐卡片不应展示推荐徽标')
assert.match(plansSubscriptionSource, /xl:grid-cols-4/, '套餐卡片桌面端应一排展示 4 个')
assert.match(plansSubscriptionSource, /家宽静态 IP 套餐/, '页面下半部分应展示家宽静态 IP 套餐')
assert.match(plansSubscriptionSource, /美国洛杉矶/, '家宽静态 IP 套餐应展示 IP 地区')
assert.match(plansSubscriptionSource, /15\/月/, '家宽静态 IP 套餐应展示月价格')
assert.match(plansSubscriptionSource, /5人共享/, '家宽静态 IP 套餐应展示共享人数')
assert.match(residentialIpSectionSource, /立即订阅/, '家宽静态 IP 套餐卡片应展示立即订阅按钮')
assert.match(
  residentialIpSectionSource,
  /ipPlan\.region[\s\S]*静态住宅出口[\s\S]*ipPlan\.priceText[\s\S]*立即订阅/,
  '家宽静态 IP 套餐说明应在地区行右侧，按钮应在价格行右侧'
)
assert.doesNotMatch(residentialIpSectionSource, /min-h-\[220px\]/, '家宽静态 IP 卡片不应通过固定最小高度扩大卡片')
assert.doesNotMatch(residentialIpSectionSource, /mt-auto/, '家宽静态 IP 卡片按钮不应通过自动上边距压到底部')
assert.match(viteConfigSource, /proxy:/, '开发服务器应代理后端 API，确保套餐页面可拉取数据')
assert.match(viteConfigSource, /\/api/, '开发服务器应代理 /api 路径')
assert.match(viteConfigSource, /localhost:30000/, '用户端 API 代理应指向后端用户端口 30000')

assert.doesNotMatch(homeSource, /<p[^>]*>\s*属性面板\s*<\/p>/, '欢迎语上方不应保留独立属性面板标签')
assert.doesNotMatch(homeSource, /续费套餐/, '首页右上角不应保留续费套餐按钮')
assert.doesNotMatch(headerSource, /<SearchBar\s*\/>/, '顶部导航不应渲染搜索框')
assert.doesNotMatch(headerSource, /import SearchBar/, '移除搜索框后不应继续导入 SearchBar 组件')

console.log('属性面板首页契约验证通过')

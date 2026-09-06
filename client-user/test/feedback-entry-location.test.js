/**
 * 留言入口位置回归测试。
 * 职责：确保留言功能从用户中心导航迁移到“我的服务”列表中，并保留套餐页主导航入口。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const layoutSource = readFileSync(new URL('../src/views/user/Layout.vue', import.meta.url), 'utf8')
const mySource = readFileSync(new URL('../src/views/user/My.vue', import.meta.url), 'utf8')
const routerSource = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')

function extractMediaBlock(source, query) {
  const mediaStart = source.indexOf(`@media ${query}`)
  if (mediaStart === -1) return ''

  const blockStart = source.indexOf('{', mediaStart)
  if (blockStart === -1) return ''

  let depth = 0
  for (let index = blockStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(mediaStart, index + 1)
    }
  }

  return ''
}

test('用户中心主导航移除留言入口并保留套餐页入口', () => {
  const navItemsBlock = layoutSource.match(/const navItems = \[[\s\S]*?\]/)?.[0]

  assert.ok(navItemsBlock, '应存在 navItems 配置')
  assert.doesNotMatch(navItemsBlock, /key:\s*'feedback'/)
  assert.doesNotMatch(navItemsBlock, /label:\s*'留言'/)
  assert.doesNotMatch(navItemsBlock, /to:\s*'\/user\/feedback'/)
  assert.equal((navItemsBlock.match(/\{\s*key:/g) || []).length, 5)
  assert.match(navItemsBlock, /label:\s*'首页'/)
  assert.match(navItemsBlock, /label:\s*'订阅'/)
  assert.match(navItemsBlock, /label:\s*'套餐'/)
  assert.match(navItemsBlock, /label:\s*'教程'/)
  assert.match(navItemsBlock, /label:\s*'我的'/)
  assert.ok(
    navItemsBlock.indexOf("key: 'subscription'") < navItemsBlock.indexOf("key: 'plans'"),
    '套餐应放在订阅后面'
  )
  assert.ok(
    navItemsBlock.indexOf("key: 'plans'") < navItemsBlock.indexOf("key: 'help'"),
    '套餐应放在教程前面'
  )
})

test('我的服务在工单支持下面提供留言入口', () => {
  const serviceSection = mySource.match(
    /<h2 class="section-title">我的服务<\/h2>[\s\S]*?<section class="content-card">/
  )?.[0]

  assert.ok(serviceSection, '应存在我的服务区块')
  assert.match(serviceSection, /<router-link to="\/user\/feedback" class="action-item">/)
  assert.match(serviceSection, /<span class="action-title">留言<\/span>/)
  assert.ok(
    serviceSection.indexOf('工单支持') < serviceSection.indexOf('留言'),
    '留言应放在工单支持下面'
  )
  assert.ok(
    serviceSection.indexOf('留言') < serviceSection.indexOf('线路优选'),
    '留言应放在线路优选前面'
  )
})

test('留言路由继续保留并加载原留言页面', () => {
  assert.match(routerSource, /path:\s*'feedback'/)
  assert.match(routerSource, /name:\s*'UserFeedback'/)
  assert.match(routerSource, /import\('@\/views\/user\/Feedback\.vue'\)/)
})

test('移动端我的服务右侧箭头垂直居中', () => {
  const mobileStyles = extractMediaBlock(mySource, '(max-width: 768px)')

  assert.ok(mobileStyles, '应存在移动端样式')
  assert.doesNotMatch(
    mobileStyles,
    /\.action-item\s*\{[\s\S]*?align-items:\s*flex-start/,
    '移动端 action-item 不应覆盖为顶部对齐，否则普通箭头会偏上'
  )
  assert.match(
    mobileStyles,
    /\.action-item\s*\{[\s\S]*?align-items:\s*center/,
    '移动端 action-item 应保持垂直居中对齐'
  )
})

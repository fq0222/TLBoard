/**
 * 用户端电脑侧边栏品牌样式回归测试。
 * 职责：确保电脑端左侧导航使用项目自有品牌信息，并且移动端底部导航策略不被改动。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const layoutSource = readFileSync(new URL('../src/views/user/Layout.vue', import.meta.url), 'utf8')
const desktopStyleSource = layoutSource.slice(0, layoutSource.indexOf('@media (max-width: 1024px)'))

/**
 * 按大括号深度提取指定媒体查询块。
 * 核心分支语义：找不到查询或块起点时返回空字符串，避免误判其他样式片段。
 *
 * @param {string} source - 待检查源码。
 * @param {string} query - 不含 @media 的媒体查询条件。
 * @returns {string} 完整媒体查询块。
 */
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

test('电脑端侧边栏展示天澜大陆品牌和项目 favicon', () => {
  assert.match(layoutSource, /class="brand-logo"/)
  assert.match(layoutSource, /src="\/favicon\.svg"/)
  assert.match(layoutSource, /class="brand-name"[\s\S]*天澜大陆/)
  assert.match(layoutSource, /class="brand-subtitle"[\s\S]*Tianlan Continent/)
  assert.doesNotMatch(layoutSource, /class="sidebar-title"/)
})

test('电脑端导航项提供参考图风格的激活箭头和圆角高亮', () => {
  assert.match(layoutSource, /class="nav-arrow"/)
  assert.match(layoutSource, /<ArrowRight\s*\/>/)
  assert.match(layoutSource, /\.nav-item\.active\s*\{[\s\S]*border-radius:\s*16px/)
  assert.match(layoutSource, /\.nav-item\.active\s+\.nav-arrow\s*\{[\s\S]*opacity:\s*1/)
})

test('电脑端侧边栏底部展示用户卡片和新版退出入口', () => {
  assert.match(layoutSource, /class="sidebar-user-card"/)
  assert.match(layoutSource, /class="user-avatar"[\s\S]*userInitial/)
  assert.match(layoutSource, /class="user-display-name"[\s\S]*sidebarUserName/)
  assert.match(layoutSource, /class="user-role"[\s\S]*USER/)
  assert.match(layoutSource, /class="logout-button"/)
  assert.match(layoutSource, /<SwitchButton\s*\/>/)
})

test('电脑端用户头像保持紧凑以容纳较长用户名', () => {
  assert.match(desktopStyleSource, /\.user-avatar\s*\{[\s\S]*width:\s*40px/)
  assert.match(desktopStyleSource, /\.user-avatar\s*\{[\s\S]*height:\s*40px/)
  assert.match(desktopStyleSource, /\.sidebar-user-card\s*\{[\s\S]*gap:\s*12px/)
  assert.match(desktopStyleSource, /\.user-display-name\s*\{[\s\S]*text-overflow:\s*ellipsis/)
})

test('电脑端侧边栏底部 hover 样式符合参考图状态', () => {
  assert.match(layoutSource, /\.sidebar-user-card:hover\s*\{[\s\S]*border-color:\s*#2563eb/)
  assert.match(layoutSource, /\.sidebar-user-card:hover\s+\.user-display-name\s*\{[\s\S]*color:\s*#2563eb/)
  assert.match(layoutSource, /\.logout-button:hover\s*\{[\s\S]*background:\s*#fff1f2/)
  assert.match(layoutSource, /\.logout-button:hover\s*\{[\s\S]*color:\s*#ff2d3d/)
})

test('移动端仍隐藏侧边栏并使用底部导航', () => {
  const mobileStyles = extractMediaBlock(layoutSource, '(max-width: 768px)')

  assert.ok(mobileStyles, '应存在用户端移动端样式')
  assert.match(mobileStyles, /\.sidebar\s*\{[\s\S]*display:\s*none/)
  assert.match(mobileStyles, /\.bottom-nav\s*\{[\s\S]*display:\s*grid/)
})

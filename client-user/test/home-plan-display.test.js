/**
 * 首页住宅 IP 卡片的静态契约测试。
 * 检查筛选入口、流量文案以及按钮和程序化调用的购买防护。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/views/Home.vue', import.meta.url), 'utf8')

test('首页分类提供住宅 IP 入口', () => {
  assert.match(source, /\{\s*label:\s*'住宅IP',\s*value:\s*'home_ip'\s*\}/)
  assert.match(source, /:aria-pressed="activePlanFilter === filter\.value"/)
})

test('四个分类按钮在桌面端可压缩，避免筛选栏溢出', () => {
  const desktopButtonStyle = source.match(/\.filter-button\s*\{([^}]*)\}/)?.[1] || ''
  assert.match(desktopButtonStyle, /min-width:\s*0;/)
})

test('住宅 IP 流量指标显示不限制流量', () => {
  assert.match(source, /<strong class="metric-value">\{\{\s*formatPlanTraffic\(plan\)\s*\}\}<\/strong>/)
  assert.match(source, /function formatPlanTraffic\(plan\)\s*\{[\s\S]*?plan\.plan_type\s*===\s*'home_ip'[\s\S]*?return '不限制流量'/)
})

test('住宅 IP 购买按钮始终禁用，普通套餐保留售罄防护', () => {
  assert.match(source, /:disabled="[^"]*plan\.is_soldout\s*\|\|\s*plan\.plan_type\s*===\s*'home_ip'[^"]*"/)
  assert.match(source, /plan\.plan_type\s*===\s*'home_ip'\s*\?\s*'仅展示'\s*:\s*plan\.is_soldout\s*\?\s*'已售罄'/)
  assert.match(source, /plan\.plan_type\s*===\s*'home_ip'\s*\?\s*'住宅 IP 套餐仅供展示，不支持首次注册购买。'\s*:\s*plan\.is_soldout/)
})

test('住宅 IP 禁用按钮常态与交互态均保持主按钮颜色', () => {
  assert.match(source, /:class="\{\s*'is-home-ip':\s*plan\.plan_type\s*===\s*'home_ip'\s*\}"/)
  assert.match(source, /\.buy-btn\.is-home-ip\.is-disabled\s*,[\s\S]*?\.buy-btn\.is-home-ip\.is-disabled:hover\s*,[\s\S]*?\.buy-btn\.is-home-ip\.is-disabled:focus\s*,[\s\S]*?\.buy-btn\.is-home-ip\.is-disabled:active\s*\{[\s\S]*?background:\s*linear-gradient\(135deg,\s*#0f766e 0%,\s*#115e59 100%\);[\s\S]*?color:\s*#ffffff;/)
})

test('住宅 IP 无描述时摘要不会引用普通套餐流量', () => {
  assert.match(source, /function getPlanSummary\(plan\)[\s\S]*?plan\.plan_type\s*===\s*'home_ip'[\s\S]*?不限制流量/)
})

test('程序化调用 selectPlan 时住宅 IP 在导航前直接返回', () => {
  assert.match(source, /function selectPlan\(plan\)\s*\{\s*if\s*\(plan\.plan_type\s*===\s*'home_ip'\)\s*\{\s*return\s*\}/)
})

test('首页轮播构建时自动发现图片并按数字顺序排列', () => {
  assert.match(source, /import\.meta\.glob\(\s*['"]\/src\/assets\/home-carousel\/\*\.\{png,jpg,jpeg,webp,gif\}['"]\s*,\s*\{\s*eager:\s*true\s*,\s*import:\s*['"]default['"]\s*\}\s*\)/)
  assert.match(source, /localeCompare\([^)]*\{\s*numeric:\s*true\s*\}/)
  assert.doesNotMatch(source, /import\s+image\d+\s+from/)
})

test('轮播按屏幕宽度设置高度并居中裁切图片', () => {
  assert.match(source, /\.home-empty-carousel\s*\{\s*height:\s*745px;/)
  assert.match(source, /@media \(max-width: 1024px\)\s*\{\s*\.home-empty-carousel\s*\{\s*height:\s*520px;/)
  assert.match(source, /@media \(max-width: 768px\)\s*\{\s*\.home-empty-carousel\s*\{\s*height:\s*320px;/)
  assert.match(source, /\.home-carousel-image\s*\{[^}]*object-fit:\s*cover;[^}]*object-position:\s*center;/)
})

test('轮播及轮播项各自导入 Element Plus 样式', () => {
  assert.match(source, /import 'element-plus\/theme-chalk\/el-carousel\.css'/)
  assert.match(source, /import 'element-plus\/theme-chalk\/el-carousel-item\.css'/)
})

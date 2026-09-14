import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTrafficChartLayout } from '../src/utils/traffic-chart-layout.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.resolve(root, relativePath), 'utf8')
}

test('移动端流量图表利用横向空间展示更多服务器', () => {
  const layout = getTrafficChartLayout(360, 360)

  assert.deepEqual(layout.grid, {
    left: 8,
    right: 8
  })
  assert.equal(layout.visibleServerCount, 4)
})

test('桌面端图表容器较窄时仍保留桌面边距', () => {
  const layout = getTrafficChartLayout(600, 1024)

  assert.deepEqual(layout.grid, {
    left: 72,
    right: 36
  })
})

test('管理端提供最近一轮服务器流量统计页面入口', () => {
  const api = read('src/api/index.js')
  const router = read('src/router/index.js')
  const layout = read('src/views/Layout.vue')
  const page = read('src/views/TrafficStats.vue')

  assert.match(api, /getTrafficUsageStats\(\)/)
  assert.match(api, /\/dashboard\/traffic-usage/)
  assert.match(router, /path: 'traffic-stats'/)
  assert.match(router, /TrafficStats/)
  assert.match(layout, /\/admin\/traffic-stats/)
  assert.match(layout, /数据统计/)
  assert.match(page, /from 'echarts\/core'/)
  assert.match(page, /BarChart/)
  assert.match(page, /chartRef/)
  assert.match(page, /setOption/)
  assert.match(page, /formatServerAxisLabel/)
  assert.match(page, /SERVER_LABEL_LINE_LENGTH = 6/)
  assert.match(page, /SERVER_LABEL_MAX_LINES = 2/)
  assert.match(page, /SERVER_BAR_COLORS/)
  assert.match(page, /getServerBarColor/)
  assert.match(page, /itemStyle: \{ color: getServerBarColor\(index\) \}/)
  assert.match(page, /trigger: 'item'/)
  assert.doesNotMatch(page, /trigger: 'axis'/)
  assert.doesNotMatch(page, /chartInstance\.on\('click'/)
  assert.match(page, /labelButtons/)
  assert.match(page, /updateLabelButtons/)
  assert.match(page, /user-count-button/)
  assert.match(page, /getTrafficChartLayout/)
  assert.doesNotMatch(page, /nameLocation: 'end'/)
  assert.match(page, /background: #ecf5ff/)
  assert.match(page, /border-radius: 4px/)
  assert.match(page, /tr:hover > td\.el-table__cell/)
  assert.match(page, /el-dialog/)
  assert.match(page, /selectedServer/)
  assert.match(page, /getTrafficUsageStats/)
  assert.match(page, /formatUserTraffic\(row\.traffic\)/)
  assert.match(page, /function formatUserTraffic\(bytes\)/)
  assert.match(page, /connectTrafficUsageWebSocket\(\)/)
  assert.match(page, /disconnectTrafficUsageWebSocket\(\)/)
  assert.match(page, /new WebSocket\(buildTrafficUsageWsUrl\(\)\)/)
  assert.match(page, /type === 'traffic-usage'/)
  assert.match(page, /onBeforeUnmount\(\(\) => \{[\s\S]*disconnectTrafficUsageWebSocket\(\)/)
})

<template>
  <div class="traffic-stats-page">
    <div class="page-header">
      <div>
        <h2>数据统计</h2>
        <p>最近一轮 30 分钟流量同步结果</p>
      </div>
      <el-button type="primary" :icon="Refresh" :loading="loading" @click="loadStats">
        刷新
      </el-button>
    </div>

    <div class="stats-meta">
      <span>当前统计时间点</span>
      <strong>{{ syncTimeText }}</strong>
    </div>

    <el-empty v-if="!loading && servers.length === 0" description="暂无本轮服务器使用数据" />

    <div v-else class="chart-shell" v-loading="loading">
      <div ref="chartRef" class="traffic-chart" aria-label="最近一轮服务器流量柱状图"></div>
      <div class="label-layer">
        <button
          v-for="label in labelButtons"
          :key="label.serverId"
          type="button"
          class="user-count-button"
          :style="label.style"
          @mouseenter="hideChartTooltip"
          @click.stop="openUsers(label.server)"
        >
          {{ label.userCount }}人
        </button>
      </div>
    </div>

    <el-dialog
      v-model="userDialogVisible"
      :title="selectedServer ? `${selectedServer.serverName} 使用用户` : '使用用户'"
      width="560px"
    >
      <el-table :data="selectedServer?.users || []" border>
        <el-table-column prop="email" label="用户 email" min-width="260" />
        <el-table-column label="使用流量" width="140" align="right">
          <template #default="{ row }">
            {{ formatTrafficValue(row.trafficValue) }} {{ stats.unit }}
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
/**
 * 管理端最近一轮服务器流量统计页。
 * 职责：读取后端当前快照，按服务器绘制柱状图，并展示服务器下的用户流量明细。
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BarChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  TooltipComponent
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { ElMessage } from 'element-plus/es/components/message/index.mjs'
import { Refresh } from '@element-plus/icons-vue'
import api from '@/api'

echarts.use([
  BarChart,
  CanvasRenderer,
  DataZoomComponent,
  GridComponent,
  TooltipComponent
])

const loading = ref(false)
const stats = ref({
  syncAt: null,
  unit: 'MB',
  servers: []
})
const selectedServer = ref(null)
const userDialogVisible = ref(false)
const chartRef = ref(null)
const labelButtons = ref([])
let chartInstance = null

const SERVER_LABEL_LINE_LENGTH = 6
const SERVER_LABEL_MAX_LINES = 2
const SERVER_BAR_COLORS = [
  '#409eff',
  '#67c23a',
  '#e6a23c',
  '#f56c6c',
  '#8e6ad8',
  '#00a7a7',
  '#d46b08',
  '#5c7cfa',
  '#13c2c2',
  '#eb2f96'
]

const servers = computed(() => stats.value.servers || [])
const syncTimeText = computed(() => {
  if (!stats.value.syncAt) {
    return '暂无统计'
  }

  return new Date(Number(stats.value.syncAt) * 1000).toLocaleString('zh-CN')
})

/**
 * 拉取最近一轮服务器流量统计。
 *
 * @returns {Promise<void>}
 */
async function loadStats() {
  loading.value = true
  try {
    const response = await api.admin.getTrafficUsageStats()
    stats.value = response.data || { syncAt: null, unit: 'MB', servers: [] }
    await nextTick()
    renderChart()
  } catch (error) {
    ElMessage.error(error?.message || '获取数据统计失败')
  } finally {
    loading.value = false
  }
}

/**
 * 初始化并渲染 ECharts 柱状图。
 *
 * @returns {void}
 */
function renderChart() {
  if (!chartRef.value || servers.value.length === 0) {
    return
  }

  if (!chartInstance) {
    chartInstance = echarts.init(chartRef.value)
    chartInstance.on('finished', updateLabelButtons)
    chartInstance.on('datazoom', updateLabelButtons)
  }

  const visibleServerCount = getVisibleServerCount()

  chartInstance.setOption({
    grid: {
      top: 48,
      right: 36,
      bottom: 112,
      left: 72,
      containLabel: true
    },
    tooltip: {
      trigger: 'item',
      triggerOn: 'mousemove',
      formatter(params) {
        const server = servers.value[params.dataIndex]
        return [
          `<strong>${server.serverName}</strong>`,
          `流量：${formatTrafficValue(server.totalTrafficValue)} ${stats.value.unit}`,
          `人数：${server.userCount} 人`
        ].join('<br/>')
      }
    },
    xAxis: {
      type: 'category',
      data: servers.value.map(server => server.serverName),
      axisLabel: {
        interval: 0,
        color: '#606266',
        fontSize: 12,
        lineHeight: 16,
        margin: 14,
        formatter: formatServerAxisLabel
      },
      axisLine: { lineStyle: { color: '#a8abb2' } },
      axisTick: { alignWithLabel: true }
    },
    yAxis: {
      type: 'value',
      name: stats.value.unit,
      nameGap: 20,
      min: 0,
      axisLabel: {
        color: '#606266',
        formatter(value) {
          return formatTrafficValue(value)
        }
      },
      splitLine: { lineStyle: { color: '#ebeef5' } }
    },
    dataZoom: servers.value.length > visibleServerCount
      ? [
          {
            type: 'slider',
            height: 18,
            bottom: 24,
            start: 0,
            end: Math.min(100, Math.round((visibleServerCount / servers.value.length) * 100))
          }
        ]
      : [],
    series: [
      {
        name: `流量(${stats.value.unit})`,
        type: 'bar',
        barMaxWidth: 54,
        data: servers.value.map((server, index) => ({
          value: server.totalTrafficValue,
          itemStyle: { color: getServerBarColor(index) }
        })),
        label: {
          show: false
        },
        itemStyle: {
          borderRadius: [4, 4, 0, 0]
        },
        emphasis: {
          focus: 'series'
        }
      }
    ]
  })
  updateLabelButtons()
}

/**
 * 按服务器位置获取柱状图颜色，服务器数量超过色板时循环使用。
 *
 * @param {number} index - 服务器在当前统计列表中的位置
 * @returns {string} 柱状图颜色
 */
function getServerBarColor(index) {
  return SERVER_BAR_COLORS[index % SERVER_BAR_COLORS.length]
}

/**
 * 打开服务器用户明细弹窗。
 *
 * @param {Object} server - 服务器统计项
 * @returns {void}
 */
function openUsers(server) {
  selectedServer.value = server
  userDialogVisible.value = true
}

/**
 * 根据 ECharts 坐标系同步柱顶人数按钮位置。
 *
 * @returns {void}
 */
function updateLabelButtons() {
  if (!chartInstance || !chartRef.value) {
    labelButtons.value = []
    return
  }

  const chartWidth = chartRef.value.clientWidth
  const chartHeight = chartRef.value.clientHeight

  labelButtons.value = servers.value
    .map((server) => {
      const point = chartInstance.convertToPixel(
        { xAxisIndex: 0, yAxisIndex: 0 },
        [server.serverName, Number(server.totalTrafficValue) || 0]
      )

      if (!Array.isArray(point)) {
        return null
      }

      const [left, top] = point
      const visible = left >= 0 && left <= chartWidth && top >= 0 && top <= chartHeight
      if (!visible) {
        return null
      }

      return {
        serverId: server.serverId,
        server,
        userCount: server.userCount,
        style: {
          left: `${left}px`,
          top: `${Math.max(8, top - 34)}px`
        }
      }
    })
    .filter(Boolean)
}

/**
 * 鼠标进入人数按钮时隐藏柱状图 tooltip，避免两个交互态叠在一起。
 *
 * @returns {void}
 */
function hideChartTooltip() {
  chartInstance?.dispatchAction({ type: 'hideTip' })
}

/**
 * 将服务器名称拆成最多两行，避免横轴名称挤在柱状图里或被单行截断。
 *
 * @param {string} value - 原始服务器名称
 * @returns {string} 适合 ECharts x 轴展示的多行文本
 */
function formatServerAxisLabel(value) {
  const chars = Array.from(String(value || ''))
  const maxChars = SERVER_LABEL_LINE_LENGTH * SERVER_LABEL_MAX_LINES
  const clippedChars = chars.length > maxChars
    ? chars.slice(0, maxChars - 1).concat('...')
    : chars
  const lines = []

  for (let index = 0; index < clippedChars.length; index += SERVER_LABEL_LINE_LENGTH) {
    lines.push(clippedChars.slice(index, index + SERVER_LABEL_LINE_LENGTH).join(''))
  }

  return lines.join('\n')
}

/**
 * 按当前图表宽度估算一次能舒服展示的服务器数量。
 *
 * @returns {number} 可见服务器数量
 */
function getVisibleServerCount() {
  const chartWidth = chartRef.value?.clientWidth || 0
  const plotWidth = Math.max(0, chartWidth - 160)
  return Math.max(1, Math.floor(plotWidth / 70))
}

/**
 * 格式化流量显示值。
 *
 * @param {number} value - 已按当前单位换算后的数值
 * @returns {string} 展示文本
 */
function formatTrafficValue(value) {
  const numberValue = Number(value) || 0
  if (numberValue >= 10) {
    return numberValue.toFixed(1).replace(/\.0$/, '')
  }

  return numberValue.toFixed(2).replace(/\.?0+$/, '')
}

function handleResize() {
  chartInstance?.resize()
  renderChart()
  updateLabelButtons()
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
  loadStats()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
  chartInstance = null
  labelButtons.value = []
})

watch(servers, async () => {
  await nextTick()
  renderChart()
})
</script>

<style scoped>
.traffic-stats-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page-header h2 {
  margin: 0;
  color: #1f2d3d;
  font-size: 22px;
  font-weight: 600;
}

.page-header p {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 14px;
}

.stats-meta {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #606266;
}

.stats-meta strong {
  color: #303133;
  font-weight: 600;
}

.chart-shell {
  position: relative;
  padding: 18px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
}

.traffic-chart {
  width: 100%;
  height: 460px;
}

.label-layer {
  position: absolute;
  inset: 18px;
  pointer-events: none;
}

.user-count-button {
  position: absolute;
  min-width: 48px;
  height: 28px;
  transform: translateX(-50%);
  border: 1px solid #409eff;
  border-radius: 4px;
  background: #ecf5ff;
  color: #1677c7;
  cursor: pointer;
  pointer-events: auto;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.12s ease;
  font-size: 13px;
  line-height: 26px;
}

.user-count-button:hover {
  transform: translateX(-50%) translateY(-1px);
  border-color: #1677c7;
  background: #d9ecff;
  box-shadow: 0 3px 10px rgba(64, 158, 255, 0.28);
  color: #0958a8;
}

.user-count-button:active {
  transform: translateX(-50%) translateY(0);
  background: #c6e2ff;
  box-shadow: 0 1px 4px rgba(64, 158, 255, 0.22);
}

.user-count-button:focus-visible {
  outline: 2px solid #79bbff;
  outline-offset: 2px;
}

:deep(.el-table__body tr:hover > td.el-table__cell) {
  background-color: #fff !important;
}

@media (max-width: 768px) {
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .stats-meta {
    width: 100%;
    justify-content: space-between;
  }
}
</style>

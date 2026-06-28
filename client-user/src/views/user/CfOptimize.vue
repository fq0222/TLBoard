<template>
  <div class="cf-optimize-container">
    <section class="content-card">
      <h2 class="card-title">当前使用的 IP</h2>
      <div class="current-ips">
        <div v-for="(ip, index) in currentIps" :key="index" class="ip-item">
          <span class="ip-address">{{ ip.ip }}</span>
          <el-tag size="small">{{ ip.source === 'default' ? '默认' : '自定义' }}</el-tag>
        </div>
        <div v-if="currentIps.length === 0" class="empty-tip">暂无自定义 IP，当前使用默认 IP。</div>
      </div>
    </section>

    <section class="content-card">
      <div class="section-head">
        <h2 class="card-title">IP 池列表</h2>
        <p class="tip">每次随机展示 50 个 IP（包含 3 个 IPv6），点击开始测试后会在浏览器本地完成延迟测试。</p>
      </div>

      <div class="toolbar">
        <el-button type="primary" size="large" class="toolbar-button primary-action" :loading="testing" :disabled="poolLoading || ipList.length === 0" @click="startTest">
          <el-icon><Connection /></el-icon>
          开始测试
        </el-button>

        <el-button size="large" class="toolbar-button recommend-action" :disabled="!tested" @click="selectTop5">
          <el-icon><Trophy /></el-icon>
          选前 5（含 IPv6）
        </el-button>

        <el-button size="large" class="toolbar-button refresh-action" :loading="poolLoading" :disabled="testing || poolLoading" @click="refreshRandom">
          <el-icon><Refresh /></el-icon>
          随机换一批
        </el-button>

        <el-button
          type="success"
          size="large"
          class="toolbar-button apply-action"
          :disabled="selectedIds.length === 0 || selectedIds.length > 5 || applying"
          :loading="applying"
          @click="applyIps"
        >
          <el-icon><Check /></el-icon>
          应用选中 IP（{{ selectedIds.length }}/5）
        </el-button>
      </div>

      <div class="desktop-table">
        <el-table :data="sortedIpList" style="width: 100%" :row-class-name="getRowClassName">
          <el-table-column label="" width="62">
            <template #default="{ row }">
              <el-checkbox
                :model-value="isSelected(row.id)"
                @change="toggleSelection(row)"
              />
            </template>
          </el-table-column>
          <el-table-column type="index" label="排名" width="72" />
          <el-table-column prop="ip" label="IP 地址" min-width="240">
            <template #default="{ row }">
              <div class="ip-table-cell">
                <span :class="['ip-address', { 'ipv6-text': isIpv6(row.ip) }]">{{ row.ip }}</span>
                <el-tag v-if="isIpv6(row.ip)" size="small" type="warning">IPv6</el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="延迟" min-width="220">
            <template #default="{ row }">
              <div class="latency-cell">
                <span :class="getLatencyClass(row.latency)">{{ formatLatency(row.latency) }}</span>
                <div v-if="row.testedTimes > 1" class="latency-detail">
                  平均: {{ row.avgLatency }}ms | 丢包: {{ row.packetLoss }}%
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.testStatus === 'testing'" type="warning" size="small">测试中</el-tag>
              <el-tag v-else-if="row.testStatus === 'done'" :type="row.latency > 0 ? 'success' : 'danger'" size="small">
                {{ row.latency > 0 ? '可用' : '超时' }}
              </el-tag>
              <el-tag v-else type="info" size="small">未测试</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="mobile-ip-list">
        <article
          v-for="(ip, index) in sortedIpList"
          :key="ip.id"
          class="mobile-ip-card"
          :class="{ selected: isSelected(ip.id) }"
        >
          <div class="mobile-ip-head">
            <el-checkbox
              :model-value="isSelected(ip.id)"
              @change="toggleSelection(ip)"
            />
            <span class="mobile-rank">#{{ index + 1 }}</span>
            <el-tag v-if="isIpv6(ip.ip)" size="small" type="warning">IPv6</el-tag>
          </div>

          <div class="mobile-ip-address" :class="{ 'ipv6-text': isIpv6(ip.ip) }">{{ ip.ip }}</div>

          <div class="mobile-ip-meta">
            <div class="mobile-meta-item">
              <span class="mobile-meta-label">延迟</span>
              <span :class="getLatencyClass(ip.latency)">{{ formatLatency(ip.latency) }}</span>
            </div>

            <div class="mobile-meta-item">
              <span class="mobile-meta-label">状态</span>
              <el-tag v-if="ip.testStatus === 'testing'" type="warning" size="small">测试中</el-tag>
              <el-tag v-else-if="ip.testStatus === 'done'" :type="ip.latency > 0 ? 'success' : 'danger'" size="small">
                {{ ip.latency > 0 ? '可用' : '超时' }}
              </el-tag>
              <el-tag v-else type="info" size="small">未测试</el-tag>
            </div>
          </div>

          <div v-if="ip.testedTimes > 1" class="mobile-latency-detail">
            平均: {{ ip.avgLatency }}ms | 丢包: {{ ip.packetLoss }}%
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { Check, Connection, Refresh, Trophy } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import {
  CF_IP_TEST_CONCURRENCY as TEST_CONCURRENCY,
  CF_IP_TEST_COUNT as TEST_COUNT,
  CF_IP_TEST_INTERVAL as TEST_INTERVAL,
  CF_IP_TEST_TIMEOUT as TEST_TIMEOUT
} from '@/utils/cf-ip-test-config'
import {
  compareCfIpResults,
  isIpv6,
  runWithConcurrency,
  selectRecommendedCfIps
} from '@/utils/cf-ip-optimizer'

const MAX_SELECTED = 5

const ipList = ref([])
const currentIps = ref([])
const selectedIds = ref([])
const testing = ref(false)
const applying = ref(false)
const tested = ref(false)
const poolLoading = ref(false)

const sortedIpList = computed(() => {
  return [...ipList.value].sort(compareCfIpResults)
})

function isSelected(id) {
  return selectedIds.value.includes(id)
}

function buildIpState(ip) {
  return {
    ...ip,
    latency: -1,
    avgLatency: 0,
    packetLoss: 100,
    testedTimes: 0,
    successTimes: 0,
    testStatus: 'pending',
    testResults: []
  }
}

async function fetchIpPool() {
  if (poolLoading.value) return false
  poolLoading.value = true

  try {
    const response = await api.user.getCfIps()
    if (response.code === 0) {
      ipList.value = (response.data.ips || []).map(buildIpState)
      currentIps.value = response.data.current_ips || []
      selectedIds.value = []
      tested.value = false
      return true
    }
    return false
  } catch (error) {
    console.error('获取 IP 池列表失败:', error)
    return false
  } finally {
    poolLoading.value = false
  }
}

async function refreshRandom() {
  const refreshed = await fetchIpPool()
  if (refreshed) {
    ElMessage.success('已刷新')
    return
  }
  ElMessage.error('刷新失败，请重试')
}

async function startTest() {
  testing.value = true
  tested.value = false

  ipList.value.forEach(ip => {
    ip.latency = -1
    ip.avgLatency = 0
    ip.packetLoss = 100
    ip.testedTimes = 0
    ip.successTimes = 0
    ip.testStatus = 'testing'
    ip.testResults = []
  })

  selectedIds.value = []

  try {
    await runWithConcurrency(ipList.value, testSingleIp, TEST_CONCURRENCY)
    tested.value = true
    ElMessage.success('测试完成，已按延迟排序')
  } catch (error) {
    ipList.value.forEach(ip => {
      if (ip.testStatus === 'testing') {
        ip.latency = -1
        ip.avgLatency = 0
        ip.packetLoss = 100
        ip.testStatus = 'done'
      }
    })
    tested.value = false
    console.error('测速失败:', error)
    ElMessage.error('测速失败，请重试')
  } finally {
    testing.value = false
  }
}

async function testSingleIp(ipData) {
  for (let i = 0; i < TEST_COUNT; i += 1) {
    try {
      const latency = await pingIp(ipData.ip)
      ipData.testedTimes += 1

      if (latency > 0) {
        ipData.successTimes += 1
        ipData.testResults.push(latency)
        ipData.latency = latency
      }

      if (ipData.testResults.length > 0) {
        const sum = ipData.testResults.reduce((a, b) => a + b, 0)
        ipData.avgLatency = Math.round(sum / ipData.testResults.length)
        ipData.packetLoss = Math.round((1 - ipData.successTimes / ipData.testedTimes) * 100)
      }

      if (i < TEST_COUNT - 1) {
        await new Promise(resolve => setTimeout(resolve, TEST_INTERVAL))
      }
    } catch {
      ipData.testedTimes += 1
      ipData.packetLoss = Math.round((1 - ipData.successTimes / ipData.testedTimes) * 100)
    }
  }

  ipData.testStatus = 'done'
}

function pingIp(ip) {
  return new Promise((resolve) => {
    const startTime = window.performance.now()
    const host = ip.includes(':') ? `[${ip}]` : ip
    const url = `https://${host}:443/cdn-cgi/trace`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
      resolve(-1)
    }, TEST_TIMEOUT)

    fetch(url, {
      mode: 'no-cors',
      signal: controller.signal,
      cache: 'no-store'
    }).then(() => {
      clearTimeout(timeoutId)
      const endTime = window.performance.now()
      resolve(Math.round(endTime - startTime))
    }).catch(() => {
      clearTimeout(timeoutId)
      const endTime = window.performance.now()
      const elapsed = endTime - startTime
      resolve(elapsed < 50 ? -1 : Math.round(elapsed))
    })
  })
}

function toggleSelection(row) {
  const exists = isSelected(row.id)
  if (exists) {
    selectedIds.value = selectedIds.value.filter(id => id !== row.id)
    return
  }

  if (selectedIds.value.length >= MAX_SELECTED) {
    ElMessage.warning(`最多只能选择 ${MAX_SELECTED} 个 IP`)
    return
  }

  selectedIds.value = [...selectedIds.value, row.id]
}

function selectTop5() {
  if (!tested.value) {
    ElMessage.warning('请先测试延迟')
    return
  }

  const selected = selectRecommendedCfIps(sortedIpList.value, MAX_SELECTED)
  if (selected.length === 0) {
    ElMessage.warning('没有可用的 IP')
    return
  }

  selectedIds.value = selected.map(ip => ip.id)
  ElMessage.success(`已选择前 ${selected.length} 个 IP`)
}

async function applyIps() {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请至少选择 1 个 IP')
    return
  }

  if (selectedIds.value.length > MAX_SELECTED) {
    ElMessage.warning(`最多只能选择 ${MAX_SELECTED} 个 IP`)
    return
  }

  try {
    applying.value = true
    const response = await api.user.applyCfIps(selectedIds.value)

    if (response.code === 0) {
      ElMessage.success(response.data.message)
      await fetchIpPool()
    }
  } catch (error) {
    console.error('应用 IP 失败:', error)
    ElMessage.error('应用失败')
  } finally {
    applying.value = false
  }
}

function formatLatency(latency) {
  if (latency < 0) return '未测试'
  if (latency === 0) return '超时'
  return `${latency}ms`
}

function getLatencyClass(latency) {
  if (latency < 0) return 'latency-pending'
  if (latency === 0) return 'latency-timeout'
  if (latency < 100) return 'latency-good'
  if (latency < 200) return 'latency-medium'
  return 'latency-bad'
}

function getRowClassName({ row }) {
  if (row.testStatus === 'done' && row.latency > 0 && row.latency < 100) {
    return 'row-good'
  }
  return ''
}

onMounted(() => {
  fetchIpPool()
})
</script>

<style scoped>
.cf-optimize-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1000px;
}

.content-card {
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
  padding: 24px;
}

.section-head {
  margin-bottom: 18px;
}

.card-title {
  margin: 0;
  color: #0f172a;
  font-size: 20px;
}

.tip {
  margin: 10px 0 0;
  color: #64748b;
  line-height: 1.7;
}

.current-ips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.ip-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  background: #f8fafc;
}

.ip-address {
  font-family: Consolas, Monaco, monospace;
  color: #0f172a;
  word-break: break-all;
}

.empty-tip {
  color: #94a3b8;
}

.toolbar {
  display: flex;
  flex-wrap: nowrap;
  gap: 12px;
  margin-bottom: 22px;
}

.toolbar-button {
  margin: 0;
  flex: 1 1 0;
  min-width: 0;
  height: 52px;
  border: none;
  border-radius: 18px;
  box-shadow: 0 12px 26px rgba(15, 23, 42, 0.12);
}

.toolbar-button:deep(span),
.toolbar-button:deep(.el-icon) {
  color: #fff;
}

.toolbar-button.is-disabled {
  box-shadow: none;
}

.primary-action {
  background: linear-gradient(135deg, #60a5fa 0%, #2563eb 100%);
}

.primary-action:not(.is-disabled):hover,
.primary-action:not(.is-disabled):focus {
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
}

.recommend-action {
  background: linear-gradient(135deg, #fbbf24 0%, #d97706 100%);
}

.recommend-action:not(.is-disabled):hover,
.recommend-action:not(.is-disabled):focus {
  background: linear-gradient(135deg, #f59e0b 0%, #b45309 100%);
}

.refresh-action {
  background: linear-gradient(135deg, #38bdf8 0%, #0ea5e9 100%);
}

.refresh-action:not(.is-disabled):hover,
.refresh-action:not(.is-disabled):focus {
  background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
}

.apply-action {
  background: linear-gradient(135deg, #4ade80 0%, #0f766e 100%);
}

.apply-action:not(.is-disabled):hover,
.apply-action:not(.is-disabled):focus {
  background: linear-gradient(135deg, #22c55e 0%, #0f766e 100%);
}

.toolbar-button.is-disabled.primary-action,
.toolbar-button.is-disabled.recommend-action,
.toolbar-button.is-disabled.refresh-action,
.toolbar-button.is-disabled.apply-action {
  background: linear-gradient(135deg, #cbd5e1 0%, #94a3b8 100%);
}

.desktop-table {
  display: block;
}

.mobile-ip-list {
  display: none;
}

.ip-table-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ipv6-text {
  color: #d97706;
}

.latency-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.latency-detail,
.mobile-latency-detail {
  color: #94a3b8;
  font-size: 12px;
}

.latency-pending {
  color: #94a3b8;
}

.latency-timeout {
  color: #ef4444;
  font-weight: 700;
}

.latency-good {
  color: #16a34a;
  font-weight: 700;
}

.latency-medium {
  color: #d97706;
  font-weight: 700;
}

.latency-bad {
  color: #ef4444;
  font-weight: 700;
}

.mobile-ip-card {
  padding: 16px;
  border-radius: 18px;
  border: 1px solid #e2e8f0;
  background: #fff;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.mobile-ip-card + .mobile-ip-card {
  margin-top: 12px;
}

.mobile-ip-card.selected {
  border-color: rgba(34, 197, 94, 0.5);
  box-shadow: 0 10px 24px rgba(34, 197, 94, 0.1);
}

.mobile-ip-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mobile-rank {
  color: #64748b;
  font-weight: 600;
}

.mobile-ip-address {
  margin-top: 12px;
  color: #0f172a;
  font-family: Consolas, Monaco, monospace;
  line-height: 1.7;
  word-break: break-all;
}

.mobile-ip-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.mobile-meta-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: 14px;
  background: #f8fafc;
}

.mobile-meta-label {
  color: #94a3b8;
  font-size: 12px;
}

.mobile-latency-detail {
  margin-top: 12px;
}

:deep(.row-good) {
  background-color: #f0fdf4 !important;
}

@media (max-width: 768px) {
  .content-card {
    border-radius: 18px;
    padding: 18px;
  }

  .toolbar {
    display: flex;
    flex-direction: column;
    flex-wrap: nowrap;
  }

  .toolbar-button {
    height: 50px;
    border-radius: 16px;
    width: 100%;
  }

  .desktop-table {
    display: none;
  }

  .mobile-ip-list {
    display: block;
  }
}
</style>

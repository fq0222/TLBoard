<template>
  <div class="subscription-container" v-loading="pageLoading">
    <section class="panel-card action-panel">
      <div class="step-actions">
        <button
          type="button"
          class="step-action-card optimize-action"
          :class="{ disabled: actionBusy }"
          :disabled="actionBusy"
          @click="startOptimize"
        >
          <span class="step-action-index">1</span>
          <span class="step-action-name">{{ cfOptimized ? '重新优选极速通道' : '一键开启极速通道' }}</span>
        </button>

        <button
          type="button"
          class="step-action-card generate-action"
          :class="{ disabled: actionBusy }"
          :disabled="actionBusy"
          @click="generateSubscription"
        >
          <span class="step-action-index">2</span>
          <span class="step-action-name">
            {{ generatingSubscription ? '生成中...' : '生成订阅链接' }}
          </span>
        </button>
      </div>
    </section>

    <section class="content-grid">
      <article class="panel-card result-card">
        <div class="section-head">
          <h2 class="card-title">结果区</h2>
          <el-tag size="small" :type="cfOptimized ? 'success' : 'warning'">
            {{ cfOptimized ? '极速通道已开启' : '极速通道未开启' }}
          </el-tag>
        </div>

        <div v-if="subscriptionReady" class="subscription-links">
          <div class="link-group">
            <span class="link-label">通用订阅链接</span>
            <el-input :model-value="subscription.subscription_url || ''" readonly size="large">
              <template #append>
                <el-button @click="copyLink(subscription.subscription_url)">复制</el-button>
              </template>
            </el-input>
            <p class="link-tip">适用于 v2rayN、v2rayNG、Shadowrocket、Quantumult X 等客户端。</p>
          </div>

          <div class="link-group">
            <span class="link-label">Clash 订阅链接</span>
            <el-input :model-value="subscription.clash_url || ''" readonly size="large">
              <template #append>
                <el-button @click="copyLink(subscription.clash_url)">复制</el-button>
              </template>
            </el-input>
            <p class="link-tip">适用于 Clash、Clash Verge、ClashX、Clash for Windows 等客户端。</p>
          </div>
        </div>
        <el-empty v-else description="请先点击“生成订阅链接”按钮" />
      </article>

      <article v-if="subscriptionReady" class="panel-card nodes-card">
        <div class="section-head">
          <h2 class="card-title">节点列表</h2>
        </div>

        <div v-if="hasNodes" class="nodes-content">
          <div class="nodes-table-wrap">
            <el-table :data="subscription.nodes" style="width: 100%">
              <el-table-column prop="node_name" label="节点" min-width="150" />
              <el-table-column prop="address" label="地址" min-width="140" />
              <el-table-column prop="port" label="端口" width="88" />
              <el-table-column label="协议" min-width="220">
                <template #default="{ row }">
                  <template v-for="tag in parseProtocol(row.protocol)" :key="tag">
                    <el-tag :type="getTagType(tag)" size="small" class="protocol-tag">{{ tag }}</el-tag>
                  </template>
                </template>
              </el-table-column>
              <el-table-column prop="remark" label="备注" min-width="140" />
            </el-table>
          </div>

          <div class="nodes-mobile-list">
            <article
              v-for="node in subscription.nodes"
              :key="`${node.node_name}-${node.address}-${node.port}`"
              class="node-mobile-card"
            >
              <div class="node-mobile-head">
                <h3 class="node-mobile-title">{{ node.node_name || '未命名节点' }}</h3>
                <div class="node-mobile-tags">
                  <template v-for="tag in parseProtocol(node.protocol)" :key="tag">
                    <el-tag :type="getTagType(tag)" size="small" class="protocol-tag">{{ tag }}</el-tag>
                  </template>
                </div>
              </div>

              <div class="node-mobile-meta">
                <div class="node-mobile-row">
                  <span class="node-mobile-label">地址</span>
                  <span class="node-mobile-value">{{ node.address || '-' }}</span>
                </div>
                <div class="node-mobile-row">
                  <span class="node-mobile-label">端口</span>
                  <span class="node-mobile-value">{{ node.port || '-' }}</span>
                </div>
                <div class="node-mobile-row">
                  <span class="node-mobile-label">备注</span>
                  <span class="node-mobile-value">{{ node.remark || '-' }}</span>
                </div>
              </div>
            </article>
          </div>
        </div>

        <el-empty v-else description="暂无节点信息" />
      </article>
    </section>

    <el-dialog
      v-model="optimizing"
      title="极速通道优化中"
      :width="optimizeDialogWidth"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      class="optimize-dialog"
    >
      <div class="optimize-dialog-content">
        <el-alert
          title="正在为您选择更快的线路，请稍候..."
          description="系统会自动检测网络质量，并应用更优的连接方案。"
          type="warning"
          :closable="false"
          show-icon
        />
        <div class="progress-panel">
          <el-progress
            :percentage="optimizeProgress"
            :stroke-width="18"
            :text-inside="true"
            :status="optimizeProgress === 100 ? 'success' : ''"
          />
          <p class="progress-text">{{ optimizeStatusText }}</p>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="generatingSubscription"
      title="生成订阅中"
      :width="optimizeDialogWidth"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      class="generate-dialog"
    >
      <div class="generate-dialog-content">
        <div class="generate-loading-orb">
          <el-icon class="generate-loading-icon"><Loading /></el-icon>
        </div>
        <h3 class="generate-dialog-title">正在生成订阅链接</h3>
        <p class="generate-dialog-text">系统正在同步节点信息并生成通用订阅和 Clash 订阅链接，请稍候。</p>
        <div class="generate-loading-dots" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import api from '@/api'
import {
  CF_IP_TEST_COUNT as TEST_COUNT,
  CF_IP_TEST_INTERVAL as TEST_INTERVAL
} from '@/utils/cf-ip-test-config'
import { createCfLatencySample } from '@/utils/cf-ip-browser-test.js'
import { selectFallbackCfIp, selectRecommendedCfIps } from '@/utils/cf-ip-optimizer'
import { getSubscriptionGenerationErrorMessage } from '@/utils/subscription-error'

const userStore = useUserStore()

const subscription = ref({})
const pageLoading = ref(false)
const generatingSubscription = ref(false)
const cfOptimized = ref(false)
const optimizing = ref(false)
const optimizeProgress = ref(0)
const optimizeStatusText = ref('')
const windowWidth = ref(window.innerWidth)
const optimizeFailureCount = ref(0)

const MAX_OPTIMIZE_FAILURE_COUNT = 3

const hasNodes = computed(() => Array.isArray(subscription.value.nodes) && subscription.value.nodes.length > 0)
const subscriptionReady = computed(() => !!subscription.value.subscription_ready)
const actionBusy = computed(() => optimizing.value || generatingSubscription.value)
const optimizeDialogWidth = computed(() => (windowWidth.value <= 768 ? '94%' : '420px'))

async function fetchPageData() {
  try {
    pageLoading.value = true
    const [subscriptionResponse, profileResult] = await Promise.all([
      api.user.getSubscription(),
      userStore.fetchUserProfile()
    ])

    if (subscriptionResponse.code === 0) {
      subscription.value = subscriptionResponse.data || {}
    }

    if (profileResult.success) {
      cfOptimized.value = !!profileResult.data.cf_optimized
    }
  } catch (error) {
    console.error('获取订阅页面数据失败:', error)
  } finally {
    pageLoading.value = false
  }
}

function handleResize() {
  windowWidth.value = window.innerWidth
}

async function copyLink(link) {
  if (!link) {
    ElMessage.warning('请先生成订阅链接')
    return
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link)
    } else {
      fallbackCopyText(link)
    }
    ElMessage.success('链接已复制到剪贴板')
  } catch (error) {
    try {
      fallbackCopyText(link)
      ElMessage.success('链接已复制到剪贴板')
    } catch (fallbackError) {
      console.error('复制链接失败:', error, fallbackError)
      ElMessage.error('复制失败，请手动复制')
    }
  }
}

function fallbackCopyText(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'readonly')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!copied) {
    throw new Error('execCommand copy failed')
  }
}

async function generateSubscription() {
  if (generatingSubscription.value || optimizing.value) {
    return
  }

  if (!cfOptimized.value) {
    ElMessage.warning('请先开启极速通道')
    return
  }

  try {
    generatingSubscription.value = true
    const response = await api.user.generateSubscription()

    if (response.code === 0) {
      subscription.value = {
        ...subscription.value,
        subscription_url: response.data.subscription_url,
        clash_url: response.data.clash_url
      }
      ElMessage.success('订阅链接已生成')
      await fetchPageData()
    } else {
      ElMessage.error(response.message || '生成订阅链接失败')
    }
  } catch (error) {
    console.error('生成订阅链接失败:', error)
    ElMessage.error(getSubscriptionGenerationErrorMessage(error))
  } finally {
    generatingSubscription.value = false
  }
}

async function startOptimize() {
  if (optimizing.value || generatingSubscription.value) {
    return
  }

  try {
    optimizing.value = true
    optimizeProgress.value = 0
    optimizeStatusText.value = '正在准备线路检测...'

    const response = await api.user.getCfIps()
    if (response.code !== 0) {
      throw new Error('线路检测服务暂不可用')
    }

    const ipPool = response.data.ips
    if (!ipPool || ipPool.length === 0) {
      throw new Error('暂无可用线路，请联系管理员')
    }

    const totalIps = ipPool.length
    let completedIps = 0

    const ipTestData = ipPool.map(item => ({
      id: item.id,
      ip: item.ip,
      latency: -1,
      successTimes: 0,
      testedTimes: 0,
      testResults: [],
      testStatus: 'pending'
    }))

    await Promise.all(ipTestData.map(async (ipData) => {
      await testSingleIp(ipData)
      completedIps += 1
      optimizeProgress.value = 10 + Math.round((completedIps / totalIps) * 70)
      optimizeStatusText.value = '正在检测线路质量...'
    }))

    ipTestData.forEach(ipData => {
      if (ipData.testResults.length > 0) {
        const sum = ipData.testResults.reduce((acc, item) => acc + item, 0)
        ipData.avgLatency = Math.round(sum / ipData.testResults.length)
        ipData.packetLoss = Math.round((1 - ipData.successTimes / ipData.testedTimes) * 100)
      } else {
        ipData.avgLatency = -1
        ipData.packetLoss = 100
      }
    })

    optimizeProgress.value = 85
    optimizeStatusText.value = '正在匹配最佳线路...'

    const selectedIps = selectRecommendedCfIps(ipTestData)
    if (selectedIps.length === 0) {
      optimizeFailureCount.value += 1
      if (optimizeFailureCount.value >= MAX_OPTIMIZE_FAILURE_COUNT) {
        await applyFallbackOptimize(ipPool)
        return
      }
      throw new Error(`当前网络暂时无法完成线路检测，请稍后重试（${optimizeFailureCount.value}/3）`)
    }

    optimizeProgress.value = 95
    optimizeStatusText.value = '正在应用优化结果...'

    const ipIds = selectedIps.map(item => item.id)
    const applyResponse = await api.user.applyCfIps(ipIds)

    if (applyResponse.code === 0) {
      optimizeProgress.value = 100
      optimizeStatusText.value = '极速通道已开启'
      cfOptimized.value = true
      optimizeFailureCount.value = 0
      await fetchPageData()
      ElMessage.success('已成功开启极速通道')
    } else {
      throw new Error(applyResponse.message || '应用优化结果失败')
    }
  } catch (error) {
    console.error('一键优选失败:', error)
    ElMessage.error(error.message || '线路优化失败，请重试')
    optimizeProgress.value = 0
    optimizeStatusText.value = ''
  } finally {
    setTimeout(() => {
      optimizing.value = false
    }, 1500)
  }
}

/**
 * 连续检测失败后的备用配置入口。
 * @param {Object[]} ipPool - 本轮后端返回的候选线路池。
 * @returns {Promise<void>} 备用配置保存并提示用户后完成。
 */
async function applyFallbackOptimize(ipPool) {
  const fallbackIp = selectFallbackCfIp(ipPool)
  if (!fallbackIp) {
    throw new Error('暂无可用线路，请联系管理员')
  }

  optimizeProgress.value = 95
  optimizeStatusText.value = '正在启用备用配置...'

  const applyResponse = await api.user.applyCfIps([fallbackIp.id])
  if (applyResponse.code !== 0) {
    throw new Error(applyResponse.message || '启用备用配置失败')
  }

  optimizeProgress.value = 100
  optimizeStatusText.value = '备用配置已启用'
  cfOptimized.value = true
  optimizeFailureCount.value = 0
  await fetchPageData()
  await ElMessageBox.alert(
    '当前网络环境无法完成线路检测。这通常与您当前使用的网络有关，并不是系统故障。我们已为您启用备用配置，您可以继续生成订阅；除极速线路以外的其他节点不受影响，可以正常使用。',
    '已启用备用配置',
    {
      confirmButtonText: '我知道了',
      type: 'warning'
    }
  )
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

      if (i < TEST_COUNT - 1) {
        await new Promise(resolve => setTimeout(resolve, TEST_INTERVAL))
      }
    } catch {
      ipData.testedTimes += 1
    }
  }
  ipData.testStatus = 'done'
}

function pingIp(ip) {
  return createCfLatencySample(ip)
}

function parseProtocol(protocol) {
  if (!protocol) return []
  return protocol.split('+').filter(tag => tag.toLowerCase() !== 'none')
}

function getTagType(tag) {
  const lower = tag.toLowerCase()
  if (lower === 'vless') return 'primary'
  if (lower === 'vmess') return 'success'
  if (lower === 'trojan') return 'warning'
  if (lower === 'tcp') return 'info'
  if (lower === 'ws') return 'info'
  if (lower === 'reality') return 'danger'
  if (lower === 'tls') return 'danger'
  return ''
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
  fetchPageData()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
.subscription-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.panel-card {
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
  padding: 24px;
  min-width: 0;
}

.action-panel {
  padding: 22px;
}

.step-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.step-action-card {
  position: relative;
  width: 100%;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 52px;
  border: 1px solid;
  border-radius: 14px;
  appearance: none;
  overflow: hidden;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.step-action-card:hover:not(:disabled) {
  transform: translateY(-1px);
}

.step-action-card:active:not(:disabled) {
  transform: scale(0.985);
}

.step-action-card:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.24);
  outline-offset: 2px;
}

.step-action-card.disabled,
.step-action-card:disabled {
  opacity: 0.56;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.optimize-action {
  color: #155bd7;
  border-color: #8bbcff;
  border-bottom: 3px solid #2563eb;
  background: linear-gradient(180deg, #f3f7ff 0%, #e8f1ff 100%);
}

.optimize-action:hover:not(:disabled) {
  background: linear-gradient(180deg, #eaf2ff 0%, #dceaff 100%);
  box-shadow: 0 6px 14px rgba(37, 99, 235, 0.12);
}

.generate-action {
  color: #07833f;
  border-color: #81dda4;
  border-bottom: 3px solid #16a34a;
  background: linear-gradient(180deg, #f2fff7 0%, #e7f9ee 100%);
}

.generate-action:hover:not(:disabled) {
  background: linear-gradient(180deg, #e9fbf0 0%, #d9f4e4 100%);
  box-shadow: 0 6px 14px rgba(22, 163, 74, 0.12);
}

.step-action-index {
  position: absolute;
  left: 18px;
  top: 50%;
  min-width: 24px;
  padding-right: 14px;
  border-right: 1px solid currentColor;
  transform: translateY(-50%);
  font-size: 17px;
  font-weight: 800;
  line-height: 24px;
}

.step-action-name {
  color: currentColor;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.25;
  text-align: center;
  letter-spacing: 0.01em;
}

@media (prefers-reduced-motion: reduce) {
  .step-action-card {
    transition: none;
  }
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}

.card-title {
  margin: 0;
  color: #0f172a;
  font-size: 20px;
}

.subscription-links {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.link-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.link-label {
  display: block;
  margin-bottom: 8px;
  color: #0f172a;
  font-weight: 600;
}

.link-tip {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.protocol-tag {
  margin-right: 4px;
  margin-bottom: 4px;
}

.nodes-table-wrap {
  width: 100%;
  min-width: 0;
}

.nodes-mobile-list {
  display: none;
}

.node-mobile-card {
  padding: 16px;
  border-radius: 18px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.node-mobile-card + .node-mobile-card {
  margin-top: 12px;
}

.node-mobile-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}

.node-mobile-title {
  margin: 0;
  color: #0f172a;
  font-size: 17px;
  line-height: 1.4;
}

.node-mobile-tags {
  display: flex;
  flex-wrap: wrap;
}

.node-mobile-meta {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.node-mobile-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.node-mobile-label {
  color: #64748b;
  font-size: 13px;
}

.node-mobile-value {
  color: #0f172a;
  line-height: 1.6;
  word-break: break-all;
}

.progress-panel {
  margin-top: 14px;
  padding: 16px;
  border-radius: 16px;
  background: #f8fafc;
}

.progress-text {
  margin: 10px 0 0;
  color: #64748b;
  font-size: 13px;
}

.optimize-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 0;
}

.optimize-dialog-content :deep(.el-alert) {
  min-width: 0;
}

.generate-dialog-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  padding: 20px 8px 12px;
}

.generate-loading-orb {
  width: 72px;
  height: 72px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 24px;
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.16), rgba(15, 118, 110, 0.22));
  box-shadow: 0 16px 30px rgba(15, 118, 110, 0.14);
}

.generate-loading-icon {
  font-size: 34px;
  color: #0f766e;
  animation: spin 1.2s linear infinite;
}

.generate-dialog-title {
  margin: 0;
  color: #0f172a;
  font-size: 22px;
}

.generate-dialog-text {
  margin: 0;
  color: #64748b;
  line-height: 1.8;
}

.generate-loading-dots {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.generate-loading-dots span {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, #22c55e, #0f766e);
  animation: dotPulse 1.2s ease-in-out infinite;
}

.generate-loading-dots span:nth-child(2) {
  animation-delay: 0.18s;
}

.generate-loading-dots span:nth-child(3) {
  animation-delay: 0.36s;
}

.optimize-dialog :deep(.el-dialog) {
  border-radius: 20px;
  box-sizing: border-box;
}

.generate-dialog :deep(.el-dialog) {
  border-radius: 20px;
  box-sizing: border-box;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes dotPulse {
  0%,
  80%,
  100% {
    transform: scale(0.7);
    opacity: 0.45;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

@media (max-width: 1024px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .panel-card,
  .action-panel {
    padding: 18px;
    border-radius: 18px;
  }

  .step-actions {
    grid-template-columns: 1fr;
  }

  .step-action-card {
    padding: 10px 48px;
  }

  .step-action-name {
    font-size: 16px;
  }

  .section-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .nodes-table-wrap {
    display: none;
  }

  .nodes-mobile-list {
    display: block;
  }

  .node-mobile-card {
    padding: 14px;
    border-radius: 16px;
  }

  .node-mobile-card + .node-mobile-card {
    margin-top: 10px;
  }

  .node-mobile-head {
    gap: 8px;
    margin-bottom: 10px;
  }

  .node-mobile-title {
    font-size: 16px;
    line-height: 1.35;
  }

  .node-mobile-tags {
    gap: 4px;
  }

  .node-mobile-tags :deep(.protocol-tag) {
    margin-right: 0;
    margin-bottom: 0;
  }

  .node-mobile-meta {
    gap: 8px;
  }

  .node-mobile-row {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
  }

  .node-mobile-label {
    font-size: 12px;
    line-height: 1.5;
  }

  .node-mobile-value {
    font-size: 15px;
    line-height: 1.5;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .link-group :deep(.el-input-group) {
    width: 100%;
  }

  .optimize-dialog :deep(.el-dialog) {
    margin-top: 4vh !important;
  }

  .optimize-dialog :deep(.el-dialog__body) {
    padding: 16px !important;
    max-height: 72vh;
    overflow-y: auto;
  }

  .optimize-dialog-content {
    padding: 0;
  }

  .generate-dialog :deep(.el-dialog) {
    margin-top: 4vh !important;
  }

  .generate-dialog :deep(.el-dialog__body) {
    padding: 16px !important;
    max-height: 72vh;
    overflow-y: auto;
  }

  .generate-dialog-content {
    padding: 4px 0 0;
  }
}
</style>

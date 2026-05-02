<template>
  <div class="cf-optimize-container">
    <div class="page-header">
      <h1 class="page-title">CF IP 优选</h1>
      <p class="page-subtitle">在本地测试 Cloudflare IP 延迟，选择最优节点</p>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">当前使用的 IP</h2>
      <div class="current-ips">
        <div v-for="(ip, index) in currentIps" :key="index" class="ip-item">
          <span class="ip-address">{{ ip.ip }}</span>
          <el-tag size="small">{{ ip.source === 'default' ? '默认' : '自定义' }}</el-tag>
        </div>
        <div v-if="currentIps.length === 0" class="empty-tip">暂无自定义 IP，使用默认 IP</div>
      </div>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">IP 池列表</h2>
      <p class="tip">每次随机展示20个IP（包含至少3个IPv6），点击"开始测试"在浏览器本地测试延迟</p>
      
      <div class="toolbar">
        <el-button type="primary" size="large" :loading="testing" @click="startTest">
          <el-icon><Connection /></el-icon>
          开始测试
        </el-button>
        
        <el-button size="large" :disabled="!tested" @click="selectTop5">
          <el-icon><Trophy /></el-icon>
          选前5（含IPv6）
        </el-button>
        
        <el-button size="large" @click="refreshRandom">
          <el-icon><Refresh /></el-icon>
          随机换一批
        </el-button>
        
        <el-button size="large" @click="selectAll">
          {{ isAllSelected ? '取消全选' : '全选' }}
        </el-button>
        
        <el-button 
          type="success" 
          size="large"
          :disabled="selectedIps.length === 0 || selectedIps.length > 5 || applying"
          :loading="applying"
          @click="applyIps"
        >
          <el-icon><Check /></el-icon>
          应用选中IP ({{ selectedIps.length }}/5)
        </el-button>
      </div>
      
      <el-table 
        :data="sortedIpList" 
        style="width: 100%"
        @selection-change="handleSelectionChange"
        ref="tableRef"
        :row-class-name="getRowClassName"
      >
        <el-table-column type="selection" width="55" />
        <el-table-column type="index" label="排名" width="70" />
        <el-table-column prop="ip" label="IP地址">
          <template #default="scope">
            <span :class="isIpv6(scope.row.ip) ? 'ipv6-tag' : ''">{{ scope.row.ip }}</span>
            <el-tag v-if="isIpv6(scope.row.ip)" size="small" type="warning" style="margin-left: 8px;">IPv6</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="延迟" width="200">
          <template #default="scope">
            <div class="latency-cell">
              <span :class="getLatencyClass(scope.row.latency)">
                {{ formatLatency(scope.row.latency) }}
              </span>
              <div v-if="scope.row.testedTimes > 1" class="latency-detail">
                平均: {{ scope.row.avgLatency }}ms | 丢包: {{ scope.row.packetLoss }}%
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="scope">
            <el-tag v-if="scope.row.testStatus === 'testing'" type="warning" size="small">测试中</el-tag>
            <el-tag v-else-if="scope.row.testStatus === 'done'" :type="scope.row.latency > 0 ? 'success' : 'danger'" size="small">
              {{ scope.row.latency > 0 ? '可用' : '超时' }}
            </el-tag>
            <el-tag v-else type="info" size="small">待测试</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Connection, Check, Refresh, Trophy } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const TEST_COUNT = 3
const TEST_TIMEOUT = 5000
const TEST_INTERVAL = 200

const ipList = ref([])
const currentIps = ref([])
const selectedIps = ref([])
const testing = ref(false)
const applying = ref(false)
const tableRef = ref(null)
const tested = ref(false)

const isAllSelected = computed(() => ipList.value.length > 0 && selectedIps.value.length === ipList.value.length)

// 排序后的列表：按延迟从低到高，超时放最后
const sortedIpList = computed(() => {
  return [...ipList.value].sort((a, b) => {
    // 未测试的放最后
    if (a.testStatus !== 'done' && b.testStatus !== 'done') return 0
    if (a.testStatus !== 'done') return 1
    if (b.testStatus !== 'done') return -1
    
    // 超时的放最后
    if (a.latency <= 0 && b.latency <= 0) return 0
    if (a.latency <= 0) return 1
    if (b.latency <= 0) return -1
    
    // 按延迟排序
    return a.latency - b.latency
  })
})

function isIpv6(ip) {
  return ip.includes(':')
}

async function fetchIpPool() {
  try {
    const response = await api.user.getCfIps()
    if (response.code === 0) {
      ipList.value = response.data.ips.map(ip => ({
        ...ip,
        latency: -1,
        avgLatency: 0,
        packetLoss: 100,
        testedTimes: 0,
        successTimes: 0,
        testStatus: 'pending',
        testResults: []
      }))
      currentIps.value = response.data.current_ips
      tested.value = false
    }
  } catch (error) {
    console.error('获取 IP 池列表失败:', error)
  }
}

async function refreshRandom() {
  await fetchIpPool()
  ElMessage.success('已刷新')
}

async function startTest() {
  testing.value = true
  
  // 重置所有IP的测试状态
  ipList.value.forEach(ip => {
    ip.latency = -1
    ip.avgLatency = 0
    ip.packetLoss = 100
    ip.testedTimes = 0
    ip.successTimes = 0
    ip.testStatus = 'testing'
    ip.testResults = []
  })
  
  // 清空选择
  if (tableRef.value) {
    tableRef.value.clearSelection()
  }
  
  await Promise.all(ipList.value.map(ip => testSingleIp(ip)))
  
  testing.value = false
  tested.value = true
  ElMessage.success('测试完成，已按延迟排序')
}

async function testSingleIp(ipData) {
  for (let i = 0; i < TEST_COUNT; i++) {
    try {
      const latency = await pingIp(ipData.ip)
      ipData.testedTimes++
      
      if (latency > 0) {
        ipData.successTimes++
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
    } catch (error) {
      ipData.testedTimes++
      ipData.packetLoss = Math.round((1 - ipData.successTimes / ipData.testedTimes) * 100)
    }
  }
  
  ipData.testStatus = 'done'
}

function pingIp(ip) {
  return new Promise((resolve) => {
    const startTime = window.performance.now()
    const url = `https://${ip}:443/cdn-cgi/trace`
    
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

// 选择前5个（必须包含至少1个IPv6）
function selectTop5() {
  if (!tested.value) {
    ElMessage.warning('请先测试延迟')
    return
  }
  
  // 获取排序后的可用IP
  const availableIps = sortedIpList.value.filter(ip => ip.latency > 0)
  
  if (availableIps.length === 0) {
    ElMessage.warning('没有可用的IP')
    return
  }
  
  // 分离IPv4和IPv6
  const ipv4List = availableIps.filter(ip => !isIpv6(ip.ip))
  const ipv6List = availableIps.filter(ip => isIpv6(ip.ip))
  
  const selected = []
  
  // 优先选择1个IPv6（如果有的话）
  if (ipv6List.length > 0) {
    selected.push(ipv6List[0])
  }
  
  // 剩余从IPv4中选择，凑够5个
  for (const ip of ipv4List) {
    if (selected.length >= 5) break
    if (!selected.find(s => s.id === ip.id)) {
      selected.push(ip)
    }
  }
  
  // 如果还不够5个，从剩余IPv6中补充
  for (const ip of ipv6List) {
    if (selected.length >= 5) break
    if (!selected.find(s => s.id === ip.id)) {
      selected.push(ip)
    }
  }
  
  // 设置选中状态
  if (tableRef.value) {
    tableRef.value.clearSelection()
    selected.forEach(row => {
      tableRef.value.toggleRowSelection(row, true)
    })
  }
  selectedIps.value = selected
  
  ElMessage.success(`已选择前 ${selected.length} 个IP`)
}

function selectAll() {
  if (isAllSelected.value) {
    selectedIps.value = []
    if (tableRef.value) {
      tableRef.value.clearSelection()
    }
  } else {
    if (tableRef.value) {
      tableRef.value.clearSelection()
      ipList.value.forEach(row => {
        tableRef.value.toggleRowSelection(row, true)
      })
    }
    selectedIps.value = [...ipList.value]
  }
}

function handleSelectionChange(selection) {
  selectedIps.value = selection
}

async function applyIps() {
  if (selectedIps.value.length === 0) {
    ElMessage.warning('请至少选择 1 个 IP')
    return
  }
  
  if (selectedIps.value.length > 5) {
    ElMessage.warning('最多只能选择 5 个 IP')
    return
  }
  
  try {
    applying.value = true
    const ipIds = selectedIps.value.map(ip => ip.id)
    const response = await api.user.applyCfIps(ipIds)
    
    if (response.code === 0) {
      ElMessage.success(response.data.message)
      fetchIpPool()
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
.cf-optimize-container { max-width: 1000px; }
.page-header { margin-bottom: 30px; }
.page-title { font-size: 28px; color: #333; margin-bottom: 10px; }
.page-subtitle { color: #666; font-size: 16px; }
.content-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); padding: 30px; margin-bottom: 20px; }
.card-title { font-size: 20px; color: #333; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #eee; }
.tip { color: #999; font-size: 14px; margin-bottom: 15px; }
.toolbar { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
.latency-cell { display: flex; flex-direction: column; gap: 4px; }
.latency-detail { font-size: 12px; color: #999; }
.latency-pending { color: #999; }
.latency-timeout { color: #f56c6c; font-weight: bold; }
.latency-good { color: #67c23a; font-weight: bold; }
.latency-medium { color: #e6a23c; font-weight: bold; }
.latency-bad { color: #f56c6c; font-weight: bold; }
.ipv6-tag { color: #e6a23c; }
.current-ips { display: flex; flex-wrap: wrap; gap: 10px; }
.ip-item { display: flex; align-items: center; gap: 10px; padding: 10px 15px; background: #f5f7fa; border-radius: 8px; }
.ip-address { font-family: monospace; color: #333; }
.empty-tip { color: #999; font-size: 14px; }
:deep(.row-good) { background-color: #f0f9eb !important; }
</style>
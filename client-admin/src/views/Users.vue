<template>
  <div class="users-container">
    <div class="page-header">
      <h1 class="page-title">用户管理</h1>
      <p class="page-subtitle">管理系统用户</p>
    </div>
    
    <div class="content-card">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索邮箱" style="width: 300px; margin-right: 10px;" @keyup.enter="fetchUsers">
          <template #append>
            <el-button @click="fetchUsers">
              <el-icon><Search /></el-icon>
            </el-button>
          </template>
        </el-input>
        <el-select v-model="status" placeholder="状态筛选" clearable style="width: 150px; margin-right: 10px;" @change="fetchUsers">
          <el-option label="正常" value="active" />
          <el-option label="已过期" value="expired" />
          <el-option label="禁用" value="disabled" />
        </el-select>
        <el-button type="warning" @click="batchDialogVisible = true">
          批量生成订阅链接
        </el-button>
        <div v-if="batchProgress.id" class="batch-progress">
          当前执行 {{ batchProgress.current_email || '-' }}
          {{ batchProgress.completed_count }} / {{ batchProgress.total_count }}
          状态：{{ batchProgress.status_text }}
        </div>
      </div>
      
      <el-table :data="users" style="width: 100%" @sort-change="handleSortChange">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="email" label="邮箱" />
        <el-table-column prop="plan_name" label="套餐" />
        <el-table-column
          prop="traffic_used"
          label="已用流量"
          sortable="custom"
          :sort-orders="['descending', null]"
        >
          <template #default="scope">
            {{ scope.row.traffic_used_text }}
          </template>
        </el-table-column>
        <el-table-column prop="traffic_limit_text" label="流量上限" />
        <el-table-column prop="expire_text" label="到期时间" />
        <el-table-column prop="status_text" label="状态" width="100">
          <template #default="scope">
            <el-tag :type="getStatusType(scope.row.status)">{{ scope.row.status_text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="scope">
            <el-button size="small" type="primary" @click="showEditDialog(scope.row)">编辑</el-button>
            <el-button
              size="small"
              type="danger"
              :loading="deletingUserId === scope.row.id"
              :disabled="deletingUserId !== null"
              @click="deleteUser(scope.row)"
            >
              <el-icon><Delete /></el-icon>
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      
      <div class="pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="limit"
          :total="total"
          :page-sizes="[15, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="fetchUsers"
          @size-change="fetchUsers"
        />
      </div>
    </div>
    
    <el-dialog v-model="dialogVisible" title="编辑用户" width="600px" :close-on-click-modal="!submitting">
      <el-form :model="userForm" label-width="100px">
        <!-- 基本信息 -->
        <el-divider content-position="left">基本信息</el-divider>
        <el-form-item label="邮箱">
          <el-input v-model="userForm.email" readonly />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="userForm.enabled" :disabled="submitting" />
        </el-form-item>
        <el-form-item label="流量上限">
          <div style="display: flex; gap: 10px; align-items: center;">
            <el-input-number v-model="userForm.traffic_value" :min="0" :precision="2" style="flex: 1;" @change="handleValueChange" :disabled="submitting" />
            <el-select v-model="userForm.traffic_unit" style="width: 100px;" @change="handleUnitChange" :disabled="submitting">
              <el-option label="B" value="B" />
              <el-option label="KB" value="KB" />
              <el-option label="MB" value="MB" />
              <el-option label="GB" value="GB" />
              <el-option label="TB" value="TB" />
            </el-select>
          </div>
        </el-form-item>
        <el-form-item label="到期时间">
          <el-date-picker v-model="userForm.expire_at" type="datetime" placeholder="选择到期时间" :disabled="submitting" />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            @click="saveBasicInfo"
            :loading="basicSubmitting"
            :disabled="cfIpsSubmitting || generatingSubscription"
          >
            更新基本信息
          </el-button>
        </el-form-item>
        
        <!-- CF IP 管理 -->
        <el-divider content-position="left">优选 IP（最多 5 个）</el-divider>
        <el-form-item>
          <div style="width: 100%;">
            <!-- 已选择的 IP 列表 -->
            <div v-for="(ip, index) in cfIps" :key="ip.id" style="display: flex; align-items: center; margin-bottom: 8px; padding: 8px; background: #f5f7fa; border-radius: 4px;">
              <span style="flex: 1;">{{ ip.ip }}</span>
              <el-button type="danger" size="small" text @click="removeCfIp(index)" :disabled="submitting">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
            
            <!-- 添加 IP -->
            <div v-if="cfIps.length < 5" style="display: flex; gap: 10px;">
              <el-select
                v-model="selectedCfIpId"
                filterable
                placeholder="搜索并选择 IP"
                style="flex: 1;"
                :disabled="submitting"
              >
                <el-option
                  v-for="ip in getSelectableCfIps()"
                  :key="ip.id"
                  :label="ip.ip"
                  :value="ip.id"
                />
              </el-select>
              <el-button type="primary" @click="addCfIp" :disabled="!selectedCfIpId || submitting">
                添加
              </el-button>
            </div>
            
            <div v-if="cfIps.length === 0" style="color: #909399; font-size: 12px; margin-top: 5px;">
              未配置优选 IP
            </div>
            <div class="section-actions">
              <el-button
                type="primary"
                @click="saveCfIps"
                :loading="cfIpsSubmitting"
                :disabled="basicSubmitting || generatingSubscription"
              >
                更新优选 IP
              </el-button>
            </div>
          </div>
        </el-form-item>
        
        <!-- 订阅链接 -->
        <el-divider content-position="left">订阅链接</el-divider>
        <el-form-item>
          <div style="width: 100%;">
            <div v-if="subscriptionUrl" style="margin-bottom: 10px;">
              <div style="margin-bottom: 5px; font-size: 12px; color: #606266;">通用订阅：</div>
              <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                <el-input v-model="subscriptionUrl" readonly>
                  <template #append>
                    <el-button
                      :loading="copySubmittingType === 'subscription'"
                      :disabled="!!copySubmittingType"
                      aria-label="复制通用订阅链接"
                      @click="copySubscriptionUrl('subscription')"
                    >
                      <el-icon><CopyDocument /></el-icon>
                    </el-button>
                  </template>
                </el-input>
              </div>
              <div style="margin-bottom: 5px; font-size: 12px; color: #606266;">Clash 订阅：</div>
              <div style="display: flex; gap: 10px;">
                <el-input v-model="clashUrl" readonly>
                  <template #append>
                    <el-button
                      :loading="copySubmittingType === 'clash'"
                      :disabled="!!copySubmittingType"
                      aria-label="复制 Clash 订阅链接"
                      @click="copySubscriptionUrl('clash')"
                    >
                      <el-icon><CopyDocument /></el-icon>
                    </el-button>
                  </template>
                </el-input>
              </div>
            </div>
            <div v-else style="color: #909399; font-size: 12px; margin-bottom: 10px;">
              未生成订阅链接
            </div>
            <el-button 
              type="success" 
              @click="generateSubscription" 
              :loading="generatingSubscription"
              :disabled="cfIps.length === 0 || submitting"
            >
              <el-icon><Link /></el-icon>
              {{ generatingSubscription ? '正在生成...' : '生成订阅链接' }}
            </el-button>
            <div v-if="cfIps.length === 0" style="color: #e6a23c; font-size: 12px; margin-top: 5px;">
              请先配置优选 IP 后再生成订阅链接
            </div>
          </div>
        </el-form-item>
      </el-form>
      
      <div v-if="submitting" style="text-align: center; color: #409eff; margin-top: 10px;">
        <el-icon class="is-loading"><Loading /></el-icon>
        正在同步到 3X-UI 服务器，请稍候...
      </div>
      
      <template #footer>
        <el-button @click="dialogVisible = false" :disabled="submitting">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="batchDialogVisible" title="批量生成订阅链接" width="420px" :close-on-click-modal="!batchStarting">
      <div class="batch-dialog-tip">
        批处理会在 3X-UI 空闲时逐个执行；如果期间有其它 3X-UI 接口访问，后续用户会暂停等待，当前用户会继续完成。
      </div>
      <el-checkbox v-model="batchForm.cfOptimizedOnly">
        仅处理已优选 CF IP 的用户
      </el-checkbox>

      <template #footer>
        <el-button @click="batchDialogVisible = false" :disabled="batchStarting">取消</el-button>
        <el-button type="primary" :loading="batchStarting" @click="startBatchGenerateSubscriptions">
          开始执行
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { Search, Loading, Delete, CopyDocument, Link } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const users = ref([])
const keyword = ref('')
const status = ref('')
const page = ref(1)
const limit = ref(15)
const total = ref(0)
const sortBy = ref('')
const sortOrder = ref('')
const dialogVisible = ref(false)
const basicSubmitting = ref(false)
const cfIpsSubmitting = ref(false)
const submitting = computed(() => basicSubmitting.value || cfIpsSubmitting.value)
const editingId = ref(null)
const deletingUserId = ref(null)

// CF IP 相关
const cfIps = ref([])
const selectedCfIpId = ref('')
const cfIpPool = ref([])
const generatingSubscription = ref(false)
const copySubmittingType = ref('')
const subscriptionUrl = ref('')
const clashUrl = ref('')
const EDIT_DIALOG_ACTION_TIMEOUT = 30000
const batchDialogVisible = ref(false)
const batchStarting = ref(false)
const batchSocket = ref(null)
const batchReconnectTimer = ref(null)

const batchForm = reactive({
  cfOptimizedOnly: true
})

const batchProgress = reactive({
  id: null,
  status: '',
  status_text: '',
  current_email: '',
  completed_count: 0,
  total_count: 0,
  failed_count: 0,
  last_error: ''
})

const userForm = reactive({
  email: '',
  enabled: true,
  traffic_value: 0,
  traffic_unit: 'GB',
  traffic_bytes: 0,  // 存储原始字节值
  expire_at: null
})

const basicInfoSnapshot = reactive({
  enabled: true,
  traffic_bytes: 0,
  expire_at: null
})

// 单位到字节的转换系数
const unitMultipliers = {
  'B': 1,
  'KB': 1024,
  'MB': 1024 * 1024,
  'GB': 1024 * 1024 * 1024,
  'TB': 1024 * 1024 * 1024 * 1024
}

// 将字节转换为指定单位的值
function bytesToUnitValue(bytes, unit) {
  const numBytes = Number(bytes) || 0
  if (numBytes === 0) return 0
  return Math.round((numBytes / unitMultipliers[unit]) * 100) / 100
}

// 将字节转换为合适的单位显示
function bytesToUnit(bytes) {
  const numBytes = Number(bytes) || 0
  if (numBytes === 0) return { value: 0, unit: 'GB' }
  
  // 找到最合适的单位
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0
  let value = numBytes
  
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  
  return { value: Math.round(value * 100) / 100, unit: units[unitIndex] }
}

function handleUnitChange(newUnit) {
  // 从存储的字节值转换为新单位的值
  userForm.traffic_value = bytesToUnitValue(userForm.traffic_bytes, newUnit)
}

function handleValueChange() {
  // 当用户修改数值时，更新存储的字节值
  userForm.traffic_bytes = Math.round(userForm.traffic_value * unitMultipliers[userForm.traffic_unit])
}

/**
 * 将日期值转换成保存接口使用的秒级时间戳。
 * 空值表示不限期，按现有接口约定提交 null。
 */
function toExpireTimestamp(value) {
  return value ? Math.floor(value.getTime() / 1000) : null
}

/**
 * 记录编辑弹窗打开时的基础信息，用于保存时只提交变化字段。
 */
function captureBasicInfoSnapshot() {
  basicInfoSnapshot.enabled = !!userForm.enabled
  basicInfoSnapshot.traffic_bytes = Number(userForm.traffic_bytes) || 0
  basicInfoSnapshot.expire_at = toExpireTimestamp(userForm.expire_at)
}

/**
 * 构造基础信息差异数据。
 * 核心分支：启用状态、流量上限、到期时间分别比较；未变化字段不进入请求体。
 */
function buildBasicInfoChanges() {
  const data = {}
  const currentExpireAt = toExpireTimestamp(userForm.expire_at)
  const currentTrafficBytes = Number(userForm.traffic_bytes) || 0

  if (!!userForm.enabled !== basicInfoSnapshot.enabled) {
    data.enabled = !!userForm.enabled
  }

  if (currentTrafficBytes !== basicInfoSnapshot.traffic_bytes) {
    data.traffic_limit = currentTrafficBytes
  }

  if (currentExpireAt !== basicInfoSnapshot.expire_at) {
    data.expire_at = currentExpireAt
  }

  return data
}

async function fetchUsers() {
  try {
    const params = {
      page: page.value,
      limit: limit.value
    }
    if (keyword.value) params.keyword = keyword.value
    if (status.value) params.status = status.value
    if (sortBy.value && sortOrder.value) {
      params.sort_by = sortBy.value
      params.sort_order = sortOrder.value
    }
    
    const response = await api.admin.getUsers(params)
    if (response.code === 0) {
      users.value = response.data.list
      total.value = response.data.total
    }
  } catch (error) {
    console.error('获取用户列表失败:', error)
  }
}

/**
 * 写入批量任务进度，保持页面展示字段稳定。
 */
function applyBatchStatus(status) {
  if (!status) return
  Object.assign(batchProgress, {
    id: status.id,
    status: status.status || '',
    status_text: status.status_text || '',
    current_email: status.current_email || '',
    completed_count: Number(status.completed_count) || 0,
    total_count: Number(status.total_count) || 0,
    failed_count: Number(status.failed_count) || 0,
    last_error: status.last_error || ''
  })
}

/**
 * 构造管理端批量任务 WebSocket 地址。
 * token 放在查询参数中，服务端会复用管理端 JWT 密钥进行校验。
 */
function buildBatchWsUrl(taskId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = encodeURIComponent(localStorage.getItem('admin_token') || '')
  return `${protocol}//${window.location.host}/api/admin/users/batch-generate-subscriptions/ws?token=${token}&task_id=${taskId}`
}

/**
 * 建立批量任务进度 WebSocket。
 * 任务结束时服务端会主动关闭连接，前端只负责清理引用。
 */
function connectBatchWebSocket(taskId) {
  if (batchSocket.value) {
    batchSocket.value.manualClose = true
    batchSocket.value.close()
  }
  if (batchReconnectTimer.value) {
    clearTimeout(batchReconnectTimer.value)
    batchReconnectTimer.value = null
  }

  const socket = new WebSocket(buildBatchWsUrl(taskId))
  batchSocket.value = socket

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data)
      if (message.type === 'status') {
        applyBatchStatus(message.data)
      }
    } catch (error) {
      console.error('解析批量任务进度失败:', error)
    }
  }

  socket.onerror = (error) => {
    console.error('批量任务 WebSocket 连接异常:', error)
  }

  socket.onclose = () => {
    if (batchSocket.value === socket) {
      batchSocket.value = null
    }
    if (!socket.manualClose && ['pending', 'running', 'paused'].includes(batchProgress.status)) {
      batchReconnectTimer.value = setTimeout(() => {
        connectBatchWebSocket(taskId)
      }, 2000)
    }
  }
}

/**
 * 启动批量生成订阅链接任务。
 * 当前只开放“优选过 CF IP 的用户”条件，后续可在弹窗中继续扩展筛选项。
 */
async function startBatchGenerateSubscriptions() {
  try {
    batchStarting.value = true
    const response = await api.admin.startBatchGenerateSubscriptions({
      cf_optimized_only: batchForm.cfOptimizedOnly
    })

    if (response.code === 0) {
      applyBatchStatus(response.data)
      connectBatchWebSocket(response.data.id)
      batchDialogVisible.value = false
      ElMessage.success('批量任务已启动')
    } else {
      ElMessage.error(response.message || '启动批量任务失败')
    }
  } catch (error) {
    console.error('启动批量任务失败:', error)
    ElMessage.error('启动批量任务失败')
  } finally {
    batchStarting.value = false
  }
}

/**
 * 页面加载时读取最近任务进度。
 * 若任务仍在运行中，则重新建立 WebSocket，避免刷新页面后看不到实时状态。
 */
async function loadBatchStatus() {
  try {
    const response = await api.admin.getBatchGenerateSubscriptionStatus()
    if (response.code === 0 && response.data) {
      applyBatchStatus(response.data)
      if (['pending', 'running', 'paused'].includes(response.data.status)) {
        connectBatchWebSocket(response.data.id)
      }
    }
  } catch (error) {
    console.error('获取批量任务状态失败:', error)
  }
}

/**
 * 获取 CF IP 池列表
 */
async function fetchCfIpPool() {
  try {
    const response = await api.admin.getCfIps({ limit: 1000 })
    if (response.code === 0) {
      cfIpPool.value = response.data.list || []
    }
  } catch (error) {
    console.error('获取CF IP池失败:', error)
  }
}

/**
 * 获取可选择的 CF IP（过滤已选择的）
 */
function getSelectableCfIps() {
  const selectedIds = cfIps.value.map(ip => ip.id)
  return cfIpPool.value.filter(ip => !selectedIds.includes(ip.id) && ip.enabled)
}

/**
 * 添加 CF IP
 */
function addCfIp() {
  if (!selectedCfIpId.value) return
  const ip = cfIpPool.value.find(ip => ip.id === selectedCfIpId.value)
  if (ip && cfIps.value.length < 5) {
    cfIps.value.push({ id: ip.id, ip: ip.ip })
    selectedCfIpId.value = ''
  }
}

/**
 * 删除 CF IP
 */
function removeCfIp(index) {
  cfIps.value.splice(index, 1)
}

/**
 * 生成订阅链接
 */
async function generateSubscription() {
  if (cfIps.value.length === 0) {
    ElMessage.warning('请先配置优选 IP')
    return
  }
  
  try {
    generatingSubscription.value = true
    const response = await api.admin.generateUserSubscription(editingId.value, { timeout: EDIT_DIALOG_ACTION_TIMEOUT })
    if (response.code === 0) {
      subscriptionUrl.value = response.data.subscription_url
      clashUrl.value = response.data.clash_url
      ElMessage.success(`订阅链接已生成，共 ${response.data.node_count} 个节点`)
    } else {
      ElMessage.error(response.message || '生成订阅链接失败')
    }
  } catch (error) {
    console.error('生成订阅链接失败:', error)
    ElMessage.error('生成订阅链接失败')
  } finally {
    generatingSubscription.value = false
  }
}

/**
 * 复制文本到剪贴板。
 * text 为待复制内容；优先使用浏览器 Clipboard API，失败时回退到临时 textarea。
 */
async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (error) {
    console.warn('Clipboard API 复制失败，尝试降级复制:', error)
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    const copied = document.execCommand('copy')
    if (!copied) {
      throw new Error('execCommand copy returned false')
    }
    return true
  } catch (error) {
    console.warn('降级复制失败:', error)
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

/**
 * 复制订阅链接。
 * type 区分通用订阅和 Clash 订阅；复制失败时提示管理员手动复制。
 */
async function copySubscriptionUrl(type = 'subscription') {
  const url = type === 'clash' ? clashUrl.value : subscriptionUrl.value
  if (!url) {
    ElMessage.warning('暂无可复制的订阅链接')
    return
  }

  try {
    copySubmittingType.value = type
    const copied = await copyTextToClipboard(url)
    if (!copied) {
      ElMessage.error('复制失败，请手动复制输入框内容')
      return
    }
    ElMessage.success('订阅链接已复制')
  } finally {
    copySubmittingType.value = ''
  }
}

async function showEditDialog(user) {
  editingId.value = user.id
  userForm.email = user.email || ''
  // 将数字转换为布尔值（0 = false, 1 = true）
  userForm.enabled = !!user.enabled
  
  // 存储原始字节值，并转换为合适的单位显示
  const trafficLimit = Number(user.traffic_limit) || 0
  userForm.traffic_bytes = trafficLimit
  const traffic = bytesToUnit(trafficLimit)
  userForm.traffic_value = traffic.value
  userForm.traffic_unit = traffic.unit
  
  // 处理到期时间：0 或 "0" 表示无限期，应设为 null
  const expireAt = Number(user.expire_at) || 0
  userForm.expire_at = expireAt > 0 ? new Date(expireAt * 1000) : null
  captureBasicInfoSnapshot()
  
  // 获取 CF IP 池
  fetchCfIpPool()
  
  // 获取完整用户详情（包含 CF IP 和订阅链接）
  try {
    const response = await api.admin.getUserDetail(user.id)
    if (response.code === 0) {
      cfIps.value = response.data.cf_ips || []
      subscriptionUrl.value = response.data.user.subscription_url || ''
      clashUrl.value = response.data.user.clash_url || ''
    }
  } catch (error) {
    console.error('获取用户详情失败:', error)
    cfIps.value = []
    subscriptionUrl.value = ''
    clashUrl.value = ''
  }
  
  dialogVisible.value = true
}

/**
 * 删除用户本地数据库数据。
 * 关键分支：二次确认后调用管理端本地删除接口；成功后关闭正在编辑的同一用户弹窗并刷新列表。
 */
async function deleteUser(user) {
  try {
    await ElMessageBox.confirm(
      `确定要删除用户“${user.email}”的本地数据吗？此操作会删除订单、订阅缓存、工单、邮件日志等本地关联记录，但不会删除 3X-UI 服务器上的用户。删除后无法恢复。`,
      '确认删除用户',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
        distinguishCancelAndClose: true
      }
    )

    deletingUserId.value = user.id
    const response = await api.admin.deleteUser(user.id)
    if (response.code === 0) {
      ElMessage.success('用户本地数据已删除')
      if (editingId.value === user.id) {
        dialogVisible.value = false
        editingId.value = null
      }
      if (users.value.length === 1 && page.value > 1) {
        page.value -= 1
      }
      await fetchUsers()
    } else {
      ElMessage.error(response.message || '删除用户失败')
    }
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      console.error('删除用户失败:', error)
      ElMessage.error('删除用户失败')
    }
  } finally {
    deletingUserId.value = null
  }
}

/**
 * 处理管理端用户列表的服务端排序。
 * 关键分支：仅响应“已用流量”列，排序变化后回到第一页，让后端按全量结果排序再分页。
 */
function handleSortChange({ prop, order }) {
  if (prop === 'traffic_used' && order === 'descending') {
    sortBy.value = 'traffic_used'
    sortOrder.value = 'desc'
  } else {
    sortBy.value = ''
    sortOrder.value = ''
  }

  page.value = 1
  fetchUsers()
}

/**
 * 单独保存用户基础信息，并同步到 3X-UI。
 * 仅提交发生变化的启用状态、流量上限和到期时间，避免误更新优选 IP 配置或禁用原因。
 */
async function saveBasicInfo() {
  try {
    const data = buildBasicInfoChanges()
    if (Object.keys(data).length === 0) {
      ElMessage.info('基本信息没有变化')
      return
    }

    basicSubmitting.value = true
    await api.admin.updateUser(editingId.value, data, { timeout: EDIT_DIALOG_ACTION_TIMEOUT })

    ElMessage.success('基本信息更新成功')
    captureBasicInfoSnapshot()
    fetchUsers()
  } catch (error) {
    console.error('更新基本信息失败:', error)
    ElMessage.error('更新基本信息失败')
  } finally {
    basicSubmitting.value = false
  }
}

/**
 * 单独保存用户优选 IP 列表。
 * 只提交当前已选择的 IP 池 ID，避免误更新用户基础信息。
 */
async function saveCfIps() {
  try {
    cfIpsSubmitting.value = true

    const ipPoolIds = cfIps.value.map(ip => ip.id)
    await api.admin.updateUserCfIps(editingId.value, ipPoolIds, { timeout: EDIT_DIALOG_ACTION_TIMEOUT })

    ElMessage.success('优选 IP 更新成功')
    fetchUsers()
  } catch (error) {
    console.error('更新优选 IP 失败:', error)
    ElMessage.error('更新优选 IP 失败')
  } finally {
    cfIpsSubmitting.value = false
  }
}

function getStatusType(status) {
  const typeMap = { active: 'success', expired: 'warning', disabled: 'danger', renew: 'warning' }
  return typeMap[status] || 'info'
}

onMounted(() => {
  fetchUsers()
  loadBatchStatus()
})

onBeforeUnmount(() => {
  if (batchReconnectTimer.value) {
    clearTimeout(batchReconnectTimer.value)
    batchReconnectTimer.value = null
  }
  if (batchSocket.value) {
    batchSocket.value.manualClose = true
    batchSocket.value.close()
    batchSocket.value = null
  }
})
</script>

<style scoped>
.users-container { width: 100%; max-width: 100%; }
.page-header { margin-bottom: 30px; }
.page-title { font-size: 28px; color: #333; margin-bottom: 10px; }
.page-subtitle { color: #666; font-size: 16px; }
.content-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 20px; }
.toolbar { display: flex; align-items: center; margin-bottom: 20px; gap: 0; flex-wrap: wrap; }
.pagination { margin-top: 20px; display: flex; justify-content: flex-end; }
.section-actions { margin-top: 12px; display: flex; align-items: center; gap: 10px; }
.batch-progress { margin-left: 16px; color: #606266; font-size: 13px; white-space: nowrap; }
.batch-dialog-tip { margin-bottom: 12px; color: #606266; font-size: 13px; line-height: 1.6; }
</style>

<template>
  <div class="servers-container">
    <div class="page-header">
      <h1 class="page-title">服务器管理</h1>
      <p class="page-subtitle">管理 3X-UI 服务器节点</p>
    </div>

    <div class="content-card">
      <div class="toolbar">
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>
          添加服务器
        </el-button>
        <el-button type="success" @click="fetchAllServersOnlineCount" :loading="queryingAllOnline">
          <el-icon><Refresh /></el-icon>
          {{ queryingAllOnline ? '获取中' : '获取在线人数' }}
        </el-button>
        <el-button type="warning" @click="runBackupTask" :loading="backupTaskRunning">
          <el-icon><Refresh /></el-icon>
          执行备份任务
        </el-button>
        <span
          v-if="backupStatusText"
          class="backup-status"
          :class="`backup-status-${backupStatusKind}`"
        >
          {{ backupStatusText }}
        </span>
      </div>

      <div class="server-grid">
        <div
          v-for="server in servers"
          :key="server.id"
          class="server-card"
        >
          <div class="server-header">
            <div class="server-title">
              <h3 class="server-name">{{ server.name }}</h3>
              <el-tag :type="server.status === 1 ? 'success' : 'danger'" size="small">
                {{ server.status_text }}
              </el-tag>
            </div>
          </div>

          <div class="server-body">
            <div class="info-row url-row">
              <el-icon><Link /></el-icon>
              <span class="url-text" :title="server.api_url">{{ server.api_url }}</span>
            </div>
            <div class="info-row version-row">
              <el-icon><InfoFilled /></el-icon>
              <span class="url-text">面板版本: {{ server.panel_version || '3.0.2' }}</span>
            </div>
            <div v-if="server.host" class="info-row host-row">
              <el-icon><Position /></el-icon>
              <span class="url-text" :title="server.host">Host: {{ server.host }}</span>
            </div>
            <div v-if="server.client_port" class="info-row port-row">
              <el-icon><Odometer /></el-icon>
              <span class="url-text">客户端端口: {{ server.client_port }}</span>
            </div>
            <div v-if="server.sub_url" class="info-row sub-row">
              <el-icon><Tickets /></el-icon>
              <span class="url-text" :title="server.sub_url">订阅: {{ server.sub_url }}</span>
            </div>

            <div class="info-grid">
              <div class="info-item info-card">
                <span class="info-icon">📌</span>
                <span class="info-label">节点</span>
                <span class="info-value">{{ server.node_count }}</span>
              </div>
              <div class="info-item info-card">
                <span class="info-icon">👥</span>
                <span class="info-label">用户</span>
                <span class="info-value">{{ server.user_count }}</span>
              </div>
              <button
                type="button"
                class="info-item info-card info-card-button"
                :class="{ 'is-loading': queryingOnlineId === server.id }"
                :disabled="queryingOnlineId === server.id"
                @click="fetchServerOnlineCount(server)"
              >
                <span class="info-icon">🟢</span>
                <span class="info-label">在线</span>
                <span class="info-value">
                  {{ queryingOnlineId === server.id ? '...' : server.online_count }}
                </span>
              </button>
            </div>
          </div>

          <div class="server-footer">
            <el-button size="small" @click="viewDetail(server)">
              <el-icon><View /></el-icon>
              详情
            </el-button>
            <el-button
              size="small"
              class="sync-btn"
              @click="syncServer(server)"
              :loading="syncingId === server.id"
            >
              <el-icon v-if="syncingId !== server.id"><Refresh /></el-icon>
              {{ syncingId === server.id ? '同步中' : '同步' }}
            </el-button>
            <el-button size="small" type="primary" @click="showEditDialog(server)">
              <el-icon><Edit /></el-icon>
              编辑
            </el-button>
            <el-button size="small" type="danger" @click="deleteServer(server)">
              <el-icon><Delete /></el-icon>
              删除
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="isEditing ? '编辑服务器' : '添加服务器'"
      width="520px"
    >
      <el-form
        ref="serverFormRef"
        :model="serverForm"
        :rules="serverRules"
        label-width="110px"
      >
        <el-form-item label="服务器名称" prop="name">
          <el-input v-model="serverForm.name" placeholder="请输入服务器名称" />
        </el-form-item>
        <el-form-item label="面板地址" prop="api_url">
          <el-input v-model="serverForm.api_url" placeholder="http://ip:port" />
        </el-form-item>
        <el-form-item label="API Token" prop="api_token">
          <el-input
            v-model="serverForm.api_token"
            type="password"
            :placeholder="isEditing ? '留空表示不修改 API Token' : '请输入 3X-UI API Token'"
            show-password
          />
        </el-form-item>
        <el-form-item label="面板版本号" prop="panel_version">
          <el-input
            v-model="serverForm.panel_version"
            placeholder="例如 3.0.2 或 3.2.5"
          />
        </el-form-item>
        <el-form-item label="Host" prop="host">
          <el-input v-model="serverForm.host" placeholder="CF 端口转发的主机名，如 open.example.com" />
        </el-form-item>
        <el-form-item label="客户端端口" prop="client_port">
          <el-input-number v-model="serverForm.client_port" :min="0" :max="65535" placeholder="客户端连接端口" />
        </el-form-item>
        <el-form-item label="订阅地址" prop="sub_url">
          <el-input v-model="serverForm.sub_url" placeholder="如：https://example.com/sub/aaa333/" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import {
  Plus,
  View,
  Refresh,
  Edit,
  Delete,
  Link,
  Position,
  Odometer,
  Tickets,
  InfoFilled
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const DEFAULT_PANEL_VERSION = '3.0.2'
const BACKUP_TASK_WS_PATH = '/api/admin/servers/backup/ws'
const MAX_ONLINE_COUNT_CONCURRENCY = 10

const router = useRouter()

const servers = ref([])
const dialogVisible = ref(false)
const isEditing = ref(false)
const submitting = ref(false)
const editingId = ref(null)
const serverFormRef = ref(null)
const syncingId = ref(null)
const queryingOnlineId = ref(null)
const queryingAllOnline = ref(false)
const backupTaskRunning = ref(false)
const backupTaskId = ref(null)
const backupStatusText = ref('')
const backupStatusKind = ref('info')
const backupSocket = ref(null)

const serverForm = reactive({
  name: '',
  api_url: '',
  api_token: '',
  panel_version: DEFAULT_PANEL_VERSION,
  host: '',
  client_port: 0,
  sub_url: ''
})

const serverRules = {
  name: [
    { required: true, message: '请输入服务器名称', trigger: 'blur' }
  ],
  api_url: [
    { required: true, message: '请输入面板地址', trigger: 'blur' },
    { pattern: /^https?:\/\/.+/, message: '请输入有效的 URL', trigger: 'blur' }
  ],
  api_token: [
    {
      validator: (rule, value, callback) => {
        if (!isEditing.value && !value) {
          callback(new Error('请输入 API Token'))
          return
        }
        callback()
      },
      trigger: 'blur'
    }
  ],
  panel_version: [
    { required: true, message: '请输入 3X-UI 面板版本号', trigger: 'blur' }
  ]
}

async function fetchServers() {
  try {
    const response = await api.admin.getServers()
    if (response.code === 0) {
      servers.value = response.data.servers
    }
  } catch (error) {
    console.error('获取服务器列表失败:', error)
  }
}

function showAddDialog() {
  isEditing.value = false
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function showEditDialog(server) {
  isEditing.value = true
  editingId.value = server.id

  serverForm.name = server.name
  serverForm.api_url = server.api_url
  serverForm.api_token = ''
  serverForm.panel_version = server.panel_version || DEFAULT_PANEL_VERSION
  serverForm.host = server.host || ''
  serverForm.client_port = server.client_port || 0
  serverForm.sub_url = server.sub_url || ''

  dialogVisible.value = true
}

function resetForm() {
  serverForm.name = ''
  serverForm.api_url = ''
  serverForm.api_token = ''
  serverForm.panel_version = DEFAULT_PANEL_VERSION
  serverForm.host = ''
  serverForm.client_port = 0
  serverForm.sub_url = ''
}

async function handleSubmit() {
  try {
    await serverFormRef.value.validate()
    submitting.value = true
    const payload = {
      ...serverForm,
      panel_version: (serverForm.panel_version || DEFAULT_PANEL_VERSION).trim()
    }

    if (isEditing.value && !payload.api_token) {
      delete payload.api_token
    }

    if (isEditing.value) {
      const response = await api.admin.updateServer(editingId.value, payload)
      if (response.code === 0) {
        ElMessage.success('服务器更新成功')
        dialogVisible.value = false
        fetchServers()
      }
    } else {
      const response = await api.admin.addServer(payload)
      if (response.code === 0) {
        ElMessage.success('服务器添加成功')
        dialogVisible.value = false
        fetchServers()
      }
    }
  } catch (error) {
    console.error('提交失败:', error)
  } finally {
    submitting.value = false
  }
}

function viewDetail(server) {
  router.push(`/admin/servers/${server.id}`)
}

async function syncServer(server) {
  try {
    syncingId.value = server.id
    const response = await api.admin.syncServer(server.id)
    if (response.code === 0) {
      ElMessage.success('同步成功')
      fetchServers()
    }
  } catch (error) {
    console.error('同步失败:', error)
  } finally {
    syncingId.value = null
  }
}

/**
 * 查询并仅刷新当前卡片的在线人数。
 * 关键分支：请求成功时只覆盖 online_count；请求失败时保持原值不变。
 *
 * @param {Object} server - 当前服务器卡片数据
 * @returns {Promise<void>}
 */
async function fetchServerOnlineCount(server) {
  try {
    queryingOnlineId.value = server.id
    const response = await api.admin.getServerOnlineCount(server.id)
    if (response.code === 0) {
      server.online_count = Number(response.data.online_count) || 0
    }
  } catch (error) {
    console.error('查询在线人数失败:', error)
  } finally {
    queryingOnlineId.value = null
  }
}

/**
 * 批量并发获取全部服务器的在线人数。
 * 关键分支：单台失败只记录失败项，不中断其余服务器的查询。
 *
 * @returns {Promise<void>}
 */
async function fetchAllServersOnlineCount() {
  if (!servers.value.length || queryingAllOnline.value) {
    return
  }

  const pendingServers = [...servers.value]
  const failedServers = []
  const workerCount = Math.min(MAX_ONLINE_COUNT_CONCURRENCY, pendingServers.length)

  try {
    queryingAllOnline.value = true

    const workers = Array.from({ length: workerCount }, async () => {
      while (pendingServers.length > 0) {
        const server = pendingServers.shift()
        if (!server) {
          return
        }

        try {
          const response = await api.admin.getServerOnlineCount(server.id)
          if (response.code === 0) {
            server.online_count = Number(response.data.online_count) || 0
          } else {
            failedServers.push(server.name)
          }
        } catch (error) {
          failedServers.push(server.name)
          console.error(`批量查询服务器 ${server.name} 在线人数失败:`, error)
        }
      }
    })

    await Promise.all(workers)

    if (failedServers.length > 0) {
      ElMessage.warning(`在线人数获取完成，${failedServers.length} 台服务器获取失败`)
      return
    }

    ElMessage.success('已获取全部服务器的在线人数')
  } finally {
    queryingAllOnline.value = false
  }
}

/**
 * 构造 3X-UI 备份任务的 WebSocket 地址。
 *
 * @param {number} taskId - 备份任务 ID
 * @returns {string} WebSocket 地址
 */
function buildBackupWsUrl(taskId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = encodeURIComponent(localStorage.getItem('admin_token') || '')
  return `${protocol}//${window.location.host}${BACKUP_TASK_WS_PATH}?token=${token}&task_id=${taskId}`
}

/**
 * 关闭当前备份任务 WebSocket，避免重复连接或页面卸载后的残留监听。
 */
function closeBackupSocket() {
  if (!backupSocket.value) {
    return
  }
  backupSocket.value.manualClose = true
  backupSocket.value.close()
  backupSocket.value = null
}

/**
 * 将后端状态对象转换为页面可直接展示的备份进度文案。
 *
 * @param {Object} status - 备份任务状态
 * @returns {string} 格式化后的展示文本
 */
function formatBackupStatusText(status) {
  const completed = Number(status.completed_count) || 0
  const total = Number(status.total_count) || 0
  const failedServers = Array.isArray(status.failed_servers) ? status.failed_servers : []

  if (status.status === 'pending' || status.status === 'running') {
    const currentServerName = status.current_server_name || '准备中'
    return `正在备份：${currentServerName}（${completed}/${total}）`
  }

  if (failedServers.length > 0) {
    return `备份完成（${completed}/${total}），失败服务器：${failedServers.join('、')}`
  }

  return `备份完成（${completed}/${total}）`
}

/**
 * 应用后端返回的备份任务状态，并同步按钮 loading 与文案颜色。
 *
 * @param {Object} status - 备份任务状态
 */
function applyBackupStatus(status) {
  if (!status) {
    return
  }

  backupTaskId.value = status.id || null
  backupTaskRunning.value = ['pending', 'running'].includes(status.status)
  backupStatusText.value = formatBackupStatusText(status)

  if (backupTaskRunning.value) {
    backupStatusKind.value = 'running'
    return
  }

  backupStatusKind.value = Array.isArray(status.failed_servers) && status.failed_servers.length > 0
    ? 'error'
    : 'success'
}

/**
 * 建立备份任务进度 WebSocket 连接，并在任务结束后自动断开。
 *
 * @param {number} taskId - 备份任务 ID
 */
function connectBackupSocket(taskId) {
  closeBackupSocket()

  const socket = new WebSocket(buildBackupWsUrl(taskId))
  backupSocket.value = socket

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data)
      if (message.type === 'status') {
        applyBackupStatus(message.data)
      }
    } catch (error) {
      console.error('解析备份任务进度失败:', error)
    }
  }

  socket.onerror = (error) => {
    console.error('备份任务 WebSocket 连接异常:', error)
  }

  socket.onclose = () => {
    if (backupSocket.value === socket) {
      backupSocket.value = null
    }
  }
}

/**
 * 启动一次手动备份任务，并接入 WebSocket 实时进度展示。
 */
async function runBackupTask() {
  try {
    const response = await api.admin.runBackupTask()
    if (response.code === 0) {
      applyBackupStatus(response.data)
      connectBackupSocket(response.data.id)
      ElMessage.success(backupTaskRunning.value ? '备份任务已启动' : '已连接到备份任务结果')
    }
  } catch (error) {
    console.error('启动备份任务失败:', error)
    backupTaskRunning.value = false
  }
}

async function deleteServer(server) {
  try {
    await ElMessageBox.confirm(
      `确定要删除服务器 "${server.name}" 吗？`,
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    const response = await api.admin.deleteServer(server.id)
    if (response.code === 0) {
      ElMessage.success('删除成功')
      fetchServers()
    }
  } catch {
    // 用户取消操作
  }
}

onMounted(() => {
  fetchServers()
})

onBeforeUnmount(() => {
  closeBackupSocket()
})
</script>

<style scoped>
.servers-container {
  width: 100%;
  max-width: 100%;
}

.page-header {
  margin-bottom: 30px;
}

.page-title {
  font-size: 28px;
  color: #333;
  margin-bottom: 10px;
}

.page-subtitle {
  color: #666;
  font-size: 16px;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 20px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.backup-status {
  font-size: 13px;
  line-height: 1.6;
}

.backup-status-running {
  color: #e6a23c;
}

.backup-status-success {
  color: #67c23a;
}

.backup-status-error {
  color: #f56c6c;
}

.server-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 360px));
  gap: 20px;
  justify-content: flex-start;
}

.server-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  transition: all 0.3s;
  border: 1px solid #e4e7ed;
  width: 360px;
  box-sizing: border-box;
}

.server-card:hover {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  transform: translateY(-2px);
}

.server-header {
  margin-bottom: 16px;
}

.server-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.server-name {
  font-size: 18px;
  color: #303133;
  margin: 0;
  font-weight: 600;
}

.server-body {
  margin-bottom: 16px;
}

.url-row,
.host-row,
.port-row,
.sub-row,
.version-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
}

.url-row {
  background: #f5f7fa;
  margin-bottom: 8px;
}

.version-row {
  background: #f4f4ff;
  margin-bottom: 8px;
}

.host-row {
  background: #ecf5ff;
  margin-bottom: 8px;
}

.port-row {
  background: #f0f9eb;
  margin-bottom: 8px;
}

.sub-row {
  background: #fdf6ec;
  margin-bottom: 16px;
}

.url-row .el-icon,
.version-row .el-icon {
  color: #409eff;
  flex-shrink: 0;
}

.url-text {
  color: #606266;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.info-card {
  padding: 6px 10px;
  border: 1px solid #e4e7ed;
  border-radius: 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.06);
}

.info-card-button {
  appearance: none;
  width: 100%;
  font: inherit;
  color: inherit;
  text-align: center;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, background 0.2s ease;
}

.info-card-button:hover {
  border-color: #409eff;
  background: linear-gradient(180deg, #ecf5ff 0%, #d9ecff 100%);
  box-shadow: 0 10px 22px rgba(64, 158, 255, 0.18);
  transform: translateY(-1px);
}

.info-card-button:focus-visible {
  outline: 2px solid #409eff;
  outline-offset: 2px;
}

.info-card-button:disabled {
  cursor: wait;
}

.info-card-button.is-loading {
  border-color: #79bbff;
  background: linear-gradient(180deg, #f0f7ff 0%, #e1f0ff 100%);
}

.info-icon {
  font-size: 16px;
}

.info-label {
  font-size: 12px;
  color: #909399;
}

.info-value {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.server-footer {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
}

.server-footer .el-button {
  width: 100%;
  min-width: 0;
  margin-left: 0;
}

.sync-btn {
  min-width: 72px;
}

@media (max-width: 768px) {
  .server-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .server-card {
    width: 100%;
  }

  .server-footer {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

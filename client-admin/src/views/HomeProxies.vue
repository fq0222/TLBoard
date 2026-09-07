<template>
  <div class="home-proxies-container">
    <div class="page-header">
      <h1 class="page-title">家宽 IP 管理</h1>
      <p class="page-subtitle">管理家宽 SOCKS 出站，并手动同步到在线 3X-UI 服务器</p>
    </div>

    <div class="content-card">
      <div class="toolbar">
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>
          添加家宽 IP
        </el-button>
        <span class="total-info">共 {{ homeProxies.length }} 条记录</span>
      </div>

      <el-empty v-if="!loading && homeProxies.length === 0" description="暂无家宽 IP 配置" />

      <div v-else class="proxy-grid">
        <div
          v-for="proxy in homeProxies"
          :key="proxy.id"
          class="proxy-card"
        >
          <div class="proxy-header">
            <div class="proxy-title">
              <h3 class="proxy-name">{{ proxy.tag }}</h3>
              <el-tag :type="getStatusInfo(proxy.sync_status).type" size="small">
                {{ getStatusInfo(proxy.sync_status).text }}
              </el-tag>
            </div>
          </div>

          <div class="proxy-body">
            <div class="info-row">
              <el-icon><Location /></el-icon>
              <span class="info-text" :title="proxy.address">{{ proxy.address }}</span>
            </div>
            <div class="info-row">
              <el-icon><Odometer /></el-icon>
              <span class="info-text">端口: {{ proxy.port }}</span>
            </div>
            <div class="info-row">
              <el-icon><User /></el-icon>
              <span class="info-text" :title="proxy.user">用户: {{ proxy.user }}</span>
            </div>
            <div class="info-row">
              <el-icon><Lock /></el-icon>
              <span class="info-text">密码: {{ proxy.password_mask || '******' }}</span>
            </div>

            <div class="sync-summary">
              <div class="sync-item">
                <span class="sync-label">成功</span>
                <span class="sync-value success">{{ proxy.last_sync_success_count || 0 }}</span>
              </div>
              <div class="sync-item">
                <span class="sync-label">失败</span>
                <span class="sync-value danger">{{ proxy.last_sync_failed_count || 0 }}</span>
              </div>
              <div class="sync-item">
                <span class="sync-label">时间</span>
                <span class="sync-value">{{ formatTime(proxy.last_sync_at) }}</span>
              </div>
            </div>

            <div v-if="proxy.last_sync_message" class="message-row">
              {{ proxy.last_sync_message }}
            </div>

            <div v-if="proxy.failed_server_names && proxy.failed_server_names.length" class="failed-box">
              <div class="failed-title">失败服务器</div>
              <div class="failed-list">
                <el-tag
                  v-for="name in proxy.failed_server_names"
                  :key="name"
                  type="danger"
                  effect="plain"
                  size="small"
                >
                  {{ name }}
                </el-tag>
              </div>
            </div>
          </div>

          <div class="proxy-footer">
            <el-button
              size="small"
              class="sync-btn"
              :loading="syncingId === proxy.id"
              :disabled="deletingId === proxy.id"
              @click="syncProxy(proxy)"
            >
              <el-icon v-if="syncingId !== proxy.id"><Refresh /></el-icon>
              {{ syncingId === proxy.id ? '同步中' : '同步' }}
            </el-button>
            <el-button
              size="small"
              type="primary"
              :disabled="syncingId === proxy.id || deletingId === proxy.id"
              @click="showEditDialog(proxy)"
            >
              <el-icon><Edit /></el-icon>
              编辑
            </el-button>
            <el-button
              size="small"
              type="danger"
              :loading="deletingId === proxy.id"
              :disabled="syncingId === proxy.id"
              @click="deleteProxy(proxy)"
            >
              <el-icon v-if="deletingId !== proxy.id"><Delete /></el-icon>
              {{ deletingId === proxy.id ? '删除中' : '删除' }}
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="isEditing ? '编辑家宽 IP' : '添加家宽 IP'"
      width="520px"
    >
      <el-form
        ref="proxyFormRef"
        :model="proxyForm"
        :rules="proxyRules"
        label-width="110px"
      >
        <el-form-item label="Tag" prop="tag">
          <el-input v-model="proxyForm.tag" placeholder="请输入唯一 tag" />
        </el-form-item>
        <el-form-item label="地址" prop="address">
          <el-input v-model="proxyForm.address" placeholder="请输入 SOCKS 地址" />
        </el-form-item>
        <el-form-item label="端口" prop="port">
          <el-input-number v-model="proxyForm.port" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="用户名" prop="user">
          <el-input v-model="proxyForm.user" placeholder="请输入 SOCKS 用户名" />
        </el-form-item>
        <el-form-item label="密码" prop="pass">
          <el-input
            v-model="proxyForm.pass"
            type="password"
            :placeholder="isEditing ? '留空表示不修改密码' : '请输入 SOCKS 密码'"
            show-password
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
/**
 * 家宽 IP 管理页面。
 * 负责本地 SOCKS outbound 配置 CRUD 和管理员手动同步触发，不在保存时自动同步远端。
 */

import { reactive, ref, onMounted } from 'vue'
import {
  Delete,
  Edit,
  Location,
  Lock,
  Odometer,
  Plus,
  Refresh,
  User
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus/es/components/message/index.mjs'
import { ElMessageBox } from 'element-plus/es/components/message-box/index.mjs'
import api from '@/api'

const statusMap = {
  pending: { type: 'warning', text: '待同步' },
  success: { type: 'success', text: '全部成功' },
  partial_failed: { type: 'danger', text: '部分失败' },
  failed: { type: 'danger', text: '全部失败' },
  delete_failed: { type: 'danger', text: '删除失败' }
}

const loading = ref(false)
const homeProxies = ref([])
const dialogVisible = ref(false)
const isEditing = ref(false)
const editingId = ref(null)
const submitting = ref(false)
const syncingId = ref(null)
const deletingId = ref(null)
const proxyFormRef = ref(null)

const proxyForm = reactive({
  tag: '',
  address: '',
  port: 1080,
  user: '',
  pass: ''
})

const proxyRules = {
  tag: [{ required: true, message: '请输入唯一 tag', trigger: 'blur' }],
  address: [{ required: true, message: '请输入 SOCKS 地址', trigger: 'blur' }],
  port: [{ required: true, type: 'number', min: 1, max: 65535, message: '端口必须是 1-65535', trigger: 'change' }],
  user: [{ required: true, message: '请输入 SOCKS 用户名', trigger: 'blur' }],
  pass: [
    {
      validator: (rule, value, callback) => {
        if (!isEditing.value && !value) {
          callback(new Error('请输入 SOCKS 密码'))
          return
        }
        callback()
      },
      trigger: 'blur'
    }
  ]
}

function getStatusInfo(status) {
  return statusMap[status] || statusMap.pending
}

function formatTime(timestamp) {
  if (!timestamp) {
    return '未同步'
  }

  return new Date(Number(timestamp) * 1000).toLocaleString('zh-CN', {
    hour12: false
  })
}

async function fetchHomeProxies() {
  try {
    loading.value = true
    const response = await api.admin.getHomeProxies()
    if (response.code === 0) {
      homeProxies.value = response.data.home_proxies || []
    }
  } catch (error) {
    console.error('获取家宽 IP 列表失败:', error)
  } finally {
    loading.value = false
  }
}

function resetForm() {
  proxyForm.tag = ''
  proxyForm.address = ''
  proxyForm.port = 1080
  proxyForm.user = ''
  proxyForm.pass = ''
}

function showAddDialog() {
  isEditing.value = false
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function showEditDialog(proxy) {
  isEditing.value = true
  editingId.value = proxy.id
  proxyForm.tag = proxy.tag
  proxyForm.address = proxy.address
  proxyForm.port = Number(proxy.port) || 1080
  proxyForm.user = proxy.user || proxy.username || ''
  proxyForm.pass = ''
  dialogVisible.value = true
}

function buildPayload() {
  return {
    tag: proxyForm.tag.trim(),
    address: proxyForm.address.trim(),
    port: Number(proxyForm.port),
    user: proxyForm.user.trim(),
    pass: proxyForm.pass.trim()
  }
}

async function handleSubmit() {
  try {
    await proxyFormRef.value.validate()
    submitting.value = true
    const payload = buildPayload()
    const response = isEditing.value
      ? await api.admin.updateHomeProxy(editingId.value, payload)
      : await api.admin.addHomeProxy(payload)

    if (response.code === 0) {
      ElMessage.success(isEditing.value ? '家宽 IP 已更新，等待同步' : '家宽 IP 已添加，等待同步')
      dialogVisible.value = false
      fetchHomeProxies()
    }
  } catch (error) {
    console.error('保存家宽 IP 失败:', error)
  } finally {
    submitting.value = false
  }
}

async function syncProxy(proxy) {
  try {
    syncingId.value = proxy.id
    const response = await api.admin.syncHomeProxy(proxy.id)
    if (response.code === 0) {
      ElMessage.success(response.data.message || '同步完成')
      fetchHomeProxies()
    }
  } catch (error) {
    console.error('同步家宽 IP 失败:', error)
  } finally {
    syncingId.value = null
  }
}

async function deleteProxy(proxy) {
  try {
    await ElMessageBox.confirm(
      `确定要删除家宽 IP "${proxy.tag}" 吗？远端 outbound 清理成功后才会删除本地记录。`,
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    deletingId.value = proxy.id
    const response = await api.admin.deleteHomeProxy(proxy.id)
    if (response.code === 0) {
      ElMessage.success(response.data.message || '删除成功')
      fetchHomeProxies()
    }
  } catch (error) {
    if (error?.response?.data?.data) {
      ElMessage.warning(error.response.data.message || '远端清理未全部成功，本地记录已保留')
      fetchHomeProxies()
    }
    console.error('删除家宽 IP 失败:', error)
  } finally {
    deletingId.value = null
  }
}

onMounted(() => {
  fetchHomeProxies()
})
</script>

<style scoped>
.home-proxies-container {
  width: 100%;
  max-width: 100%;
}

.page-header {
  margin-bottom: 30px;
}

.page-title {
  margin-bottom: 10px;
  color: #333;
  font-size: 28px;
}

.page-subtitle {
  color: #666;
  font-size: 16px;
}

.content-card {
  padding: 20px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.total-info {
  margin-left: auto;
  color: #666;
}

.proxy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 360px));
  gap: 20px;
  justify-content: flex-start;
}

.proxy-card {
  box-sizing: border-box;
  width: 360px;
  padding: 20px;
  border: 1px solid #e4e7ed;
  border-radius: 12px;
  background: #fff;
  transition: all 0.3s;
}

.proxy-card:hover {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  transform: translateY(-2px);
}

.proxy-header {
  margin-bottom: 16px;
}

.proxy-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.proxy-name {
  overflow: hidden;
  margin: 0;
  color: #303133;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
  font-weight: 600;
}

.proxy-body {
  margin-bottom: 16px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f5f7fa;
}

.info-row .el-icon {
  flex-shrink: 0;
  color: #409eff;
}

.info-text {
  min-width: 0;
  overflow: hidden;
  color: #606266;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.sync-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.sync-item {
  display: flex;
  min-height: 58px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fafafa;
}

.sync-label {
  color: #909399;
  font-size: 12px;
}

.sync-value {
  max-width: 100%;
  overflow: hidden;
  color: #303133;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.sync-value.success {
  color: #67c23a;
}

.sync-value.danger {
  color: #f56c6c;
}

.message-row {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f4f4f5;
  color: #606266;
  line-height: 1.5;
  font-size: 13px;
}

.failed-box {
  margin-top: 12px;
  padding: 10px;
  border: 1px solid #fde2e2;
  border-radius: 8px;
  background: #fef0f0;
}

.failed-title {
  margin-bottom: 8px;
  color: #c45656;
  font-size: 13px;
  font-weight: 600;
}

.failed-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.proxy-footer {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
}

.proxy-footer .el-button {
  width: 100%;
  min-width: 0;
  margin-left: 0;
}

.sync-btn {
  min-width: 72px;
}

@media (max-width: 768px) {
  .proxy-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .proxy-card {
    width: 100%;
  }

  .proxy-footer {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

<template>
  <div class="servers-container">
    <div class="page-header">
      <h1 class="page-title">服务器管理</h1>
      <p class="page-subtitle">管理3X-UI服务器节点</p>
    </div>
    
    <div class="content-card">
      <div class="toolbar">
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>
          添加服务器
        </el-button>
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
              <div class="info-item">
                <span class="info-icon">📦</span>
                <span class="info-label">节点</span>
                <span class="info-value">{{ server.node_count }}</span>
              </div>
              <div class="info-item">
                <span class="info-icon">👥</span>
                <span class="info-label">用户</span>
                <span class="info-value">{{ server.user_count }}</span>
              </div>
              <div class="info-item">
                <span class="info-icon">🟢</span>
                <span class="info-label">在线</span>
                <span class="info-value">{{ server.online_count }}</span>
              </div>
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
    
    <!-- 添加/编辑对话框 -->
    <el-dialog 
      v-model="dialogVisible" 
      :title="isEditing ? '编辑服务器' : '添加服务器'"
      width="500px"
    >
      <el-form 
        ref="serverFormRef" 
        :model="serverForm" 
        :rules="serverRules" 
        label-width="100px"
      >
        <el-form-item label="服务器名称" prop="name">
          <el-input v-model="serverForm.name" placeholder="请输入服务器名称" />
        </el-form-item>
        <el-form-item label="面板地址" prop="api_url">
          <el-input v-model="serverForm.api_url" placeholder="http://ip:port" />
        </el-form-item>
        <el-form-item label="API用户名" prop="api_username">
          <el-input v-model="serverForm.api_username" placeholder="请输入API用户名" />
        </el-form-item>
        <el-form-item label="API密码" prop="api_password">
          <el-input 
            v-model="serverForm.api_password" 
            type="password"
            placeholder="请输入API密码"
            show-password
          />
        </el-form-item>
        <el-form-item label="Host" prop="host">
          <el-input v-model="serverForm.host" placeholder="CF端口转发的主机名，如 open.example.com" />
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
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, View, Refresh, Edit, Delete, Link, Position, Odometer, Tickets } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const router = useRouter()

const servers = ref([])
const dialogVisible = ref(false)
const isEditing = ref(false)
const submitting = ref(false)
const editingId = ref(null)
const serverFormRef = ref(null)
const syncingId = ref(null)

const serverForm = reactive({
  name: '',
  api_url: '',
  api_username: '',
  api_password: '',
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
    { pattern: /^https?:\/\/.+/, message: '请输入有效的URL', trigger: 'blur' }
  ],
  api_username: [
    { required: true, message: '请输入API用户名', trigger: 'blur' }
  ],
  api_password: [
    { required: true, message: '请输入API密码', trigger: 'blur' }
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
  serverForm.api_username = ''
  serverForm.api_password = ''
  serverForm.host = server.host || ''
  serverForm.client_port = server.client_port || 0
  serverForm.sub_url = server.sub_url || ''
  
  dialogVisible.value = true
}

function resetForm() {
  serverForm.name = ''
  serverForm.api_url = ''
  serverForm.api_username = ''
  serverForm.api_password = ''
  serverForm.host = ''
  serverForm.client_port = 0
  serverForm.sub_url = ''
}

async function handleSubmit() {
  try {
    await serverFormRef.value.validate()
    submitting.value = true
    
    if (isEditing.value) {
      const response = await api.admin.updateServer(editingId.value, serverForm)
      if (response.code === 0) {
        ElMessage.success('服务器更新成功')
        dialogVisible.value = false
        fetchServers()
      }
    } else {
      const response = await api.admin.addServer(serverForm)
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
</script>

<style scoped>
.servers-container {
  max-width: 1200px;
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
  margin-bottom: 20px;
}

.server-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
}

.server-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  transition: all 0.3s;
  border: 1px solid #e4e7ed;
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

.url-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 8px;
  margin-bottom: 16px;
}

.host-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #ecf5ff;
  border-radius: 8px;
  margin-bottom: 8px;
}

.port-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f0f9eb;
  border-radius: 8px;
  margin-bottom: 16px;
}

.sub-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fdf6ec;
  border-radius: 8px;
  margin-bottom: 16px;
}

.url-row .el-icon {
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
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
}

.server-footer .el-button {
  flex: 1;
}

.sync-btn {
  min-width: 72px;
}
</style>

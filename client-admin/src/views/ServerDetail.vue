<template>
  <div class="server-detail-container">
    <div class="page-header">
      <div class="header-top">
        <el-button @click="goBack" class="back-btn">
          <el-icon><ArrowLeft /></el-icon>
          返回服务器列表
        </el-button>
      </div>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">服务器信息</h2>
      <div class="server-info">
        <div class="info-item">
          <span class="info-label">服务器名称：</span>
          <span class="info-value">{{ server.name }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">面板地址：</span>
          <span class="info-value">{{ server.api_url }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">状态：</span>
          <el-tag :type="server.status === 1 ? 'success' : 'danger'">
            {{ server.status === 1 ? '在线' : '离线' }}
          </el-tag>
        </div>
        <div class="info-item">
          <span class="info-label">最后检测：</span>
          <span class="info-value">{{ formatTime(server.last_check_at) }}</span>
        </div>
      </div>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">节点列表</h2>
      <div v-for="node in nodes" :key="node.inbound_id" class="node-item">
        <div class="node-header">
          <h3>{{ node.remark || '未命名节点' }}</h3>
          <div class="node-stats">
            <el-tag size="small">{{ node.protocol }}</el-tag>
            <span>端口：{{ node.port }}</span>
            <span>用户：{{ node.user_count }}</span>
            <span>在线：{{ node.online_count }}</span>
          </div>
        </div>
        
        <el-table :data="node.users" style="width: 100%" size="small">
          <el-table-column prop="email" label="用户标识" min-width="120" />
          <el-table-column prop="enabled" label="状态" width="80">
            <template #default="scope">
              <el-tag :type="scope.row.enabled ? 'success' : 'danger'" size="small">
                {{ scope.row.enabled ? '启用' : '禁用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="expire_text" label="到期时间" width="150" />
          <el-table-column prop="traffic_used_text" label="已用流量" width="100" />
          <el-table-column prop="traffic_limit_text" label="流量上限" width="100" />
          <el-table-column label="操作" width="280" fixed="right">
            <template #default="scope">
              <el-button size="small" type="primary" @click="editUser(node, scope.row)">
                <el-icon><Edit /></el-icon>
                编辑
              </el-button>
              <el-button 
                size="small" 
                :type="scope.row.enabled ? 'warning' : 'success'"
                @click="toggleUser(node, scope.row)"
              >
                <el-icon><Switch /></el-icon>
                {{ scope.row.enabled ? '禁用' : '启用' }}
              </el-button>
              <el-button size="small" type="danger" @click="deleteUser(node, scope.row)">
                <el-icon><Delete /></el-icon>
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 编辑用户对话框 -->
    <el-dialog 
      v-model="editDialogVisible" 
      title="编辑用户" 
      width="500px"
    >
      <el-form 
        ref="editFormRef" 
        :model="editForm" 
        label-width="100px"
      >
        <el-form-item label="用户标识">
          <el-input v-model="editForm.email" disabled />
        </el-form-item>
        <el-form-item label="到期时间">
          <el-date-picker
            v-model="editForm.expiryTime"
            type="datetime"
            placeholder="选择到期时间"
            format="YYYY-MM-DD HH:mm:ss"
            value-format="x"
            style="width: 100%"
          />
          <div class="form-tip">
            <el-button size="small" @click="editForm.expiryTime = 0">设为永不过期</el-button>
            <el-button size="small" @click="setExpiryDays(30)">30天</el-button>
            <el-button size="small" @click="setExpiryDays(90)">90天</el-button>
            <el-button size="small" @click="setExpiryDays(365)">1年</el-button>
          </div>
        </el-form-item>
        <el-form-item label="流量上限(GB)">
          <el-input-number 
            v-model="editForm.totalGB" 
            :min="0" 
            :step="1"
            placeholder="0表示无限制"
            style="width: 100%"
          />
          <div class="form-tip">设置为 0 表示无限制</div>
        </el-form-item>
      </el-form>
      
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitEdit" :loading="submitting">
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Edit, Delete, Switch, ArrowLeft } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const route = useRoute()
const router = useRouter()
const server = ref({})
const nodes = ref([])
const editDialogVisible = ref(false)
const submitting = ref(false)
const editFormRef = ref(null)

// 返回服务器列表
function goBack() {
  router.push('/admin/servers')
}

// 编辑表单数据
const editForm = ref({
  email: '',
  inboundId: null,
  clientUuid: '',
  expiryTime: 0,
  totalGB: 0
})

async function fetchServerDetail() {
  try {
    const response = await api.admin.getServerDetail(route.params.id)
    if (response.code === 0) {
      server.value = response.data.server
      nodes.value = response.data.nodes
    }
  } catch (error) {
    console.error('获取服务器详情失败:', error)
  }
}

function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toLocaleString('zh-CN')
}

// 编辑用户
function editUser(node, user) {
  editForm.value = {
    email: user.email,
    inboundId: node.inbound_id,
    clientUuid: user.uuid || '',
    expiryTime: user.expiry_time || 0,
    totalGB: user.traffic_limit || 0
  }
  editDialogVisible.value = true
}

// 设置到期天数
function setExpiryDays(days) {
  editForm.value.expiryTime = Date.now() + days * 24 * 60 * 60 * 1000
}

// 提交编辑
async function submitEdit() {
  try {
    submitting.value = true
    
    const response = await api.admin.updateXuiUser(route.params.id, {
      inboundId: editForm.value.inboundId,
      email: editForm.value.email,
      expiryTime: editForm.value.expiryTime,
      totalGB: editForm.value.totalGB
    })
    
    if (response.code === 0) {
      ElMessage.success('用户更新成功')
      editDialogVisible.value = false
      fetchServerDetail()
    } else {
      ElMessage.error(response.message || '更新失败')
    }
  } catch (error) {
    console.error('更新用户失败:', error)
    ElMessage.error('更新用户失败')
  } finally {
    submitting.value = false
  }
}

// 切换用户启用/禁用状态
async function toggleUser(node, user) {
  try {
    const action = user.enabled ? '禁用' : '启用'
    await ElMessageBox.confirm(
      `确定要${action}用户 "${user.email}" 吗？`,
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    
    const response = await api.admin.updateXuiUser(route.params.id, {
      inboundId: node.inbound_id,
      email: user.email,
      enabled: !user.enabled
    })
    
    if (response.code === 0) {
      ElMessage.success(`用户已${action}`)
      fetchServerDetail()
    } else {
      ElMessage.error(response.message || `${action}失败`)
    }
  } catch {
    // 用户取消操作
  }
}

// 删除用户
async function deleteUser(node, user) {
  try {
    await ElMessageBox.confirm(
      `确定要删除用户 "${user.email}" 吗？此操作不可恢复！`,
      '警告',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'error'
      }
    )
    
    const response = await api.admin.deleteXuiUser(route.params.id, {
      inboundId: node.inbound_id,
      email: user.email
    })
    
    if (response.code === 0) {
      ElMessage.success('用户已删除')
      fetchServerDetail()
    } else {
      ElMessage.error(response.message || '删除失败')
    }
  } catch {
    // 用户取消操作
  }
}

onMounted(() => {
  fetchServerDetail()
})
</script>

<style scoped>
.server-detail-container { max-width: 1200px; }
.page-header { margin-bottom: 30px; }
.header-top { margin-bottom: 15px; }
.back-btn { display: inline-flex; align-items: center; gap: 5px; }
.page-title { font-size: 28px; color: #333; margin-bottom: 10px; }
.page-subtitle { color: #666; font-size: 16px; }
.content-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 30px; margin-bottom: 20px; }
.card-title { font-size: 20px; color: #333; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #eee; }
.server-info { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
.info-item { display: flex; align-items: center; gap: 10px; }
.info-label { color: #666; font-weight: 500; }
.info-value { color: #333; }
.node-item { background: #f5f7fa; border-radius: 8px; padding: 20px; margin-bottom: 15px; }
.node-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; }
.node-header h3 { margin: 0; color: #333; }
.node-stats { display: flex; align-items: center; gap: 15px; color: #666; font-size: 14px; }
.form-tip { margin-top: 8px; color: #999; font-size: 12px; display: flex; gap: 8px; }
</style>

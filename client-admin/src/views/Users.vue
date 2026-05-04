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
          <el-option label="已禁用" value="disabled" />
        </el-select>
      </div>
      
      <el-table :data="users" style="width: 100%">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="email" label="邮箱" />
        <el-table-column prop="plan_name" label="套餐" />
        <el-table-column prop="traffic_used_text" label="已用流量" />
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
          </template>
        </el-table-column>
      </el-table>
      
      <div class="pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="limit"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="fetchUsers"
          @size-change="fetchUsers"
        />
      </div>
    </div>
    
    <el-dialog v-model="dialogVisible" title="编辑用户" width="500px" :close-on-click-modal="!submitting">
      <el-form :model="userForm" label-width="100px">
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
      </el-form>
      <div v-if="submitting" style="text-align: center; color: #409eff; margin-top: 10px;">
        <el-icon class="is-loading"><Loading /></el-icon>
        正在同步到 3X-UI 服务器，请稍候...
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false" :disabled="submitting">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Search, Loading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const users = ref([])
const keyword = ref('')
const status = ref('')
const page = ref(1)
const limit = ref(10)
const total = ref(0)
const dialogVisible = ref(false)
const submitting = ref(false)
const editingId = ref(null)

const userForm = reactive({
  enabled: true,
  traffic_value: 0,
  traffic_unit: 'GB',
  traffic_bytes: 0,  // 存储原始字节值
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

async function fetchUsers() {
  try {
    const params = {
      page: page.value,
      limit: limit.value
    }
    if (keyword.value) params.keyword = keyword.value
    if (status.value) params.status = status.value
    
    const response = await api.admin.getUsers(params)
    if (response.code === 0) {
      users.value = response.data.list
      total.value = response.data.total
    }
  } catch (error) {
    console.error('获取用户列表失败:', error)
  }
}

function showEditDialog(user) {
  editingId.value = user.id
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
  dialogVisible.value = true
}

async function handleSubmit() {
  try {
    submitting.value = true
    
    const data = {
      enabled: userForm.enabled,
      traffic_limit: userForm.traffic_bytes,  // 直接使用存储的字节值
      expire_at: userForm.expire_at ? Math.floor(userForm.expire_at.getTime() / 1000) : null
    }
    const response = await api.admin.updateUser(editingId.value, data)
    if (response.code === 0) {
      ElMessage.success('用户信息更新成功')
      dialogVisible.value = false
      fetchUsers()
    }
  } catch (error) {
    console.error('更新失败:', error)
  } finally {
    submitting.value = false
  }
}

function getStatusType(status) {
  const typeMap = { active: 'success', expired: 'warning', disabled: 'danger' }
  return typeMap[status] || 'info'
}

onMounted(() => {
  fetchUsers()
})
</script>

<style scoped>
.users-container { max-width: 1200px; }
.page-header { margin-bottom: 30px; }
.page-title { font-size: 28px; color: #333; margin-bottom: 10px; }
.page-subtitle { color: #666; font-size: 16px; }
.content-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 20px; }
.toolbar { display: flex; align-items: center; margin-bottom: 20px; }
.pagination { margin-top: 20px; display: flex; justify-content: flex-end; }
</style>
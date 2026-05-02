<template>
  <div class="settings-container">
    <div class="page-header">
      <h1 class="page-title">系统设置</h1>
      <p class="page-subtitle">管理系统设置和管理员账号</p>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">修改密码</h2>
      <el-form :model="passwordForm" :rules="passwordRules" ref="passwordFormRef" label-width="100px" style="max-width: 500px;">
        <el-form-item label="原密码" prop="old_password">
          <el-input v-model="passwordForm.old_password" type="password" show-password placeholder="请输入原密码" />
        </el-form-item>
        <el-form-item label="新密码" prop="new_password">
          <el-input v-model="passwordForm.new_password" type="password" show-password placeholder="请输入新密码" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleChangePassword" :loading="submitting">修改密码</el-button>
        </el-form-item>
      </el-form>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">管理员列表</h2>
      <div class="toolbar">
        <el-button type="primary" @click="showAddAdminDialog">
          <el-icon><Plus /></el-icon>
          添加管理员
        </el-button>
      </div>
      
      <el-table :data="admins" style="width: 100%">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="username" label="用户名" />
        <el-table-column prop="is_super" label="角色" width="120">
          <template #default="scope">
            <el-tag :type="scope.row.is_super ? 'danger' : 'info'">
              {{ scope.row.is_super ? '超级管理员' : '普通管理员' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间">
          <template #default="scope">{{ formatTime(scope.row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="scope">
            <el-button size="small" type="danger" @click="deleteAdmin(scope.row)" :disabled="scope.row.is_super">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    
    <el-dialog v-model="adminDialogVisible" title="添加管理员" width="400px">
      <el-form :model="adminForm" label-width="100px">
        <el-form-item label="用户名">
          <el-input v-model="adminForm.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="adminForm.password" type="password" show-password placeholder="请输入密码" />
        </el-form-item>
        <el-form-item label="超级管理员">
          <el-switch v-model="adminForm.is_super" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adminDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleAddAdmin" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAdminStore } from '@/stores/admin'
import api from '@/api'

const adminStore = useAdminStore()
const admins = ref([])
const submitting = ref(false)
const adminDialogVisible = ref(false)
const passwordFormRef = ref(null)

const passwordForm = reactive({
  old_password: '',
  new_password: ''
})

const passwordRules = {
  old_password: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  new_password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码长度至少8位', trigger: 'blur' }
  ]
}

const adminForm = reactive({
  username: '',
  password: '',
  is_super: false
})

async function fetchAdmins() {
  try {
    const response = await api.admin.getAdmins()
    if (response.code === 0) {
      admins.value = response.data.list
    }
  } catch (error) {
    console.error('获取管理员列表失败:', error)
  }
}

async function handleChangePassword() {
  try {
    await passwordFormRef.value.validate()
    submitting.value = true
    const result = await adminStore.changePassword(passwordForm)
    if (result.success) {
      ElMessage.success('密码修改成功，请重新登录')
      passwordForm.old_password = ''
      passwordForm.new_password = ''
    } else {
      ElMessage.error(result.message)
    }
  } catch (error) {
    console.error('修改密码失败:', error)
  } finally {
    submitting.value = false
  }
}

function showAddAdminDialog() {
  adminForm.username = ''
  adminForm.password = ''
  adminForm.is_super = false
  adminDialogVisible.value = true
}

async function handleAddAdmin() {
  try {
    submitting.value = true
    const response = await api.admin.addAdmin(adminForm)
    if (response.code === 0) {
      ElMessage.success('管理员添加成功')
      adminDialogVisible.value = false
      fetchAdmins()
    }
  } catch (error) {
    console.error('添加管理员失败:', error)
  } finally {
    submitting.value = false
  }
}

async function deleteAdmin(admin) {
  try {
    await ElMessageBox.confirm(`确定要删除管理员 "${admin.username}" 吗？`, '提示', { type: 'warning' })
    const response = await api.admin.deleteAdmin(admin.id)
    if (response.code === 0) {
      ElMessage.success('删除成功')
      fetchAdmins()
    }
  } catch {}
}

function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toLocaleString('zh-CN')
}

onMounted(() => {
  fetchAdmins()
})
</script>

<style scoped>
.settings-container { max-width: 1000px; }
.page-header { margin-bottom: 30px; }
.page-title { font-size: 28px; color: #333; margin-bottom: 10px; }
.page-subtitle { color: #666; font-size: 16px; }
.content-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 30px; margin-bottom: 20px; }
.card-title { font-size: 20px; color: #333; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #eee; }
.toolbar { margin-bottom: 20px; }
</style>
<template>
  <div class="cf-ips-container">
    <div class="page-header">
      <h1 class="page-title">CF IP池管理</h1>
      <p class="page-subtitle">管理Cloudflare优选IP池</p>
    </div>
    
    <div class="content-card">
      <div class="toolbar">
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>
          添加IP
        </el-button>
        <el-button @click="showImportDialog">
          <el-icon><Upload /></el-icon>
          批量导入
        </el-button>
        <span class="total-info">共 {{ total }} 条记录</span>
      </div>
      
      <el-table :data="ips" style="width: 100%">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="ip" label="IP地址" />
        <el-table-column prop="enabled" label="状态" width="100">
          <template #default="scope">
            <el-tag :type="scope.row.enabled ? 'success' : 'danger'">
              {{ scope.row.enabled ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="scope">
            <el-button size="small" type="primary" @click="showEditDialog(scope.row)">编辑</el-button>
            <el-button size="small" type="danger" @click="deleteIp(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      
      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="limit"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="fetchIps"
          @size-change="handleSizeChange"
          background
        />
      </div>
    </div>
    
    <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑IP' : '添加IP'" width="400px">
      <el-form :model="ipForm" label-width="80px">
        <el-form-item label="IP地址">
          <el-input v-model="ipForm.ip" placeholder="请输入IP地址，如 104.16.132.229 或 [2606:4700::]" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="ipForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>
    
    <el-dialog v-model="importDialogVisible" title="批量导入IP" width="500px">
      <el-input v-model="importText" type="textarea" :rows="15" placeholder="每行一个IP地址&#10;例如：&#10;104.16.132.229&#10;104.16.133.229&#10;[2606:4700::]" />
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleImport" :loading="importing">导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Plus, Upload } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const ips = ref([])
const page = ref(1)
const limit = ref(20)
const total = ref(0)
const dialogVisible = ref(false)
const importDialogVisible = ref(false)
const isEditing = ref(false)
const submitting = ref(false)
const importing = ref(false)
const editingId = ref(null)
const importText = ref('')

const ipForm = reactive({
  ip: '',
  enabled: true
})

async function fetchIps() {
  try {
    const response = await api.admin.getCfIps({ page: page.value, limit: limit.value })
    if (response.code === 0) {
      ips.value = response.data.list
      total.value = parseInt(response.data.total) || 0
    }
  } catch (error) {
    console.error('获取IP池失败:', error)
  }
}

function handleSizeChange(newSize) {
  limit.value = newSize
  page.value = 1
  fetchIps()
}

function showAddDialog() {
  isEditing.value = false
  editingId.value = null
  ipForm.ip = ''
  ipForm.enabled = true
  dialogVisible.value = true
}

function showEditDialog(ip) {
  isEditing.value = true
  editingId.value = ip.id
  ipForm.ip = ip.ip
  ipForm.enabled = ip.enabled
  dialogVisible.value = true
}

function showImportDialog() {
  importText.value = ''
  importDialogVisible.value = true
}

async function handleSubmit() {
  if (!ipForm.ip.trim()) {
    ElMessage.warning('请输入IP地址')
    return
  }
  
  try {
    submitting.value = true
    if (isEditing.value) {
      const response = await api.admin.updateCfIp(editingId.value, ipForm)
      if (response.code === 0) {
        ElMessage.success('更新成功')
        dialogVisible.value = false
        fetchIps()
      }
    } else {
      const response = await api.admin.addCfIp(ipForm)
      if (response.code === 0) {
        ElMessage.success('添加成功')
        dialogVisible.value = false
        fetchIps()
      }
    }
  } catch (error) {
    console.error('提交失败:', error)
  } finally {
    submitting.value = false
  }
}

async function handleImport() {
  try {
    importing.value = true
    const lines = importText.value.split('\n').filter(line => line.trim())
    const ips = lines.map(line => line.trim())
    
    if (ips.length === 0) {
      ElMessage.warning('请输入至少一个IP地址')
      return
    }
    
    const response = await api.admin.importCfIps({ ips, enabled: true })
    if (response.code === 0) {
      ElMessage.success(response.data.message)
      importDialogVisible.value = false
      fetchIps()
    }
  } catch (error) {
    console.error('导入失败:', error)
  } finally {
    importing.value = false
  }
}

async function deleteIp(ip) {
  try {
    await ElMessageBox.confirm(`确定要删除IP "${ip.ip}" 吗？`, '提示', { type: 'warning' })
    const response = await api.admin.deleteCfIp(ip.id)
    if (response.code === 0) {
      ElMessage.success('删除成功')
      fetchIps()
    }
  } catch {}
}

onMounted(() => {
  fetchIps()
})
</script>

<style scoped>
.cf-ips-container { width: 100%; max-width: 100%; }
.page-header { margin-bottom: 30px; }
.page-title { font-size: 28px; color: #333; margin-bottom: 10px; }
.page-subtitle { color: #666; font-size: 16px; }
.content-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 20px; }
.toolbar { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; }
.total-info { color: #666; margin-left: auto; }
.pagination-wrapper { 
  margin-top: 20px; 
  display: flex; 
  justify-content: flex-end; 
  padding: 10px 0;
  background: #fff;
}
</style>

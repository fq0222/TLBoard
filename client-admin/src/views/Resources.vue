<template>
  <div class="resources-container">
    <div class="page-header">
      <h2>资源管理</h2>
      <el-button type="primary" @click="showUploadDialog">
        <el-icon><Upload /></el-icon>
        上传文件
      </el-button>
    </div>

    <!-- 资源列表 -->
    <el-table :data="resources" v-loading="loading" border stripe>
      <el-table-column prop="name" label="资源名称" min-width="200" show-overflow-tooltip />
      <el-table-column prop="original_name" label="原始文件名" min-width="150" show-overflow-tooltip />
      <el-table-column label="文件大小" width="100" align="right">
        <template #default="{ row }">
          {{ formatSize(row.size) }}
        </template>
      </el-table-column>
      <el-table-column label="下载次数" width="90" align="center">
        <template #default="{ row }">
          {{ row.download_count }}
        </template>
      </el-table-column>
      <el-table-column label="下载栏" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.is_download_resource ? 'success' : 'info'" size="small">
            {{ row.is_download_resource ? '显示' : '隐藏' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="下载分类" width="120" align="center" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.is_download_resource ? (row.download_category || '其他') : '-' }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row)" size="small">
            {{ getStatusText(row) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="过期时间" width="160" align="center">
        <template #default="{ row }">
          {{ row.expire_at ? formatTime(row.expire_at) : '永不过期' }}
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="160" align="center">
        <template #default="{ row }">
          {{ formatTime(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="350" align="center" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="showDistributeDialog(row)">分发</el-button>
          <el-button size="small" @click="showDistributionsDialog(row)">分发列表</el-button>
          <el-button size="small" @click="showRenameDialog(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="pagination" v-if="total > 0">
      <el-pagination
        v-model:current-page="currentPage"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        @current-change="fetchResources"
      />
    </div>

    <!-- 上传对话框 -->
    <el-dialog v-model="uploadDialogVisible" title="上传文件" width="500" @closed="handleUploadDialogClosed">
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        :limit="5"
        :on-exceed="handleExceed"
        :on-change="handleFileChange"
        :on-remove="handleFileChange"
        drag
      >
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">
          将文件拖到此处，或<em>点击上传</em>
        </div>
        <template #tip>
          <div class="el-upload__tip">
            单个文件最大 {{ resourceConfig.max_file_size }}MB
          </div>
        </template>
      </el-upload>
      <template #footer>
        <el-button @click="handleUploadCancel">取消</el-button>
        <el-button type="primary" @click="handleUpload" :loading="uploading">
          上传
        </el-button>
      </template>
    </el-dialog>

    <!-- 资源编辑对话框 -->
    <el-dialog v-model="renameDialogVisible" title="编辑资源" width="460">
      <el-form :model="renameForm" label-width="80px">
        <el-form-item label="资源名称">
          <el-input v-model="renameForm.name" placeholder="请输入资源名称" />
        </el-form-item>
        <el-form-item label="下载资源">
          <el-switch v-model="renameForm.is_download_resource" active-text="显示" inactive-text="隐藏" />
        </el-form-item>
        <el-form-item v-if="renameForm.is_download_resource" label="下载分类">
          <el-input
            v-model="renameForm.download_category"
            maxlength="100"
            show-word-limit
            placeholder="如 Android、Windows、iOS"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="renameDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleRename">确定</el-button>
      </template>
    </el-dialog>

    <!-- 分发对话框 -->
    <el-dialog v-model="distributeDialogVisible" title="分发资源" width="600">
      <el-form :model="distributeForm" label-width="100px">
        <el-form-item label="选择用户">
          <el-select
            v-model="distributeForm.user_ids"
            multiple
            filterable
            remote
            reserve-keyword
            placeholder="请输入邮箱搜索用户"
            :remote-method="searchUsers"
            :loading="searchLoading"
            style="width: 100%"
          >
            <el-option
              v-for="user in userOptions"
              :key="user.id"
              :label="user.email"
              :value="user.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="有效期">
          <el-input-number
            v-model="distributeForm.expire_minutes"
            :min="1"
            :max="10080"
            placeholder="分钟"
          />
          <span style="margin-left: 10px; color: #666;">分钟（默认60分钟）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="distributeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleDistribute" :loading="distributing">
          确认分发
        </el-button>
      </template>
    </el-dialog>

    <!-- 分发列表对话框 -->
    <el-dialog v-model="distributionsDialogVisible" title="分发列表" width="900">
      <div class="distributions-toolbar">
        <el-button size="small" @click="showBatchExpireDialog" :disabled="selectedDistributions.length === 0">
          批量设置有效期
        </el-button>
      </div>
      <el-table :data="distributions" v-loading="distributionsLoading" border stripe @selection-change="handleDistributionSelect">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="email" label="用户邮箱" min-width="200" />
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="getDistributionStatusType(row)" size="small">
              {{ getDistributionStatusText(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="过期时间" width="160" align="center">
          <template #default="{ row }">
            {{ row.expire_at ? formatTime(row.expire_at) : '永不过期' }}
          </template>
        </el-table-column>
        <el-table-column label="下载次数" width="90" align="center">
          <template #default="{ row }">
            {{ row.download_count }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button size="small" type="danger" @click="handleDeleteDistribution(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 批量设置有效期对话框 -->
    <el-dialog v-model="batchExpireDialogVisible" title="批量设置有效期" width="400">
      <el-form :model="batchExpireForm" label-width="80px">
        <el-form-item label="有效期">
          <el-input-number
            v-model="batchExpireForm.expire_minutes"
            :min="1"
            :max="10080"
            placeholder="分钟"
          />
          <span style="margin-left: 10px; color: #666;">分钟</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchExpireDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleBatchExpire" :loading="batchExpiring">
          确认
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import api from '../api'

const loading = ref(false)
const uploading = ref(false)
const resources = ref([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)

// 资源配置
const resourceConfig = ref({
  max_file_size: 100,
  download_speed_limit: 0
})

// 上传相关
const uploadDialogVisible = ref(false)
const uploadRef = ref(null)
const selectedFiles = ref([])

// 资源编辑相关
const renameDialogVisible = ref(false)
const renameForm = ref({
  id: null,
  name: '',
  is_download_resource: false,
  download_category: '其他'
})

// 分发相关
const distributeDialogVisible = ref(false)
const distributeForm = ref({ resource_id: null, user_ids: [], expire_minutes: 60 })
const distributing = ref(false)
const searchLoading = ref(false)
const userOptions = ref([])

// 分发列表相关
const distributionsDialogVisible = ref(false)
const distributionsLoading = ref(false)
const distributions = ref([])
const selectedDistributions = ref([])

// 批量设置有效期相关
const batchExpireDialogVisible = ref(false)
const batchExpireForm = ref({ expire_minutes: 60 })
const batchExpiring = ref(false)

// 获取资源配置
const fetchResourceConfig = async () => {
  try {
    const res = await api.admin.getResourceConfig()
    if (res.code === 0) {
      resourceConfig.value = res.data
    }
  } catch (error) {
    console.error('获取资源配置失败:', error)
  }
}

// 获取资源列表
const fetchResources = async () => {
  loading.value = true
  try {
    const res = await api.admin.getResources({
      page: currentPage.value,
      limit: pageSize.value
    })
    if (res.code === 0) {
      resources.value = res.data.list
      total.value = res.data.total
    }
  } catch (error) {
    ElMessage.error('获取资源列表失败')
  } finally {
    loading.value = false
  }
}

// 格式化文件大小
const formatSize = (bytes) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`
}

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

// 获取状态类型
const getStatusType = (row) => {
  if (!row.enabled) return 'info'
  if (row.expire_at && row.expire_at < Math.floor(Date.now() / 1000)) return 'warning'
  return 'success'
}

// 获取状态文本
const getStatusText = (row) => {
  if (!row.enabled) return '已禁用'
  if (row.expire_at && row.expire_at < Math.floor(Date.now() / 1000)) return '已过期'
  return '正常'
}

// 清理上传组件内外两层文件列表，避免下次选择文件时夹带旧文件。
const resetUploadFiles = () => {
  selectedFiles.value = []
  uploadRef.value?.clearFiles()
}

// 显示上传对话框
const showUploadDialog = () => {
  resetUploadFiles()
  uploadDialogVisible.value = true
}

// 文件变更
const handleFileChange = (file, fileList) => {
  selectedFiles.value = fileList
}

// 上传弹窗取消时主动清空文件列表。
const handleUploadCancel = () => {
  resetUploadFiles()
  uploadDialogVisible.value = false
}

// 上传弹窗关闭后兜底清空，覆盖右上角关闭和遮罩关闭场景。
const handleUploadDialogClosed = () => {
  resetUploadFiles()
}

// 文件数量超出限制
const handleExceed = () => {
  ElMessage.warning('最多只能同时上传 5 个文件')
}

// 上传文件
const handleUpload = async () => {
  if (selectedFiles.value.length === 0) {
    ElMessage.warning('请选择要上传的文件')
    return
  }

  uploading.value = true
  try {
    for (const file of selectedFiles.value) {
      const formData = new FormData()
      formData.append('file', file.raw)
      const res = await api.admin.uploadResource(formData)
      if (res.code !== 0) {
        ElMessage.error(`上传失败: ${res.message}`)
        continue
      }
    }
    ElMessage.success('上传成功')
    resetUploadFiles()
    uploadDialogVisible.value = false
    fetchResources()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

// 显示资源编辑对话框
const showRenameDialog = (row) => {
  renameForm.value = {
    id: row.id,
    name: row.name,
    is_download_resource: !!row.is_download_resource,
    download_category: row.download_category || '其他'
  }
  renameDialogVisible.value = true
}

// 保存资源编辑
const handleRename = async () => {
  if (renameForm.value.is_download_resource && !renameForm.value.download_category.trim()) {
    ElMessage.warning('请输入下载分类')
    return
  }

  try {
    const res = await api.admin.updateResource(renameForm.value.id, {
      name: renameForm.value.name,
      is_download_resource: renameForm.value.is_download_resource,
      download_category: renameForm.value.download_category
    })
    if (res.code === 0) {
      ElMessage.success('保存成功')
      renameDialogVisible.value = false
      fetchResources()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

// 删除资源
const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确定要删除该资源吗？删除后无法恢复。', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    const res = await api.admin.deleteResource(row.id)
    if (res.code === 0) {
      ElMessage.success('删除成功')
      fetchResources()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

// 搜索用户
const searchUsers = async (keyword) => {
  if (!keyword) {
    userOptions.value = []
    return
  }
  searchLoading.value = true
  try {
    const res = await api.admin.searchUsers(keyword)
    if (res.code === 0) {
      userOptions.value = res.data
    }
  } catch (error) {
    console.error('搜索用户失败:', error)
  } finally {
    searchLoading.value = false
  }
}

// 显示分发对话框
const showDistributeDialog = (row) => {
  distributeForm.value = {
    resource_id: row.id,
    user_ids: [],
    expire_minutes: 60
  }
  userOptions.value = []
  distributeDialogVisible.value = true
}

// 分发资源
const handleDistribute = async () => {
  if (distributeForm.value.user_ids.length === 0) {
    ElMessage.warning('请选择用户')
    return
  }

  distributing.value = true
  try {
    const res = await api.admin.distributeResource(distributeForm.value.resource_id, {
      user_ids: distributeForm.value.user_ids,
      expire_minutes: distributeForm.value.expire_minutes
    })
    if (res.code === 0) {
      ElMessage.success(`成功分发给 ${res.data.distributions.length} 个用户`)
      distributeDialogVisible.value = false
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('分发失败')
  } finally {
    distributing.value = false
  }
}

// 显示分发列表对话框
const showDistributionsDialog = async (row) => {
  distributeForm.value.resource_id = row.id
  distributionsDialogVisible.value = true
  await fetchDistributions(row.id)
}

// 获取分发列表
const fetchDistributions = async (resourceId) => {
  distributionsLoading.value = true
  try {
    const res = await api.admin.getResourceDistributions(resourceId)
    if (res.code === 0) {
      distributions.value = res.data
    }
  } catch (error) {
    ElMessage.error('获取分发列表失败')
  } finally {
    distributionsLoading.value = false
  }
}

// 分发列表选择变更
const handleDistributionSelect = (selection) => {
  selectedDistributions.value = selection
}

// 获取分发状态类型
const getDistributionStatusType = (row) => {
  if (!row.enabled) return 'info'
  if (row.expire_at && row.expire_at < Math.floor(Date.now() / 1000)) return 'warning'
  return 'success'
}

// 获取分发状态文本
const getDistributionStatusText = (row) => {
  if (!row.enabled) return '已禁用'
  if (row.expire_at && row.expire_at < Math.floor(Date.now() / 1000)) return '已过期'
  return '有效'
}

// 删除分发记录
const handleDeleteDistribution = async (row) => {
  try {
    await ElMessageBox.confirm('确定要删除该分发记录吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    const res = await api.admin.deleteDistribution(row.id)
    if (res.code === 0) {
      ElMessage.success('删除成功')
      fetchDistributions(distributeForm.value.resource_id)
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

// 显示批量设置有效期对话框
const showBatchExpireDialog = () => {
  batchExpireForm.value.expire_minutes = 60
  batchExpireDialogVisible.value = true
}

// 批量设置有效期
const handleBatchExpire = async () => {
  const ids = selectedDistributions.value.map(d => d.id)
  if (ids.length === 0) {
    ElMessage.warning('请选择要设置的记录')
    return
  }

  batchExpiring.value = true
  try {
    const res = await api.admin.batchExpireDistributions({
      ids,
      expire_minutes: batchExpireForm.value.expire_minutes
    })
    if (res.code === 0) {
      ElMessage.success('设置成功')
      batchExpireDialogVisible.value = false
      fetchDistributions(distributeForm.value.resource_id)
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('设置失败')
  } finally {
    batchExpiring.value = false
  }
}

onMounted(() => {
  fetchResourceConfig()
  fetchResources()
})
</script>

<style scoped>
.resources-container {
  padding: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

.distributions-toolbar {
  margin-bottom: 15px;
}
</style>

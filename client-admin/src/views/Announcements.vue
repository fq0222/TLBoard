<template>
  <div class="announcements-container">
    <div class="page-header">
      <h1 class="page-title">公告管理</h1>
      <p class="page-subtitle">管理系统公告</p>
    </div>
    
    <div class="content-card">
      <div class="toolbar">
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>
          添加公告
        </el-button>
      </div>
      
      <el-table :data="announcements" style="width: 100%">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="title" label="标题" />
        <el-table-column prop="pinned" label="置顶" width="80">
          <template #default="scope">
            <el-tag :type="scope.row.pinned ? 'danger' : 'info'" size="small">
              {{ scope.row.pinned ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="enabled" label="状态" width="80">
          <template #default="scope">
            <el-tag :type="scope.row.enabled ? 'success' : 'danger'" size="small">
              {{ scope.row.enabled ? '显示' : '隐藏' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间">
          <template #default="scope">{{ formatTime(scope.row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="scope">
            <el-button size="small" type="primary" @click="showEditDialog(scope.row)">编辑</el-button>
            <el-button size="small" type="danger" @click="deleteAnnouncement(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    
    <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑公告' : '添加公告'" width="600px">
      <el-form :model="announcementForm" label-width="80px">
        <el-form-item label="标题">
          <el-input v-model="announcementForm.title" placeholder="请输入公告标题" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="announcementForm.content" type="textarea" :rows="6" placeholder="请输入公告内容，支持Markdown" />
        </el-form-item>
        <el-form-item label="置顶">
          <el-switch v-model="announcementForm.pinned" />
        </el-form-item>
        <el-form-item label="显示">
          <el-switch v-model="announcementForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const announcements = ref([])
const dialogVisible = ref(false)
const isEditing = ref(false)
const submitting = ref(false)
const editingId = ref(null)

const announcementForm = reactive({
  title: '',
  content: '',
  pinned: false,
  enabled: true
})

async function fetchAnnouncements() {
  try {
    const response = await api.admin.getAnnouncements({ page: 1, limit: 100 })
    if (response.code === 0) {
      announcements.value = response.data.list
    }
  } catch (error) {
    console.error('获取公告列表失败:', error)
  }
}

function showAddDialog() {
  isEditing.value = false
  editingId.value = null
  announcementForm.title = ''
  announcementForm.content = ''
  announcementForm.pinned = false
  announcementForm.enabled = true
  dialogVisible.value = true
}

function showEditDialog(announcement) {
  isEditing.value = true
  editingId.value = announcement.id
  announcementForm.title = announcement.title
  announcementForm.content = announcement.content
  announcementForm.pinned = !!announcement.pinned
  announcementForm.enabled = !!announcement.enabled
  dialogVisible.value = true
}

async function handleSubmit() {
  try {
    submitting.value = true
    if (isEditing.value) {
      const response = await api.admin.updateAnnouncement(editingId.value, announcementForm)
      if (response.code === 0) {
        ElMessage.success('公告更新成功')
        dialogVisible.value = false
        fetchAnnouncements()
      }
    } else {
      const response = await api.admin.addAnnouncement(announcementForm)
      if (response.code === 0) {
        ElMessage.success('公告添加成功')
        dialogVisible.value = false
        fetchAnnouncements()
      }
    }
  } catch (error) {
    console.error('提交失败:', error)
  } finally {
    submitting.value = false
  }
}

async function deleteAnnouncement(announcement) {
  try {
    await ElMessageBox.confirm(`确定要删除公告 "${announcement.title}" 吗？`, '提示', { type: 'warning' })
    const response = await api.admin.deleteAnnouncement(announcement.id)
    if (response.code === 0) {
      ElMessage.success('删除成功')
      fetchAnnouncements()
    }
  } catch {}
}

function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toLocaleString('zh-CN')
}

onMounted(() => {
  fetchAnnouncements()
})
</script>

<style scoped>
.announcements-container { max-width: 1200px; }
.page-header { margin-bottom: 30px; }
.page-title { font-size: 28px; color: #333; margin-bottom: 10px; }
.page-subtitle { color: #666; font-size: 16px; }
.content-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 20px; }
.toolbar { margin-bottom: 20px; }
</style>
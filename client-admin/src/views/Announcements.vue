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
        <el-table-column prop="title" label="标题" min-width="180" />
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
        <el-table-column prop="node_show" label="节点显示" width="100">
          <template #default="scope">
            <el-tag :type="scope.row.node_show ? 'warning' : 'info'" size="small">
              {{ scope.row.node_show ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="popup_show_limit" label="弹窗次数" width="110">
          <template #default="scope">
            {{ Number(scope.row.popup_show_limit || 0) }}
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" min-width="170">
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

    <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑公告' : '添加公告'" width="900px">
      <div class="editor-container">
        <div class="editor-left">
          <el-form :model="announcementForm" label-width="96px">
            <el-form-item label="标题">
              <el-input v-model="announcementForm.title" placeholder="请输入公告标题" />
            </el-form-item>
            <el-form-item label="内容">
              <el-input v-model="announcementForm.content" type="textarea" :rows="12" placeholder="请输入公告内容，支持 Markdown" />
            </el-form-item>
            <el-form-item label="置顶">
              <el-switch v-model="announcementForm.pinned" />
            </el-form-item>
            <el-form-item label="显示">
              <el-switch v-model="announcementForm.enabled" />
            </el-form-item>
            <el-form-item label="订阅节点">
              <el-switch v-model="announcementForm.node_show" />
              <div class="field-tip">开启后只在订阅链接的虚拟节点中显示公告标题，不在系统公告列表和弹窗中显示。</div>
            </el-form-item>
            <el-form-item label="弹窗次数">
              <el-input-number
                v-model="announcementForm.popup_show_limit"
                :min="0"
                :step="1"
                :disabled="announcementForm.node_show"
                controls-position="right"
              />
              <div class="field-tip">0 表示不弹窗，正整数表示每个用户最多弹出次数；订阅节点公告会忽略该设置。</div>
            </el-form-item>
          </el-form>
        </div>
        <div class="editor-right">
          <div class="preview-header">Markdown 预览</div>
          <div class="preview-content" v-html="renderedContent"></div>
        </div>
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { marked } from 'marked'
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
  enabled: true,
  popup_show_limit: 0,
  node_show: false
})

const renderedContent = computed(() => {
  if (!announcementForm.content) return '<p style="color: #999;">请输入内容查看预览</p>'
  return marked(announcementForm.content)
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
  announcementForm.popup_show_limit = 0
  announcementForm.node_show = false
  dialogVisible.value = true
}

function showEditDialog(announcement) {
  isEditing.value = true
  editingId.value = announcement.id
  announcementForm.title = announcement.title
  announcementForm.content = announcement.content
  announcementForm.pinned = !!announcement.pinned
  announcementForm.enabled = !!announcement.enabled
  announcementForm.popup_show_limit = Number(announcement.popup_show_limit || 0)
  announcementForm.node_show = !!announcement.node_show
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
    await ElMessageBox.confirm(`确定要删除公告"${announcement.title}"吗？`, '提示', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
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
.announcements-container { width: 100%; max-width: 100%; }
.page-header { margin-bottom: 30px; }
.page-title { font-size: 28px; color: #333; margin-bottom: 10px; }
.page-subtitle { color: #666; font-size: 16px; }
.content-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 20px; }
.toolbar { margin-bottom: 20px; }

.field-tip {
  margin-top: 6px;
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}

.editor-container {
  display: flex;
  gap: 20px;
  min-height: 400px;
}

.editor-left {
  flex: 1;
}

.editor-right {
  flex: 1;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  overflow: hidden;
}

.preview-header {
  background: #f5f7fa;
  padding: 10px 16px;
  font-weight: 600;
  color: #606266;
  border-bottom: 1px solid #dcdfe6;
}

.preview-content {
  padding: 16px;
  overflow-y: auto;
  max-height: 450px;
  line-height: 1.6;
}

.preview-content :deep(h1),
.preview-content :deep(h2),
.preview-content :deep(h3),
.preview-content :deep(h4),
.preview-content :deep(h5),
.preview-content :deep(h6) {
  margin-top: 16px;
  margin-bottom: 8px;
  color: #333;
}

.preview-content :deep(h1) { font-size: 24px; }
.preview-content :deep(h2) { font-size: 20px; }
.preview-content :deep(h3) { font-size: 18px; }

.preview-content :deep(p) {
  margin-bottom: 12px;
}

.preview-content :deep(ul),
.preview-content :deep(ol) {
  padding-left: 24px;
  margin-bottom: 12px;
}

.preview-content :deep(li) {
  margin-bottom: 4px;
}

.preview-content :deep(code) {
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 14px;
}

.preview-content :deep(pre) {
  background: #f5f5f5;
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin-bottom: 12px;
}

.preview-content :deep(pre code) {
  background: none;
  padding: 0;
}

.preview-content :deep(blockquote) {
  border-left: 4px solid #409eff;
  padding-left: 16px;
  margin: 12px 0;
  color: #999;
}

.preview-content :deep(a) {
  color: #409eff;
  text-decoration: none;
}

.preview-content :deep(a:hover) {
  text-decoration: underline;
}

.preview-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 12px;
}

.preview-content :deep(th),
.preview-content :deep(td) {
  border: 1px solid #eee;
  padding: 8px 12px;
  text-align: left;
}

.preview-content :deep(th) {
  background: #f5f5f5;
  font-weight: 600;
}
</style>

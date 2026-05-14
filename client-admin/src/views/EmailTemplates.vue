<template>
  <div class="email-templates-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>邮件模板管理</span>
          <el-button type="primary" @click="showDialog = true; resetForm()">新增模板</el-button>
        </div>
      </template>

      <el-table :data="templates" v-loading="loading">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="模板名称" />
        <el-table-column prop="subject" label="邮件主题" />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" @click="editTemplate(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 编辑弹窗 -->
    <el-dialog
      v-model="showDialog"
      :title="editingId ? '编辑模板' : '新增模板'"
      width="800px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" label-width="100px">
        <el-form-item label="模板名称">
          <el-input v-model="form.name" placeholder="输入模板名称" />
        </el-form-item>
        <el-form-item label="邮件主题">
          <el-input v-model="form.subject" placeholder="支持变量，如 {{username}}" />
        </el-form-item>
        <el-form-item label="可用变量">
          <div>
            <el-tag
              v-for="varName in availableVariables.slice(0, 4)"
              :key="varName"
              class="variable-tag"
              @click="insertVariable(varName)"
              style="cursor: pointer; margin-right: 8px; margin-bottom: 8px;"
            >
              {{ formatVariableDisplay(varName) }}
            </el-tag>
          </div>
          <div>
            <el-tag
              v-for="varName in availableVariables.slice(4)"
              :key="varName"
              class="variable-tag"
              @click="insertVariable(varName)"
              style="cursor: pointer; margin-right: 8px;"
            >
              {{ formatVariableDisplay(varName) }}
            </el-tag>
          </div>
        </el-form-item>
        <el-form-item label="邮件内容">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="15"
            placeholder="输入 HTML 邮件内容"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button @click="handlePreview">预览</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 预览弹窗 -->
    <el-dialog v-model="showPreview" title="邮件预览" width="700px">
      <div class="preview-subject">
        <strong>主题：</strong>{{ previewData.subject }}
      </div>
      <div class="preview-content" v-html="previewData.content"></div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const loading = ref(false)
const templates = ref([])
const showDialog = ref(false)
const showPreview = ref(false)
const editingId = ref(null)
const previewData = ref({ subject: '', content: '' })

const availableVariables = ['username', 'email', 'user_id', 'plan_name', 'expire_date', 'traffic_used', 'traffic_limit', 'download_url']

const formatVariableDisplay = (varName) => `{{${varName}}}`

const form = ref({
  name: '',
  subject: '',
  content: '',
  variables: []
})

const loadTemplates = async () => {
  loading.value = true
  try {
    const res = await api.admin.getEmailTemplates()
    if (res.code === 0) {
      templates.value = res.data
    }
  } catch (error) {
    console.error('加载模板失败:', error)
  } finally {
    loading.value = false
  }
}

const resetForm = () => {
  editingId.value = null
  form.value = {
    name: '',
    subject: '',
    content: '',
    variables: []
  }
}

const editTemplate = (row) => {
  editingId.value = row.id
  form.value = {
    name: row.name,
    subject: row.subject,
    content: row.content,
    variables: row.variables ? JSON.parse(row.variables) : []
  }
  showDialog.value = true
}

const insertVariable = (varName) => {
  const textarea = document.querySelector('.el-textarea__inner')
  if (textarea) {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = form.value.content
    form.value.content = text.substring(0, start) + '{{' + varName + '}}' + text.substring(end)
  }
}

const handlePreview = async () => {
  try {
    const res = await api.admin.previewEmailTemplate(editingId.value || 0, {
      content: form.value.content,
      subject: form.value.subject
    })
    if (res.code === 0) {
      previewData.value = res.data
      showPreview.value = true
    }
  } catch (error) {
    // 本地预览
    previewData.value = {
      subject: form.value.subject,
      content: form.value.content
    }
    showPreview.value = true
  }
}

const handleSave = async () => {
  if (!form.value.name || !form.value.subject || !form.value.content) {
    ElMessage.warning('请填写完整信息')
    return
  }
  try {
    let res
    if (editingId.value) {
      res = await api.admin.updateEmailTemplate(editingId.value, form.value)
    } else {
      res = await api.admin.createEmailTemplate(form.value)
    }
    if (res.code === 0) {
      ElMessage.success(editingId.value ? '模板已更新' : '模板已创建')
      showDialog.value = false
      loadTemplates()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确定删除该模板？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    const res = await api.admin.deleteEmailTemplate(row.id)
    if (res.code === 0) {
      ElMessage.success('模板已删除')
      loadTemplates()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    // 取消删除
  }
}

onMounted(() => {
  loadTemplates()
})
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.variable-tag:hover {
  opacity: 0.8;
}
.preview-subject {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #eee;
}
.preview-content {
  border: 1px solid #eee;
  padding: 16px;
  border-radius: 4px;
}
</style>

<template>
  <div class="email-sender-container">
    <el-card>
      <template #header>
        <span>发送邮件</span>
      </template>

      <el-form :model="form" label-width="120px">
        <!-- 选择模板 -->
        <el-form-item label="选择模板">
          <el-select v-model="form.template_id" placeholder="选择邮件模板" @change="handleTemplateChange">
            <el-option
              v-for="tpl in templates"
              :key="tpl.id"
              :label="tpl.name"
              :value="tpl.id"
            />
          </el-select>
        </el-form-item>

        <!-- 收件人类型 -->
        <el-form-item label="收件人">
          <el-radio-group v-model="form.target_type">
            <el-radio value="all">所有用户</el-radio>
            <el-radio value="disabled">被禁用用户</el-radio>
            <el-radio value="custom">自定义</el-radio>
          </el-radio-group>
        </el-form-item>

        <!-- 自定义收件人 -->
        <el-form-item v-if="form.target_type === 'custom'" label="搜索用户">
          <el-input
            v-model="searchKeyword"
            placeholder="输入邮箱搜索"
            @input="handleSearch"
          >
            <template #append>
              <el-button @click="handleSearch">搜索</el-button>
            </template>
          </el-input>
          <div v-if="searchResults.length > 0" class="search-results">
            <div
              v-for="user in searchResults"
              :key="user.id"
              class="search-item"
              @click="addUser(user)"
            >
              {{ user.email }}
            </div>
          </div>
          <div v-if="selectedUsers.length > 0" class="selected-users">
            <el-tag
              v-for="user in selectedUsers"
              :key="user.id"
              closable
              @close="removeUser(user)"
            >
              {{ user.email }}
            </el-tag>
          </div>
        </el-form-item>

        <!-- 邮件主题 -->
        <el-form-item label="邮件主题">
          <el-input v-model="form.subject" placeholder="邮件主题" />
        </el-form-item>

        <!-- 模板变量 -->
        <el-form-item v-if="form.template_id" label="模板变量">
          <div class="variables-info">
            <el-tag
              v-for="varName in templateVariables"
              :key="varName"
              type="info"
              style="margin-right: 8px; margin-bottom: 8px;"
            >
              {{ formatVariableDisplay(varName) }} - {{ getVariableLabel(varName) }}
            </el-tag>
          </div>
          <div class="variables-tip">
            提示：用户信息变量会自动填充，无需手动设置
          </div>
        </el-form-item>

        <!-- 邮件内容 -->
        <el-form-item label="邮件内容">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="15"
            placeholder="HTML 邮件内容"
          />
        </el-form-item>

        <!-- 操作按钮 -->
        <el-form-item>
          <el-button @click="handlePreview">预览邮件</el-button>
          <el-button type="primary" @click="handleSend" :loading="sending">
            {{ form.target_type === 'custom' ? '发送' : '创建群发任务' }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

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
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import api from '@/api'

const router = useRouter()
const loading = ref(false)
const sending = ref(false)
const templates = ref([])
const showPreview = ref(false)
const previewData = ref({ subject: '', content: '' })
const searchKeyword = ref('')
const searchResults = ref([])
const selectedUsers = ref([])

const form = ref({
  template_id: null,
  target_type: 'all',
  subject: '',
  content: ''
})

const templateVariables = computed(() => {
  if (!form.value.template_id) return []
  const tpl = templates.value.find(t => t.id === form.value.template_id)
  return tpl?.variables ? JSON.parse(tpl.variables) : []
})

const variableLabels = {
  username: '用户名',
  email: '邮箱',
  user_id: '用户ID',
  plan_name: '套餐名称',
  expire_date: '到期时间',
  traffic_used: '已用流量',
  traffic_limit: '流量上限',
  download_url: '下载链接'
}

const getVariableLabel = (varName) => variableLabels[varName] || varName

const formatVariableDisplay = (varName) => `{{${varName}}}`

const loadTemplates = async () => {
  try {
    const res = await api.admin.getEmailTemplates()
    if (res.code === 0) {
      templates.value = res.data
    }
  } catch (error) {
    console.error('加载模板失败:', error)
  }
}

const handleTemplateChange = async (templateId) => {
  const tpl = templates.value.find(t => t.id === templateId)
  if (tpl) {
    form.value.subject = tpl.subject
    form.value.content = tpl.content
  }
}

const handleSearch = async () => {
  if (!searchKeyword.value) {
    searchResults.value = []
    return
  }
  try {
    const res = await api.admin.searchUsers(searchKeyword.value)
    if (res.code === 0) {
      searchResults.value = res.data.filter(
        user => !selectedUsers.value.find(u => u.id === user.id)
      )
    }
  } catch (error) {
    console.error('搜索失败:', error)
  }
}

const addUser = (user) => {
  if (!selectedUsers.value.find(u => u.id === user.id)) {
    selectedUsers.value.push(user)
  }
  searchResults.value = []
  searchKeyword.value = ''
}

const removeUser = (user) => {
  selectedUsers.value = selectedUsers.value.filter(u => u.id !== user.id)
}

const handlePreview = async () => {
  try {
    const res = await api.admin.previewEmailTemplate(form.value.template_id, {})
    if (res.code === 0) {
      previewData.value = res.data
    } else {
      previewData.value = {
        subject: form.value.subject,
        content: form.value.content
      }
    }
  } catch (error) {
    previewData.value = {
      subject: form.value.subject,
      content: form.value.content
    }
  }
  showPreview.value = true
}

const handleSend = async () => {
  if (!form.value.subject || !form.value.content) {
    ElMessage.warning('请填写邮件主题和内容')
    return
  }

  // 自定义模式：单发
  if (form.value.target_type === 'custom') {
    if (selectedUsers.value.length === 0) {
      ElMessage.warning('请选择收件人')
      return
    }
    sending.value = true
    try {
      for (const user of selectedUsers.value) {
        await api.admin.sendEmail({
          to: user.email,
          subject: form.value.subject,
          content: form.value.content,
          user_id: user.id
        })
      }
      ElMessage.success(`已发送 ${selectedUsers.value.length} 封邮件`)
      selectedUsers.value = []
    } catch (error) {
      ElMessage.error('发送失败')
    } finally {
      sending.value = false
    }
    return
  }

  // 群发模式：创建任务
  if (!form.value.template_id) {
    ElMessage.warning('请选择邮件模板')
    return
  }
  sending.value = true
  try {
    const res = await api.admin.createEmailCampaign({
      name: `群发任务 - ${new Date().toLocaleString()}`,
      template_id: form.value.template_id,
      target_type: form.value.target_type
    })
    if (res.code === 0) {
      ElMessage.success('群发任务已创建')
      router.push('/admin/email-campaigns')
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('创建失败')
  } finally {
    sending.value = false
  }
}

onMounted(() => {
  loadTemplates()
})
</script>

<style scoped>
.search-results {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  margin-top: 8px;
  max-height: 200px;
  overflow-y: auto;
}
.search-item {
  padding: 8px 12px;
  cursor: pointer;
}
.search-item:hover {
  background-color: #f5f7fa;
}
.selected-users {
  margin-top: 8px;
}
.selected-users .el-tag {
  margin-right: 8px;
  margin-bottom: 8px;
}
.variables-info {
  margin-bottom: 8px;
}
.variables-tip {
  color: #909399;
  font-size: 12px;
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

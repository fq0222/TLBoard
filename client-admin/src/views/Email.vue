<template>
  <div class="email-container">
    <div class="page-header">
      <h1 class="page-title">邮件管理</h1>
      <p class="page-subtitle">发送邮件、管理模板和群发任务</p>
    </div>

    <el-tabs v-model="activeTab" type="border-card" class="email-tabs">
      <!-- 发送邮件 Tab -->
      <el-tab-pane label="发送邮件" name="sender">
        <div class="tab-content">
          <el-form :model="senderForm" label-width="120px">
            <!-- 选择模板 -->
            <el-form-item label="选择模板">
              <el-select v-model="senderForm.template_id" placeholder="选择邮件模板" @change="handleSenderTemplateChange">
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
              <el-radio-group v-model="senderForm.target_type">
                <el-radio value="all">所有用户</el-radio>
                <el-radio value="disabled">被禁用用户</el-radio>
                <el-radio value="custom">自定义</el-radio>
              </el-radio-group>
            </el-form-item>

            <!-- 自定义收件人 -->
            <el-form-item v-if="senderForm.target_type === 'custom'" label="收件人">
              <div class="custom-recipient">
                <el-input
                  v-model="customEmail"
                  placeholder="输入邮箱地址，按回车添加"
                  @keyup.enter="addCustomEmail"
                >
                  <template #append>
                    <el-button @click="addCustomEmail">添加</el-button>
                  </template>
                </el-input>
                <div class="email-type-switch">
                  <el-radio-group v-model="emailInputType" size="small">
                    <el-radio-button value="manual">手动输入</el-radio-button>
                    <el-radio-button value="search">搜索用户</el-radio-button>
                  </el-radio-group>
                </div>
              </div>
              
              <!-- 搜索用户 -->
              <div v-if="emailInputType === 'search'" class="search-section">
                <el-input
                  v-model="searchKeyword"
                  placeholder="输入邮箱搜索系统用户"
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
              </div>
              
              <!-- 已选收件人 -->
              <div v-if="selectedRecipients.length > 0" class="selected-users">
                <el-tag
                  v-for="(recipient, index) in selectedRecipients"
                  :key="index"
                  :type="recipient.type === 'external' ? 'warning' : ''"
                  closable
                  @close="removeRecipient(index)"
                >
                  {{ recipient.email }}
                  <span v-if="recipient.type === 'external'" class="external-badge">外部</span>
                </el-tag>
              </div>
            </el-form-item>

            <!-- 邮件主题 -->
            <el-form-item label="邮件主题">
              <el-input v-model="senderForm.subject" placeholder="邮件主题" />
            </el-form-item>

            <!-- 模板变量 -->
            <el-form-item v-if="senderForm.template_id" label="模板变量">
              <div class="variables-info">
                <el-tag
                  v-for="varName in senderTemplateVariables"
                  :key="varName"
                  type="info"
                  style="margin-right: 8px; margin-bottom: 8px;"
                >
                  {{ formatVariableDisplay(varName) }}
                </el-tag>
              </div>
              <div class="variables-tip">
                提示：用户信息变量会自动填充，无需手动设置
              </div>
            </el-form-item>

            <!-- 邮件内容 -->
            <el-form-item label="邮件内容" class="content-editor">
              <el-input
                v-model="senderForm.content"
                type="textarea"
                placeholder="HTML 邮件内容"
              />
            </el-form-item>

            <!-- 操作按钮 -->
            <el-form-item>
              <el-button @click="handleSenderPreview">预览邮件</el-button>
              <el-button type="primary" @click="handleSenderSend" :loading="sending">
                {{ senderForm.target_type === 'custom' ? '发送' : '创建群发任务' }}
              </el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>

      <!-- 群发任务 Tab -->
      <el-tab-pane label="群发任务" name="campaigns">
        <div class="tab-content">
          <div class="toolbar">
            <el-button type="primary" @click="activeTab = 'sender'">新建任务</el-button>
          </div>

          <el-table :data="campaigns" v-loading="campaignsLoading">
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="name" label="任务名称" />
            <el-table-column label="目标" width="120">
              <template #default="{ row }">
                {{ getTargetLabel(row.target_type) }}
              </template>
            </el-table-column>
            <el-table-column label="进度" width="150">
              <template #default="{ row }">
                {{ (row.sent_count || 0) + (row.failed_count || 0) }}/{{ row.total_count }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="getStatusType(row.status)">{{ getStatusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="250">
              <template #default="{ row }">
                <el-button size="small" @click="viewCampaignDetail(row)">详情</el-button>
                <el-button
                  v-if="row.status === 'pending' || row.status === 'sending'"
                  size="small"
                  type="warning"
                  @click="handlePauseCampaign(row)"
                >
                  暂停
                </el-button>
                <el-button
                  v-if="row.status === 'paused'"
                  size="small"
                  type="success"
                  @click="handleResumeCampaign(row)"
                >
                  恢复
                </el-button>
                <el-button size="small" type="danger" @click="handleDeleteCampaign(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- 邮件模板 Tab -->
      <el-tab-pane label="邮件模板" name="templates">
        <div class="tab-content">
          <div class="toolbar">
            <el-button type="primary" @click="showTemplateDialog = true; resetTemplateForm()">新增模板</el-button>
          </div>

          <el-table :data="templates" v-loading="templatesLoading">
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="name" label="模板名称" />
            <el-table-column prop="subject" label="邮件主题" />
            <el-table-column label="操作" width="200">
              <template #default="{ row }">
                <el-button size="small" @click="editTemplate(row)">编辑</el-button>
                <el-button size="small" type="danger" @click="handleDeleteTemplate(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- 邮件日志 Tab -->
      <el-tab-pane label="邮件日志" name="logs">
        <div class="tab-content">
          <div class="toolbar">
            <el-button type="danger" @click="handleClearLogs">清空过期日志</el-button>
          </div>

          <el-table :data="emailLogs" v-loading="emailLogsLoading">
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="email" label="收件人" width="200" />
            <el-table-column prop="subject" label="主题" show-overflow-tooltip />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.status === 'sent' ? 'success' : 'danger'" size="small">
                  {{ row.status === 'sent' ? '成功' : '失败' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="error_message" label="错误信息" width="200" show-overflow-tooltip />
            <el-table-column label="发送时间" width="180">
              <template #default="{ row }">
                {{ formatTime(row.sent_at) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100">
              <template #default="{ row }">
                <el-button size="small" type="danger" @click="handleDeleteLog(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination">
            <el-pagination
              v-model:current-page="emailLogsPage"
              :page-size="emailLogsPageSize"
              :total="emailLogsTotal"
              layout="total, prev, pager, next"
              @current-change="handleEmailLogsPageChange"
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 预览弹窗 -->
    <el-dialog v-model="showPreview" title="邮件预览" width="700px">
      <div class="preview-subject">
        <strong>主题：</strong>{{ previewData.subject }}
      </div>
      <div class="preview-content" v-html="previewData.content"></div>
    </el-dialog>

    <!-- 任务详情弹窗 -->
    <el-dialog v-model="showCampaignDetail" title="任务详情" width="800px">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="任务名称">{{ currentCampaign.name }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="getStatusType(currentCampaign.status)">
            {{ getStatusLabel(currentCampaign.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="目标类型">{{ getTargetLabel(currentCampaign.target_type) }}</el-descriptions-item>
        <el-descriptions-item label="总数量">{{ currentCampaign.total_count }}</el-descriptions-item>
        <el-descriptions-item label="已发送">{{ currentCampaign.sent_count || 0 }}</el-descriptions-item>
        <el-descriptions-item label="失败">{{ currentCampaign.failed_count || 0 }}</el-descriptions-item>
      </el-descriptions>

      <div class="logs-section">
        <h4>发送日志</h4>
        <el-table :data="campaignLogs" v-loading="logsLoading" max-height="400">
          <el-table-column prop="email" label="邮箱" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'sent' ? 'success' : 'danger'" size="small">
                {{ row.status === 'sent' ? '成功' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="error_message" label="错误信息" />
          <el-table-column label="时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row.sent_at) }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>

    <!-- 编辑模板弹窗 -->
    <el-dialog
      v-model="showTemplateDialog"
      :title="editingTemplateId ? '编辑模板' : '新增模板'"
      width="800px"
      :close-on-click-modal="false"
    >
      <el-form :model="templateForm" label-width="100px">
        <el-form-item label="模板名称">
          <el-input v-model="templateForm.name" placeholder="输入模板名称" />
        </el-form-item>
        <el-form-item label="邮件主题">
          <el-input v-model="templateForm.subject" placeholder="支持变量，如 {{username}}" />
        </el-form-item>
        <el-form-item label="可用变量">
          <el-tag
            v-for="varName in availableVariables"
            :key="varName"
            class="variable-tag"
            @click="insertVariable(varName)"
            style="cursor: pointer; margin-right: 8px;"
          >
            {{ formatVariable(varName) }}
          </el-tag>
        </el-form-item>
        <el-form-item label="邮件内容">
          <el-input
            v-model="templateForm.content"
            type="textarea"
            :rows="15"
            placeholder="输入 HTML 邮件内容"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showTemplateDialog = false">取消</el-button>
        <el-button @click="handleTemplatePreview">预览</el-button>
        <el-button type="primary" @click="handleSaveTemplate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

// Tab 状态
const activeTab = ref('sender')

// ========== 发送邮件相关 ==========
const sending = ref(false)
const searchKeyword = ref('')
const searchResults = ref([])
const selectedUsers = ref([])
const customEmail = ref('')
const emailInputType = ref('manual')
const selectedRecipients = ref([])

const senderForm = ref({
  template_id: null,
  target_type: 'all',
  subject: '',
  content: ''
})

const senderTemplateVariables = computed(() => {
  if (!senderForm.value.template_id) return []
  const tpl = templates.value.find(t => t.id === senderForm.value.template_id)
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

const formatVariableDisplay = (varName) => {
  return `{{${varName}}} - ${variableLabels[varName] || varName}`
}

const formatVariable = (varName) => {
  return `{{${varName}}}`
}

const handleSenderTemplateChange = (templateId) => {
  const tpl = templates.value.find(t => t.id === templateId)
  if (tpl) {
    senderForm.value.subject = tpl.subject
    senderForm.value.content = tpl.content
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
  if (!selectedRecipients.value.find(r => r.id === user.id)) {
    selectedRecipients.value.push({
      id: user.id,
      email: user.email,
      type: 'internal'
    })
  }
  searchResults.value = []
  searchKeyword.value = ''
}

const removeUser = (user) => {
  selectedUsers.value = selectedUsers.value.filter(u => u.id !== user.id)
}

const addCustomEmail = () => {
  const email = customEmail.value.trim()
  if (!email) return
  
  // 简单的邮箱格式验证
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    ElMessage.warning('请输入有效的邮箱地址')
    return
  }
  
  // 检查是否已存在
  if (selectedRecipients.value.find(r => r.email === email)) {
    ElMessage.warning('该邮箱已添加')
    return
  }
  
  selectedRecipients.value.push({
    email: email,
    type: 'external'
  })
  customEmail.value = ''
}

const removeRecipient = (index) => {
  selectedRecipients.value.splice(index, 1)
}

const handleSenderPreview = () => {
  previewData.value = {
    subject: senderForm.value.subject,
    content: senderForm.value.content
  }
  showPreview.value = true
}

const handleSenderSend = async () => {
  if (!senderForm.value.subject || !senderForm.value.content) {
    ElMessage.warning('请填写邮件主题和内容')
    return
  }

  // 自定义模式：单发
  if (senderForm.value.target_type === 'custom') {
    if (selectedRecipients.value.length === 0) {
      ElMessage.warning('请添加收件人')
      return
    }
    sending.value = true
    try {
      let successCount = 0
      for (const recipient of selectedRecipients.value) {
        try {
          await api.admin.sendEmail({
            to: recipient.email,
            subject: senderForm.value.subject,
            content: senderForm.value.content,
            user_id: recipient.id || null
          })
          successCount++
        } catch (error) {
          console.error(`发送失败: ${recipient.email}`, error)
        }
      }
      ElMessage.success(`已成功发送 ${successCount} 封邮件`)
      selectedRecipients.value = []
    } catch (error) {
      ElMessage.error('发送失败')
    } finally {
      sending.value = false
    }
    return
  }

  // 群发模式：创建任务
  if (!senderForm.value.template_id) {
    ElMessage.warning('请选择邮件模板')
    return
  }

  sending.value = true
  try {
    const res = await api.admin.createEmailCampaign({
      name: `群发任务 - ${new Date().toLocaleString()}`,
      template_id: senderForm.value.template_id,
      target_type: senderForm.value.target_type
    })
    if (res.code === 0) {
      ElMessage.success('群发任务已创建')
      activeTab.value = 'campaigns'
      loadCampaigns()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('创建失败')
  } finally {
    sending.value = false
  }
}

// ========== 群发任务相关 ==========
const campaignsLoading = ref(false)
const campaigns = ref([])
const showCampaignDetail = ref(false)
const currentCampaign = ref({})
const campaignLogs = ref([])
const logsLoading = ref(false)

const targetLabels = {
  all: '所有用户',
  disabled: '禁用用户',
  custom: '自定义'
}

const statusLabels = {
  pending: '待发送',
  sending: '发送中',
  completed: '已完成',
  paused: '已暂停'
}

const statusTypes = {
  pending: 'info',
  sending: 'warning',
  completed: 'success',
  paused: 'danger'
}

const getTargetLabel = (type) => targetLabels[type] || type
const getStatusLabel = (status) => statusLabels[status] || status
const getStatusType = (status) => statusTypes[status] || 'info'

const formatTime = (timestamp) => {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleString()
}

const loadCampaigns = async () => {
  campaignsLoading.value = true
  try {
    const res = await api.admin.getEmailCampaigns()
    if (res.code === 0) {
      campaigns.value = res.data
    }
  } catch (error) {
    console.error('加载任务失败:', error)
  } finally {
    campaignsLoading.value = false
  }
}

const viewCampaignDetail = async (row) => {
  currentCampaign.value = row
  showCampaignDetail.value = true
  logsLoading.value = true
  try {
    const res = await api.admin.getEmailCampaignLogs(row.id, { limit: 100 })
    if (res.code === 0) {
      campaignLogs.value = res.data.list
    }
  } catch (error) {
    console.error('加载日志失败:', error)
  } finally {
    logsLoading.value = false
  }
}

const handlePauseCampaign = async (row) => {
  try {
    const res = await api.admin.pauseEmailCampaign(row.id)
    if (res.code === 0) {
      ElMessage.success('任务已暂停')
      loadCampaigns()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

const handleResumeCampaign = async (row) => {
  try {
    const res = await api.admin.resumeEmailCampaign(row.id)
    if (res.code === 0) {
      ElMessage.success('任务已恢复')
      loadCampaigns()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

const handleDeleteCampaign = async (row) => {
  try {
    await ElMessageBox.confirm('确定删除该任务？删除后将同时删除相关日志。', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    const res = await api.admin.deleteEmailCampaign(row.id)
    if (res.code === 0) {
      ElMessage.success('任务已删除')
      loadCampaigns()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    // 取消删除
  }
}

// ========== 邮件模板相关 ==========
const templatesLoading = ref(false)
const templates = ref([])
const showTemplateDialog = ref(false)
const showPreview = ref(false)
const previewData = ref({ subject: '', content: '' })
const editingTemplateId = ref(null)

const availableVariables = ['username', 'email', 'user_id', 'plan_name', 'expire_date', 'traffic_used', 'traffic_limit']

const templateForm = ref({
  name: '',
  subject: '',
  content: '',
  variables: []
})

const loadTemplates = async () => {
  templatesLoading.value = true
  try {
    const res = await api.admin.getEmailTemplates()
    if (res.code === 0) {
      templates.value = res.data
    }
  } catch (error) {
    console.error('加载模板失败:', error)
  } finally {
    templatesLoading.value = false
  }
}

const resetTemplateForm = () => {
  editingTemplateId.value = null
  templateForm.value = {
    name: '',
    subject: '',
    content: '',
    variables: []
  }
}

const editTemplate = (row) => {
  editingTemplateId.value = row.id
  templateForm.value = {
    name: row.name,
    subject: row.subject,
    content: row.content,
    variables: row.variables ? JSON.parse(row.variables) : []
  }
  showTemplateDialog.value = true
}

const insertVariable = (varName) => {
  const textarea = document.querySelector('.el-textarea__inner')
  if (textarea) {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = templateForm.value.content
    templateForm.value.content = text.substring(0, start) + '{{' + varName + '}}' + text.substring(end)
  }
}

const handleTemplatePreview = () => {
  previewData.value = {
    subject: templateForm.value.subject,
    content: templateForm.value.content
  }
  showPreview.value = true
}

const handleSaveTemplate = async () => {
  if (!templateForm.value.name || !templateForm.value.subject || !templateForm.value.content) {
    ElMessage.warning('请填写完整信息')
    return
  }
  try {
    let res
    if (editingTemplateId.value) {
      res = await api.admin.updateEmailTemplate(editingTemplateId.value, templateForm.value)
    } else {
      res = await api.admin.createEmailTemplate(templateForm.value)
    }
    if (res.code === 0) {
      ElMessage.success(editingTemplateId.value ? '模板已更新' : '模板已创建')
      showTemplateDialog.value = false
      loadTemplates()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('保存失败')
  }
}

const handleDeleteTemplate = async (row) => {
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

// ========== 邮件日志相关 ==========
const emailLogsLoading = ref(false)
const emailLogs = ref([])
const emailLogsPage = ref(1)
const emailLogsPageSize = 10
const emailLogsTotal = ref(0)

const handleEmailLogsPageChange = (page) => {
  emailLogsPage.value = page
  loadEmailLogs()
}

const loadEmailLogs = async () => {
  emailLogsLoading.value = true
  try {
    const res = await api.admin.getEmailLogs({
      page: emailLogsPage.value,
      limit: emailLogsPageSize
    })
    if (res.code === 0) {
      emailLogs.value = res.data.list
      emailLogsTotal.value = Number(res.data.total) || 0
    }
  } catch (error) {
    console.error('加载邮件日志失败:', error)
  } finally {
    emailLogsLoading.value = false
  }
}

const handleDeleteLog = async (row) => {
  try {
    await ElMessageBox.confirm('确定删除该日志？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    const res = await api.admin.deleteEmailLog(row.id)
    if (res.code === 0) {
      ElMessage.success('日志已删除')
      loadEmailLogs()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    // 取消删除
  }
}

const handleClearLogs = async () => {
  try {
    await ElMessageBox.confirm('确定清空 30 天前的邮件日志？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    const res = await api.admin.clearEmailLogs(30)
    if (res.code === 0) {
      ElMessage.success('日志已清空')
      loadEmailLogs()
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    // 取消
  }
}

// 初始化
onMounted(() => {
  loadTemplates()
  loadCampaigns()
  loadEmailLogs()
})
</script>

<style scoped>
.email-container {
  max-width: 1200px;
}

.page-header {
  margin-bottom: 20px;
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

.email-tabs {
  min-height: 900px;
}

.tab-content {
  padding: 20px 0;
  min-height: 700px;
}

.toolbar {
  margin-bottom: 20px;
}

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

.custom-recipient {
  width: 100%;
}

.email-type-switch {
  margin-top: 8px;
  margin-bottom: 8px;
}

.search-section {
  margin-top: 8px;
}

.selected-users {
  margin-top: 8px;
}

.selected-users .el-tag {
  margin-right: 8px;
  margin-bottom: 8px;
}

.external-badge {
  font-size: 10px;
  margin-left: 4px;
  opacity: 0.7;
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

.logs-section {
  margin-top: 20px;
}

.logs-section h4 {
  margin-bottom: 12px;
}

.variable-tag:hover {
  opacity: 0.8;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.content-editor {
  flex: 1;
}

.content-editor :deep(.el-textarea) {
  height: 100%;
}

.content-editor :deep(.el-textarea__inner) {
  height: 400px;
  resize: none;
}
</style>

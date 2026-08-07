<template>
  <div class="settings-container">
    <div class="page-header">
      <h1 class="page-title">系统设置</h1>
      <p class="page-subtitle">管理系统设置、管理员账号和推广奖励系数</p>
    </div>

    <el-tabs v-model="activeTab" class="settings-tabs">
      <el-tab-pane label="修改密码" name="password">
        <div class="content-card">
          <el-form
            ref="passwordFormRef"
            :model="passwordForm"
            :rules="passwordRules"
            label-width="100px"
            style="max-width: 500px;"
          >
            <el-form-item label="原密码" prop="old_password">
              <el-input
                v-model="passwordForm.old_password"
                type="password"
                show-password
                placeholder="请输入原密码"
              />
            </el-form-item>
            <el-form-item label="新密码" prop="new_password">
              <el-input
                v-model="passwordForm.new_password"
                type="password"
                show-password
                placeholder="请输入新密码"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="submitting" @click="handleChangePassword">
                修改密码
              </el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>

      <el-tab-pane label="管理员管理" name="admins">
        <div class="content-card">
          <div class="toolbar">
            <el-button type="primary" @click="showAddAdminDialog">
              <el-icon><Plus /></el-icon>
              添加管理员
            </el-button>
          </div>

          <el-table :data="admins" style="width: 100%">
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="username" label="用户名" />
            <el-table-column prop="is_super" label="角色" width="140">
              <template #default="{ row }">
                <el-tag :type="row.is_super ? 'danger' : 'info'">
                  {{ row.is_super ? '超级管理员' : '普通管理员' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="创建时间">
              <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-button
                  size="small"
                  type="danger"
                  :disabled="!!row.is_super"
                  @click="deleteAdmin(row)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane label="邮件配置" name="email">
        <div class="content-card">
          <h2 class="card-title">Brevo 邮件配置</h2>
          <el-form :model="emailForm" label-width="120px" style="max-width: 640px;">
            <el-form-item label="API Key">
              <el-input v-model="emailForm.api_key" type="password" show-password placeholder="输入 Brevo API Key" />
            </el-form-item>
            <el-form-item label="发件人邮箱">
              <el-input v-model="emailForm.sender_email" placeholder="noreply@example.com" />
            </el-form-item>
            <el-form-item label="发件人名称">
              <el-input v-model="emailForm.sender_name" placeholder="机场面板" />
            </el-form-item>
            <el-form-item label="每日发送配额">
              <el-input-number v-model="emailForm.daily_limit" :min="1" :max="300" />
              <span class="form-hint">封 / 天，所有邮件发送的总上限</span>
            </el-form-item>
            <el-form-item label="每日群发配额">
              <el-input-number v-model="emailForm.campaign_daily_limit" :min="1" :max="300" />
              <span class="form-hint">封 / 天，群发任务专用配额</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="emailSaving" @click="saveEmailConfig">保存配置</el-button>
              <el-button @click="showTestDialog = true">发送测试邮件</el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>

      <el-tab-pane label="资源管理" name="resource">
        <div class="content-card">
          <h2 class="card-title">资源管理配置</h2>
          <el-form :model="resourceForm" label-width="140px" style="max-width: 640px;">
            <el-form-item label="最大文件大小">
              <el-input-number v-model="resourceForm.max_file_size" :min="1" :max="1024" />
              <span class="form-hint">MB，单个文件最大允许上传大小</span>
            </el-form-item>
            <el-form-item label="总下载速度限制">
              <el-input-number v-model="resourceForm.download_speed_limit" :min="0" />
              <span class="form-hint">KB/s，0 表示不限速</span>
            </el-form-item>
            <el-form-item label="博客视频限速">
              <el-input-number v-model="resourceForm.blog_video_speed_limit" :min="0" />
              <span class="form-hint">KB/s，所有博客视频播放/下载共享，0 表示不限速</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="resourceSaving" @click="saveResourceConfig">保存配置</el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>

      <el-tab-pane label="流量配置" name="traffic">
        <div class="content-card">
          <h2 class="card-title">流量与推广奖励配置</h2>
          <el-form :model="trafficForm" label-width="160px" style="max-width: 720px;">
            <el-form-item label="流量统计倍率">
              <el-input-number
                v-model="trafficForm.traffic_usage_multiplier"
                :min="0"
                :max="100"
                :step="0.1"
                :precision="2"
              />
              <span class="form-hint">默认 1.0，仅影响后续新增流量统计</span>
            </el-form-item>
            <el-form-item label="推广奖励系数">
              <el-input-number
                v-model="trafficForm.referral_reward_coefficient"
                :min="0"
                :max="1"
                :step="0.01"
                :precision="4"
              />
              <div class="form-block-hint">
                被推广者首单支付完成后，按实付金额乘以该系数发放余额；0.1 表示 10%。
              </div>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="trafficSaving" @click="saveTrafficConfig">保存配置</el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>

      <el-tab-pane label="订阅配置" name="subscription">
        <div class="content-card">
          <h2 class="card-title">订阅响应配置</h2>
          <el-form :model="subscriptionForm" label-width="160px" style="max-width: 640px;">
            <el-form-item label="Clash 订阅名称">
              <el-input
                v-model="subscriptionForm.clash_config_name"
                maxlength="100"
                show-word-limit
                placeholder="请输入订阅配置名称"
              />
            </el-form-item>
            <el-form-item label="自动更新间隔">
              <el-input-number
                v-model="subscriptionForm.clash_profile_update_interval"
                :min="1"
                :max="168"
                :step="1"
                :precision="0"
              />
              <span class="form-hint">小时，写入 Profile-Update-Interval 响应头</span>
            </el-form-item>
            <el-form-item label="官方电报频道">
              <el-input
                v-model="subscriptionForm.telegram_channel_url"
                maxlength="255"
                placeholder="请输入 Telegram 频道链接"
              />
              <span class="form-hint">用户端首页“官方电报频道”按钮会跳转到该链接</span>
            </el-form-item>
            <el-form-item label="在线客服链接">
              <el-input
                v-model="subscriptionForm.online_customer_service_url"
                maxlength="255"
                placeholder="请输入在线客服链接"
              />
              <span class="form-hint">用户端登录页“联系我们”会在新标签页打开该链接</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="subscriptionSaving" @click="saveSubscriptionConfig">
                保存配置
              </el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>

      <el-tab-pane label="Telegram" name="telegram">
        <div class="content-card">
          <h2 class="card-title">Telegram 一期配置</h2>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="内部接口开关">
              <el-tag :type="telegramConfig.internal_api_enabled ? 'success' : 'info'">
                {{ telegramConfig.internal_api_enabled ? '已启用' : '未启用' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="内部接口密钥">
              <el-tag :type="telegramConfig.has_internal_api_secret ? 'success' : 'warning'">
                {{ telegramConfig.has_internal_api_secret ? '已配置' : '未配置' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="路径前缀">
              <code>{{ telegramConfig.internal_api_path_prefix || '/api/internal/telegram' }}</code>
            </el-descriptions-item>
            <el-descriptions-item label="允许时间偏移">
              {{ telegramConfig.internal_api_allowed_skew_seconds || 300 }} 秒
            </el-descriptions-item>
          </el-descriptions>
          <div class="form-block-hint">
            一期只开放签名鉴权的内部 API，真实密钥仍通过 `server/config.js` 或 PM2 环境变量维护，不在页面中展示明文。
          </div>
        </div>

        <div class="content-card">
          <h2 class="card-title">生成管理员绑定码</h2>
          <el-form :model="telegramBindForm" label-width="140px" style="max-width: 640px;">
            <el-form-item label="目标管理员">
              <el-select v-model="telegramBindForm.admin_id" placeholder="请选择管理员" style="width: 100%;">
                <el-option
                  v-for="item in admins"
                  :key="item.id"
                  :label="item.username"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="有效期（秒）">
              <el-input-number
                v-model="telegramBindForm.expires_in_seconds"
                :min="60"
                :max="86400"
                :step="60"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="telegramBindCreating" @click="handleCreateTelegramBindCode">
                生成绑定码
              </el-button>
            </el-form-item>
          </el-form>

          <el-alert
            v-if="telegramBindResult.bind_code"
            title="最新绑定码"
            type="success"
            :closable="false"
            show-icon
          >
            <template #default>
              <div class="telegram-bind-code">
                <div><strong>绑定码：</strong><code>{{ telegramBindResult.bind_code }}</code></div>
                <div><strong>目标管理员：</strong>{{ telegramBindResult.username }}</div>
                <div><strong>过期时间：</strong>{{ formatTime(telegramBindResult.expires_at) }}</div>
              </div>
            </template>
          </el-alert>
        </div>

        <div class="content-card">
          <h2 class="card-title">已绑定管理员</h2>
          <el-table :data="telegramBindings" style="width: 100%">
            <el-table-column prop="username" label="管理员" min-width="140" />
            <el-table-column prop="chat_id" label="Chat ID" min-width="150" />
            <el-table-column prop="telegram_username" label="Telegram 用户名" min-width="160">
              <template #default="{ row }">
                {{ row.telegram_username || '-' }}
              </template>
            </el-table-column>
            <el-table-column prop="updated_at" label="最近更新时间" min-width="180">
              <template #default="{ row }">
                {{ formatTime(row.updated_at) }}
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

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
        <el-button type="primary" :loading="submitting" @click="handleAddAdmin">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showTestDialog" title="发送测试邮件" width="400px">
      <el-form>
        <el-form-item label="测试邮箱">
          <el-input v-model="testEmail" placeholder="输入接收测试的邮箱" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showTestDialog = false">取消</el-button>
        <el-button type="primary" :loading="testSending" @click="handleSendTest">发送</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus/es/components/message/index.mjs'
import { ElMessageBox } from 'element-plus/es/components/message-box/index.mjs'
import { useAdminStore } from '@/stores/admin'
import api from '@/api'

const adminStore = useAdminStore()

const activeTab = ref('password')
const admins = ref([])
const submitting = ref(false)
const adminDialogVisible = ref(false)
const passwordFormRef = ref(null)

const emailForm = ref({
  api_key: '',
  sender_email: '',
  sender_name: '',
  daily_limit: 200,
  campaign_daily_limit: 100
})
const showTestDialog = ref(false)
const testEmail = ref('')
const emailSaving = ref(false)
const testSending = ref(false)

const resourceForm = ref({
  max_file_size: 100,
  download_speed_limit: 0,
  blog_video_speed_limit: 300
})
const resourceSaving = ref(false)

const trafficForm = reactive({
  traffic_usage_multiplier: 1,
  referral_reward_coefficient: 0.1
})
const trafficSaving = ref(false)

const subscriptionForm = ref({
  clash_config_name: '天涯大陆',
  clash_profile_update_interval: 2,
  telegram_channel_url: '',
  online_customer_service_url: ''
})
const DEFAULT_SUBSCRIPTION_CONFIG = {
  clash_config_name: '天涯大陆',
  clash_profile_update_interval: 2,
  telegram_channel_url: '',
  online_customer_service_url: ''
}
const subscriptionSaving = ref(false)
const telegramConfig = ref({
  internal_api_enabled: false,
  has_internal_api_secret: false,
  internal_api_allowed_skew_seconds: 300,
  internal_api_path_prefix: '/api/internal/telegram'
})
const telegramBindings = ref([])
const telegramBindCreating = ref(false)
const telegramBindForm = reactive({
  admin_id: null,
  expires_in_seconds: 900
})
const telegramBindResult = reactive({
  bind_code: '',
  username: '',
  expires_at: 0
})

const passwordForm = reactive({
  old_password: '',
  new_password: ''
})

const passwordRules = {
  old_password: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  new_password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码长度至少 8 位', trigger: 'blur' }
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
      if (!telegramBindForm.admin_id && admins.value.length > 0) {
        telegramBindForm.admin_id = admins.value[0].id
      }
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
    await ElMessageBox.confirm(`确定要删除管理员“${admin.username}”吗？`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    const response = await api.admin.deleteAdmin(admin.id)
    if (response.code === 0) {
      ElMessage.success('删除成功')
      fetchAdmins()
    }
  } catch {
    // 用户取消删除时不提示错误。
  }
}

function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Date(Number(timestamp) * 1000).toLocaleString('zh-CN')
}

async function loadEmailConfig() {
  try {
    const res = await api.admin.getEmailConfig()
    if (res.code === 0) {
      emailForm.value = res.data
    }
  } catch (error) {
    console.error('加载邮件配置失败:', error)
  }
}

async function saveEmailConfig() {
  try {
    emailSaving.value = true
    const res = await api.admin.updateEmailConfig(emailForm.value)
    if (res.code === 0) {
      ElMessage.success('配置已保存')
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('保存失败')
  } finally {
    emailSaving.value = false
  }
}

async function handleSendTest() {
  if (!testEmail.value) {
    ElMessage.warning('请输入测试邮箱')
    return
  }

  try {
    testSending.value = true
    const res = await api.admin.sendTestEmail({ email: testEmail.value })
    if (res.code === 0) {
      ElMessage.success('测试邮件已发送')
      showTestDialog.value = false
      testEmail.value = ''
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('发送失败')
  } finally {
    testSending.value = false
  }
}

async function loadResourceConfig() {
  try {
    const res = await api.admin.getResourceConfig()
    if (res.code === 0) {
      resourceForm.value = res.data
    }
  } catch (error) {
    console.error('加载资源配置失败:', error)
  }
}

async function saveResourceConfig() {
  try {
    resourceSaving.value = true
    const res = await api.admin.saveResourceConfig(resourceForm.value)
    if (res.code === 0) {
      ElMessage.success('资源配置已保存')
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('保存失败')
  } finally {
    resourceSaving.value = false
  }
}

async function loadTrafficConfig() {
  try {
    const res = await api.admin.getTrafficConfig()
    if (res.code === 0) {
      trafficForm.traffic_usage_multiplier = Number(res.data.traffic_usage_multiplier || 1)
      trafficForm.referral_reward_coefficient = Number(res.data.referral_reward_coefficient ?? 0.1)
    }
  } catch (error) {
    console.error('加载流量配置失败:', error)
  }
}

async function saveTrafficConfig() {
  try {
    trafficSaving.value = true
    const res = await api.admin.saveTrafficConfig({
      traffic_usage_multiplier: trafficForm.traffic_usage_multiplier,
      referral_reward_coefficient: trafficForm.referral_reward_coefficient
    })
    if (res.code === 0) {
      trafficForm.referral_reward_coefficient = Number(res.data.referral_reward_coefficient ?? trafficForm.referral_reward_coefficient)
      ElMessage.success('流量配置已保存')
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('保存失败')
  } finally {
    trafficSaving.value = false
  }
}

async function loadSubscriptionConfig() {
  try {
    const res = await api.admin.getSubscriptionConfig()
    if (res.code === 0) {
      subscriptionForm.value = normalizeSubscriptionConfig(res.data)
    }
  } catch (error) {
    console.error('加载订阅配置失败:', error)
  }
}

/**
 * 归一化订阅配置，兼容后端旧响应缺少新增字段的情况。
 *
 * @param {Object} config - 后端返回或本地合并后的订阅配置
 * @returns {Object} 可直接绑定到表单的订阅配置
 */
function normalizeSubscriptionConfig(config = {}) {
  return {
    ...DEFAULT_SUBSCRIPTION_CONFIG,
    ...config,
    telegram_channel_url: String(config.telegram_channel_url || '').trim(),
    online_customer_service_url: String(config.online_customer_service_url || '').trim()
  }
}

async function saveSubscriptionConfig() {
  if (!subscriptionForm.value.clash_config_name.trim()) {
    ElMessage.warning('请输入 Clash 订阅名称')
    return
  }

  const telegramChannelUrl = String(subscriptionForm.value.telegram_channel_url || '').trim()
  if (telegramChannelUrl && !/^https?:\/\/\S+$/i.test(telegramChannelUrl)) {
    ElMessage.warning('请输入有效的官方电报频道链接')
    return
  }

  const onlineCustomerServiceUrl = String(subscriptionForm.value.online_customer_service_url || '').trim()
  if (onlineCustomerServiceUrl && !/^https?:\/\/\S+$/i.test(onlineCustomerServiceUrl)) {
    ElMessage.warning('请输入有效的在线客服链接')
    return
  }

  try {
    subscriptionSaving.value = true
    const payload = {
      clash_config_name: subscriptionForm.value.clash_config_name.trim(),
      clash_profile_update_interval: subscriptionForm.value.clash_profile_update_interval,
      telegram_channel_url: telegramChannelUrl,
      online_customer_service_url: onlineCustomerServiceUrl
    }
    const res = await api.admin.saveSubscriptionConfig(payload)
    if (res.code === 0) {
      if (
        !Object.prototype.hasOwnProperty.call(res.data || {}, 'telegram_channel_url') ||
        !Object.prototype.hasOwnProperty.call(res.data || {}, 'online_customer_service_url')
      ) {
        ElMessage.warning('后端未返回新增链接配置，请重启后端服务后重新保存')
        subscriptionForm.value = normalizeSubscriptionConfig({
          ...(res.data || {})
        })
        return
      }

      subscriptionForm.value = normalizeSubscriptionConfig(res.data)
      ElMessage.success('订阅配置已保存')
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('保存失败')
  } finally {
    subscriptionSaving.value = false
  }
}

async function loadTelegramConfig() {
  try {
    const res = await api.admin.getTelegramConfig()
    if (res.code === 0) {
      telegramConfig.value = res.data
    }
  } catch (error) {
    console.error('加载 Telegram 配置失败:', error)
  }
}

async function loadTelegramBindings() {
  try {
    const res = await api.admin.getTelegramAdminBindings()
    if (res.code === 0) {
      telegramBindings.value = res.data.list || []
    }
  } catch (error) {
    console.error('加载 Telegram 绑定列表失败:', error)
  }
}

async function handleCreateTelegramBindCode() {
  if (!telegramBindForm.admin_id) {
    ElMessage.warning('请选择要绑定的管理员')
    return
  }

  try {
    telegramBindCreating.value = true
    const res = await api.admin.createTelegramAdminBindCode({
      admin_id: telegramBindForm.admin_id,
      expires_in_seconds: telegramBindForm.expires_in_seconds
    })
    if (res.code === 0) {
      telegramBindResult.bind_code = res.data.bind_code
      telegramBindResult.username = res.data.username
      telegramBindResult.expires_at = res.data.expires_at
      loadTelegramBindings()
      ElMessage.success('管理员绑定码已生成')
    } else {
      ElMessage.error(res.message)
    }
  } catch (error) {
    ElMessage.error('生成绑定码失败')
  } finally {
    telegramBindCreating.value = false
  }
}

onMounted(() => {
  fetchAdmins()
  loadEmailConfig()
  loadResourceConfig()
  loadTrafficConfig()
  loadSubscriptionConfig()
  loadTelegramConfig()
  loadTelegramBindings()
})
</script>

<style scoped>
.settings-container {
  width: 100%;
  max-width: 100%;
}

.page-header {
  margin-bottom: 30px;
}

.page-title {
  margin-bottom: 10px;
  color: #333;
  font-size: 28px;
}

.page-subtitle {
  color: #666;
  font-size: 16px;
}

.content-card {
  margin-bottom: 20px;
  padding: 30px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.card-title {
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
  color: #333;
  font-size: 20px;
}

.toolbar {
  margin-bottom: 20px;
}

.form-hint {
  margin-left: 10px;
  color: #666;
}

.form-block-hint {
  margin-top: 8px;
  color: #666;
  font-size: 12px;
  line-height: 1.6;
}

.traffic-input-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.telegram-bind-code {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
</style>

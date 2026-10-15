<template>
  <div class="passkeys-admin" :aria-busy="busy">
    <div class="page-header">
      <h1 class="page-title">Passkey 管理</h1>
      <p class="page-subtitle">查看和撤销用户的 Passkey 密钥</p>
    </div>

    <section class="content-card" aria-label="用户 Passkey 列表">
      <form class="passkey-search-form" role="search" @submit.prevent="search">
        <el-input
          v-model="keyword"
          class="passkey-search"
          placeholder="搜索用户邮箱或密钥名称"
          aria-label="搜索用户邮箱或密钥名称"
          :prefix-icon="Search"
          :disabled="busy"
          clearable
        />
        <el-button type="primary" native-type="submit" :disabled="busy" :loading="loading">搜索</el-button>
      </form>

      <div v-if="loadFailed" class="load-status" role="status">
        列表加载失败，请重试。
        <el-button class="passkey-retry" link type="primary" :disabled="busy" @click="loadPasskeys">重试</el-button>
      </div>
      <p v-if="loading" class="load-status" role="status">正在加载 Passkey…</p>

      <el-table :data="users" row-key="user_id" class="passkey-table" empty-text="暂无 Passkey 用户">
        <el-table-column label="用户邮箱" min-width="230">
          <template #default="{ row }">
            <div class="passkey-user">
              <span class="user-email">{{ row.email }}</span>
              <el-tag size="small" round>{{ row.passkey_count }} / {{ row.passkey_limit }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column min-width="660">
          <template #header>
            <div class="passkey-columns">
              <span>Passkey 密钥</span><span>创建时间</span><span>上次使用时间</span><span>操作</span>
            </div>
          </template>
          <template #default="{ row }">
            <div v-if="!row.passkeys.length" class="empty-keys">尚未添加 Passkey</div>
            <div v-for="key in row.passkeys" :key="key.id" class="passkey-record">
              <span class="key-name">{{ key.name }}</span>
              <div class="key-time"><span class="field-label">创建时间</span><time>{{ formatTime(key.created_at) }}</time></div>
              <div class="key-time"><span class="field-label">上次使用</span><time>{{ formatTime(key.last_used_at, '尚未使用') }}</time></div>
              <el-button
                class="passkey-revoke"
                type="danger"
                plain
                size="small"
                :aria-label="`撤销 ${row.email} 的 ${key.name}`"
                :disabled="busy"
                :loading="revokingId === key.id"
                @click="revokePasskey(row, key)"
              >撤销</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <span class="user-total" aria-live="polite">共 {{ total }} 位用户</span>
        <el-pagination
          :current-page="page"
          :page-size="limit"
          :total="total"
          :disabled="busy"
          layout="prev, pager, next"
          @current-change="changePage"
        />
      </div>
    </section>
  </div>
</template>

<script setup>
/** 管理端 Passkey 分组页：以用户分页，在同一行展示全部密钥及各自的撤销入口。 */
import { computed, onMounted, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus/es/components/message/index.mjs'
import { ElMessageBox } from 'element-plus/es/components/message-box/index.mjs'
import api from '@/api'

const users = ref([])
const total = ref(0)
const page = ref(1)
const limit = 15
const keyword = ref('')
const appliedKeyword = ref('')
const loading = ref(false)
const loadFailed = ref(false)
const revokingId = ref(null)
const busy = computed(() => loading.value || revokingId.value !== null)
const timeFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
})

/** 将 timestamp 秒级时间戳格式化为上海时间；空值和非法值使用 emptyText。 */
function formatTime(timestamp, emptyText = '—') {
  if (timestamp === null || timestamp === undefined || timestamp === '') return emptyText
  const date = new Date(Number(timestamp) * 1000)
  return Number.isFinite(date.getTime()) ? timeFormatter.format(date) : emptyText
}

/** 校验后端响应信封；非零业务码交由页面统一提示，不访问错误响应中的 data。 */
function responseData(response) {
  if (response.code !== 0) throw new Error(response.message || '操作失败，请稍后重试')
  return response.data
}

/** 只显示一次错误；error 可为 HTTP、网络或业务异常，不记录或输出任何凭据材料。 */
function showError(error, fallback) {
  if (error.response?.status === 401) return
  ElMessage.error(error.response?.data?.message || (error.response || error.request ? fallback : error.message) || fallback)
}

/**
 * 加载已提交的搜索条件与当前页；失败保留旧列表并允许重试。
 * 删除或其他管理员撤销导致页码失效时，最多补查一次有效页。
 */
async function loadPasskeys() {
  if (loading.value) return
  loading.value = true
  loadFailed.value = false
  try {
    let data = responseData(await api.admin.getPasskeys({ page: page.value, limit, keyword: appliedKeyword.value }))
    const lastPage = Math.max(1, Math.ceil(Number(data.total) / limit))
    if (page.value > lastPage) {
      page.value = lastPage
      data = responseData(await api.admin.getPasskeys({ page: page.value, limit, keyword: appliedKeyword.value }))
    }
    users.value = data.list
    total.value = Number(data.total)
  } catch (error) {
    loadFailed.value = true
    showError(error, '获取 Passkey 列表失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

/** 提交修剪后的关键词并回到第一页；确认与请求期间忽略重复提交。 */
async function search() {
  if (busy.value) return
  appliedKeyword.value = keyword.value.trim()
  page.value = 1
  await loadPasskeys()
}

/** 切换到 nextPage 用户分页；保留上次已提交的关键词，避免未提交输入改变查询。 */
async function changePage(nextPage) {
  if (busy.value) return
  page.value = nextPage
  await loadPasskeys()
}

/**
 * 撤销 user 的单个 key；确认前即锁定所有操作，取消时无提示且不发送请求。
 * 成功后刷新分组与配额，末页最后一位用户消失时退回前页。
 */
async function revokePasskey(user, key) {
  if (busy.value) return
  revokingId.value = key.id
  try {
    await ElMessageBox.confirm(
      `确定撤销用户 ${user.email} 的“${key.name}”吗？仅撤销该登录密钥，它将不能再用于登录，其他密钥和密码登录不受影响。`,
      '撤销 Passkey',
      { confirmButtonText: '确定撤销', cancelButtonText: '取消', type: 'warning' }
    )
    responseData(await api.admin.revokePasskey(key.id))
    ElMessage.success('Passkey 已撤销')
    if (users.value.length === 1 && user.passkeys.length === 1 && page.value > 1) page.value -= 1
    await loadPasskeys()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') showError(error, '撤销 Passkey 失败，请稍后重试')
  } finally {
    revokingId.value = null
  }
}

onMounted(loadPasskeys)
</script>

<style scoped>
.passkeys-admin { width: 100%; min-width: 0; }
.page-header { margin-bottom: 20px; }
.page-title { margin: 0 0 8px; font-size: 28px; color: #303133; }
.page-subtitle { margin: 0; color: #606266; font-size: 15px; }
.content-card { padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
.passkey-search-form { display: flex; gap: 12px; margin-bottom: 20px; }
.passkey-search { max-width: 390px; min-width: 0; }
.load-status { margin: 0 0 12px; color: #606266; }
.passkey-user { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 14px 0; }
.user-email, .key-name { overflow-wrap: anywhere; }
.passkey-columns, .passkey-record { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr) 80px; align-items: center; gap: 16px; }
.passkey-record { min-height: 76px; padding: 14px 0; }
.passkey-record + .passkey-record { border-top: 1px solid #ebeef5; }
.key-time { min-width: 0; }
.key-time time { overflow-wrap: anywhere; }
.field-label { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.passkey-revoke { justify-self: start; }
.empty-keys { padding: 18px 0; color: #909399; }
.pagination { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 16px; margin-top: 20px; }
.user-total { color: #606266; }
.passkey-table :deep(.el-table__cell) { padding: 0 12px; }
.passkey-table :deep(th.el-table__cell) { padding: 14px 12px; background: #f5f7fa; }
.passkey-table :deep(.cell) { padding: 0; }

@media (max-width: 767px) {
  .page-title { font-size: 22px; }
  .page-subtitle { font-size: 13px; }
  .content-card { padding: 12px; }
  .passkey-search-form { gap: 8px; }
  .passkey-table :deep(.el-table__header-wrapper), .passkey-table :deep(colgroup) { display: none; }
  .passkey-table :deep(.el-table__body) { width: 100% !important; }
  .passkey-table :deep(.el-table__body tr) { display: block; padding: 0 0 12px; border-bottom: 1px solid #dcdfe6; }
  .passkey-table :deep(.el-table__body td) { display: block; width: auto; padding: 0; border: 0; }
  .passkey-table :deep(.el-table__inner-wrapper::before) { display: none; }
  .passkey-user { padding: 16px 0 10px; }
  .passkey-record { grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 14px 0; }
  .key-name { font-weight: 600; }
  .key-time { display: flex; flex-wrap: wrap; gap: 6px 16px; }
  .field-label { position: static; width: auto; height: auto; overflow: visible; clip-path: none; white-space: normal; color: #606266; }
  .pagination { justify-content: center; gap: 8px; }
  .pagination :deep(.el-pager li) { min-width: 24px; }
}
</style>

<!-- 登录与安全卡片：独立管理当前用户的 Passkey 列表、密码复验和系统认证窗口。 -->
<template>
  <section class="passkey-section" aria-labelledby="passkey-section-title">
    <h2 id="passkey-section-title" class="passkey-section-title">登录与安全</h2>
    <div class="passkey-card" v-loading="listLoading">
      <header class="passkey-header">
        <div class="passkey-heading">
          <h3>Passkey 密钥</h3>
          <p>使用指纹、面容或设备 PIN 安全登录，无需输入密码。</p>
        </div>
        <div class="passkey-header-actions">
          <span class="passkey-count">已添加 {{ passkeys.length }} / 2</span>
          <el-button
            class="passkey-add-button"
            type="primary"
            :disabled="busy || !!listError || passkeys.length >= 2"
            @click="openAdd"
          >
            <el-icon><Plus /></el-icon>
            添加 Passkey
          </el-button>
        </div>
      </header>

      <div v-if="listError" class="passkey-load-error" role="status">
        <span>密钥列表暂时不可用，请重新加载后操作。</span>
        <el-button class="passkey-retry-button" :disabled="busy" @click="loadPasskeys">重新加载</el-button>
      </div>
      <template v-else>
        <div class="passkey-list-header" aria-hidden="true">
          <span>名称</span><span>创建时间</span><span>上次使用</span><span class="passkey-action-label">操作</span>
        </div>
        <div v-if="!passkeys.length && !listLoading" class="passkey-empty">
          <el-icon><Key /></el-icon>
          <p>尚未添加 Passkey</p>
          <span>添加后，可使用设备验证快速登录。</span>
        </div>
        <ul v-else class="passkey-list" aria-label="已添加的 Passkey 密钥">
          <li v-for="passkey in passkeys" :key="passkey.id" class="passkey-row">
            <div class="passkey-name">
              <el-icon class="passkey-key-icon"><Key /></el-icon>
              <span>{{ passkey.name }}</span>
            </div>
            <dl class="passkey-times">
              <div><dt>创建时间</dt><dd>{{ formatTimestamp(passkey.created_at) }}</dd></div>
              <div><dt>上次使用</dt><dd>{{ passkey.last_used_at == null ? '尚未使用' : formatTimestamp(passkey.last_used_at) }}</dd></div>
            </dl>
            <el-button
              class="passkey-delete-button"
              type="danger"
              link
              :disabled="busy"
              :aria-label="`删除 ${passkey.name}`"
              @click="openDelete(passkey)"
            >
              <el-icon><Delete /></el-icon>
              删除
            </el-button>
          </li>
        </ul>
      </template>
    </div>

    <el-dialog
      v-model="addVisible"
      class="passkey-add-dialog"
      title="添加 Passkey"
      width="min(440px, 92vw)"
      :close-on-click-modal="false"
      :close-on-press-escape="!busy"
      :show-close="!busy"
      @closed="clearAddForm"
    >
      <p class="passkey-dialog-description">先验证当前密码，再按照系统提示添加密钥。</p>
      <el-form label-position="top" @submit.prevent="addPasskey">
        <el-form-item label="密钥名称（可选）">
          <el-input v-model="addName" maxlength="50" placeholder="例如：我的电脑" :disabled="busy" autocomplete="off" />
        </el-form-item>
        <el-form-item label="当前密码" :error="addPasswordError">
          <el-input v-model="addPassword" type="password" show-password autocomplete="current-password" :disabled="busy" @keyup.enter="addPasskey" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button class="passkey-add-cancel" :disabled="busy" @click="closeAdd">取消</el-button>
        <el-button class="passkey-add-confirm" type="primary" :loading="operationBusy" :disabled="busy" @click="addPasskey">继续添加</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="deleteVisible"
      class="passkey-delete-dialog"
      title="删除 Passkey"
      width="min(440px, 92vw)"
      :close-on-click-modal="false"
      :close-on-press-escape="!busy"
      :show-close="!busy"
      @closed="clearDeleteForm"
    >
      <p class="passkey-dialog-description">确定删除“{{ selectedPasskey?.name }}”？删除后将无法再使用此密钥登录，你仍可使用密码或其他密钥登录。</p>
      <el-form label-position="top" @submit.prevent="deletePasskey">
        <el-form-item label="当前密码" :error="deletePasswordError">
          <el-input v-model="deletePassword" type="password" show-password autocomplete="current-password" :disabled="busy" @keyup.enter="deletePasskey" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button class="passkey-delete-cancel" :disabled="busy" @click="closeDelete">取消</el-button>
        <el-button class="passkey-delete-confirm" type="danger" :loading="operationBusy" :disabled="busy" @click="deletePasskey">确认删除</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, Key, Plus } from '@element-plus/icons-vue'
import api from '@/api'
import { PasskeyClient } from '@/utils/passkey-client'

const passkeyClient = new PasskeyClient()
const passkeys = ref([])
const listLoading = ref(false)
const listError = ref(false)
const operationBusy = ref(false)
const busy = computed(() => listLoading.value || operationBusy.value)
const addVisible = ref(false)
const addName = ref('')
const addPassword = ref('')
const addPasswordError = ref('')
const deleteVisible = ref(false)
const selectedPasskey = ref(null)
const deletePassword = ref('')
const deletePasswordError = ref('')
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
})

/** 将后端秒级时间戳 value 格式化为上海时间；无效值保留占位而不伪造日期。 */
function formatTimestamp(value) {
  const date = new Date(Number(value) * 1000)
  if (!Number.isFinite(date.getTime())) return '-'
  return dateFormatter.format(date).replaceAll('/', '-')
}

/** 页面统一显示 error 的业务/传输错误；API 已抑制全局弹窗，避免重复提示。 */
function showError(error) {
  ElMessage.error(error.userMessage || error.message || 'Passkey 操作失败，请重试')
}

/** 拉取后端安全元数据；失败保留已有列表并禁止未知名额状态下继续绑定。 */
async function loadPasskeys() {
  if (listLoading.value) return
  listLoading.value = true
  try {
    const data = passkeyClient.unwrap(await api.user.getPasskeys())
    passkeys.value = data.list
    listError.value = false
  } catch (error) {
    listError.value = true
    showError(error)
  } finally {
    listLoading.value = false
  }
}

/** 清理添加表单的名称、密码与校验；窗口关闭后不保留复验密码。 */
function clearAddForm() {
  addName.value = ''
  addPassword.value = ''
  addPasswordError.value = ''
}

/** 仅在名额已知且不足两条时打开添加窗口。 */
function openAdd() {
  if (busy.value || listError.value || passkeys.value.length >= 2) return
  clearAddForm()
  addVisible.value = true
}

/** 空闲时取消添加并立即清理敏感输入，系统认证期间保持窗口锁定。 */
function closeAdd() {
  if (busy.value) return
  addVisible.value = false
  clearAddForm()
}

/** 先复验密码再调用认证器；成功或真实上限冲突后刷新，取消静默，所有分支释放锁并清空密码。 */
async function addPasskey() {
  if (busy.value || !addVisible.value) return
  addPasswordError.value = addPassword.value ? '' : '请输入当前密码'
  if (addPasswordError.value) return
  operationBusy.value = true
  try {
    const created = await passkeyClient.register({ name: addName.value.trim(), password: addPassword.value })
    if (!created) return
    addVisible.value = false
    ElMessage.success('Passkey 添加成功')
    await loadPasskeys()
  } catch (error) {
    showError(error)
    // 只识别后端数字 2103；并发绑定占满名额后关闭窗口并拉取真实列表，避免重复提交旧挑战。
    const businessCode = error.response?.data?.code ?? error.code
    if (businessCode === 2103) {
      addVisible.value = false
      await loadPasskeys()
    }
  } finally {
    addPassword.value = ''
    operationBusy.value = false
  }
}

/** 清理删除窗口密码、校验与目标记录，避免复用上一次选择。 */
function clearDeleteForm() {
  deletePassword.value = ''
  deletePasswordError.value = ''
  selectedPasskey.value = null
}

/** 将 passkey 记录设为唯一删除目标，先展示影响说明及密码输入。 */
function openDelete(passkey) {
  if (busy.value) return
  clearDeleteForm()
  selectedPasskey.value = passkey
  deleteVisible.value = true
}

/** 空闲时取消删除，立即移除目标与密码且不发送请求。 */
function closeDelete() {
  if (busy.value) return
  deleteVisible.value = false
  clearDeleteForm()
}

/** 复验密码后只撤销选中 ID；成功刷新列表，失败保留窗口并允许重新输入密码。 */
async function deletePasskey() {
  if (busy.value || !selectedPasskey.value || !deleteVisible.value) return
  deletePasswordError.value = deletePassword.value ? '' : '请输入当前密码'
  if (deletePasswordError.value) return
  operationBusy.value = true
  try {
    passkeyClient.unwrap(await api.user.deletePasskey(selectedPasskey.value.id, { password: deletePassword.value }))
    deleteVisible.value = false
    ElMessage.success('Passkey 已删除')
    await loadPasskeys()
  } catch (error) {
    showError(error)
  } finally {
    deletePassword.value = ''
    operationBusy.value = false
  }
}

onMounted(loadPasskeys)
</script>

<style scoped>
.passkey-section {
  container: passkey-content / inline-size;
  min-width: 0;
  padding: 16px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}
.passkey-section-title {
  margin: 0 0 14px;
  color: #1e293b;
  font-size: 18px;
  font-weight: 600;
}
.passkey-card {
  min-width: 0;
  padding: 16px;
  border: 1px solid #e7ecf3;
  border-radius: 8px;
}
.passkey-header, .passkey-header-actions, .passkey-name {
  display: flex;
  align-items: center;
}
.passkey-header {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.passkey-heading {
  min-width: 0;
}
.passkey-heading h3 {
  margin: 0;
  color: #1e293b;
  font-size: 16px;
  font-weight: 600;
}
.passkey-heading p {
  margin: 4px 0 0;
  color: #8492a6;
  font-size: 14px;
  line-height: 1.6;
}
.passkey-header-actions {
  flex-shrink: 0;
  gap: 16px;
}
.passkey-count {
  color: #8492a6;
  font-size: 14px;
  white-space: nowrap;
}
.passkey-add-button {
  height: 40px;
  padding: 0 18px;
  gap: 8px;
}
.passkey-list-header,
.passkey-row {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 2fr) 80px;
  gap: 16px;
  align-items: center;
}
.passkey-list-header {
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr) 80px;
  padding: 10px 12px;
  border-radius: 6px 6px 0 0;
  background: #f7f9fb;
  color: #8492a6;
  font-size: 14px;
}
.passkey-action-label {
  text-align: right;
}
.passkey-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.passkey-row {
  min-height: 56px;
  padding: 8px 12px;
  border-bottom: 1px solid #e7ecf3;
}
.passkey-name {
  gap: 12px;
  min-width: 0;
  color: #334155;
  font-size: 15px;
}
.passkey-name span {
  overflow-wrap: anywhere;
}
.passkey-key-icon {
  flex-shrink: 0;
  color: #8492a6;
  font-size: 24px;
}
.passkey-times {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  min-width: 0;
  margin: 0;
  color: #8492a6;
  font-size: 14px;
}
.passkey-times dt {
  /* 桌面只视觉隐藏字段名称，保留 dl/dt/dd 的读屏语义。 */
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.passkey-times dd {
  margin: 0;
}
.passkey-delete-button {
  justify-self: end;
  /* 压缩列表留白时仍保留足够的删除触控高度。 */
  min-height: 40px;
  padding: 0 8px;
  gap: 6px;
}
.passkey-empty {
  padding: 20px 12px;
  text-align: center;
  color: #8492a6;
}
.passkey-empty .el-icon {
  font-size: 28px;
}
.passkey-empty p {
  margin: 8px 0 4px;
  color: #64748b;
  font-size: 15px;
}
.passkey-empty span {
  font-size: 13px;
}
.passkey-load-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: #8492a6;
  font-size: 14px;
}
.passkey-dialog-description {
  margin: 0 0 20px;
  color: #64748b;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
/* 按内容区宽度切换，避免平板侧栏占位后把桌面列表挤出横向滚动条。 */
@container passkey-content (max-width: 680px) {
  .passkey-section-title {
    margin-bottom: 8px;
    font-size: 17px;
  }
  .passkey-card {
    padding: 10px;
  }
  .passkey-header {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    margin-bottom: 8px;
  }
  .passkey-heading h3 {
    font-size: 16px;
  }
  /* 窄屏缩减辅助文字与留白，保留标题层级及完整时间字段。 */
  .passkey-heading p {
    font-size: 12px;
    line-height: 1.4;
  }
  .passkey-count {
    font-size: 12px;
  }
  .passkey-header-actions {
    justify-content: space-between;
    gap: 6px;
  }
  .passkey-add-button {
    height: 36px;
    padding: 0 12px;
  }
  .passkey-list-header {
    display: none;
  }
  .passkey-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
    padding: 8px 0;
    border-top: 1px solid #e7ecf3;
    border-bottom: 0;
  }
  .passkey-times {
    grid-row: 2;
    grid-column: 1 / -1;
    grid-template-columns: 1fr;
    gap: 3px;
    font-size: 12px;
  }
  .passkey-times div {
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }
  .passkey-times dt {
    display: block;
    position: static;
    width: auto;
    height: auto;
    margin: 0;
    overflow: visible;
    clip-path: none;
    white-space: normal;
    flex-shrink: 0;
  }
  .passkey-times dd {
    text-align: right;
  }
  .passkey-delete-button {
    grid-row: 1;
    grid-column: 2;
    min-height: 36px;
  }
  .passkey-name {
    gap: 10px;
    font-size: 14px;
  }
  .passkey-empty {
    padding: 12px 8px;
  }
  .passkey-load-error {
    flex-direction: column;
    align-items: flex-start;
  }
}
@media (max-width: 768px) {
  .passkey-section {
    padding: 8px;
  }
}
</style>

<template>
  <el-dialog
    v-model="visible"
    class="referral-poster-dialog"
    title="推广海报"
    width="440px"
    append-to-body
  >
    <div class="referral-poster">
      <h2 class="poster-title">分享好友，余额奖励轻松拿</h2>
      <button
        class="poster-qr-wrap"
        type="button"
        aria-label="复制推广链接"
        @click="copyReferralLink"
      >
        <img
          v-if="qrCode"
          class="poster-qr-code"
          :src="qrCode"
          alt="推广注册链接二维码"
        >
        <span class="poster-qr-hint">点击二维码复制链接</span>
      </button>
      <p class="poster-features">AI 畅享 · 流媒体流畅 · 4K 高清体验</p>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import QRCode from 'qrcode'

const props = defineProps({
  referralUrl: {
    type: String,
    required: true
  }
})

const visible = ref(false)
const qrCode = ref('')
const activeReferralUrl = ref('')
const openRequestId = ref(0)

/**
 * 复制指定文本到剪贴板。
 * @param {string} text - 需要复制的文本。
 * @returns {Promise<void>} 复制成功时完成；安全上下文 API 或回退命令失败时抛出异常。
 */
async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'readonly')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    if (!document.execCommand('copy')) {
      throw new Error('execCommand copy failed')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}

/**
 * 复制当前推广链接并反馈结果。
 * @returns {Promise<void>} 操作结束后完成；复制异常会被记录并转换为用户提示。
 */
async function copyReferralLink() {
  try {
    await copyToClipboard(activeReferralUrl.value)
    ElMessage.success('推广链接已复制')
  } catch (error) {
    console.error('复制推广链接失败:', error)
    ElMessage.error('复制失败，请稍后重试')
  }
}

/**
 * 生成推广二维码并打开海报弹窗。
 * @returns {Promise<void>} 海报打开或错误提示完成后结束；空链接和二维码生成失败时不会打开弹窗。
 */
async function open() {
  const referralUrl = props.referralUrl
  const requestId = ++openRequestId.value
  visible.value = false
  qrCode.value = ''
  activeReferralUrl.value = ''

  if (!referralUrl) {
    ElMessage.error('推广链接暂不可用，请稍后重试')
    return
  }

  try {
    const generatedQrCode = await QRCode.toDataURL(referralUrl, {
      width: 280,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    })
    if (requestId !== openRequestId.value) return

    qrCode.value = generatedQrCode
    activeReferralUrl.value = referralUrl
    visible.value = true
  } catch (error) {
    if (requestId !== openRequestId.value) return

    console.error('推广海报二维码生成失败:', error)
    ElMessage.error('海报生成失败，请稍后重试')
  }
}

defineExpose({ open })
</script>

<style scoped>
.referral-poster {
  overflow: hidden;
  padding: 30px 24px 26px;
  border-radius: 20px;
  background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
  text-align: center;
}

.poster-title {
  margin: 0 0 24px;
  color: #0f172a;
  font-size: 24px;
  line-height: 1.4;
}

.poster-qr-wrap {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 100%;
  padding: 16px;
  border: 0;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 14px 30px rgba(37, 99, 235, 0.14);
  font: inherit;
  cursor: pointer;
}

.poster-qr-wrap:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.45);
  outline-offset: 4px;
}

.poster-qr-code {
  display: block;
  width: 280px;
  max-width: 100%;
  height: auto;
}

.poster-qr-hint {
  color: #2563eb;
  font-weight: 700;
}

.poster-features {
  margin: 22px 0 0;
  color: #475569;
  font-size: 14px;
}

:global(.referral-poster-dialog) {
  max-width: 440px;
}

:global(.referral-poster-dialog .el-dialog__body) {
  padding: 0 20px 20px;
}

:global(.referral-poster-dialog .el-dialog__title) {
  display: none;
}

@media (max-width: 768px) {
  :global(.referral-poster-dialog) {
    width: calc(100vw - 32px) !important;
    margin-right: auto;
    margin-left: auto;
  }

  :global(.referral-poster-dialog .el-dialog__body) {
    padding: 0 12px 12px;
  }

  .referral-poster {
    padding: 26px 14px 22px;
  }

  .poster-title {
    font-size: 21px;
  }

  .poster-qr-wrap {
    box-sizing: border-box;
  }
}
</style>

<template>
  <div class="feedback-page">
    <section class="feedback-hero">
      <div class="hero-copy">
        <h1>把你想要的改进告诉我</h1>
        <p class="hero-text">
          你的每一条留言都会被管理员认真查看。无论是系统体验优化、某个地区的节点服务器、住宅 IP 需求，还是需要搭建自己的 VPN，都可以在这里提出。管理员认为可行的建议会展示出来让大家投票，票数更高的需求会被优先评估和处理。
        </p>
      </div>

      <div class="submit-panel">
        <div class="panel-header">
          <h2>提交建议</h2>
          <span>{{ feedbackForm.content.length }}/150</span>
        </div>
        <el-input
          v-model="feedbackForm.content"
          type="textarea"
          :rows="5"
          maxlength="150"
          resize="none"
          show-word-limit
          placeholder="例如：希望增加日本住宅 IP，或者需要新加坡节点..."
        />
        <el-button
          type="primary"
          class="submit-button"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submitFeedback"
        >
          提交留言
        </el-button>
      </div>
    </section>

    <section class="featured-section">
      <div class="section-title-row">
        <div>
          <p class="eyebrow">大家正在投票</p>
          <h2>优质留言建议</h2>
        </div>
        <el-button text type="primary" :loading="loading" @click="fetchFeatured">刷新</el-button>
      </div>

      <div v-if="loading" class="loading-state">
        <el-icon><Loading /></el-icon>
        <span>正在加载留言...</span>
      </div>

      <el-empty v-else-if="featuredMessages.length === 0" description="还没有展示中的优质留言" />

      <div v-else class="message-grid">
        <article v-for="message in featuredMessages" :key="message.id" class="message-card">
          <p class="message-content">{{ message.content }}</p>
          <div class="message-footer">
            <span class="vote-count">{{ message.vote_count }} 票</span>
            <el-button
              size="small"
              :type="message.has_voted ? 'success' : 'primary'"
              :plain="message.has_voted"
              :disabled="message.has_voted || votingId === message.id"
              :loading="votingId === message.id"
              @click="voteMessage(message)"
            >
              {{ message.has_voted ? '已投票' : '投一票' }}
            </el-button>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup>
/**
 * 用户端留言板页面。
 * 职责：提交 150 字以内建议，并展示管理员精选留言供用户投票。
 */

import { computed, onMounted, reactive, ref } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const feedbackForm = reactive({
  content: ''
})
const featuredMessages = ref([])
const loading = ref(false)
const submitting = ref(false)
const votingId = ref(null)

const canSubmit = computed(() => {
  const content = feedbackForm.content.trim()
  return content.length > 0 && content.length <= 150
})

/**
 * 获取精选留言列表。
 * 职责：刷新展示区数据。
 * 关键参数：无。
 * 核心分支语义：接口成功替换列表，失败时保留旧数据并提示。
 *
 * @returns {Promise<void>}
 */
async function fetchFeatured() {
  try {
    loading.value = true
    const response = await api.user.getFeedbackFeatured()
    if (response.code === 0) {
      featuredMessages.value = response.data.list || []
    }
  } catch (error) {
    console.error('获取精选留言失败:', error)
    ElMessage.error('获取精选留言失败')
  } finally {
    loading.value = false
  }
}

/**
 * 提交用户留言。
 * 职责：发送当前输入内容，并在成功后清空输入框。
 * 关键参数：feedbackForm.content 为用户输入。
 * 核心分支语义：超过 150 字或空内容不提交；成功后给出确认反馈。
 *
 * @returns {Promise<void>}
 */
async function submitFeedback() {
  if (!canSubmit.value) {
    return
  }

  try {
    submitting.value = true
    const response = await api.user.createFeedbackMessage({
      content: feedbackForm.content.trim()
    })

    if (response.code === 0) {
      feedbackForm.content = ''
      ElMessage.success('留言已提交，感谢你的建议')
    }
  } catch (error) {
    console.error('提交留言失败:', error)
    if (Number(error.response?.data?.code) === 1003) {
      ElMessage.error('每个用户每天只能提交3条留言')
      return
    }
    ElMessage.error(error.userMessage || '提交留言失败')
  } finally {
    submitting.value = false
  }
}

/**
 * 给精选留言投票。
 * 职责：执行单用户单票，并在本地即时更新票数。
 * 关键参数：message 为当前卡片数据。
 * 核心分支语义：已投票不重复请求；新投票成功后票数加一。
 *
 * @param {Object} message - 精选留言
 * @returns {Promise<void>}
 */
async function voteMessage(message) {
  if (message.has_voted) {
    return
  }

  try {
    votingId.value = message.id
    const response = await api.user.voteFeedbackMessage(message.id)
    if (response.code === 0) {
      if (!response.data.already_voted) {
        message.vote_count = Number(message.vote_count || 0) + 1
      }
      message.has_voted = true
      ElMessage.success(response.data.already_voted ? '你已经投过票了' : '投票成功')
    }
  } catch (error) {
    console.error('留言投票失败:', error)
    ElMessage.error(error.userMessage || '投票失败')
  } finally {
    votingId.value = null
  }
}

onMounted(() => {
  fetchFeatured()
})
</script>

<style scoped>
.feedback-page {
  width: 100%;
  max-width: none;
  margin: 0;
  color: #1f2937;
}

.feedback-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(380px, 30vw);
  gap: 24px;
  align-items: stretch;
  margin-bottom: 24px;
}

.hero-copy,
.submit-panel,
.featured-section {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
}

.hero-copy {
  min-height: 220px;
  padding: 40px 48px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.eyebrow {
  margin: 0 0 8px;
  color: #409eff;
  font-size: 13px;
  font-weight: 700;
}

.hero-copy h1,
.featured-section h2,
.submit-panel h2 {
  margin: 0;
  color: #111827;
}

.hero-copy h1 {
  font-size: clamp(34px, 2.3vw, 46px);
  line-height: 1.2;
}

.hero-text {
  max-width: 920px;
  margin: 16px 0 0;
  color: #4b5563;
  font-size: 17px;
  line-height: 1.8;
}

.submit-panel {
  padding: 28px;
}

.panel-header,
.section-title-row,
.message-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-header {
  margin-bottom: 14px;
}

.panel-header span {
  color: #909399;
  font-size: 13px;
}

.submit-button {
  width: 100%;
  margin-top: 14px;
}

.featured-section {
  padding: 28px;
}

.section-title-row {
  margin-bottom: 20px;
}

.message-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 18px 22px;
  background: #f9fafb;
}

.message-content {
  flex: 1;
  margin: 0;
  color: #374151;
  line-height: 1.7;
  word-break: break-word;
}

.message-footer {
  width: 190px;
  flex-shrink: 0;
}

.vote-count {
  color: #409eff;
  font-weight: 700;
}

.loading-state {
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #606266;
}

@media (max-width: 1024px) {
  .feedback-hero {
    grid-template-columns: 1fr;
  }

  .message-grid {
    gap: 10px;
  }

  .message-card {
    align-items: flex-start;
    flex-direction: column;
    gap: 14px;
  }

  .message-footer {
    width: 100%;
  }
}

@media (max-width: 768px) {
  .feedback-page {
    max-width: none;
  }

  .feedback-hero {
    gap: 12px;
    margin-bottom: 12px;
  }

  .hero-copy,
  .submit-panel,
  .featured-section {
    border-radius: 8px;
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.06);
  }

  .hero-copy {
    padding: 16px;
  }

  .hero-copy h1 {
    font-size: 22px;
  }

  .hero-text {
    margin-top: 8px;
    font-size: 13px;
    line-height: 1.55;
  }

  .submit-panel,
  .featured-section {
    padding: 14px;
  }

  .panel-header {
    margin-bottom: 8px;
  }

  .submit-panel h2,
  .featured-section h2 {
    font-size: 18px;
  }

  .submit-button {
    margin-top: 10px;
  }

  .section-title-row {
    margin-bottom: 12px;
  }

  .message-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .message-card {
    min-height: 116px;
    padding: 12px;
  }

  .message-content {
    font-size: 14px;
    line-height: 1.55;
  }
}
</style>

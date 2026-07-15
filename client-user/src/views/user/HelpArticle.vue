<template>
  <div class="article-container">
    <div class="content-card" v-loading="loading">
      <el-button class="back-button" @click="$router.push('/user/help')">
        <el-icon><ArrowLeft /></el-icon>
        返回列表
      </el-button>

      <el-empty v-if="!loading && !article" description="文章不存在" />

      <article v-else-if="article" class="article-detail">
        <header class="article-header">
          <h1>{{ article.title }}</h1>
          <div class="article-meta">
            <el-tag v-if="article.category" effect="plain">{{ article.category }}</el-tag>
            <span>更新于 {{ formatTime(article.updated_at) }}</span>
          </div>
          <p>{{ article.summary }}</p>
        </header>

        <div class="markdown-body" v-html="renderedContent"></div>
      </article>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { marked } from 'marked'
import api from '@/api'

const route = useRoute()
const article = ref(null)
const loading = ref(false)

function sanitizeHtml(html) {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('script, iframe, object, embed, style, link').forEach((node) => node.remove())
  template.content.querySelectorAll('img').forEach((node) => {
    node.setAttribute('loading', 'lazy')
    node.setAttribute('decoding', 'async')
    node.setAttribute('fetchpriority', 'low')
  })
  template.content.querySelectorAll('*').forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim().toLowerCase()
      if (name.startsWith('on') || value.startsWith('javascript:')) {
        node.removeAttribute(attr.name)
      }
    })
  })
  return template.innerHTML
}

const renderedContent = computed(() => {
  if (!article.value?.content) return ''
  return sanitizeHtml(marked(article.value.content))
})

function formatTime(timestamp) {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function fetchArticle() {
  try {
    loading.value = true
    const response = await api.user.getHelpArticle(route.params.id)
    if (response.code === 0) {
      article.value = response.data
    }
  } catch (error) {
    console.error('获取帮助文章详情失败:', error)
    ElMessage.error('获取帮助文章详情失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchArticle()
})
</script>

<style scoped>
.article-container {
  max-width: 920px;
}

.content-card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  padding: 24px;
  min-height: 360px;
}

.back-button {
  margin-bottom: 22px;
}

.article-header {
  border-bottom: 1px solid #ebeef5;
  padding-bottom: 20px;
  margin-bottom: 24px;
}

.article-header h1 {
  font-size: 28px;
  line-height: 1.35;
  color: #303133;
  margin: 0 0 14px;
}

.article-header p {
  color: #606266;
  font-size: 15px;
  line-height: 1.7;
  margin: 14px 0 0;
}

.article-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #909399;
  font-size: 14px;
}

.markdown-body {
  color: #303133;
  font-size: 15px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  color: #303133;
  line-height: 1.4;
  margin: 24px 0 12px;
}

.markdown-body :deep(h1) { font-size: 26px; }
.markdown-body :deep(h2) { font-size: 22px; }
.markdown-body :deep(h3) { font-size: 18px; }

.markdown-body :deep(p),
.markdown-body :deep(ul),
.markdown-body :deep(ol),
.markdown-body :deep(blockquote),
.markdown-body :deep(pre) {
  margin: 0 0 16px;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 24px;
}

.markdown-body :deep(a) {
  color: #409eff;
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(code) {
  background: #f5f7fa;
  border-radius: 4px;
  padding: 2px 6px;
  font-family: Consolas, Monaco, monospace;
  font-size: 14px;
}

.markdown-body :deep(pre) {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
}

.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
}

.markdown-body :deep(blockquote) {
  border-left: 4px solid #409eff;
  padding-left: 14px;
  color: #606266;
}

.markdown-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  border: 1px solid #ebeef5;
}

@media (max-width: 768px) {
  .content-card {
    padding: 18px;
  }

  .article-header h1 {
    font-size: 23px;
  }
}
</style>

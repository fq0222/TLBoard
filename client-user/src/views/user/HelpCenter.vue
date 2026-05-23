<template>
  <div class="help-container">
    <section class="help-layout">
      <aside class="download-card">
        <div class="download-head">
          <h2 class="download-title">下载</h2>
        </div>

        <div class="download-list">
          <div
            v-for="item in downloadItems"
            :key="item.id"
            class="download-item"
          >
            <div class="download-item-main">
              <span class="download-item-name">{{ item.name }}</span>
            </div>

            <el-button
              type="success"
              class="download-button"
              :loading="downloadLoadingId === item.id"
              @click="handleDownload(item)"
            >
              获取
            </el-button>
          </div>
        </div>

      </aside>

      <div class="content-card">
        <div class="filters">
          <el-input
            v-model="keyword"
            class="search-input"
            placeholder="搜索标题或简介"
            clearable
            @keyup.enter="handleSearch"
            @clear="handleSearch"
          >
            <template #append>
              <el-button @click="handleSearch">搜索</el-button>
            </template>
          </el-input>

          <el-select v-model="category" class="category-select" placeholder="分类" @change="handleFilterChange">
            <el-option label="全部分类" value="" />
            <el-option v-for="item in categories" :key="item" :label="item" :value="item" />
          </el-select>
        </div>

        <div v-loading="loading" class="article-list">
          <el-empty v-if="!loading && articles.length === 0" description="暂无帮助文章" />

          <router-link
            v-for="article in articles"
            :key="article.id"
            class="article-card"
            :to="`/user/help/${article.id}`"
          >
            <div class="article-main">
              <div class="article-meta">
                <el-tag v-if="article.category" size="small" effect="plain">{{ article.category }}</el-tag>
                <span>{{ formatTime(article.updated_at) }}</span>
              </div>
              <h2>{{ article.title }}</h2>
              <p>{{ article.summary }}</p>
            </div>
            <el-icon class="article-arrow"><ArrowRight /></el-icon>
          </router-link>
        </div>

        <div v-if="total > limit" class="pagination">
          <el-pagination
            v-model:current-page="page"
            :page-size="limit"
            :total="total"
            layout="prev, pager, next"
            @current-change="fetchArticles"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowRight } from '@element-plus/icons-vue'
import api from '@/api'

const articles = ref([])
const categories = ref([])
const loading = ref(false)
const keyword = ref('')
const category = ref('')
const page = ref(1)
const limit = ref(9)
const total = ref(0)
const downloadLoadingId = ref('')

const downloadItems = ref([
  {
    id: 'android-app',
    name: 'Android-App 下载'
  }
])

function formatTime(timestamp) {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

async function fetchCategories() {
  try {
    const response = await api.user.getHelpCategories()
    if (response.code === 0) {
      categories.value = response.data
    }
  } catch (error) {
    console.error('获取帮助分类失败:', error)
  }
}

async function fetchArticles() {
  try {
    loading.value = true
    const response = await api.user.getHelpArticles({
      page: page.value,
      limit: limit.value,
      keyword: keyword.value || undefined,
      category: category.value || undefined
    })
    if (response.code === 0) {
      articles.value = response.data.list
      total.value = response.data.total
    }
  } catch (error) {
    console.error('获取帮助文章失败:', error)
    ElMessage.error('获取帮助文章失败')
  } finally {
    loading.value = false
  }
}

async function handleDownload(item) {
  try {
    downloadLoadingId.value = item.id
    const response = await api.user.getDownloadLink()

    if (response.code === 0 && response.data?.download_url) {
      const win = window.open(response.data.download_url, '_blank', 'noopener,noreferrer')
      if (!win) {
        ElMessage.warning('浏览器拦截了新窗口，请允许弹窗后重试')
      }
      return
    }

    ElMessage.error(response.message || '获取下载链接失败')
  } catch (error) {
    console.error('获取下载链接失败:', error)
    ElMessage.error('获取下载链接失败')
  } finally {
    downloadLoadingId.value = ''
  }
}

function handleSearch() {
  page.value = 1
  fetchArticles()
}

function handleFilterChange() {
  page.value = 1
  fetchArticles()
}

onMounted(() => {
  fetchCategories()
  fetchArticles()
})
</script>

<style scoped>
.help-container {
  width: 100%;
}

.help-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.75fr);
  gap: 20px;
  align-items: start;
}

.content-card,
.download-card {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
}

.content-card {
  padding: 20px;
  order: 1;
}

.download-card {
  padding: 20px;
  order: 2;
}

.download-head {
  margin-bottom: 14px;
}

.download-title {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
}

.download-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.download-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.download-item-main {
  min-width: 0;
}

.download-item-name {
  color: #0f172a;
  font-weight: 600;
}

.download-button {
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, #4ade80 0%, #16a34a 100%);
  box-shadow: 0 10px 22px rgba(34, 197, 94, 0.18);
}

.download-button:deep(span) {
  color: #fff;
}

.filters {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.search-input {
  max-width: 420px;
}

.category-select {
  width: 180px;
}

.article-list {
  min-height: 220px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.article-card {
  min-height: 150px;
  border: 1px solid #e4e7ed;
  border-radius: 12px;
  padding: 18px;
  color: inherit;
  text-decoration: none;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}

.article-card:hover {
  border-color: #409eff;
  box-shadow: 0 8px 20px rgba(64, 158, 255, 0.12);
  transform: translateY(-2px);
}

.article-main {
  min-width: 0;
}

.article-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 24px;
  color: #909399;
  font-size: 13px;
  margin-bottom: 12px;
}

.article-card h2 {
  font-size: 17px;
  line-height: 1.4;
  margin: 0 0 10px;
  color: #303133;
}

.article-card p {
  color: #606266;
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
}

.article-arrow {
  flex: 0 0 auto;
  margin-top: 2px;
  color: #c0c4cc;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

@media (max-width: 1024px) {
  .help-layout {
    grid-template-columns: 1fr;
  }

  .download-card {
    order: -1;
  }

  .article-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .content-card,
  .download-card {
    border-radius: 14px;
    padding: 16px;
  }

  .filters {
    flex-direction: column;
  }

  .search-input,
  .category-select {
    width: 100%;
    max-width: none;
  }

  .download-item {
    align-items: center;
    flex-direction: row;
  }

  .download-button {
    flex-shrink: 0;
  }

  .article-list {
    grid-template-columns: 1fr;
  }
}
</style>

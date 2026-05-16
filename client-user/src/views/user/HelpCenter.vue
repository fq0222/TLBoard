<template>
  <div class="help-container">
    <div class="page-header">
      <div>
        <h1 class="page-title">帮助中心</h1>
        <p class="page-subtitle">查看订阅、客户端、CF IP 与续费相关教程</p>
      </div>
    </div>

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

      <div class="pagination" v-if="total > limit">
        <el-pagination
          v-model:current-page="page"
          :page-size="limit"
          :total="total"
          layout="prev, pager, next"
          @current-change="fetchArticles"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
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
  max-width: 1120px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.page-subtitle {
  margin: 8px 0 0;
  color: #606266;
  font-size: 14px;
}

.content-card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  padding: 20px;
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.article-card {
  min-height: 150px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
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
  .article-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .filters {
    flex-direction: column;
  }

  .search-input,
  .category-select {
    width: 100%;
    max-width: none;
  }

  .article-list {
    grid-template-columns: 1fr;
  }
}
</style>

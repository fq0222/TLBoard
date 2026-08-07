<template>
  <div class="blogs-container">
    <div class="page-header">
      <div>
        <h1 class="page-title">博客管理</h1>
        <p class="page-subtitle">维护用户帮助中心展示的 Markdown 文章</p>
      </div>
      <el-button type="primary" @click="showEditor()">
        <el-icon><Plus /></el-icon>
        新增文章
      </el-button>
    </div>

    <div class="content-card">
      <div class="toolbar">
        <el-input
          v-model="filters.keyword"
          class="search-input"
          placeholder="搜索标题或简介"
          clearable
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-select v-model="filters.category" class="filter-select" placeholder="分类" clearable @change="handleSearch">
          <el-option v-for="item in categories" :key="item" :label="item" :value="item" />
        </el-select>
        <el-select v-model="filters.status" class="filter-select" placeholder="状态" clearable @change="handleSearch">
          <el-option label="草稿" value="draft" />
          <el-option label="已发布" value="published" />
        </el-select>
        <el-button @click="handleSearch">筛选</el-button>
      </div>

      <el-table :data="articles" v-loading="loading" style="width: 100%">
        <el-table-column prop="title" label="标题" width="760" show-overflow-tooltip />
        <el-table-column prop="category" label="分类" width="140">
          <template #default="{ row }">{{ row.category || '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="150">
          <template #default="{ row }">
            <div class="status-tags">
              <el-tag :type="row.status === 'published' ? 'success' : 'info'" size="small">
                {{ getStatusText(row.status) }}
              </el-tag>
              <el-tag v-if="row.pinned" type="warning" size="small">置顶</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="updated_at" label="更新时间" width="180">
          <template #default="{ row }">{{ formatTime(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="340" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="showEditor(row)">编辑</el-button>
            <el-button link type="primary" @click="showPreview(row)">预览</el-button>
            <el-button link :type="row.pinned ? 'warning' : 'success'" @click="togglePinned(row)">
              {{ row.pinned ? '取消置顶' : '置顶' }}
            </el-button>
            <el-button link type="success" @click="toggleStatus(row)">
              {{ row.status === 'published' ? '设为草稿' : '发布' }}
            </el-button>
            <el-button link type="danger" @click="deleteArticle(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination" v-if="total > pagination.limit">
        <el-pagination
          v-model:current-page="pagination.page"
          :page-size="pagination.limit"
          :total="total"
          layout="prev, pager, next"
          @current-change="fetchArticles"
        />
      </div>
    </div>

    <el-dialog v-model="editorVisible" :title="editingId ? '编辑文章' : '新增文章'" width="92%" top="4vh" class="blog-dialog">
      <el-form :model="form" label-width="80px">
        <div class="form-grid">
          <el-form-item label="标题" required>
            <el-input v-model="form.title" maxlength="200" show-word-limit placeholder="请输入文章标题" />
          </el-form-item>
          <el-form-item label="分类">
            <el-input v-model="form.category" maxlength="100" show-word-limit placeholder="如 Clash、订阅教程" />
          </el-form-item>
        </div>
        <el-form-item label="简介" required>
          <el-input v-model="form.summary" maxlength="500" show-word-limit placeholder="请输入文章简介" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio-button label="draft">草稿</el-radio-button>
            <el-radio-button label="published">已发布</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="置顶">
          <el-switch v-model="form.pinned" />
        </el-form-item>
        <el-form-item label="内容" required>
          <div class="editor-shell">
            <div class="editor-toolbar">
              <el-upload
                action="#"
                :show-file-list="false"
                :auto-upload="false"
                accept="image/jpeg,image/png,image/gif,image/webp"
                :on-change="handleImageSelected"
              >
                <el-button :loading="uploading">
                  <el-icon><Upload /></el-icon>
                  上传图片
                </el-button>
              </el-upload>
              <el-upload
                action="#"
                :show-file-list="false"
                :auto-upload="false"
                accept="video/mp4"
                :on-change="handleVideoSelected"
              >
                <el-button :loading="videoUploading">
                  <el-icon><Upload /></el-icon>
                  上传视频
                </el-button>
              </el-upload>
            </div>
            <div class="editor-columns">
              <el-input
                ref="contentInput"
                v-model="form.content"
                type="textarea"
                :rows="20"
                resize="none"
                placeholder="请输入 Markdown 内容"
              />
              <div class="preview-panel">
                <div class="preview-title">预览</div>
                <div class="markdown-body" v-html="renderedContent"></div>
              </div>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitArticle">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewVisible" title="文章预览" width="860px" @close="handlePreviewClose" @closed="handlePreviewClosed">
      <article v-if="previewArticle" ref="previewArticleRef" class="preview-article">
        <h1>{{ previewArticle.title }}</h1>
        <div class="preview-meta">
          <el-tag v-if="previewArticle.category" effect="plain">{{ previewArticle.category }}</el-tag>
          <span>{{ formatTime(previewArticle.updated_at) }}</span>
        </div>
        <p class="preview-summary">{{ previewArticle.summary }}</p>
        <div class="markdown-body" v-html="previewHtml"></div>
      </article>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index.mjs'
import { ElMessageBox } from 'element-plus/es/components/message-box/index.mjs'
import { Plus, Upload } from '@element-plus/icons-vue'
import { marked } from 'marked'
import api from '@/api'

const articles = ref([])
const categories = ref([])
const loading = ref(false)
const submitting = ref(false)
const uploading = ref(false)
const videoUploading = ref(false)
const editorVisible = ref(false)
const previewVisible = ref(false)
const previewArticle = ref(null)
const previewArticleRef = ref(null)
const contentInput = ref(null)
const editingId = ref(null)
const total = ref(0)

const pagination = reactive({ page: 1, limit: 10 })
const filters = reactive({ keyword: '', category: '', status: '' })
const form = reactive({
  title: '',
  summary: '',
  category: '',
  content: '',
  status: 'draft',
  pinned: false
})

function sanitizeHtml(html) {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('script, iframe, object, embed, style, link').forEach((node) => node.remove())
  template.content.querySelectorAll('video').forEach((node) => {
    node.setAttribute('controls', 'controls')
    node.setAttribute('preload', 'metadata')
    node.setAttribute('playsinline', 'playsinline')
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
  if (!form.content) return '<p class="empty-preview">输入 Markdown 后在这里预览</p>'
  return sanitizeHtml(marked(form.content))
})

const previewHtml = computed(() => {
  if (!previewArticle.value?.content) return ''
  return sanitizeHtml(marked(previewArticle.value.content))
})

function getStatusText(status) {
  return status === 'published' ? '已发布' : '草稿'
}

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

function resetForm() {
  editingId.value = null
  form.title = ''
  form.summary = ''
  form.category = ''
  form.content = ''
  form.status = 'draft'
  form.pinned = false
}

async function fetchCategories() {
  try {
    const response = await api.admin.getBlogCategories()
    if (response.code === 0) categories.value = response.data
  } catch (error) {
    console.error('获取博客分类失败:', error)
  }
}

async function fetchArticles() {
  try {
    loading.value = true
    const response = await api.admin.getBlogs({
      page: pagination.page,
      limit: pagination.limit,
      keyword: filters.keyword || undefined,
      category: filters.category || undefined,
      status: filters.status || undefined
    })
    if (response.code === 0) {
      articles.value = response.data.list
      total.value = response.data.total
    }
  } catch (error) {
    console.error('获取博客文章失败:', error)
    ElMessage.error('获取博客文章失败')
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  pagination.page = 1
  fetchArticles()
}

async function showEditor(row) {
  resetForm()
  if (row) {
    const response = await api.admin.getBlog(row.id)
    if (response.code === 0) {
      editingId.value = row.id
      form.title = response.data.title
      form.summary = response.data.summary
      form.category = response.data.category || ''
      form.content = response.data.content
      form.status = response.data.status
      form.pinned = !!response.data.pinned
    }
  }
  editorVisible.value = true
}

async function showPreview(row) {
  try {
    const response = await api.admin.getBlog(row.id)
    if (response.code === 0) {
      previewArticle.value = response.data
      previewVisible.value = true
    }
  } catch (error) {
    console.error('获取预览失败:', error)
  }
}

function handlePreviewClose() {
  const root = previewArticleRef.value
  if (!root) return

  root.querySelectorAll('video').forEach((video) => {
    video.pause()
    video.currentTime = 0
  })
}

function handlePreviewClosed() {
  previewArticle.value = null
}

function validateForm() {
  if (!form.title.trim()) return '请填写标题'
  if (!form.summary.trim()) return '请填写简介'
  if (!form.content.trim()) return '请填写 Markdown 内容'
  return ''
}

async function submitArticle() {
  const error = validateForm()
  if (error) {
    ElMessage.warning(error)
    return
  }

  try {
    submitting.value = true
    const payload = {
      title: form.title,
      summary: form.summary,
      category: form.category || null,
      content: form.content,
      status: form.status,
      pinned: form.pinned
    }
    const response = editingId.value
      ? await api.admin.updateBlog(editingId.value, payload)
      : await api.admin.addBlog(payload)

    if (response.code === 0) {
      ElMessage.success('保存成功')
      editorVisible.value = false
      fetchArticles()
      fetchCategories()
    }
  } catch (error) {
    console.error('保存文章失败:', error)
  } finally {
    submitting.value = false
  }
}

async function toggleStatus(row) {
  try {
    const response = await api.admin.getBlog(row.id)
    if (response.code !== 0) return
    const article = response.data
    const nextStatus = article.status === 'published' ? 'draft' : 'published'
    const updateResponse = await api.admin.updateBlog(article.id, { ...article, status: nextStatus })
    if (updateResponse.code === 0) {
      ElMessage.success(nextStatus === 'published' ? '已发布' : '已设为草稿')
      fetchArticles()
      fetchCategories()
    }
  } catch (error) {
    console.error('切换状态失败:', error)
  }
}

async function togglePinned(row) {
  try {
    const response = await api.admin.getBlog(row.id)
    if (response.code !== 0) return
    const article = response.data
    const nextPinned = !article.pinned
    const updateResponse = await api.admin.updateBlog(article.id, { ...article, pinned: nextPinned })
    if (updateResponse.code === 0) {
      ElMessage.success(nextPinned ? '已置顶' : '已取消置顶')
      fetchArticles()
    }
  } catch (error) {
    console.error('切换置顶状态失败:', error)
  }
}

async function deleteArticle(row) {
  try {
    await ElMessageBox.confirm(`确定删除文章 "${row.title}" 吗？`, '提示', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    })
    const response = await api.admin.deleteBlog(row.id)
    if (response.code === 0) {
      ElMessage.success('删除成功')
      fetchArticles()
      fetchCategories()
    }
  } catch {}
}

async function handleImageSelected(uploadFile) {
  if (!uploadFile?.raw) return
  const formData = new FormData()
  formData.append('file', uploadFile.raw)

  try {
    uploading.value = true
    const response = await api.admin.uploadBlogImage(formData)
    if (response.code === 0) {
      insertAtCursor(response.data.markdown)
      ElMessage.success('图片上传成功')
    }
  } catch (error) {
    console.error('上传图片失败:', error)
  } finally {
    uploading.value = false
  }
}

async function handleVideoSelected(uploadFile) {
  if (!uploadFile?.raw) return
  const formData = new FormData()
  formData.append('file', uploadFile.raw)

  try {
    videoUploading.value = true
    const response = await api.admin.uploadBlogVideo(formData)
    if (response.code === 0) {
      insertAtCursor(response.data.markdown)
      ElMessage.success('视频上传成功')
    }
  } catch (error) {
    console.error('上传视频失败:', error)
  } finally {
    videoUploading.value = false
  }
}

async function insertAtCursor(markdown) {
  await nextTick()
  const textarea = contentInput.value?.textarea
  if (!textarea) {
    form.content += `\n${markdown}\n`
    return
  }

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const before = form.content.slice(0, start)
  const after = form.content.slice(end)
  const prefix = before && !before.endsWith('\n') ? '\n' : ''
  const suffix = after && !after.startsWith('\n') ? '\n' : ''
  const insertion = `${prefix}${markdown}${suffix}`
  form.content = `${before}${insertion}${after}`

  await nextTick()
  const cursor = start + insertion.length
  textarea.focus()
  textarea.setSelectionRange(cursor, cursor)
}

onMounted(() => {
  fetchCategories()
  fetchArticles()
})
</script>

<style scoped>
.blogs-container {
  width: 100%;
  max-width: 100%;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page-title {
  font-size: 28px;
  color: #333;
  margin: 0 0 10px;
}

.page-subtitle {
  color: #666;
  font-size: 16px;
  margin: 0;
}

.content-card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  padding: 20px;
}

.toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.search-input {
  width: 320px;
}

.filter-select {
  width: 160px;
}

.status-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.pagination {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 260px;
  gap: 16px;
}

.editor-shell {
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  overflow: hidden;
}

.editor-toolbar {
  display: flex;
  justify-content: flex-start;
  padding: 10px 12px;
  background: #f5f7fa;
  border-bottom: 1px solid #dcdfe6;
}

.editor-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  min-height: 520px;
}

.editor-columns :deep(.el-textarea),
.editor-columns :deep(.el-textarea__inner) {
  height: 100%;
}

.editor-columns :deep(.el-textarea__inner) {
  border: none;
  border-radius: 0;
  font-family: Consolas, Monaco, monospace;
  line-height: 1.6;
}

.preview-panel {
  border-left: 1px solid #dcdfe6;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.preview-title {
  padding: 10px 14px;
  background: #fafafa;
  border-bottom: 1px solid #ebeef5;
  color: #606266;
  font-weight: 600;
}

.markdown-body {
  padding: 16px;
  overflow-y: auto;
  color: #303133;
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.preview-panel .markdown-body {
  flex: 1;
  max-height: 480px;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  color: #303133;
  line-height: 1.4;
  margin: 20px 0 10px;
}

.markdown-body :deep(h1) { font-size: 25px; }
.markdown-body :deep(h2) { font-size: 21px; }
.markdown-body :deep(h3) { font-size: 18px; }

.markdown-body :deep(p),
.markdown-body :deep(ul),
.markdown-body :deep(ol),
.markdown-body :deep(blockquote),
.markdown-body :deep(pre) {
  margin: 0 0 14px;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 24px;
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

.markdown-body :deep(a) {
  color: #409eff;
  text-decoration: none;
}

.markdown-body :deep(img) {
  max-width: 100%;
  height: auto;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.markdown-body :deep(video) {
  display: block;
  max-width: 100%;
  width: 100%;
  height: auto;
  max-height: 80vh;
  max-height: 80dvh;
  object-fit: contain;
  border-radius: 8px;
  background: #000;
  margin: 0 0 14px;
}

.empty-preview {
  color: #909399;
}

.preview-article h1 {
  margin: 0 0 12px;
  color: #303133;
}

.preview-meta {
  display: flex;
  gap: 12px;
  align-items: center;
  color: #909399;
  margin-bottom: 12px;
}

.preview-summary {
  color: #606266;
  line-height: 1.7;
  padding-bottom: 16px;
  border-bottom: 1px solid #ebeef5;
}

@media (max-width: 900px) {
  .form-grid,
  .editor-columns {
    grid-template-columns: 1fr;
  }

  .preview-panel {
    border-left: none;
    border-top: 1px solid #dcdfe6;
  }

  .search-input,
  .filter-select {
    width: 100%;
  }

  .markdown-body :deep(video) {
    max-height: 70vh;
    max-height: 70dvh;
  }
}
</style>

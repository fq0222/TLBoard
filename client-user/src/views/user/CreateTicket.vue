<template>
  <div class="create-ticket-container">
    <div class="page-header">
      <h1 class="page-title">创建工单</h1>
      <el-button @click="$router.push('/user/tickets')">返回列表</el-button>
    </div>

    <div class="content-card">
      <el-form :model="form" :rules="rules" ref="formRef" label-width="100px">
        <el-form-item label="工单标题" prop="title">
          <el-input v-model="form.title" placeholder="请输入工单标题" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="问题描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="6" placeholder="请详细描述您遇到的问题" maxlength="500" show-word-limit />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSubmit" :loading="submitting">提交工单</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '@/api'

const router = useRouter()
const formRef = ref(null)
const submitting = ref(false)

const form = ref({
  title: '',
  description: ''
})

const rules = {
  title: [
    { required: true, message: '请输入工单标题', trigger: 'blur' },
    { max: 50, message: '工单标题不能超过50字', trigger: 'blur' }
  ],
  description: [
    { required: true, message: '请输入问题描述', trigger: 'blur' },
    { max: 500, message: '问题描述不能超过500字', trigger: 'blur' }
  ]
}

async function handleSubmit() {
  try {
    await formRef.value.validate()
    submitting.value = true

    const response = await api.user.createTicket(form.value)
    if (response.code === 0) {
      ElMessage.success('工单创建成功')
      router.push(`/user/tickets/${response.data.id}`)
    }
  } catch (error) {
    if (error !== false) {
      console.error('创建工单失败:', error)
      ElMessage.error('创建工单失败')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.create-ticket-container {
  max-width: 800px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 30px;
}

@media (max-width: 768px) {
  .create-ticket-container {
    max-width: none;
  }

  .page-header {
    align-items: center;
    margin-bottom: 16px;
  }

  .page-title {
    font-size: 22px;
  }

  .content-card {
    border-radius: 14px;
    padding: 18px;
  }

  :deep(.el-form-item) {
    display: block;
    margin-bottom: 22px;
  }

  :deep(.el-form-item__label) {
    display: block;
    height: auto;
    margin-bottom: 8px;
    padding: 0;
    text-align: left;
    line-height: 1.4;
  }

  :deep(.el-form-item__content) {
    display: block;
    margin-left: 0 !important;
  }

  :deep(.el-input) {
    width: 100%;
  }

  :deep(.el-textarea) {
    width: 100%;
  }

  :deep(.el-button--primary) {
    width: 100%;
    min-height: 42px;
  }
}
</style>

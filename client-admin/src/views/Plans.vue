<template>
  <div class="plans-container">
    <div class="page-header">
      <h1 class="page-title">套餐管理</h1>
      <p class="page-subtitle">管理订阅套餐</p>
    </div>
    
    <div class="content-card">
      <div class="toolbar">
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>
          添加套餐
        </el-button>
      </div>
      
      <el-table :data="plans" style="width: 100%">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="套餐名称" />
        <el-table-column prop="price_text" label="价格">
          <template #default="scope">
            ¥{{ scope.row.price_text }}
          </template>
        </el-table-column>
        <el-table-column prop="duration_days" label="有效天数" />
        <el-table-column prop="traffic_text" label="流量上限" />
        <el-table-column prop="sort_order" label="排序" width="80" />
        <el-table-column prop="enabled" label="状态" width="100">
          <template #default="scope">
            <el-tag :type="scope.row.enabled ? 'success' : 'danger'">
              {{ scope.row.enabled ? '已上架' : '已下架' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="scope">
            <el-button size="small" type="primary" @click="showEditDialog(scope.row)">
              编辑
            </el-button>
            <el-button size="small" type="danger" @click="deletePlan(scope.row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    
    <el-dialog 
      v-model="dialogVisible" 
      :title="isEditing ? '编辑套餐' : '添加套餐'"
      width="500px"
    >
      <el-form ref="planFormRef" :model="planForm" :rules="planRules" label-width="100px">
        <el-form-item label="套餐名称" prop="name">
          <el-input v-model="planForm.name" placeholder="请输入套餐名称" />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input v-model="planForm.description" type="textarea" placeholder="请输入套餐描述" />
        </el-form-item>
        <el-form-item label="价格(分)" prop="price">
          <el-input-number v-model="planForm.price" :min="0" />
        </el-form-item>
        <el-form-item label="有效天数" prop="duration_days">
          <el-input-number v-model="planForm.duration_days" :min="1" />
        </el-form-item>
        <el-form-item label="流量上限(bytes)" prop="traffic_limit">
          <el-input-number v-model="planForm.traffic_limit" :min="0" />
        </el-form-item>
        <el-form-item label="排序权重" prop="sort_order">
          <el-input-number v-model="planForm.sort_order" :min="0" />
        </el-form-item>
        <el-form-item label="是否上架" prop="enabled">
          <el-switch v-model="planForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const plans = ref([])
const dialogVisible = ref(false)
const isEditing = ref(false)
const submitting = ref(false)
const editingId = ref(null)
const planFormRef = ref(null)

const planForm = reactive({
  name: '',
  description: '',
  price: 0,
  duration_days: 30,
  traffic_limit: 0,
  sort_order: 0,
  enabled: true
})

const planRules = {
  name: [{ required: true, message: '请输入套餐名称', trigger: 'blur' }],
  price: [{ required: true, message: '请输入价格', trigger: 'blur' }],
  duration_days: [{ required: true, message: '请输入有效天数', trigger: 'blur' }],
  traffic_limit: [{ required: true, message: '请输入流量上限', trigger: 'blur' }]
}

async function fetchPlans() {
  try {
    const response = await api.admin.getPlans()
    if (response.code === 0) {
      plans.value = response.data.list
    }
  } catch (error) {
    console.error('获取套餐列表失败:', error)
  }
}

function showAddDialog() {
  isEditing.value = false
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function showEditDialog(plan) {
  isEditing.value = true
  editingId.value = plan.id
  planForm.name = plan.name
  planForm.description = plan.description
  planForm.price = plan.price
  planForm.duration_days = plan.duration_days
  planForm.traffic_limit = plan.traffic_limit
  planForm.sort_order = plan.sort_order
  planForm.enabled = plan.enabled
  dialogVisible.value = true
}

function resetForm() {
  planForm.name = ''
  planForm.description = ''
  planForm.price = 0
  planForm.duration_days = 30
  planForm.traffic_limit = 0
  planForm.sort_order = 0
  planForm.enabled = true
}

async function handleSubmit() {
  try {
    await planFormRef.value.validate()
    submitting.value = true
    if (isEditing.value) {
      const response = await api.admin.updatePlan(editingId.value, planForm)
      if (response.code === 0) {
        ElMessage.success('套餐更新成功')
        dialogVisible.value = false
        fetchPlans()
      }
    } else {
      const response = await api.admin.addPlan(planForm)
      if (response.code === 0) {
        ElMessage.success('套餐添加成功')
        dialogVisible.value = false
        fetchPlans()
      }
    }
  } catch (error) {
    console.error('提交失败:', error)
  } finally {
    submitting.value = false
  }
}

async function deletePlan(plan) {
  try {
    await ElMessageBox.confirm(`确定要删除套餐 "${plan.name}" 吗？`, '提示', { type: 'warning' })
    const response = await api.admin.deletePlan(plan.id)
    if (response.code === 0) {
      ElMessage.success('删除成功')
      fetchPlans()
    }
  } catch {}
}

onMounted(() => {
  fetchPlans()
})
</script>

<style scoped>
.plans-container { max-width: 1200px; }
.page-header { margin-bottom: 30px; }
.page-title { font-size: 28px; color: #333; margin-bottom: 10px; }
.page-subtitle { color: #666; font-size: 16px; }
.content-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 20px; }
.toolbar { margin-bottom: 20px; }
</style>
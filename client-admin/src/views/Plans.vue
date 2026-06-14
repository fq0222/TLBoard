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
        <el-table-column label="套餐类型" width="110">
          <template #default="scope">
            <el-tag :type="scope.row.plan_type === 'timed' ? 'warning' : 'info'">
              {{ scope.row.plan_type_text || (scope.row.plan_type === 'timed' ? '限时套餐' : '不限时套餐') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="price_text" label="价格">
          <template #default="scope">
            ¥{{ scope.row.price_text }}
          </template>
        </el-table-column>
        <el-table-column label="有效天数">
          <template #default="scope">
            {{ formatDuration(scope.row) }}
          </template>
        </el-table-column>
        <el-table-column prop="traffic_text" label="流量上限" />
        <el-table-column prop="sort_order" label="排序" width="80" />
        <el-table-column label="可销售总量" width="120">
          <template #default="scope">
            {{ scope.row.sales_limit === -1 ? '不限制' : scope.row.sales_limit }}
          </template>
        </el-table-column>
        <el-table-column prop="sales_count" label="已售数量" width="100" />
        <el-table-column label="首页展示" width="100">
          <template #default="scope">
            <el-tag :type="scope.row.show_on_home ? 'success' : 'info'">
              {{ scope.row.show_on_home ? '展示' : '隐藏' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最后更新时间" width="160">
          <template #default="scope">
            {{ scope.row.updated_at ? formatTime(scope.row.updated_at) : '-' }}
          </template>
        </el-table-column>
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
      width="560px"
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
        <el-form-item label="套餐类型" prop="plan_type">
          <el-radio-group v-model="planForm.plan_type">
            <el-radio-button label="timed">限时套餐</el-radio-button>
            <el-radio-button label="lifetime">不限时套餐</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="有效天数" prop="duration_days">
          <el-input-number
            v-model="planForm.duration_days"
            :min="planForm.plan_type === 'timed' ? 1 : 0"
            :disabled="planForm.plan_type === 'lifetime'"
          />
          <span class="form-tip">{{ planForm.plan_type === 'lifetime' ? '不限时套餐固定为 0' : '限时套餐需大于 0' }}</span>
        </el-form-item>
        <el-form-item label="流量上限" prop="traffic_limit">
          <div class="traffic-input">
            <el-input-number v-model="trafficValue" :min="0" :precision="2" />
            <el-select v-model="trafficUnit" style="width: 100px;">
              <el-option label="GB" :value="1073741824" />
              <el-option label="MB" :value="1048576" />
              <el-option label="KB" :value="1024" />
              <el-option label="B" :value="1" />
            </el-select>
          </div>
        </el-form-item>
        <el-form-item label="排序权重" prop="sort_order">
          <el-input-number v-model="planForm.sort_order" :min="0" />
        </el-form-item>
        <el-form-item label="可销售总量" prop="sales_limit">
          <el-input-number v-model="planForm.sales_limit" :min="-1" />
          <span class="form-tip">-1 表示不限制可售数量</span>
        </el-form-item>
        <el-form-item label="首页展示" prop="show_on_home">
          <el-switch v-model="planForm.show_on_home" />
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
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/api'

const plans = ref([])
const dialogVisible = ref(false)
const isEditing = ref(false)
const submitting = ref(false)
const editingId = ref(null)
const planFormRef = ref(null)

// 流量单位相关
const trafficUnit = ref(1073741824) // 默认GB
const trafficValue = ref(0)

const planForm = reactive({
  name: '',
  description: '',
  price: 0,
  plan_type: 'timed',
  duration_days: 30,
  traffic_limit: 0,
  sort_order: 0,
  enabled: true,
  show_on_home: true,
  sales_limit: -1
})

// 校验套餐类型与有效天数的契约，避免管理端提交出破坏续费语义的数据。
function validateDurationDays(rule, value, callback) {
  const days = Number(value)
  if (planForm.plan_type === 'lifetime') {
    if (days !== 0) {
      callback(new Error('不限时套餐的有效天数必须为 0'))
      return
    }
    callback()
    return
  }

  if (!Number.isFinite(days) || days <= 0) {
    callback(new Error('限时套餐的有效天数必须大于 0'))
    return
  }
  callback()
}

const planRules = {
  name: [{ required: true, message: '请输入套餐名称', trigger: 'blur' }],
  price: [{ required: true, message: '请输入价格', trigger: 'blur' }],
  plan_type: [{ required: true, message: '请选择套餐类型', trigger: 'change' }],
  duration_days: [{ required: true, validator: validateDurationDays, trigger: 'change' }]
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  const date = new Date(timestamp * 1000)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function resolvePlanType(plan) {
  return plan.plan_type || (Number(plan.duration_days) === 0 ? 'lifetime' : 'timed')
}

function formatDuration(plan) {
  return resolvePlanType(plan) === 'lifetime' ? '无限期' : `${plan.duration_days}天`
}

// 监听流量值和单位变化，计算实际字节数
watch([trafficValue, trafficUnit], () => {
  planForm.traffic_limit = Math.round(trafficValue.value * trafficUnit.value)
})

// 切换套餐类型时同步有效天数，保持不限时套餐固定为 duration_days=0。
watch(() => planForm.plan_type, (planType) => {
  if (planType === 'lifetime') {
    planForm.duration_days = 0
  } else if (Number(planForm.duration_days) <= 0) {
    planForm.duration_days = 30
  }
  planFormRef.value?.clearValidate('duration_days')
})

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
  planForm.plan_type = resolvePlanType(plan)
  planForm.duration_days = plan.duration_days
  planForm.sort_order = plan.sort_order
  planForm.enabled = !!plan.enabled  // 将数字转换为布尔值
  planForm.show_on_home = !!plan.show_on_home
  planForm.sales_limit = plan.sales_limit
  
  // 计算流量值和单位
  const trafficLimit = Number(plan.traffic_limit) || 0
  if (trafficLimit >= 1073741824 && trafficLimit % 1073741824 === 0) {
    trafficValue.value = trafficLimit / 1073741824
    trafficUnit.value = 1073741824
  } else if (trafficLimit >= 1048576 && trafficLimit % 1048576 === 0) {
    trafficValue.value = trafficLimit / 1048576
    trafficUnit.value = 1048576
  } else if (trafficLimit >= 1024 && trafficLimit % 1024 === 0) {
    trafficValue.value = trafficLimit / 1024
    trafficUnit.value = 1024
  } else {
    trafficValue.value = trafficLimit
    trafficUnit.value = 1
  }
  planForm.traffic_limit = trafficLimit
  
  dialogVisible.value = true
}

function resetForm() {
  planForm.name = ''
  planForm.description = ''
  planForm.price = 0
  planForm.plan_type = 'timed'
  planForm.duration_days = 30
  planForm.traffic_limit = 0
  planForm.sort_order = 0
  planForm.enabled = true
  planForm.show_on_home = true
  planForm.sales_limit = -1
  trafficValue.value = 0
  trafficUnit.value = 1073741824
}

async function handleSubmit() {
  try {
    await planFormRef.value.validate()
    submitting.value = true
    
    // 确保traffic_limit是数字
    planForm.traffic_limit = Math.round(trafficValue.value * trafficUnit.value)
    if (planForm.plan_type === 'lifetime') {
      planForm.duration_days = 0
    }
    
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
.plans-container { width: 100%; max-width: 100%; }
.page-header { margin-bottom: 30px; }
.page-title { font-size: 28px; color: #333; margin-bottom: 10px; }
.page-subtitle { color: #666; font-size: 16px; }
.content-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 20px; }
.toolbar { margin-bottom: 20px; }
.form-tip { margin-left: 10px; color: #999; font-size: 12px; }
.traffic-input { display: flex; gap: 10px; align-items: center; }
</style>

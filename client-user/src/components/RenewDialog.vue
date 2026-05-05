<template>
  <el-dialog
    v-model="dialogVisible"
    title="续费套餐"
    width="800px"
    :before-close="handleClose"
  >
    <div class="renew-dialog-content">
      <el-alert
        title="续费说明"
        description="续费将在现有套餐基础上累加流量，使用期限保持无限期。"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 20px;"
      />
      
      <div v-if="loading" class="loading-container">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载套餐中...</span>
      </div>
      
      <div v-else-if="plans.length === 0" class="empty-container">
        <el-empty description="暂无可用套餐" />
      </div>
      
      <div v-else class="plans-grid">
        <div
          v-for="plan in plans"
          :key="plan.id"
          class="plan-card"
          :class="{ 'is-selected': selectedPlanId === plan.id, 'is-current': plan.id === currentPlanId }"
          @click="selectPlan(plan.id)"
        >
          <div class="plan-header">
            <h3 class="plan-name">{{ plan.name }}</h3>
            <el-tag v-if="plan.id === currentPlanId" type="success" size="small">当前套餐</el-tag>
          </div>
          
          <div class="plan-price">
            <span class="currency">¥</span>
            <span class="amount">{{ (plan.price / 100).toFixed(2) }}</span>
          </div>
          
          <div class="plan-traffic">
            <el-icon><DataLine /></el-icon>
            <span>{{ formatTraffic(plan.traffic_limit) }}</span>
          </div>
          
          <div v-if="plan.description" class="plan-description">
            {{ plan.description }}
          </div>
          
          <div class="plan-check" v-if="selectedPlanId === plan.id">
            <el-icon><CircleCheck /></el-icon>
          </div>
        </div>
      </div>
    </div>
    
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button
          type="primary"
          :disabled="!selectedPlanId"
          :loading="submitting"
          @click="handleRenew"
        >
          立即续费
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { Loading, DataLine, CircleCheck } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  currentPlanId: {
    type: Number,
    default: null
  }
})

const emit = defineEmits(['update:visible', 'renew'])

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const loading = ref(false)
const submitting = ref(false)
const plans = ref([])
const selectedPlanId = ref(null)

watch(() => props.visible, (newVal) => {
  if (newVal) {
    fetchPlans()
    selectedPlanId.value = null
  }
})

/**
 * 获取套餐列表
 */
async function fetchPlans() {
  try {
    loading.value = true
    const result = await api.user.getPlans()
    if (result.code === 0) {
      plans.value = result.data || []
    } else {
      ElMessage.error(result.message || '获取套餐列表失败')
    }
  } catch (error) {
    console.error('获取套餐列表失败:', error)
    ElMessage.error('获取套餐列表失败')
  } finally {
    loading.value = false
  }
}

/**
 * 选择套餐
 */
function selectPlan(planId) {
  selectedPlanId.value = planId
}

/**
 * 格式化流量显示
 */
function formatTraffic(bytes) {
  if (!bytes || bytes === 0) return '无限制'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 关闭弹窗
 */
function handleClose() {
  dialogVisible.value = false
}

/**
 * 提交续费
 */
async function handleRenew() {
  if (!selectedPlanId.value) {
    ElMessage.warning('请选择套餐')
    return
  }
  
  submitting.value = true
  
  try {
    emit('renew', selectedPlanId.value)
  } catch (error) {
    console.error('续费失败:', error)
    ElMessage.error('续费失败，请重试')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.renew-dialog-content {
  min-height: 300px;
}

.loading-container,
.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #909399;
}

.loading-container .is-loading {
  font-size: 32px;
  margin-bottom: 10px;
}

.plans-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.plan-card {
  position: relative;
  border: 2px solid #e4e7ed;
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.3s ease;
  background: #fff;
}

.plan-card:hover {
  border-color: #409eff;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.2);
}

.plan-card.is-selected {
  border-color: #409eff;
  background: #ecf5ff;
}

.plan-card.is-current {
  border-color: #67c23a;
}

.plan-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.plan-name {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.plan-price {
  margin-bottom: 12px;
}

.plan-price .currency {
  font-size: 16px;
  color: #f56c6c;
}

.plan-price .amount {
  font-size: 28px;
  font-weight: 700;
  color: #f56c6c;
}

.plan-traffic {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #606266;
  font-size: 14px;
  margin-bottom: 8px;
}

.plan-description {
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}

.plan-check {
  position: absolute;
  top: 10px;
  right: 10px;
  color: #409eff;
  font-size: 24px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>

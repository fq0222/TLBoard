<template>
  <el-dialog
    v-model="dialogVisible"
    title=""
    :width="dialogWidth"
    :before-close="handleClose"
    class="renew-dialog"
  >
    <div class="renew-dialog-content">
      <section class="renew-hero">
        <div>
        </div>
        <div class="renew-tip-card">
          <span class="tip-title">续费说明</span>
          <p>续费会在现有套餐基础上累加流量，流量用完后 3 天内仍可续费当前套餐。</p>
        </div>
      </section>

      <div v-if="loading" class="loading-container">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载套餐中...</span>
      </div>

      <div v-else-if="plans.length === 0" class="empty-container">
        <el-empty description="暂无可用套餐" />
      </div>

      <template v-else>
        <div class="plans-grid">
          <article
            v-for="plan in displayPlans"
            :key="plan.id"
            class="plan-card"
            :class="{
              'is-selected': selectedPlanId === plan.id,
              'is-current': plan.id === currentPlanId,
              'is-soldout': plan.is_soldout
            }"
            @click="selectPlan(plan)"
          >
            <div class="plan-badges">
              <span v-if="plan.id === currentPlanId" class="plan-badge current">当前套餐</span>
              <span v-if="plan.isRecommended" class="plan-badge recommend">优先推荐</span>
              <span v-if="plan.is_soldout && plan.id !== currentPlanId" class="plan-badge soldout">已售罄</span>
            </div>

            <div class="plan-top">
              <div>
                <h3 class="plan-name">{{ plan.name }}</h3>
                <p class="plan-fit">{{ plan.fitLabel }}</p>
              </div>
              <div class="plan-price">
                <span class="currency">¥</span>
                <span class="amount">{{ formatPrice(plan.price) }}</span>
              </div>
            </div>

            <div class="plan-metrics">
              <div class="metric-item">
                <span>流量</span>
                <strong>{{ formatTraffic(plan.traffic_limit) }}</strong>
              </div>
              <div class="metric-item">
                <span>时长</span>
                <strong>{{ plan.durationText }}</strong>
              </div>
            </div>

            <p v-if="plan.description" class="plan-description">{{ plan.description }}</p>

            <div class="plan-state">
              <span>{{ getStateText(plan) }}</span>
              <el-icon v-if="selectedPlanId === plan.id" class="plan-check"><CircleCheck /></el-icon>
            </div>
          </article>
        </div>

        <section class="pay-section">
          <div class="pay-section-head">
            <div>
              <h3>支付方式</h3>
            </div>
          </div>

          <div class="pay-type-options">
            <label
              class="pay-type-card"
              :class="{ 'is-selected': payType === 9 }"
            >
              <input
                v-model="payType"
                type="radio"
                class="pay-type-input"
                :value="9"
              >
              <div class="pay-type-main">
                <span class="pay-type-icon balance">余</span>
                <span class="pay-type-copy">
                  <strong>余额支付</strong>
                </span>
              </div>
              <el-icon v-if="payType === 9" class="pay-type-check"><CircleCheck /></el-icon>
            </label>

            <label
              class="pay-type-card"
              :class="{ 'is-selected': payType === 2 }"
            >
              <input
                v-model="payType"
                type="radio"
                class="pay-type-input"
                :value="2"
              >
              <div class="pay-type-main">
                <span class="pay-type-icon alipay">支</span>
                <span class="pay-type-copy">
                  <strong>支付宝</strong>
                </span>
              </div>
              <el-icon v-if="payType === 2" class="pay-type-check"><CircleCheck /></el-icon>
            </label>

            <label
              class="pay-type-card"
              :class="{ 'is-selected': payType === 1 }"
            >
              <input
                v-model="payType"
                type="radio"
                class="pay-type-input"
                :value="1"
              >
              <div class="pay-type-main">
                <span class="pay-type-icon wechat">微</span>
                <span class="pay-type-copy">
                  <strong>微信支付</strong>
                </span>
              </div>
              <el-icon v-if="payType === 1" class="pay-type-check"><CircleCheck /></el-icon>
            </label>
          </div>
        </section>
      </template>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button class="footer-button cancel-button" @click="handleClose">取消</el-button>
        <el-button
          type="primary"
          class="footer-button confirm-button"
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { CircleCheck, Loading } from '@element-plus/icons-vue'
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
const payType = ref(1)
const windowWidth = ref(window.innerWidth)

const dialogWidth = computed(() => (windowWidth.value <= 768 ? '94%' : '860px'))

const recommendedPlanId = computed(() => {
  const preferred = plans.value.find((plan) => plan.is_recommended || plan.recommended)
  if (preferred) return preferred.id

  const availablePlans = plans.value.filter((plan) => !plan.is_soldout)
  if (availablePlans.length > 0) return availablePlans[0].id

  return plans.value[0]?.id ?? null
})

const displayPlans = computed(() =>
  plans.value.map((plan) => ({
    ...plan,
    isRecommended: plan.id === recommendedPlanId.value,
    fitLabel: getFitLabel(plan),
    durationText: Number(plan.duration_days) === 0 ? '不限时套餐' : `${plan.duration_days} 天周期`
  }))
)

function handleResize() {
  windowWidth.value = window.innerWidth
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

watch(() => props.visible, (newVal) => {
  if (newVal) {
    fetchPlans()
    selectedPlanId.value = props.currentPlanId || null
    payType.value = 1
  }
})

async function fetchPlans() {
  try {
    loading.value = true
    const result = await api.user.getPlans()
    if (result.code === 0) {
      plans.value = result.data.plans || []
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

function selectPlan(plan) {
  if (plan.is_soldout && plan.id !== props.currentPlanId) {
    ElMessage.warning('该套餐已售罄')
    return
  }
  selectedPlanId.value = plan.id
}

function formatPrice(price) {
  return (Number(price) / 100).toFixed(2)
}

function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '0 B'

  const numBytes = Number(bytes)
  if (Number.isNaN(numBytes)) return '0 B'
  if (numBytes <= 0) return '不限量'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(numBytes) / Math.log(1024)), units.length - 1)
  return `${parseFloat((numBytes / (1024 ** index)).toFixed(2))} ${units[index]}`
}

function getFitLabel(plan) {
  if (plan.description) return '可查看下方套餐说明'

  const duration = Number(plan.duration_days)
  if (duration === 0) return '适合长期维持当前线路'
  if (duration <= 30) return '适合短期补充流量'
  if (duration <= 90) return '适合常规续费'
  return '适合中长期稳定使用'
}

function getStateText(plan) {
  if (plan.id === props.currentPlanId) return '当前正在使用的套餐'
  if (plan.is_soldout) return '暂不可选择该套餐'
  if (selectedPlanId.value === plan.id) return '已选中，提交后进入原续费流程'
  return '点击卡片即可切换为该续费方案'
}

function handleClose() {
  dialogVisible.value = false
}

async function handleRenew() {
  if (!selectedPlanId.value) {
    ElMessage.warning('请选择套餐')
    return
  }

  submitting.value = true

  try {
    emit('renew', { planId: selectedPlanId.value, payType: payType.value })
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
  --text-main: #14213d;
  --text-muted: #5f6c8d;
  --line: rgba(20, 33, 61, 0.08);
  --accent: #0f766e;
  --accent-soft: rgba(15, 118, 110, 0.08);
  min-height: 320px;
}

.renew-hero {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  margin-bottom: 22px;
}

.renew-tip-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px;
  border-radius: 22px;
  background: linear-gradient(145deg, #f7f4e9 0%, #f6fbfa 100%);
  border: 1px solid var(--line);
}

.tip-title {
  display: inline-block;
  color: var(--text-main);
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}

.renew-tip-card p {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.7;
  font-size: 13px;
  text-align: right;
}

.loading-container,
.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 220px;
  color: #909399;
}

.loading-container .is-loading {
  font-size: 32px;
  margin-bottom: 10px;
}

.plans-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.plan-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border-radius: 22px;
  border: 1px solid var(--line);
  background: #fff;
  cursor: pointer;
  transition: 0.25s ease;
}

.plan-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 34px rgba(20, 33, 61, 0.08);
}

.plan-card.is-selected {
  border-color: rgba(15, 118, 110, 0.36);
  background: rgba(15, 118, 110, 0.05);
  box-shadow: 0 18px 36px rgba(15, 118, 110, 0.1);
}

.plan-card.is-current {
  border-color: rgba(103, 194, 58, 0.35);
}

.plan-card.is-soldout {
  opacity: 0.72;
}

.plan-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 28px;
}

.plan-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.plan-badge.current {
  background: rgba(103, 194, 58, 0.12);
  color: #3d8b28;
}

.plan-badge.recommend {
  background: rgba(15, 118, 110, 0.12);
  color: var(--accent);
}

.plan-badge.soldout {
  background: rgba(245, 108, 108, 0.12);
  color: #d9534f;
}

.plan-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}

.plan-name {
  margin: 0;
  color: var(--text-main);
  font-size: 21px;
}

.plan-fit {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.plan-price {
  color: var(--accent);
  white-space: nowrap;
}

.currency {
  font-size: 16px;
}

.amount {
  font-size: 30px;
  font-weight: 800;
  line-height: 1;
}

.plan-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.metric-item {
  padding: 12px 14px;
  border-radius: 16px;
  background: #f7f8fa;
}

.metric-item span {
  display: block;
  margin-bottom: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.metric-item strong {
  color: var(--text-main);
  font-size: 15px;
}

.plan-description {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.8;
}

.plan-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.7;
}

.plan-check {
  color: var(--accent);
  font-size: 20px;
  flex-shrink: 0;
}

.pay-section {
  margin-top: 24px;
  padding: 20px;
  border-radius: 24px;
  background: #f8fafc;
  border: 1px solid var(--line);
}

.pay-section-head h3 {
  margin: 0;
  color: var(--text-main);
  font-size: 18px;
}

.pay-type-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.pay-type-card {
  position: relative;
  display: block;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1.5px solid rgba(20, 33, 61, 0.08);
  background: #fff;
  cursor: pointer;
  transition: 0.25s ease;
}

.pay-type-card.is-selected {
  border-color: rgba(15, 118, 110, 0.36);
  background: var(--accent-soft);
  box-shadow: 0 14px 28px rgba(15, 118, 110, 0.08);
}

.pay-type-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.pay-type-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pay-type-icon {
  width: 42px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
}

.pay-type-icon.alipay {
  background: linear-gradient(135deg, #1677ff, #0958d9);
}

.pay-type-icon.wechat {
  background: linear-gradient(135deg, #07c160, #06ad56);
}

.pay-type-icon.balance {
  background: linear-gradient(135deg, #f59e0b, #d97706);
}

.pay-type-copy {
  display: flex;
  flex-direction: column;
}

.pay-type-copy strong {
  color: var(--text-main);
  font-size: 15px;
}

.pay-type-check {
  position: absolute;
  top: 12px;
  right: 12px;
  color: var(--accent);
  font-size: 20px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.footer-button {
  min-width: 120px;
  height: 44px;
  border-radius: 999px;
}

.cancel-button {
  border-color: rgba(148, 163, 184, 0.4);
  color: #475569;
  background: #fff;
}

.confirm-button {
  border: none;
  background: linear-gradient(135deg, #22c55e 0%, #0f766e 100%);
  box-shadow: 0 12px 24px rgba(15, 118, 110, 0.18);
}

@media (max-width: 768px) {
  .renew-hero {
    gap: 12px;
    margin-bottom: 18px;
  }

  .renew-title {
    font-size: 25px;
  }

  .renew-tip-card {
    display: block;
  }

  .tip-title {
    margin-bottom: 8px;
  }

  .renew-tip-card p {
    text-align: left;
  }

  .plans-grid {
    grid-template-columns: 1fr;
  }

  .plan-card {
    padding: 16px;
    border-radius: 20px;
  }

  .plan-top {
    flex-direction: column;
  }

  .pay-section {
    margin-top: 18px;
    padding: 16px;
    border-radius: 20px;
  }

  .pay-type-options {
    grid-template-columns: 1fr;
  }

  .dialog-footer {
    flex-direction: column;
  }

  .dialog-footer .el-button {
    width: 100%;
    margin-left: 0;
  }

  :deep(.el-dialog) {
    margin-top: 4vh !important;
  }

  :deep(.el-dialog__body) {
    padding: 16px !important;
    max-height: 72vh;
    overflow-y: auto;
  }

  :deep(.el-dialog__footer) {
    padding: 0 16px 16px !important;
  }
}
</style>

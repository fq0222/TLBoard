<template>
  <div class="orders-container">
    <div class="page-header">
      <h1 class="page-title">订单管理</h1>
      <div class="stats-row">
        <div class="stats-card">
          <div class="stats-label">全部订单金额</div>
          <div class="stats-value">¥{{ summary.total_amount }}</div>
        </div>
        <div class="stats-card">
          <div class="stats-label">ORD订单数量</div>
          <div class="stats-value">{{ summary.ord_count }}</div>
        </div>
        <div class="stats-card">
          <div class="stats-label">REN订单数量</div>
          <div class="stats-value">{{ summary.ren_count }}</div>
        </div>
      </div>
    </div>

    <div class="content-card">
      <div class="toolbar">
        <el-input
          v-model="email"
          placeholder="搜索邮箱"
          style="width: 200px; margin-right: 10px;"
          @keyup.enter="fetchOrders"
        />
        <el-select
          v-model="status"
          placeholder="状态筛选"
          clearable
          style="width: 150px; margin-right: 10px;"
          @change="fetchOrders"
        >
          <el-option label="待支付" value="pending" />
          <el-option label="已支付" value="paid" />
          <el-option label="已过期" value="expired" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="margin-right: 10px;"
          @change="fetchOrders"
        />
      </div>

      <div class="tw-hidden md:tw-block">
      <el-table :data="orders" style="width: 100%">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="out_trade_no" label="订单号" />
        <el-table-column prop="email" label="用户邮箱" />
        <el-table-column prop="plan_name" label="套餐" />
        <el-table-column prop="amount_text" label="金额">
          <template #default="scope">¥{{ scope.row.amount_text }}</template>
        </el-table-column>
        <el-table-column prop="status_text" label="状态" width="100">
          <template #default="scope">
            <el-tag :type="getStatusType(scope.row.status)">{{ scope.row.status_text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间">
          <template #default="scope">{{ formatTime(scope.row.created_at) }}</template>
        </el-table-column>
      </el-table>
      </div>

      <div class="tw-grid tw-gap-3 md:tw-hidden">
        <article v-for="order in orders" :key="order.id" class="mobile-order-card">
          <div class="mobile-order-header"><strong>{{ order.out_trade_no }}</strong><el-tag :type="getStatusType(order.status)">{{ order.status_text }}</el-tag></div>
          <div class="mobile-order-row"><span>用户</span><b>{{ order.email }}</b></div>
          <div class="mobile-order-row"><span>套餐</span><b>{{ order.plan_name }}</b></div>
          <div class="mobile-order-row"><span>金额</span><b>¥{{ order.amount_text }}</b></div>
          <div class="mobile-order-row"><span>创建时间</span><b>{{ formatTime(order.created_at) }}</b></div>
        </article>
      </div>

      <div class="pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="limit"
          :total="total"
          :page-sizes="[15, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="fetchOrders"
          @size-change="fetchOrders"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import api from '@/api'

const orders = ref([])
const email = ref('')
const status = ref('')
const dateRange = ref(null)
const page = ref(1)
const limit = ref(15)
const total = ref(0)
const summary = ref({
  total_amount: '0.00',
  ord_count: 0,
  ren_count: 0
})

async function fetchOrders() {
  try {
    const params = {
      page: page.value,
      limit: limit.value
    }
    if (email.value) params.email = email.value
    if (status.value) params.status = status.value
    if (dateRange.value && dateRange.value.length === 2) {
      params.start_date = dateRange.value[0].toISOString().split('T')[0]
      params.end_date = dateRange.value[1].toISOString().split('T')[0]
    }

    const response = await api.admin.getOrders(params)
    if (response.code === 0) {
      orders.value = response.data.list
      total.value = response.data.total
      summary.value = response.data.summary || {
        total_amount: '0.00',
        ord_count: 0,
        ren_count: 0
      }
    }
  } catch (error) {
    console.error('获取订单列表失败:', error)
  }
}

function getStatusType(currentStatus) {
  const typeMap = { pending: 'warning', paid: 'success', expired: 'info' }
  return typeMap[currentStatus] || 'info'
}

function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toLocaleString('zh-CN')
}

onMounted(() => {
  fetchOrders()
})
</script>

<style scoped>
.orders-container { width: 100%; max-width: 100%; }

.page-header { margin-bottom: 30px; }

.page-title {
  margin-bottom: 16px;
  color: #333;
  font-size: 28px;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.stats-card {
  padding: 18px 20px;
  border: 1px solid #dbe7ff;
  border-radius: 12px;
  background: linear-gradient(135deg, #f7faff 0%, #eef4ff 100%);
}

.stats-label {
  margin-bottom: 10px;
  color: #5b6b8a;
  font-size: 14px;
}

.stats-value {
  color: #1f2d3d;
  font-size: 30px;
  font-weight: 700;
  line-height: 1;
}

.content-card {
  padding: 20px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}

.pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

@media (max-width: 960px) {
  .stats-row { grid-template-columns: 1fr; }
}

@media (max-width: 767px) {
  .content-card { padding: 12px; }
  .toolbar { display: grid; gap: 10px; }
  .toolbar :deep(.el-input), .toolbar :deep(.el-select), .toolbar :deep(.el-date-editor) { width: 100% !important; margin-right: 0 !important; }
  .pagination { overflow-x: auto; justify-content: flex-start; }
}
.mobile-order-card { padding: 14px; border: 1px solid #ebeef5; border-radius: 10px; }
.mobile-order-header, .mobile-order-row { display: flex; justify-content: space-between; gap: 12px; }
.mobile-order-header { align-items: center; margin-bottom: 12px; }
.mobile-order-header strong { min-width: 0; overflow-wrap: anywhere; }
.mobile-order-row { padding: 5px 0; }
.mobile-order-row span { color: #909399; }
.mobile-order-row b { text-align: right; overflow-wrap: anywhere; }
</style>

<template>
  <div class="orders-container">
    <div class="page-header">
      <h1 class="page-title">订单管理</h1>
      <p class="page-subtitle">查看和管理订单</p>
    </div>
    
    <div class="content-card">
      <div class="toolbar">
        <el-input v-model="email" placeholder="搜索邮箱" style="width: 200px; margin-right: 10px;" @keyup.enter="fetchOrders" />
        <el-select v-model="status" placeholder="状态筛选" clearable style="width: 150px; margin-right: 10px;" @change="fetchOrders">
          <el-option label="待支付" value="pending" />
          <el-option label="已支付" value="paid" />
          <el-option label="已过期" value="expired" />
        </el-select>
        <el-date-picker v-model="dateRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" style="margin-right: 10px;" @change="fetchOrders" />
      </div>
      
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
      
      <div class="pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="limit"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="fetchOrders"
          @size-change="fetchOrders"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '@/api'

const orders = ref([])
const email = ref('')
const status = ref('')
const dateRange = ref(null)
const page = ref(1)
const limit = ref(10)
const total = ref(0)

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
    }
  } catch (error) {
    console.error('获取订单列表失败:', error)
  }
}

function getStatusType(status) {
  const typeMap = { pending: 'warning', paid: 'success', expired: 'info' }
  return typeMap[status] || 'info'
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
.orders-container { max-width: 1200px; }
.page-header { margin-bottom: 30px; }
.page-title { font-size: 28px; color: #333; margin-bottom: 10px; }
.page-subtitle { color: #666; font-size: 16px; }
.content-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 20px; }
.toolbar { display: flex; align-items: center; margin-bottom: 20px; }
.pagination { margin-top: 20px; display: flex; justify-content: flex-end; }
</style>
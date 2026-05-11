<template>
  <div class="subscription-container" v-loading="loading" element-loading-text="正在同步节点信息，请稍候...">
    <div class="page-header">
      <h1 class="page-title">订阅信息</h1>
      <p class="page-subtitle">查看您的订阅详情和节点信息</p>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">订阅链接</h2>
      <div class="subscription-links">
        <div class="link-group">
          <span class="link-label">通用订阅：</span>
          <el-input v-model="subscription.subscription_url" readonly size="large">
            <template #append>
              <el-button @click="copyLink(subscription.subscription_url)">复制</el-button>
            </template>
          </el-input>
          <p class="link-tip">适用于 v2rayN、V2rayNG、Shadowrocket、Quantumult X 等</p>
        </div>
        <div class="link-group">
          <span class="link-label">Clash订阅：</span>
          <el-input v-model="subscription.clash_url" readonly size="large">
            <template #append>
              <el-button @click="copyLink(subscription.clash_url)">复制</el-button>
            </template>
          </el-input>
          <p class="link-tip">适用于 Clash、Clash Verge、ClashX、Clash for Windows 等</p>
        </div>
      </div>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">账户信息</h2>
      <div class="account-info">
        <div class="info-item">
          <span class="info-label">到期时间：</span>
          <span class="info-value">{{ subscription.expire_text }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">已用流量：</span>
          <span class="info-value">{{ subscription.traffic_used_text }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">流量总量：</span>
          <span class="info-value">{{ subscription.traffic_limit_text }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">使用比例：</span>
          <el-progress 
            :percentage="subscription.traffic_percent || 0" 
            :stroke-width="16"
            :text-inside="true"
            style="width: 200px;"
          />
        </div>
      </div>
    </div>
    
    <div class="content-card">
      <h2 class="card-title">节点列表</h2>
      <el-table :data="subscription.nodes" style="width: 100%">
        <el-table-column prop="node_name" label="节点" min-width="150" />
        <el-table-column prop="address" label="地址" min-width="120" />
        <el-table-column prop="port" label="端口" width="80" />
        <el-table-column label="协议" min-width="200">
          <template #default="{ row }">
            <template v-for="tag in parseProtocol(row.protocol)" :key="tag">
              <el-tag :type="getTagType(tag)" size="small" class="protocol-tag">{{ tag }}</el-tag>
            </template>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" />
      </el-table>
    </div>
  </div>
</template>

<script setup>
/**
 * 订阅信息组件
 * 展示订阅链接、账户信息和节点列表
 */

import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

// 响应式数据
const subscription = ref({})
const loading = ref(false)

/**
 * 获取订阅信息
 */
async function fetchSubscription() {
  try {
    loading.value = true
    const response = await api.user.getSubscription()
    if (response.code === 0) {
      subscription.value = response.data
    }
  } catch (error) {
    console.error('获取订阅信息失败:', error)
  } finally {
    loading.value = false
  }
}

/**
 * 复制链接
 * @param {string} link - 链接地址
 */
function copyLink(link) {
  if (link) {
    navigator.clipboard.writeText(link)
    ElMessage.success('链接已复制到剪贴板')
  }
}

/**
 * 解析协议字符串为标签数组
 * @param {string} protocol - 如 "vless+tcp+reality"
 * @returns {string[]} 标签数组，过滤掉 none
 */
function parseProtocol(protocol) {
  if (!protocol) return []
  return protocol.split('+').filter(tag => tag.toLowerCase() !== 'none')
}

/**
 * 获取标签类型（颜色）
 * @param {string} tag - 标签文本
 * @returns {string} Element Plus tag type
 */
function getTagType(tag) {
  const lower = tag.toLowerCase()
  if (lower === 'vless') return 'primary'
  if (lower === 'vmess') return 'success'
  if (lower === 'trojan') return 'warning'
  if (lower === 'tcp') return 'info'
  if (lower === 'ws') return 'info'
  if (lower === 'reality') return 'danger'
  if (lower === 'tls') return 'danger'
  return ''
}

// 组件挂载时获取数据
onMounted(() => {
  fetchSubscription()
})
</script>

<style scoped>
.subscription-container {
  max-width: 800px;
}

.page-header {
  margin-bottom: 30px;
}

.page-title {
  font-size: 28px;
  color: #333;
  margin-bottom: 10px;
}

.page-subtitle {
  color: #666;
  font-size: 16px;
}

.content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 30px;
  margin-bottom: 20px;
}

.card-title {
  font-size: 20px;
  color: #333;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
}

.subscription-links {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.link-group {
  display: flex;
  flex-direction: column;
}

.link-label {
  margin-bottom: 8px;
  color: #333;
  font-weight: 500;
}

.link-tip {
  margin-top: 8px;
  color: #999;
  font-size: 13px;
}

.account-info {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.info-label {
  color: #666;
  font-weight: 500;
}

.info-value {
  color: #333;
}

.protocol-tag {
  margin-right: 4px;
}
</style>
<template>
  <div class="not-found-container">
    <div class="not-found-content">
      <h1 class="error-code">404</h1>
      <h2 class="error-title">页面不存在</h2>
      <p class="error-message">您访问的页面不存在或已被移除</p>
      <el-button type="primary" size="large" @click="goHome">
        返回首页
      </el-button>
    </div>
  </div>
</template>

<script setup>
/**
 * 404页面组件
 * 当用户访问不存在的页面时显示
 */

import { useRouter } from 'vue-router'

const router = useRouter()

/**
 * 返回首页
 */
function goHome() {
  router.push('/')
}
</script>

<style scoped>
.not-found-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.not-found-content {
  text-align: center;
  color: #fff;
}

.error-code {
  font-size: 120px;
  font-weight: bold;
  margin: 0;
  line-height: 1;
  text-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.error-title {
  font-size: 36px;
  margin: 20px 0 10px;
}

.error-message {
  font-size: 18px;
  margin-bottom: 30px;
  opacity: 0.9;
}
</style>
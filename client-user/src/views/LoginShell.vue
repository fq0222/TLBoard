<!-- 同步登录路由壳：下载表单期间展示布局骨架，失败后刷新当前完整 URL 重试。 -->
<template>
  <component :is="loginPage" v-if="loginPage" />
  <div v-else class="login-loading-container" :aria-busy="pending">
    <div class="login-loading-shell">
      <section class="login-loading-card">
        <template v-if="pending">
          <p role="status" aria-live="polite" class="login-loading-status">
            <span class="loading-spinner" aria-hidden="true"></span>
            正在加载登录页面…
          </p>
          <div data-testid="login-skeleton" class="login-skeleton" aria-hidden="true">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line skeleton-subtitle"></div>
            <div class="skeleton-line skeleton-input"></div>
            <div class="skeleton-line skeleton-input"></div>
            <div class="skeleton-line skeleton-button"></div>
            <div class="skeleton-line skeleton-subtitle"></div>
          </div>
        </template>
        <div v-else role="alert" class="login-loading-error">
          <h2>登录页面加载失败</h2>
          <p>请检查网络连接后重试。</p>
          <a :href="route.fullPath">刷新重试</a>
        </div>
      </section>
      <section class="login-loading-aside" aria-hidden="true">
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line skeleton-panel"></div>
        <div class="skeleton-line skeleton-panel"></div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import { loadLoginPage } from '@/utils/login-page-loader'

const loginPage = shallowRef(null)
const pending = ref(true)
const route = useRoute()

/**
 * 首次挂载时加载完整表单，无参数；不导航以保留当前查询参数。
 * 成功替换骨架，失败吞掉异常并提供原生刷新链接，重建资源加载状态；用户中心预加载由表单挂载负责。
 */
async function loadForm() {
  pending.value = true
  try {
    const module = await loadLoginPage()
    loginPage.value = module.default
  } catch {
    loginPage.value = null
  } finally {
    pending.value = false
  }
}

onMounted(loadForm)
</script>

<style scoped>
.login-loading-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at top left, rgba(15, 118, 110, 0.22), transparent 28%),
    linear-gradient(135deg, #f4f3ed 0%, #eef4f2 48%, #f8f8fb 100%);
}

.login-loading-shell {
  width: 100%;
  max-width: 1120px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(380px, 420px);
  gap: 24px;
}

.login-loading-card,
.login-loading-aside {
  padding: 28px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(20, 33, 61, 0.08);
  box-shadow: 0 24px 60px rgba(20, 33, 61, 0.08);
}

.login-loading-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 24px;
  color: #0b5f58;
}

.loading-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid #d5e7e4;
  border-top-color: #0f766e;
  border-radius: 50%;
  animation: login-spin 0.8s linear infinite;
}

.skeleton-line {
  height: 20px;
  margin-bottom: 22px;
  border-radius: 10px;
  background: #e9eeef;
}

.skeleton-title { width: 65%; height: 34px; }
.skeleton-subtitle { width: 80%; height: 16px; }
.skeleton-input { height: 48px; }
.skeleton-button { height: 52px; background: #d4e7e3; }
.skeleton-panel { height: 100px; }

.login-loading-error h2 { color: #14213d; }
.login-loading-error p { color: #5f6c8d; }
.login-loading-error a {
  display: inline-block;
  padding: 12px 28px;
  border: none;
  border-radius: 12px;
  background: #0f766e;
  color: #fff;
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}

@keyframes login-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .loading-spinner { animation: none; }
}
@media (max-width: 1024px) {
  .login-loading-shell { grid-template-columns: 1fr; max-width: 700px; }
}
@media (max-width: 768px) {
  .login-loading-container { padding: 10px; align-items: flex-start; }
  .login-loading-shell { gap: 10px; }
  .login-loading-card,
  .login-loading-aside { padding: 18px 14px; border-radius: 20px; }
}
</style>

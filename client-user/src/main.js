/**
 * 用户端前端主入口文件
 * 初始化Vue应用、路由、状态管理和UI组件库
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ElMessage } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'

import App from './App.vue'
import router from './router'
import { useUserStore } from './stores/user'
import {
  configureUnauthorizedHandler,
  getSessionExpiredMessage,
  getSessionExpiredNavigation
} from './utils/auth-session'
import { initializeSessionAfterRouterReady } from './utils/app-startup'

// 创建Vue应用实例
const app = createApp(App)

// 创建Pinia状态管理实例
const pinia = createPinia()

// 使用插件
app.use(pinia)

const userStore = useUserStore(pinia)
configureUnauthorizedHandler(async ({ source = 'api', fullPath, skipRedirect = false } = {}) => {
  const currentPath = fullPath || router.currentRoute.value.fullPath
  const navigation = getSessionExpiredNavigation(currentPath)
  userStore.clearToken()
  if (navigation) {
    ElMessage.error(getSessionExpiredMessage(source))
    if (!skipRedirect) await router.replace(navigation)
  }
})
app.use(router)

// 等待初始路由守卫处理完已有 token，再安装会话定时器并挂载应用。
void initializeSessionAfterRouterReady(router, () => {
  userStore.initializeSessionMonitoring()
}).then(() => {
  app.mount('#app')
}).catch(error => {
  console.error('用户端应用挂载失败:', error)
})

console.log('用户端应用启动成功')

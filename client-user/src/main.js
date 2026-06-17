/**
 * 用户端前端主入口文件
 * 初始化Vue应用、路由、状态管理和UI组件库
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'

import App from './App.vue'
import router from './router'

// 创建Vue应用实例
const app = createApp(App)

// 创建Pinia状态管理实例
const pinia = createPinia()

// 使用插件
app.use(pinia)
app.use(router)

// 挂载应用
app.mount('#app')

console.log('用户端应用启动成功')

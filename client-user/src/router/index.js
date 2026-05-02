/**
 * 用户端路由配置
 * 定义页面路由和导航守卫
 */

import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

// 路由配置
const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue'),
    meta: { title: '首页' }
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录', guest: true }
  },
  {
    path: '/user',
    name: 'UserLayout',
    component: () => import('@/views/user/Layout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'UserProfile',
        component: () => import('@/views/user/Profile.vue'),
        meta: { title: '个人中心' }
      },
      {
        path: 'subscription',
        name: 'Subscription',
        component: () => import('@/views/user/Subscription.vue'),
        meta: { title: '订阅信息' }
      },
      {
        path: 'cf-optimize',
        name: 'CfOptimize',
        component: () => import('@/views/user/CfOptimize.vue'),
        meta: { title: 'CF IP优选' }
      }
    ]
  },
  {
    path: '/payment/callback',
    name: 'PaymentCallback',
    component: () => import('@/views/PaymentCallback.vue'),
    meta: { title: '支付回调' }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
    meta: { title: '页面不存在' }
  }
]

// 创建路由实例
const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    } else {
      return { top: 0 }
    }
  }
})

// 全局前置守卫
router.beforeEach((to, from, next) => {
  // 设置页面标题
  document.title = to.meta.title ? `${to.meta.title} - 天澜大陆` : '天澜大陆'
  
  // 获取用户状态
  const userStore = useUserStore()
  
  // 检查是否需要登录
  if (to.meta.requiresAuth && !userStore.isLoggedIn) {
    next({ name: 'Login', query: { redirect: to.fullPath } })
    return
  }
  
  // 检查是否是游客页面（已登录用户不应访问）
  if (to.meta.guest && userStore.isLoggedIn) {
    next({ name: 'UserProfile' })
    return
  }
  
  next()
})

// 全局后置守卫
router.afterEach((to, from) => {
  // 可以在这里添加页面加载完成后的逻辑
  console.log(`页面跳转: ${from.path} -> ${to.path}`)
})

export default router
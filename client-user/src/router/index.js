/**
 * 用户端路由配置
 * 定义页面路由和导航守卫
 */

import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

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
    path: '/forgot-password',
    name: 'ForgotPassword',
    component: () => import('@/views/ForgotPassword.vue'),
    meta: { title: '忘记密码', guest: true }
  },
  {
    path: '/reset-password',
    name: 'ResetPassword',
    component: () => import('@/views/ResetPassword.vue'),
    meta: { title: '重置密码', guest: true }
  },
  {
    path: '/user',
    name: 'UserLayout',
    component: () => import('@/views/user/Layout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'UserHome',
        component: () => import('@/views/user/Profile.vue'),
        meta: { title: '首页' }
      },
      {
        path: 'my',
        name: 'UserProfile',
        component: () => import('@/views/user/My.vue'),
        meta: { title: '我的' }
      },
      {
        path: 'referral',
        name: 'UserReferral',
        component: () => import('@/views/user/Referral.vue'),
        meta: { title: '推广' }
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
        meta: { title: 'CF IP 优选' }
      },
      {
        path: 'tickets',
        name: 'Tickets',
        component: () => import('@/views/user/Tickets.vue'),
        meta: { title: '我的工单' }
      },
      {
        path: 'tickets/create',
        name: 'CreateTicket',
        component: () => import('@/views/user/CreateTicket.vue'),
        meta: { title: '创建工单' }
      },
      {
        path: 'tickets/:id',
        name: 'TicketDetail',
        component: () => import('@/views/user/TicketDetail.vue'),
        meta: { title: '工单详情' }
      },
      {
        path: 'help',
        name: 'HelpCenter',
        component: () => import('@/views/user/HelpCenter.vue'),
        meta: { title: '帮助中心' }
      },
      {
        path: 'help/:id',
        name: 'HelpArticle',
        component: () => import('@/views/user/HelpArticle.vue'),
        meta: { title: '帮助文章' }
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

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    }

    return { top: 0 }
  }
})

router.beforeEach((to, from, next) => {
  document.title = to.meta.title ? `${to.meta.title} - 天澜大陆` : '天澜大陆'

  const userStore = useUserStore()

  if (to.meta.requiresAuth && !userStore.isLoggedIn) {
    next({ name: 'Login', query: { redirect: to.fullPath } })
    return
  }

  if (to.meta.guest && userStore.isLoggedIn) {
    next({ path: '/user' })
    return
  }

  next()
})

router.afterEach((to, from) => {
  console.log(`页面跳转: ${from.path} -> ${to.path}`)
})

export default router

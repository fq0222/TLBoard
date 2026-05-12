/**
 * 管理端路由配置
 * 定义页面路由和导航守卫
 */

import { createRouter, createWebHistory } from 'vue-router'
import { useAdminStore } from '@/stores/admin'

// 路由配置
const routes = [
  {
    path: '/admin/login',
    name: 'AdminLogin',
    component: () => import('@/views/Login.vue'),
    meta: { title: '管理员登录', guest: true }
  },
  {
    path: '/admin',
    name: 'AdminLayout',
    component: () => import('@/views/Layout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '仪表盘' }
      },
      {
        path: 'servers',
        name: 'Servers',
        component: () => import('@/views/Servers.vue'),
        meta: { title: '服务器管理' }
      },
      {
        path: 'servers/:id',
        name: 'ServerDetail',
        component: () => import('@/views/ServerDetail.vue'),
        meta: { title: '服务器详情' }
      },
      {
        path: 'plans',
        name: 'Plans',
        component: () => import('@/views/Plans.vue'),
        meta: { title: '套餐管理' }
      },
      {
        path: 'announcements',
        name: 'Announcements',
        component: () => import('@/views/Announcements.vue'),
        meta: { title: '公告管理' }
      },
      {
        path: 'users',
        name: 'Users',
        component: () => import('@/views/Users.vue'),
        meta: { title: '用户管理' }
      },
      {
        path: 'orders',
        name: 'Orders',
        component: () => import('@/views/Orders.vue'),
        meta: { title: '订单管理' }
      },
      {
        path: 'cf-ips',
        name: 'CfIps',
        component: () => import('@/views/CfIps.vue'),
        meta: { title: 'CF IP池管理' }
      },
      {
        path: 'tickets',
        name: 'Tickets',
        component: () => import('@/views/Tickets.vue'),
        meta: { title: '工单管理' }
      },
      {
        path: 'tickets/:id',
        name: 'TicketDetail',
        component: () => import('@/views/TicketDetail.vue'),
        meta: { title: '工单详情' }
      },
      {
        path: 'email-sender',
        name: 'EmailSender',
        component: () => import('@/views/EmailSender.vue'),
        meta: { title: '发送邮件' }
      },
      {
        path: 'email-campaigns',
        name: 'EmailCampaigns',
        component: () => import('@/views/EmailCampaigns.vue'),
        meta: { title: '群发任务' }
      },
      {
        path: 'email-templates',
        name: 'EmailTemplates',
        component: () => import('@/views/EmailTemplates.vue'),
        meta: { title: '邮件模板' }
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('@/views/Settings.vue'),
        meta: { title: '系统设置' }
      }
    ]
  },
  {
    path: '/',
    redirect: '/admin'
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
  document.title = to.meta.title ? `${to.meta.title} - 管理端` : '管理端'
  
  // 获取管理员状态
  const adminStore = useAdminStore()
  
  // 检查是否需要登录
  if (to.meta.requiresAuth && !adminStore.isLoggedIn) {
    next({ name: 'AdminLogin', query: { redirect: to.fullPath } })
    return
  }
  
  // 检查是否是游客页面（已登录管理员不应访问）
  if (to.meta.guest && adminStore.isLoggedIn) {
    next({ name: 'Dashboard' })
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
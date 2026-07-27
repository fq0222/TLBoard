/**
 * 管理端路由配置。
 * 负责页面路由、登录守卫和标题更新。
 */

import { createRouter, createWebHistory } from 'vue-router'
import { useAdminStore } from '@/stores/admin'

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
        path: 'traffic-stats',
        name: 'TrafficStats',
        component: () => import('@/views/TrafficStats.vue'),
        meta: { title: '数据统计' }
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
        meta: { title: 'CF IP 池管理' }
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
        path: 'email',
        name: 'Email',
        component: () => import('@/views/Email.vue'),
        meta: { title: '邮件管理' }
      },
      {
        path: 'resources',
        name: 'Resources',
        component: () => import('@/views/Resources.vue'),
        meta: { title: '资源管理' }
      },
      {
        path: 'blogs',
        name: 'Blogs',
        component: () => import('@/views/Blogs.vue'),
        meta: { title: '博客管理' }
      },
      {
        path: 'referrals',
        name: 'Referrals',
        component: () => import('@/views/Referrals.vue'),
        meta: { title: '推广管理' }
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
  document.title = to.meta.title ? `${to.meta.title} - 管理端` : '管理端'

  const adminStore = useAdminStore()
  if (to.meta.requiresAuth && !adminStore.isLoggedIn) {
    next({ name: 'AdminLogin', query: { redirect: to.fullPath } })
    return
  }

  if (to.meta.guest && adminStore.isLoggedIn) {
    next({ name: 'Dashboard' })
    return
  }

  next()
})

router.afterEach((to, from) => {
  console.log(`页面跳转: ${from.path} -> ${to.path}`)
})

export default router

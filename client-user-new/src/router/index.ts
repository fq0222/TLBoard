import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(to, from, savedPosition) {
    return savedPosition || { left: 0, top: 0 }
  },
  routes: [
    {
      path: '/',
      name: 'PublicPlans',
      component: () => import('../views/PublicPlans.vue'),
      meta: {
        title: '套餐订阅',
      },
    },
    {
      path: '/plans',
      name: 'PlansSubscriptionAlias',
      component: () => import('../views/PlansSubscription.vue'),
      meta: {
        title: '套餐订阅',
        requiresAuth: true,
      },
    },
    {
      path: '/profile',
      name: 'Profile',
      component: () => import('../views/Ecommerce.vue'),
      meta: {
        title: '个人中心',
        requiresAuth: true,
      },
    },
    {
      path: '/form-elements',
      name: 'Form Elements',
      component: () => import('../views/Forms/FormElements.vue'),
      meta: {
        title: 'Form Elements',
      },
    },
    {
      path: '/basic-tables',
      name: 'Basic Tables',
      component: () => import('../views/Tables/BasicTables.vue'),
      meta: {
        title: 'Basic Tables',
      },
    },
    {
      path: '/line-chart',
      name: 'Line Chart',
      component: () => import('../views/Chart/LineChart/LineChart.vue'),
    },
    {
      path: '/bar-chart',
      name: 'Bar Chart',
      component: () => import('../views/Chart/BarChart/BarChart.vue'),
    },
    {
      path: '/alerts',
      name: 'Alerts',
      component: () => import('../views/UiElements/Alerts.vue'),
      meta: {
        title: 'Alerts',
      },
    },
    {
      path: '/avatars',
      name: 'Avatars',
      component: () => import('../views/UiElements/Avatars.vue'),
      meta: {
        title: 'Avatars',
      },
    },
    {
      path: '/badge',
      name: 'Badge',
      component: () => import('../views/UiElements/Badges.vue'),
      meta: {
        title: 'Badge',
      },
    },

    {
      path: '/buttons',
      name: 'Buttons',
      component: () => import('../views/UiElements/Buttons.vue'),
      meta: {
        title: 'Buttons',
      },
    },

    {
      path: '/images',
      name: 'Images',
      component: () => import('../views/UiElements/Images.vue'),
      meta: {
        title: 'Images',
      },
    },
    {
      path: '/videos',
      name: 'Videos',
      component: () => import('../views/UiElements/Videos.vue'),
      meta: {
        title: 'Videos',
      },
    },
    {
      path: '/blank',
      name: 'Blank',
      component: () => import('../views/Pages/BlankPage.vue'),
      meta: {
        title: 'Blank',
      },
    },

    {
      path: '/error-404',
      name: '404 Error',
      component: () => import('../views/Errors/FourZeroFour.vue'),
      meta: {
        title: '404 Error',
      },
    },

    {
      path: '/signin',
      name: 'Signin',
      component: () => import('../views/Auth/Signin.vue'),
      meta: {
        title: '登录',
        guest: true,
      },
    },
    {
      path: '/login',
      redirect: (to) => ({
        name: 'Signin',
        query: to.query,
      }),
    },
    {
      path: '/forgot-password',
      name: 'ForgotPassword',
      component: () => import('../views/Auth/ForgotPassword.vue'),
      meta: {
        title: '忘记密码',
        guest: true,
      },
    },
    {
      path: '/reset-password',
      name: 'ResetPassword',
      component: () => import('../views/Auth/ResetPassword.vue'),
      meta: {
        title: '重置密码',
        guest: true,
      },
    },
    {
      path: '/payment/callback',
      name: 'PaymentCallback',
      component: () => import('../views/PaymentCallback.vue'),
      meta: {
        title: '支付回调',
      },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('../views/Errors/FourZeroFour.vue'),
      meta: {
        title: '页面不存在',
      },
    },
  ],
})

export default router

router.beforeEach((to, from, next) => {
  document.title = `${to.meta.title || '套餐订阅'} - 天澜大陆`

  const userStore = useUserStore()

  if (to.meta.requiresAuth && !userStore.isLoggedIn.value) {
    next({ name: 'Signin', query: { redirect: to.fullPath } })
    return
  }

  if (to.meta.guest && userStore.isLoggedIn.value && !to.query.plan_id) {
    next({ path: '/profile' })
    return
  }

  next()
})

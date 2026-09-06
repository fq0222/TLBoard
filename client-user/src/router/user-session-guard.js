/**
 * 用户端会话路由决策。
 * 职责：集中处理根目录、访客页和登录页的跳转目标，避免守卫里散落复杂分支。
 */

/**
 * 根据目标路由和当前会话状态计算跳转目标。
 * 关键参数：to 为 vue-router 目标路由，userStore 需提供 ensureValidSession()。
 * 核心分支：根目录有效会话进用户中心；受保护页无效会话进登录；访客页有效会话进用户中心。
 * @param {Object} to - 目标路由对象
 * @param {Object} userStore - 用户状态仓库
 * @returns {Promise<Object|null>} vue-router 跳转目标；null 表示继续当前导航
 */
export async function resolveUserNavigation(to, userStore) {
  const hasValidSession = await userStore.ensureValidSession()

  if (to.path === '/' && hasValidSession) {
    return { path: '/user' }
  }

  if (to.meta.requiresAuth && !hasValidSession) {
    return { name: 'Login', query: { redirect: to.fullPath } }
  }

  if (to.meta.guest && hasValidSession) {
    return { path: '/user' }
  }

  return null
}

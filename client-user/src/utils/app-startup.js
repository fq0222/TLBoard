/**
 * 等待 Vue Router 完成初始导航后再启动会话生命周期监听。
 * 关键参数：router 提供 isReady，initializeSession 安装定时器和浏览器监听。
 * 核心分支：初始导航失败时记录错误且不启动监听，并以 false 正常结束以便应用继续挂载。
 */
export async function initializeSessionAfterRouterReady(
  router,
  initializeSession,
  onError = error => console.error('用户端初始路由加载失败:', error)
) {
  try {
    await router.isReady()
    initializeSession()
    return true
  } catch (error) {
    onError(error)
    return false
  }
}

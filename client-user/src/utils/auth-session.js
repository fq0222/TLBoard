/** 校验登录后的站内跳转地址，拒绝协议相对地址与外部 URL。 */
export function getSafeRedirect(redirect, fallback = '/user') {
  return typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//') && redirect[1] !== '\\'
    ? redirect : fallback
}

/** 受保护用户页失效时保留当前路径；公开页不触发自动跳转。 */
export function getSessionExpiredNavigation(fullPath) {
  if (typeof fullPath !== 'string' || !(fullPath === '/user' || fullPath.startsWith('/user/'))) return null
  return { name: 'Login', query: { redirect: getSafeRedirect(fullPath) } }
}

/**
 * 判断 401 响应是否仍属于当前登录周期。
 * @param {string|null|undefined} requestToken - 请求发送时使用的 token
 * @param {string|null|undefined} currentToken - 收到响应时的当前 token
 */
export function isRequestFromCurrentSession(requestToken, currentToken) {
  return (requestToken || null) === (currentToken || null)
}

/** 根据失效来源返回准确提示，避免把其他标签页主动退出误报为过期。 */
export function getSessionExpiredMessage(source) {
  return source === 'storage' ? '登录状态已变更，请重新登录' : '登录已过期，请重新登录'
}

/** 合并同一登录周期内的并发 401 与本地到期事件。 */
export class UnauthorizedCoordinator {
  constructor({ onUnauthorized = () => {} } = {}) {
    this.onUnauthorized = onUnauthorized
    this.handled = false
    this.promise = null
  }

  /** 更新真正执行清状态、提示与跳转的回调。 */
  setHandler(handler) { this.onUnauthorized = handler }

  /** 首次调用执行处理，后续并发或迟到响应复用同一结果。 */
  handle(context) {
    if (this.handled) return this.promise || Promise.resolve()
    this.handled = true
    this.promise = Promise.resolve(this.onUnauthorized(context))
    return this.promise
  }

  /** 登录成功后解除锁定，允许处理下一个登录周期。 */
  reset() { this.handled = false; this.promise = null }
}

const unauthorizedCoordinator = new UnauthorizedCoordinator()

/** 配置应用级会话失效处理器。 */
export function configureUnauthorizedHandler(handler) { unauthorizedCoordinator.setHandler(handler) }
/** 触发统一会话失效处理，并合并并发调用。 */
export function handleUnauthorized(context) { return unauthorizedCoordinator.handle(context) }
/** 登录成功后重置失效处理锁。 */
export function resetUnauthorizedHandling() { unauthorizedCoordinator.reset() }

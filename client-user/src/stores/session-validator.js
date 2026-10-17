/** 用户会话本地校验器：解析 JWT 到期时间，不请求服务器。 */

/**
 * 解析 JWT 的 exp 字段。
 * @param {string} token - JWT 字符串
 * @returns {number|null} 毫秒级过期时间；格式无效时返回 null
 */
export function getJwtExpiresAt(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padding = '='.repeat((4 - normalized.length % 4) % 4)
    const payload = JSON.parse(globalThis.atob(normalized + padding))
    const expiresAt = payload?.exp * 1000
    return Number.isFinite(payload?.exp) && payload.exp > 0 && Number.isFinite(expiresAt) ? expiresAt : null
  } catch {
    return null
  }
}

/**
 * 管理路由鉴权所需的本地 JWT 校验。
 * 关键参数：getToken 读取当前 token，clearSession 清理 Pinia 与持久化状态。
 * 核心分支：token 缺失、格式无效或已经到期时清理会话；有效时直接放行。
 */
export class SessionValidator {
  constructor({ getToken, clearSession, now = () => Date.now() }) {
    this.getToken = getToken
    this.clearSession = clearSession
    this.now = now
    this.invalidTokenPending = false
  }

  /** 本地校验当前 token，不发起 profile 请求。 */
  async ensureValidSession() {
    const token = this.getToken()
    const expiresAt = getJwtExpiresAt(token)
    if (expiresAt !== null && expiresAt > this.now()) return true
    if (token) this.invalidTokenPending = true
    this.clearSession()
    return false
  }

  /** 返回并消费“本次失败来自已有无效 token”标记，确保只提示一次。 */
  consumeInvalidToken() {
    const pending = this.invalidTokenPending
    this.invalidTokenPending = false
    return pending
  }
}

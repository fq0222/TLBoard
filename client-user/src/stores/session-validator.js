/**
 * 用户会话校验器。
 * 职责：为路由守卫提供轻量登录态确认，避免导航切换时重复请求 profile。
 */

export const SESSION_VALIDATION_CACHE_MS = 10 * 60 * 1000

/**
 * 管理用户会话校验的缓存与并发请求复用。
 * 关键参数：依赖通过构造函数注入，便于 Pinia store 使用并方便单元测试。
 * 核心分支：无 token 直接失败；缓存命中直接成功；并发请求复用同一个 Promise；校验失败清 token。
 */
export class SessionValidator {
  constructor({ getToken, getUserInfo, fetchProfile, setUserInfo, clearToken, now = () => Date.now() }) {
    this.getToken = getToken
    this.getUserInfo = getUserInfo
    this.fetchProfile = fetchProfile
    this.setUserInfo = setUserInfo
    this.clearToken = clearToken
    this.now = now
    this.validatedAt = 0
    this.validationPromise = null
  }

  /**
   * 校验当前 token 是否仍可用。
   * @returns {Promise<boolean>} token 有效时返回 true，否则返回 false。
   */
  async ensureValidSession() {
    if (!this.getToken()) {
      return false
    }

    if (this.isCacheValid()) {
      return true
    }

    if (this.validationPromise) {
      return this.validationPromise
    }

    this.validationPromise = this.validateWithServer()

    try {
      return await this.validationPromise
    } finally {
      this.validationPromise = null
    }
  }

  isCacheValid() {
    return Boolean(this.getUserInfo()) && this.now() - this.validatedAt < SESSION_VALIDATION_CACHE_MS
  }

  async validateWithServer() {
    try {
      const response = await this.fetchProfile()

      if (response.code === 0) {
        this.setUserInfo(response.data)
        this.validatedAt = this.now()
        return true
      }
    } catch (error) {
      console.error('校验用户登录态失败:', error)
    }

    this.validatedAt = 0
    this.clearToken()
    return false
  }
}

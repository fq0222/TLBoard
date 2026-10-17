import { getJwtExpiresAt } from './session-validator.js'

const MAX_TIMEOUT_MS = 2_147_483_647

/** 管理 JWT 到期定时器、页面恢复补查与多标签页同步。 */
export class SessionLifecycle {
  constructor({ getToken, onExpired, onStorageToken = () => {}, now = () => Date.now(),
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = timer => globalThis.clearTimeout(timer), windowTarget = globalThis.window,
    documentTarget = globalThis.document }) {
    this.getToken = getToken
    this.onExpired = onExpired
    this.onStorageToken = onStorageToken
    this.now = now
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.windowTarget = windowTarget
    this.documentTarget = documentTarget
    this.timer = null
    this.initialized = false
    this.expiredHandled = false
    this.handleFocus = () => this.checkExpiry()
    this.handleVisibilityChange = () => {
      if (!this.documentTarget?.hidden) this.checkExpiry()
    }
    this.handleStorage = event => {
      if (event.key !== 'user_token') return
      this.onStorageToken(event.newValue || '')
      if (!event.newValue) {
        this.clearScheduledTimer()
        this.expireOnce({ source: 'storage' })
        return
      }
      this.schedule(event.newValue)
    }
  }

  /** 初始化监听并按当前 token 设置到期任务；重复调用不会重复注册。 */
  initialize() {
    if (this.initialized) return
    this.initialized = true
    this.windowTarget?.addEventListener('focus', this.handleFocus)
    this.windowTarget?.addEventListener('storage', this.handleStorage)
    this.documentTarget?.addEventListener('visibilitychange', this.handleVisibilityChange)
    this.schedule(this.getToken())
  }

  /** 为指定 token 重新安排一次性到期任务；无效或已到期时立即失效。 */
  schedule(token) {
    this.clearScheduledTimer()
    this.expiredHandled = false
    if (!token) return
    const expiresAt = getJwtExpiresAt(token)
    const delay = expiresAt === null ? 0 : expiresAt - this.now()
    if (delay <= 0) return this.expireOnce({ source: 'expiry' })
    this.timer = this.setTimer(() => this.checkExpiry(), Math.min(delay, MAX_TIMEOUT_MS))
  }

  /** 检查当前 token；未到期时重排剩余时长，到期时只处理一次。 */
  checkExpiry() {
    const token = this.getToken()
    if (!token) return
    const expiresAt = getJwtExpiresAt(token)
    if (expiresAt === null || expiresAt <= this.now()) {
      this.clearScheduledTimer()
      return this.expireOnce({ source: 'expiry' })
    }
    this.schedule(token)
  }

  /** 清理定时器和全部浏览器监听，供应用卸载或测试销毁使用。 */
  destroy() {
    this.clearScheduledTimer()
    if (!this.initialized) return
    this.windowTarget?.removeEventListener('focus', this.handleFocus)
    this.windowTarget?.removeEventListener('storage', this.handleStorage)
    this.documentTarget?.removeEventListener('visibilitychange', this.handleVisibilityChange)
    this.initialized = false
  }

  clearScheduledTimer() {
    if (this.timer === null) return
    this.clearTimer(this.timer)
    this.timer = null
  }

  expireOnce(context = { source: 'expiry' }) {
    if (this.expiredHandled) return
    this.expiredHandled = true
    this.onExpired(context)
  }
}

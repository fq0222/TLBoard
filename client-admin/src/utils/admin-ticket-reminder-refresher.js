/**
 * 管理端工单提醒刷新控制器。
 * 职责：按管理端交互时机刷新待处理工单数量，避免路由频繁切换时重复请求。
 */

export const ADMIN_TICKET_ROUTE_REFRESH_COOLDOWN_MS = 3 * 60 * 1000

/**
 * 控制管理端工单提醒刷新节奏。
 * 关键参数：fetchActionRequiredCount 负责请求接口，setActionRequiredCount 负责写回界面状态。
 * 核心分支：路由刷新有 3 分钟冷却；前台恢复和点击可强制刷新；并发刷新复用同一个请求。
 */
export class AdminTicketReminderRefresher {
  constructor({ fetchActionRequiredCount, setActionRequiredCount, now = () => Date.now() }) {
    this.fetchActionRequiredCount = fetchActionRequiredCount
    this.setActionRequiredCount = setActionRequiredCount
    this.now = now
    this.lastRouteRefreshAt = Number.NEGATIVE_INFINITY
    this.refreshPromise = null
  }

  /**
   * 刷新需要管理员处理的工单数量。
   * @param {{ force?: boolean }} options - force 为 true 时跳过路由冷却判断。
   * @returns {Promise<void>}
   */
  async refresh({ force = false } = {}) {
    if (!force && !this.canRefreshAfterRouteChange()) {
      return
    }

    if (this.refreshPromise) {
      return this.refreshPromise
    }

    this.refreshPromise = this.fetchAndUpdate()

    try {
      await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  /**
   * 处理路由切换后的刷新。
   * @returns {Promise<void>}
   */
  async refreshAfterRouteChange() {
    if (!this.canRefreshAfterRouteChange()) {
      return
    }

    this.lastRouteRefreshAt = this.now()
    await this.refresh({ force: true })
  }

  canRefreshAfterRouteChange() {
    return this.now() - this.lastRouteRefreshAt >= ADMIN_TICKET_ROUTE_REFRESH_COOLDOWN_MS
  }

  async fetchAndUpdate() {
    try {
      const response = await this.fetchActionRequiredCount()
      if (response.code === 0) {
        this.setActionRequiredCount(response.data.count || 0)
      }
    } catch (error) {
      console.error('获取管理端工单待处理数量失败:', error)
    }
  }
}

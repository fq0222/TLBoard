/**
 * 未读工单提醒刷新控制器。
 * 职责：降低未读工单数量接口调用频率，同时保留导航、点击和前台恢复等关键刷新时机。
 */

export const TICKET_UNREAD_ROUTE_REFRESH_COOLDOWN_MS = 30 * 1000

/**
 * 控制未读工单数量刷新节奏。
 * 关键参数：fetchUnreadCount 负责请求接口，setUnreadCount 负责写回界面状态。
 * 核心分支：路由刷新有 30 秒冷却；强制刷新跳过冷却；并发刷新复用同一个请求。
 */
export class UnreadTicketRefresher {
  constructor({ fetchUnreadCount, setUnreadCount, now = () => Date.now() }) {
    this.fetchUnreadCount = fetchUnreadCount
    this.setUnreadCount = setUnreadCount
    this.now = now
    this.lastRouteRefreshAt = Number.NEGATIVE_INFINITY
    this.refreshPromise = null
  }

  /**
   * 刷新未读工单数量。
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
    return this.now() - this.lastRouteRefreshAt >= TICKET_UNREAD_ROUTE_REFRESH_COOLDOWN_MS
  }

  async fetchAndUpdate() {
    try {
      const response = await this.fetchUnreadCount()
      if (response.code === 0) {
        this.setUnreadCount(response.data.count || 0)
      }
    } catch (error) {
      console.error('获取未读工单数量失败:', error)
    }
  }
}

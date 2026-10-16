/**
 * 未读工单提醒刷新控制器。
 * 职责：降低未读工单数量接口调用频率，同时保留导航、点击和前台恢复等关键刷新时机。
 */

export const TICKET_UNREAD_REFRESH_INTERVAL_MS = 2 * 60 * 1000

/**
 * 控制未读工单数量刷新节奏。
 * 关键参数：fetchUnreadCount 负责请求接口，setUnreadCount 负责写回界面状态。
 * 核心分支：所有刷新来源共享 2 分钟间隔；首次刷新立即执行；并发刷新复用同一个请求。
 */
export class UnreadTicketRefresher {
  constructor({ fetchUnreadCount, setUnreadCount, now = () => Date.now() }) {
    this.fetchUnreadCount = fetchUnreadCount
    this.setUnreadCount = setUnreadCount
    this.now = now
    this.lastRefreshAt = Number.NEGATIVE_INFINITY
    this.refreshPromise = null
  }

  /**
   * 刷新未读工单数量。
   * @returns {Promise<void>}
   */
  async refresh() {
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    if (!this.canRefresh()) {
      return
    }

    this.lastRefreshAt = this.now()
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
    await this.refresh()
  }

  canRefresh() {
    return this.now() - this.lastRefreshAt >= TICKET_UNREAD_REFRESH_INTERVAL_MS
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

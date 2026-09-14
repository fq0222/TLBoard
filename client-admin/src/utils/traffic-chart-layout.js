const MOBILE_CHART_MAX_WIDTH = 768
const MOBILE_HORIZONTAL_RESERVE = 56
const DESKTOP_HORIZONTAL_RESERVE = 160
const SERVER_SLOT_WIDTH = 70

/**
 * 根据图表容器宽度生成流量柱状图的横向布局。
 * 移动端缩小绘图区两侧留白，并按可用宽度计算首屏服务器数量。
 *
 * @param {number} chartWidth - 图表容器当前宽度（像素）
 * @param {number} viewportWidth - 当前视口宽度，用于区分移动端与窄容器桌面端
 * @returns {{grid: {left: number, right: number}, visibleServerCount: number}} 图表边距与首屏数量
 */
export function getTrafficChartLayout(chartWidth, viewportWidth = chartWidth) {
  const normalizedWidth = Math.max(0, Number(chartWidth) || 0)
  const normalizedViewportWidth = Math.max(0, Number(viewportWidth) || 0)
  const isMobile = normalizedViewportWidth <= MOBILE_CHART_MAX_WIDTH
  const horizontalReserve = isMobile
    ? MOBILE_HORIZONTAL_RESERVE
    : DESKTOP_HORIZONTAL_RESERVE

  return {
    grid: isMobile
      ? { left: 8, right: 8 }
      : { left: 72, right: 36 },
    visibleServerCount: Math.max(
      1,
      Math.floor(Math.max(0, normalizedWidth - horizontalReserve) / SERVER_SLOT_WIDTH)
    )
  }
}

/**
 * 将流量计数器输入归一化为非负有限数值。
 * @param {*} value - 3X-UI 累计流量或本地同步基线。
 * @returns {number} 可参与增量计算的非负数值。
 */
function normalizeTrafficValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * 计算可重置的 3X-UI 服务器级累计流量增量。
 * 职责：正常增长时取当前值与旧基线之差；计数器回退时将当前值视为重置后的新增量。
 * 关键参数：currentTraffic 为远端当前累计值，lastSyncTraffic 为本地旧基线，multiplier 为统计倍率。
 * 核心分支：只有当前值严格小于旧基线才判定为重置，最终增量统一应用倍率并四舍五入。
 *
 * @param {number|string} currentTraffic - 远端当前累计流量。
 * @param {number|string} lastSyncTraffic - 上次同步累计流量。
 * @param {number|string} [multiplier=1] - 流量统计倍率。
 * @returns {{rawIncrement:number,increment:number,resetDetected:boolean}} 原始增量、倍率后增量和重置标记。
 */
function calculateTrafficCounterIncrement(currentTraffic, lastSyncTraffic, multiplier = 1) {
  const current = normalizeTrafficValue(currentTraffic);
  const previous = normalizeTrafficValue(lastSyncTraffic);
  const parsedMultiplier = Number(multiplier);
  const safeMultiplier = Number.isFinite(parsedMultiplier) && parsedMultiplier >= 0
    ? parsedMultiplier
    : 1;
  const resetDetected = current < previous;
  const rawIncrement = resetDetected ? current : current - previous;

  return {
    rawIncrement,
    increment: Math.round(rawIncrement * safeMultiplier),
    resetDetected
  };
}

module.exports = {
  calculateTrafficCounterIncrement
};

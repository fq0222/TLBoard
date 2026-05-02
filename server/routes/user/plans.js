/**
 * 用户端套餐路由
 * 处理套餐列表查询
 */

const express = require('express');
const router = express.Router();

// 日志工具
const logger = {
  info: (msg) => console.log(`[USER-PLANS] [INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[USER-PLANS] [ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[USER-PLANS] [WARN] ${new Date().toISOString()} - ${msg}`)
};

/**
 * GET /api/user/plans
 * 获取已上架套餐列表
 */
router.get('/', async (req, res) => {
  try {
    const db = req.app.locals.db;

    // 查询已上架套餐
    const plans = await db.prepare(`
      SELECT id, name, description, price, duration_days, traffic_limit, sort_order
      FROM plans 
      WHERE enabled = 1 
      ORDER BY sort_order ASC, id ASC
    `).all();

    // 格式化套餐数据
    const formattedPlans = plans.map(plan => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      price_text: (plan.price / 100).toFixed(2),
      duration_days: plan.duration_days,
      traffic_limit: plan.traffic_limit,
      traffic_text: formatTraffic(plan.traffic_limit),
      sort_order: plan.sort_order
    }));

    logger.info(`获取套餐列表成功，共 ${formattedPlans.length} 个套餐`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        plans: formattedPlans
      }
    });
  } catch (error) {
    logger.error(`获取套餐列表错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * 格式化流量显示
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的流量字符串
 */
function formatTraffic(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = router;
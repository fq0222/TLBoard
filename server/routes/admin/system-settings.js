const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-SYSTEM-SETTINGS');

const TRAFFIC_USAGE_MULTIPLIER_KEY = 'traffic_usage_multiplier';
const DEFAULT_TRAFFIC_USAGE_MULTIPLIER = 1.0;

async function getTrafficUsageMultiplier(db) {
  const row = await db.prepare('SELECT value FROM system_settings WHERE key = ?').get(TRAFFIC_USAGE_MULTIPLIER_KEY);
  const multiplier = Number(row?.value);
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    return DEFAULT_TRAFFIC_USAGE_MULTIPLIER;
  }
  return multiplier;
}

async function saveTrafficUsageMultiplier(db, multiplier) {
  const now = Math.floor(Date.now() / 1000);
  await db.pool.query(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `, [TRAFFIC_USAGE_MULTIPLIER_KEY, String(multiplier), now]);
}

router.get('/traffic', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const traffic_usage_multiplier = await getTrafficUsageMultiplier(db);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        traffic_usage_multiplier
      }
    });
  } catch (error) {
    logger.error(`获取流量配置失败: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

router.put('/traffic', authenticateAdmin, [
  body('traffic_usage_multiplier')
    .isFloat({ min: 0, max: 100 })
    .withMessage('流量统计倍率必须是0到100之间的数字')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const db = req.app.locals.db;
    const traffic_usage_multiplier = Number(req.body.traffic_usage_multiplier);
    await saveTrafficUsageMultiplier(db, traffic_usage_multiplier);

    logger.info(`保存流量统计倍率成功: ${traffic_usage_multiplier}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        traffic_usage_multiplier
      }
    });
  } catch (error) {
    logger.error(`保存流量配置失败: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

module.exports = router;

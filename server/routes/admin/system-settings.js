const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-SYSTEM-SETTINGS');

const TRAFFIC_USAGE_MULTIPLIER_KEY = 'traffic_usage_multiplier';
const DEFAULT_TRAFFIC_USAGE_MULTIPLIER = 1.0;
const CLASH_CONFIG_NAME_KEY = 'clash_config_name';
const CLASH_PROFILE_UPDATE_INTERVAL_KEY = 'clash_profile_update_interval';
const DEFAULT_CLASH_CONFIG_NAME = '天澜大陆';
const DEFAULT_CLASH_PROFILE_UPDATE_INTERVAL = 2;

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

/**
 * 读取单个系统设置值。
 *
 * @param {Object} db - 数据库实例
 * @param {string} key - 配置键名
 * @returns {Promise<string|undefined>} 配置值
 */
async function getSystemSettingValue(db, key) {
  const row = await db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
  return row?.value;
}

/**
 * 保存单个系统设置值。
 * 核心分支：存在时更新，不存在时插入，避免 PostgreSQL prepare().run() 追加 RETURNING。
 *
 * @param {Object} db - 数据库实例
 * @param {string} key - 配置键名
 * @param {string|number} value - 配置值
 * @returns {Promise<void>}
 */
async function saveSystemSettingValue(db, key, value) {
  const now = Math.floor(Date.now() / 1000);
  await db.pool.query(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `, [key, String(value), now]);
}

/**
 * 读取订阅客户端响应头配置。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<{clash_config_name:string,clash_profile_update_interval:number}>} 订阅配置
 */
async function getSubscriptionConfig(db) {
  const [configNameValue, updateIntervalValue] = await Promise.all([
    getSystemSettingValue(db, CLASH_CONFIG_NAME_KEY),
    getSystemSettingValue(db, CLASH_PROFILE_UPDATE_INTERVAL_KEY)
  ]);
  const updateInterval = Number(updateIntervalValue);

  return {
    clash_config_name: String(configNameValue || '').trim() || DEFAULT_CLASH_CONFIG_NAME,
    clash_profile_update_interval: Number.isFinite(updateInterval) && updateInterval > 0
      ? updateInterval
      : DEFAULT_CLASH_PROFILE_UPDATE_INTERVAL
  };
}

/**
 * 保存订阅客户端响应头配置。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} config - 订阅配置
 * @param {string} config.clash_config_name - Clash 订阅下载名称
 * @param {number} config.clash_profile_update_interval - 自动更新间隔（小时）
 * @returns {Promise<void>}
 */
async function saveSubscriptionConfig(db, config) {
  await Promise.all([
    saveSystemSettingValue(db, CLASH_CONFIG_NAME_KEY, String(config.clash_config_name).trim()),
    saveSystemSettingValue(db, CLASH_PROFILE_UPDATE_INTERVAL_KEY, Number(config.clash_profile_update_interval))
  ]);
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

router.get('/subscription', authenticateAdmin, async (req, res) => {
  try {
    const data = await getSubscriptionConfig(req.app.locals.db);
    res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    logger.error(`获取订阅配置失败: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

router.put('/subscription', authenticateAdmin, [
  body('clash_config_name')
    .trim()
    .notEmpty()
    .withMessage('订阅名称不能为空')
    .isLength({ max: 100 })
    .withMessage('订阅名称不能超过100个字符'),
  body('clash_profile_update_interval')
    .isInt({ min: 1, max: 168 })
    .withMessage('自动更新间隔必须是1到168之间的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 1001,
        message: errors.array()[0]?.msg || '参数校验失败',
        data: null
      });
    }

    const data = {
      clash_config_name: String(req.body.clash_config_name).trim(),
      clash_profile_update_interval: Number(req.body.clash_profile_update_interval)
    };
    await saveSubscriptionConfig(req.app.locals.db, data);

    logger.info(`保存订阅配置成功: name=${data.clash_config_name}, interval=${data.clash_profile_update_interval}`);
    res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    logger.error(`保存订阅配置失败: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

router.getSubscriptionConfig = getSubscriptionConfig;
router.saveSubscriptionConfig = saveSubscriptionConfig;

module.exports = router;

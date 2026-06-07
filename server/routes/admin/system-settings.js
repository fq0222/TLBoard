const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-SYSTEM-SETTINGS');

const TRAFFIC_USAGE_MULTIPLIER_KEY = 'traffic_usage_multiplier';
const DEFAULT_TRAFFIC_USAGE_MULTIPLIER = 1.0;
const REFERRAL_REWARD_TRAFFIC_KEY = 'referral_reward_traffic';
const DEFAULT_REFERRAL_REWARD_TRAFFIC = 0;
const CLASH_CONFIG_NAME_KEY = 'clash_config_name';
const CLASH_PROFILE_UPDATE_INTERVAL_KEY = 'clash_profile_update_interval';
const TELEGRAM_CHANNEL_URL_KEY = 'telegram_channel_url';
const DEFAULT_CLASH_CONFIG_NAME = '天涯大陆';
const DEFAULT_CLASH_PROFILE_UPDATE_INTERVAL = 2;

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
 * 读取流量配置。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<{traffic_usage_multiplier:number,referral_reward_traffic:number}>} 流量配置
 */
async function getTrafficConfig(db) {
  const [multiplierValue, rewardTrafficValue] = await Promise.all([
    getSystemSettingValue(db, TRAFFIC_USAGE_MULTIPLIER_KEY),
    getSystemSettingValue(db, REFERRAL_REWARD_TRAFFIC_KEY)
  ]);
  const trafficUsageMultiplier = Number(multiplierValue);
  const referralRewardTraffic = Number(rewardTrafficValue);

  return {
    traffic_usage_multiplier: Number.isFinite(trafficUsageMultiplier) && trafficUsageMultiplier >= 0
      ? trafficUsageMultiplier
      : DEFAULT_TRAFFIC_USAGE_MULTIPLIER,
    referral_reward_traffic: Number.isFinite(referralRewardTraffic) && referralRewardTraffic >= 0
      ? Math.floor(referralRewardTraffic)
      : DEFAULT_REFERRAL_REWARD_TRAFFIC
  };
}

/**
 * 保存流量配置。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 流量配置
 * @param {number} payload.traffic_usage_multiplier - 流量统计倍率
 * @param {number} payload.referral_reward_traffic - 推广奖励流量字节数
 * @returns {Promise<void>}
 */
async function saveTrafficConfig(db, payload) {
  await Promise.all([
    saveSystemSettingValue(db, TRAFFIC_USAGE_MULTIPLIER_KEY, Number(payload.traffic_usage_multiplier)),
    saveSystemSettingValue(db, REFERRAL_REWARD_TRAFFIC_KEY, Math.floor(Number(payload.referral_reward_traffic)))
  ]);
}

/**
 * 读取订阅响应配置。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<{clash_config_name:string,clash_profile_update_interval:number,telegram_channel_url:string}>} 订阅配置
 */
async function getSubscriptionConfig(db) {
  const [configNameValue, updateIntervalValue, telegramChannelUrlValue] = await Promise.all([
    getSystemSettingValue(db, CLASH_CONFIG_NAME_KEY),
    getSystemSettingValue(db, CLASH_PROFILE_UPDATE_INTERVAL_KEY),
    getSystemSettingValue(db, TELEGRAM_CHANNEL_URL_KEY)
  ]);
  const updateInterval = Number(updateIntervalValue);

  return {
    clash_config_name: String(configNameValue || '').trim() || DEFAULT_CLASH_CONFIG_NAME,
    clash_profile_update_interval: Number.isFinite(updateInterval) && updateInterval > 0
      ? updateInterval
      : DEFAULT_CLASH_PROFILE_UPDATE_INTERVAL,
    telegram_channel_url: String(telegramChannelUrlValue || '').trim()
  };
}

/**
 * 保存订阅响应配置。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} config - 订阅配置
 * @param {string} config.clash_config_name - Clash 订阅下载名称
 * @param {number} config.clash_profile_update_interval - 自动更新间隔（小时）
 * @param {string} config.telegram_channel_url - 官方 Telegram 频道链接
 * @returns {Promise<void>}
 */
async function saveSubscriptionConfig(db, config) {
  await Promise.all([
    saveSystemSettingValue(db, CLASH_CONFIG_NAME_KEY, String(config.clash_config_name).trim()),
    saveSystemSettingValue(db, CLASH_PROFILE_UPDATE_INTERVAL_KEY, Number(config.clash_profile_update_interval)),
    saveSystemSettingValue(db, TELEGRAM_CHANNEL_URL_KEY, String(config.telegram_channel_url || '').trim())
  ]);
}

/**
 * 处理 express-validator 校验失败。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {boolean} 是否已返回错误响应
 */
function handleValidationFailure(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }

  return res.status(400).json({
    code: 1001,
    message: errors.array()[0]?.msg || '参数校验失败',
    data: null
  });
}

router.get('/traffic', authenticateAdmin, async (req, res) => {
  try {
    const data = await getTrafficConfig(req.app.locals.db);
    res.json({
      code: 0,
      message: 'ok',
      data
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
    .withMessage('流量统计倍率必须是 0 到 100 之间的数字'),
  body('referral_reward_traffic')
    .isInt({ min: 0 })
    .withMessage('推广奖励流量必须是大于等于 0 的整数')
], async (req, res) => {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = {
      traffic_usage_multiplier: Number(req.body.traffic_usage_multiplier),
      referral_reward_traffic: Math.floor(Number(req.body.referral_reward_traffic))
    };
    await saveTrafficConfig(req.app.locals.db, data);

    logger.info(
      `保存流量配置成功: multiplier=${data.traffic_usage_multiplier}, referralRewardTraffic=${data.referral_reward_traffic}`
    );
    res.json({
      code: 0,
      message: 'ok',
      data
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
    .withMessage('订阅名称不能超过 100 个字符'),
  body('clash_profile_update_interval')
    .isInt({ min: 1, max: 168 })
    .withMessage('自动更新间隔必须是 1 到 168 之间的整数'),
  body('telegram_channel_url')
    .optional({ checkFalsy: true })
    .trim()
    .isURL({ require_protocol: true, protocols: ['http', 'https'] })
    .withMessage('Telegram 频道链接必须是有效的 http 或 https 地址')
], async (req, res) => {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = {
      clash_config_name: String(req.body.clash_config_name).trim(),
      clash_profile_update_interval: Number(req.body.clash_profile_update_interval),
      telegram_channel_url: String(req.body.telegram_channel_url || '').trim()
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

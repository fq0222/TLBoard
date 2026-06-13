const { getUnixTimestamp } = require('../../shared/utils/time');
const systemSettingsRepository = require('../../repositories/system-settings-repository');

const TRAFFIC_USAGE_MULTIPLIER_KEY = 'traffic_usage_multiplier';
const REFERRAL_REWARD_TRAFFIC_KEY = 'referral_reward_traffic';
const CLASH_CONFIG_NAME_KEY = 'clash_config_name';
const CLASH_PROFILE_UPDATE_INTERVAL_KEY = 'clash_profile_update_interval';
const TELEGRAM_CHANNEL_URL_KEY = 'telegram_channel_url';
const ONLINE_CUSTOMER_SERVICE_URL_KEY = 'online_customer_service_url';
const BREVO_API_KEY = 'brevo_api_key';
const BREVO_SENDER_EMAIL_KEY = 'brevo_sender_email';
const BREVO_SENDER_NAME_KEY = 'brevo_sender_name';
const BREVO_DAILY_LIMIT_KEY = 'brevo_daily_limit';
const BREVO_CAMPAIGN_DAILY_LIMIT_KEY = 'brevo_campaign_daily_limit';
const RESOURCE_CONFIG_KEY = 'resource_config';

const DEFAULT_TRAFFIC_USAGE_MULTIPLIER = 1.0;
const DEFAULT_REFERRAL_REWARD_TRAFFIC = 0;
const DEFAULT_CLASH_CONFIG_NAME = '天涯大陆';
const DEFAULT_CLASH_PROFILE_UPDATE_INTERVAL = 2;
const DEFAULT_EMAIL_CONFIG = {
  api_key: '',
  sender_email: '',
  sender_name: '',
  daily_limit: 200,
  campaign_daily_limit: 100
};
const DEFAULT_RESOURCE_CONFIG = {
  max_file_size: 100,
  download_speed_limit: 0
};

/**
 * 管理端系统设置服务。
 * 职责：集中维护系统设置 key、默认值与数据归一化规则，路由和控制器不直接接触存储细节。
 */

/**
 * 读取单个设置值。
 *
 * @param {Object} db - 数据库实例
 * @param {string} key - 设置键名
 * @returns {Promise<string|undefined>} 设置值
 */
async function getSystemSettingValue(db, key) {
  const row = await systemSettingsRepository.findSettingByKey(db, key);
  return row?.value;
}

/**
 * 保存单个设置值。
 *
 * @param {Object} db - 数据库实例
 * @param {string} key - 设置键名
 * @param {string|number} value - 设置值
 * @returns {Promise<void>}
 */
async function saveSystemSettingValue(db, key, value) {
  await systemSettingsRepository.saveSetting(db, key, value, getUnixTimestamp());
}

/**
 * 规范化可公开跳转链接。
 * 核心分支：空值返回空字符串；非空值只做 trim，URL 合法性由路由校验负责。
 *
 * @param {*} value - 原始链接值
 * @returns {string} 归一化后的链接
 */
function normalizeOptionalUrl(value) {
  return String(value || '').trim();
}

/**
 * 规范化正整数设置。
 * 核心分支：非法值或空值使用默认值；合法值取整数，保持旧配置接口宽容行为。
 *
 * @param {*} value - 原始数值
 * @param {number} defaultValue - 默认值
 * @returns {number} 归一化后的正整数
 */
function normalizePositiveInteger(value, defaultValue) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : defaultValue;
}

/**
 * 规范化非负整数设置。
 *
 * @param {*} value - 原始数值
 * @param {number} defaultValue - 默认值
 * @returns {number} 归一化后的非负整数
 */
function normalizeNonNegativeInteger(value, defaultValue) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue >= 0
    ? parsedValue
    : defaultValue;
}

/**
 * 读取流量配置。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<{traffic_usage_multiplier:number,referral_reward_traffic:number}>} 流量配置
 */
async function getTrafficConfig(db) {
  const settings = await systemSettingsRepository.findSettingsByKeys(db, [
    TRAFFIC_USAGE_MULTIPLIER_KEY,
    REFERRAL_REWARD_TRAFFIC_KEY
  ]);
  const trafficUsageMultiplier = Number(settings[TRAFFIC_USAGE_MULTIPLIER_KEY]);
  const referralRewardTraffic = Number(settings[REFERRAL_REWARD_TRAFFIC_KEY]);

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
 * @returns {Promise<Object>} 保存后的流量配置
 */
async function saveTrafficConfig(db, payload) {
  const config = {
    traffic_usage_multiplier: Number(payload.traffic_usage_multiplier),
    referral_reward_traffic: Math.floor(Number(payload.referral_reward_traffic))
  };

  await Promise.all([
    saveSystemSettingValue(db, TRAFFIC_USAGE_MULTIPLIER_KEY, config.traffic_usage_multiplier),
    saveSystemSettingValue(db, REFERRAL_REWARD_TRAFFIC_KEY, config.referral_reward_traffic)
  ]);

  return config;
}

/**
 * 读取邮件配置。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} Brevo 邮件配置
 */
async function getEmailConfig(db) {
  const settings = await systemSettingsRepository.findSettingsByKeys(db, [
    BREVO_API_KEY,
    BREVO_SENDER_EMAIL_KEY,
    BREVO_SENDER_NAME_KEY,
    BREVO_DAILY_LIMIT_KEY,
    BREVO_CAMPAIGN_DAILY_LIMIT_KEY
  ]);

  return {
    api_key: String(settings[BREVO_API_KEY] || '').trim(),
    sender_email: String(settings[BREVO_SENDER_EMAIL_KEY] || '').trim(),
    sender_name: String(settings[BREVO_SENDER_NAME_KEY] || '').trim(),
    daily_limit: normalizePositiveInteger(settings[BREVO_DAILY_LIMIT_KEY], DEFAULT_EMAIL_CONFIG.daily_limit),
    campaign_daily_limit: normalizePositiveInteger(
      settings[BREVO_CAMPAIGN_DAILY_LIMIT_KEY],
      DEFAULT_EMAIL_CONFIG.campaign_daily_limit
    )
  };
}

/**
 * 保存邮件配置。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 邮件配置表单
 * @returns {Promise<Object>} 保存后的邮件配置
 */
async function saveEmailConfig(db, payload) {
  const config = {
    api_key: String(payload.api_key || '').trim(),
    sender_email: String(payload.sender_email || '').trim(),
    sender_name: String(payload.sender_name || '').trim(),
    daily_limit: normalizePositiveInteger(payload.daily_limit, DEFAULT_EMAIL_CONFIG.daily_limit),
    campaign_daily_limit: normalizePositiveInteger(
      payload.campaign_daily_limit,
      DEFAULT_EMAIL_CONFIG.campaign_daily_limit
    )
  };

  await Promise.all([
    saveSystemSettingValue(db, BREVO_API_KEY, config.api_key),
    saveSystemSettingValue(db, BREVO_SENDER_EMAIL_KEY, config.sender_email),
    saveSystemSettingValue(db, BREVO_SENDER_NAME_KEY, config.sender_name),
    saveSystemSettingValue(db, BREVO_DAILY_LIMIT_KEY, config.daily_limit),
    saveSystemSettingValue(db, BREVO_CAMPAIGN_DAILY_LIMIT_KEY, config.campaign_daily_limit)
  ]);

  return config;
}

/**
 * 读取资源管理配置。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<{max_file_size:number,download_speed_limit:number}>} 资源配置
 */
async function getResourceConfig(db) {
  const value = await getSystemSettingValue(db, RESOURCE_CONFIG_KEY);
  if (!value) {
    return { ...DEFAULT_RESOURCE_CONFIG };
  }

  try {
    const parsedConfig = JSON.parse(value);
    return {
      max_file_size: normalizePositiveInteger(
        parsedConfig.max_file_size,
        DEFAULT_RESOURCE_CONFIG.max_file_size
      ),
      download_speed_limit: normalizeNonNegativeInteger(
        parsedConfig.download_speed_limit,
        DEFAULT_RESOURCE_CONFIG.download_speed_limit
      )
    };
  } catch (error) {
    return { ...DEFAULT_RESOURCE_CONFIG };
  }
}

/**
 * 保存资源管理配置。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 资源配置表单
 * @returns {Promise<{max_file_size:number,download_speed_limit:number}>} 保存后的资源配置
 */
async function saveResourceConfig(db, payload) {
  const config = {
    max_file_size: normalizePositiveInteger(payload.max_file_size, DEFAULT_RESOURCE_CONFIG.max_file_size),
    download_speed_limit: normalizeNonNegativeInteger(
      payload.download_speed_limit,
      DEFAULT_RESOURCE_CONFIG.download_speed_limit
    )
  };

  await saveSystemSettingValue(db, RESOURCE_CONFIG_KEY, JSON.stringify(config));

  return config;
}

/**
 * 读取订阅与公开链接配置。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 订阅配置
 */
async function getSubscriptionConfig(db) {
  const settings = await systemSettingsRepository.findSettingsByKeys(db, [
    CLASH_CONFIG_NAME_KEY,
    CLASH_PROFILE_UPDATE_INTERVAL_KEY,
    TELEGRAM_CHANNEL_URL_KEY,
    ONLINE_CUSTOMER_SERVICE_URL_KEY
  ]);
  const updateInterval = Number(settings[CLASH_PROFILE_UPDATE_INTERVAL_KEY]);

  return {
    clash_config_name: String(settings[CLASH_CONFIG_NAME_KEY] || '').trim() || DEFAULT_CLASH_CONFIG_NAME,
    clash_profile_update_interval: Number.isFinite(updateInterval) && updateInterval > 0
      ? updateInterval
      : DEFAULT_CLASH_PROFILE_UPDATE_INTERVAL,
    telegram_channel_url: normalizeOptionalUrl(settings[TELEGRAM_CHANNEL_URL_KEY]),
    online_customer_service_url: normalizeOptionalUrl(settings[ONLINE_CUSTOMER_SERVICE_URL_KEY])
  };
}

/**
 * 保存订阅与公开链接配置。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} config - 订阅配置
 * @param {string} config.clash_config_name - Clash 订阅下载名称
 * @param {number} config.clash_profile_update_interval - 自动更新间隔（小时）
 * @param {string} config.telegram_channel_url - 官方 Telegram 频道链接
 * @param {string} config.online_customer_service_url - 在线客服链接
 * @returns {Promise<Object>} 保存后的订阅配置
 */
async function saveSubscriptionConfig(db, config) {
  const normalizedConfig = {
    clash_config_name: String(config.clash_config_name).trim(),
    clash_profile_update_interval: Number(config.clash_profile_update_interval),
    telegram_channel_url: normalizeOptionalUrl(config.telegram_channel_url),
    online_customer_service_url: normalizeOptionalUrl(config.online_customer_service_url)
  };

  await Promise.all([
    saveSystemSettingValue(db, CLASH_CONFIG_NAME_KEY, normalizedConfig.clash_config_name),
    saveSystemSettingValue(db, CLASH_PROFILE_UPDATE_INTERVAL_KEY, normalizedConfig.clash_profile_update_interval),
    saveSystemSettingValue(db, TELEGRAM_CHANNEL_URL_KEY, normalizedConfig.telegram_channel_url),
    saveSystemSettingValue(db, ONLINE_CUSTOMER_SERVICE_URL_KEY, normalizedConfig.online_customer_service_url)
  ]);

  return normalizedConfig;
}

/**
 * 读取公开在线客服链接。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<string>} 在线客服链接
 */
async function getOnlineCustomerServiceUrl(db) {
  const value = await getSystemSettingValue(db, ONLINE_CUSTOMER_SERVICE_URL_KEY);
  return normalizeOptionalUrl(value);
}

module.exports = {
  keys: {
    TRAFFIC_USAGE_MULTIPLIER_KEY,
    REFERRAL_REWARD_TRAFFIC_KEY,
    CLASH_CONFIG_NAME_KEY,
    CLASH_PROFILE_UPDATE_INTERVAL_KEY,
    TELEGRAM_CHANNEL_URL_KEY,
    ONLINE_CUSTOMER_SERVICE_URL_KEY,
    BREVO_API_KEY,
    BREVO_SENDER_EMAIL_KEY,
    BREVO_SENDER_NAME_KEY,
    BREVO_DAILY_LIMIT_KEY,
    BREVO_CAMPAIGN_DAILY_LIMIT_KEY,
    RESOURCE_CONFIG_KEY
  },
  getSystemSettingValue,
  saveSystemSettingValue,
  getTrafficConfig,
  saveTrafficConfig,
  getEmailConfig,
  saveEmailConfig,
  getResourceConfig,
  saveResourceConfig,
  getSubscriptionConfig,
  saveSubscriptionConfig,
  getOnlineCustomerServiceUrl
};

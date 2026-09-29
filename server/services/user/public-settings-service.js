const systemSettingsRepository = require('../../repositories/system-settings-repository');

const ONLINE_CUSTOMER_SERVICE_URL_KEY = 'online_customer_service_url';
const RESOURCE_CONFIG_KEY = 'resource_config';

/**
 * 用户端公开设置服务。
 * 职责：只输出允许匿名访问的设置白名单，避免把 system_settings 整体暴露给前端。
 */

/**
 * 规范化公开链接。
 * 核心分支：未配置返回空字符串；已配置仅 trim，后台保存阶段负责 URL 校验。
 *
 * @param {*} value - 原始设置值
 * @returns {string} 公开链接
 */
function normalizePublicUrl(value) {
  return String(value || '').trim();
}

/**
 * 获取用户端匿名可读取的公开设置。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<{online_customer_service_url:string,home_ip_info_url:string}>} 公开设置
 */
async function getPublicSettings(db) {
  const [row, resourceRow] = await Promise.all([
    systemSettingsRepository.findSettingByKey(db, ONLINE_CUSTOMER_SERVICE_URL_KEY),
    systemSettingsRepository.findSettingByKey(db, RESOURCE_CONFIG_KEY)
  ]);
  let homeIpInfoUrl = '';
  try {
    homeIpInfoUrl = normalizePublicUrl(JSON.parse(resourceRow?.value || '{}').home_ip_info_url);
  } catch (error) {
    // 历史资源配置损坏时仍返回公开设置默认值。
  }

  return {
    online_customer_service_url: normalizePublicUrl(row?.value),
    home_ip_info_url: homeIpInfoUrl
  };
}

module.exports = {
  getPublicSettings
};

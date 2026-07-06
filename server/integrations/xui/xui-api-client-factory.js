/**
 * 3X-UI API 客户端工厂。
 * 根据版本选择具体适配器，并在无法识别版本时回退到默认实现。
 */

const XuiApiClientV302 = require('./xui-api-client-v302');
const XuiApiClientV325 = require('./xui-api-client-v325');
const XuiApiClientV342 = require('./xui-api-client-v342');

const DEFAULT_XUI_API_VERSION = '3.0.2';
const CLIENT_REGISTRY = {
  '3.0.2': XuiApiClientV302,
  '3.2.5': XuiApiClientV325,
  // 3.3.1 延续 3.2.5 的 clients API 路由族，复用新版客户端适配器。
  '3.3.1': XuiApiClientV325,
  '3.4.2': XuiApiClientV342
};

/**
 * 规范化版本号输入，避免空值和前后空白影响分流。
 * @param {string} version - 原始版本号。
 * @returns {string} 规范化后的版本号。
 */
function normalizeVersion(version) {
  if (!version) {
    return DEFAULT_XUI_API_VERSION;
  }
  return String(version).trim();
}

/**
 * 解析客户端构造器及最终使用的版本号。
 * @param {string} version - 请求的版本号。
 * @returns {{ ClientClass: Function, requestedVersion: string, resolvedVersion: string }}
 */
function resolveClientVersion(version) {
  const requestedVersion = normalizeVersion(version);
  const ClientClass = CLIENT_REGISTRY[requestedVersion] || CLIENT_REGISTRY[DEFAULT_XUI_API_VERSION];
  const resolvedVersion = CLIENT_REGISTRY[requestedVersion]
    ? requestedVersion
    : DEFAULT_XUI_API_VERSION;

  return {
    ClientClass,
    requestedVersion,
    resolvedVersion
  };
}

/**
 * 创建版本化 3X-UI 客户端实例。
 * @param {string} baseURL - 3X-UI 面板地址。
 * @param {string} apiToken - 3X-UI API Token。
 * @param {Object} options - 客户端配置。
 * @param {string} [options.apiVersion] - 目标 API 版本。
 * @returns {{ client: Object, requestedVersion: string, resolvedVersion: string }}
 */
function createXuiApiClient(baseURL, apiToken, options = {}) {
  const { ClientClass, requestedVersion, resolvedVersion } = resolveClientVersion(options.apiVersion);
  const client = new ClientClass(baseURL, apiToken, options);

  return {
    client,
    requestedVersion,
    resolvedVersion
  };
}

module.exports = {
  CLIENT_REGISTRY,
  DEFAULT_XUI_API_VERSION,
  createXuiApiClient,
  normalizeVersion,
  resolveClientVersion
};

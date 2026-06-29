const crypto = require('crypto');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('SUBSCRIPTION-CACHE-SERVICE');

/**
 * 统一规范化值，避免空值、空白和键顺序影响指纹结果。
 * @param {*} value
 * @returns {*}
 */
function normalizeValue(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeValue(item));
  }

  if (typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = normalizeValue(value[key]);
        return result;
      }, {});
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return value;
}

/**
 * 将对象或 JSON 字符串序列化为稳定格式，供指纹计算使用。
 * @param {*} value
 * @param {boolean} silent - 是否静默处理解析警告
 * @returns {string}
 */
function stableJson(value, silent = false) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  let parsedValue = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    try {
      parsedValue = JSON.parse(trimmed);
    } catch (error) {
      if (!silent) {
        logger.warn(`stableJson 解析 JSON 失败，按普通字符串处理: ${error.message}`);
      }
      parsedValue = trimmed;
    }
  }

  return JSON.stringify(normalizeValue(parsedValue));
}

/**
 * 对字符串做 sha256，生成固定长度的十六进制指纹。
 * @param {string} payload
 * @returns {string}
 */
function hashPayload(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * 统一处理数字字段，空值或非法值转为 0。
 * @param {*} value
 * @returns {number}
 */
function normalizeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

/**
 * 计算节点级缓存指纹。
 * 规则：server_id + inbound_id + remark + protocol + port + settings + stream_settings
 * @param {Object} node
 * @param {boolean} silent - 是否静默处理指纹解析警告
 * @returns {string}
 */
function computeNodeFingerprint(node = {}, silent = false) {
  return hashPayload(stableJson({
    server_id: normalizeNumber(node.server_id),
    inbound_id: normalizeNumber(node.inbound_id),
    remark: normalizeValue(node.remark),
    protocol: normalizeValue(node.protocol),
    port: normalizeNumber(node.port),
    settings: stableJson(node.settings, silent),
    stream_settings: stableJson(node.stream_settings, silent)
  }, silent));
}

/**
 * 计算服务器级缓存指纹。
 * 规则：server_id + sub_url + host + client_port
 * @param {Object} server
 * @returns {string}
 */
function computeServerFingerprint(server = {}) {
  return hashPayload(stableJson({
    server_id: normalizeNumber(server.server_id || server.id),
    sub_url: normalizeValue(server.sub_url),
    host: normalizeValue(server.host),
    client_port: normalizeNumber(server.client_port)
  }));
}

/**
 * 按评估模式输出来源缓存失效日志，静默评估时跳过日志。
 * @param {string} message - 缓存失效说明
 * @param {boolean} silent - 是否静默评估
 * @returns {void}
 */
function logCacheInvalid(message, silent) {
  if (!silent) {
    logger.info(message);
  }
}

/**
 * 判断来源缓存是否仍可复用，并返回失效原因。
 * @param {Object} params
 * @param {Object} params.source
 * @param {Object} params.node
 * @param {Object} params.server
 * @param {string} params.subId
 * @param {number} params.now
 * @param {number} params.maxAgeSeconds
 * @param {boolean} params.silent
 * @returns {{ usable: boolean, reason: string }}
 */
function isSourceCacheUsable({
  source,
  node,
  server,
  subId,
  now,
  maxAgeSeconds,
  silent = false
} = {}) {
  if (!source) {
    logCacheInvalid('来源缓存不存在', silent);
    return { usable: false, reason: 'missing_source' };
  }

  if (String(source.sub_id || '') !== String(subId || '')) {
    logCacheInvalid('来源缓存失效：sub_id 已变化', silent);
    return { usable: false, reason: 'sub_id_mismatch' };
  }

  const nodeFingerprint = computeNodeFingerprint(node, silent);
  if (String(source.node_fingerprint || '') !== nodeFingerprint) {
    logCacheInvalid('来源缓存失效：节点指纹不匹配', silent);
    return { usable: false, reason: 'node_fingerprint_mismatch' };
  }

  const serverFingerprint = computeServerFingerprint(server);
  if (String(source.server_fingerprint || '') !== serverFingerprint) {
    logCacheInvalid('来源缓存失效：服务器指纹不匹配', silent);
    return { usable: false, reason: 'server_fingerprint_mismatch' };
  }

  if (normalizeNumber(maxAgeSeconds) > 0) {
    const currentTime = normalizeNumber(now);
    const fetchedAt = normalizeNumber(source.fetched_at);
    if (currentTime - fetchedAt > normalizeNumber(maxAgeSeconds)) {
      logCacheInvalid('来源缓存失效：缓存已过期', silent);
      return { usable: false, reason: 'cache_expired' };
    }
  }

  return { usable: true, reason: 'ok' };
}

module.exports = {
  stableJson,
  computeNodeFingerprint,
  computeServerFingerprint,
  isSourceCacheUsable
};

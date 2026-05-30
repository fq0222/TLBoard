const crypto = require('crypto');

const LOG_PREFIX = '[subscription-cache-service]';

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
 * @returns {string}
 */
function stableJson(value) {
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
      console.warn(`${LOG_PREFIX} stableJson 解析 JSON 失败，按普通字符串处理: ${error.message}`);
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
 * @returns {string}
 */
function computeNodeFingerprint(node = {}) {
  return hashPayload(stableJson({
    server_id: normalizeNumber(node.server_id),
    inbound_id: normalizeNumber(node.inbound_id),
    remark: normalizeValue(node.remark),
    protocol: normalizeValue(node.protocol),
    port: normalizeNumber(node.port),
    settings: stableJson(node.settings),
    stream_settings: stableJson(node.stream_settings)
  }));
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
 * 判断来源缓存是否仍可复用，并返回失效原因。
 * @param {Object} params
 * @param {Object} params.source
 * @param {Object} params.node
 * @param {Object} params.server
 * @param {string} params.subId
 * @param {number} params.now
 * @param {number} params.maxAgeSeconds
 * @returns {{ usable: boolean, reason: string }}
 */
function isSourceCacheUsable({ source, node, server, subId, now, maxAgeSeconds } = {}) {
  if (!source) {
    console.log(`${LOG_PREFIX} 来源缓存不存在`);
    return { usable: false, reason: 'missing_source' };
  }

  if (String(source.sub_id || '') !== String(subId || '')) {
    console.log(`${LOG_PREFIX} 来源缓存失效：sub_id 已变化`);
    return { usable: false, reason: 'sub_id_mismatch' };
  }

  const nodeFingerprint = computeNodeFingerprint(node);
  if (String(source.node_fingerprint || '') !== nodeFingerprint) {
    console.log(`${LOG_PREFIX} 来源缓存失效：节点指纹不匹配`);
    return { usable: false, reason: 'node_fingerprint_mismatch' };
  }

  const serverFingerprint = computeServerFingerprint(server);
  if (String(source.server_fingerprint || '') !== serverFingerprint) {
    console.log(`${LOG_PREFIX} 来源缓存失效：服务器指纹不匹配`);
    return { usable: false, reason: 'server_fingerprint_mismatch' };
  }

  if (normalizeNumber(maxAgeSeconds) > 0) {
    const currentTime = normalizeNumber(now);
    const fetchedAt = normalizeNumber(source.fetched_at);
    if (currentTime - fetchedAt > normalizeNumber(maxAgeSeconds)) {
      console.log(`${LOG_PREFIX} 来源缓存失效：缓存已过期`);
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

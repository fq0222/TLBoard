const crypto = require('crypto');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('SUBSCRIPTION-CACHE-SERVICE');
const SOURCE_FINGERPRINT_VERSION = 'v2';

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
 * 为来源缓存生成带算法版本的稳定指纹。
 * @param {*} payload - 已按业务边界投影的数据。
 * @param {boolean} silent - 是否静默处理 JSON 解析警告。
 * @returns {string} 形如 `v2:<sha256>` 的版本化指纹。
 */
function versionFingerprint(payload, silent = false) {
  return `${SOURCE_FINGERPRINT_VERSION}:${hashPayload(stableJson(payload, silent))}`;
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
 * 从完整客户端快照中只提取当前节点凭据对应客户端的 flow。
 * @param {Object} node - 含当前用户本地凭据和 inbound settings 的节点记录。
 * @param {boolean} silent - 是否静默处理 settings 解析警告。
 * @returns {string} 唯一匹配客户端的 flow；存在客户端但无法唯一匹配时返回隔离标记。
 */
function getCurrentClientFlow(node, silent = false) {
  if (!node.settings) {
    return normalizeValue(node.flow);
  }

  let settings;
  try {
    settings = typeof node.settings === 'string' ? JSON.parse(node.settings) : node.settings;
  } catch (error) {
    if (!silent) {
      logger.warn(`节点 settings 解析失败，无法提取当前客户端 flow: ${error.message}`);
    }
    return '__invalid_settings__';
  }

  if (!Array.isArray(settings?.clients)) {
    return normalizeValue(node.flow);
  }

  const matches = settings.clients.filter((client) => {
    if (!client) return false;
    return (!!node.sub_id && String(client.subId || '') === String(node.sub_id))
      || (!!node.uuid && String(client.id || '') === String(node.uuid))
      || (!!node.auth && String(client.auth || client.password || '') === String(node.auth))
      || (!!node.password && String(client.password || client.auth || '') === String(node.password));
  });

  if (matches.length === 1) {
    return normalizeValue(matches[0].flow);
  }
  return settings.clients.length > 0 ? '__unmatched_client__' : normalizeValue(node.flow);
}

/**
 * 计算节点级缓存指纹。
 * 规则：仅包含 inbound 连接字段和当前用户凭据，不包含完整 settings.clients。
 * @param {Object} node
 * @param {boolean} silent - 是否静默处理指纹解析警告
 * @returns {string}
 */
function computeNodeFingerprint(node = {}, silent = false) {
  return versionFingerprint({
    inbound: {
      server_id: normalizeNumber(node.server_id),
      inbound_id: normalizeNumber(node.inbound_id),
      remark: normalizeValue(node.remark),
      protocol: normalizeValue(node.protocol),
      port: normalizeNumber(node.port),
      stream_settings: stableJson(node.stream_settings, silent)
    },
    credential: {
      sub_id: normalizeValue(node.sub_id),
      uuid: normalizeValue(node.uuid),
      auth: normalizeValue(node.auth),
      password: normalizeValue(node.password),
      flow: getCurrentClientFlow(node, silent)
    }
  }, silent);
}

/**
 * 计算服务器级缓存指纹。
 * 规则：server_id + sub_url + host + client_port
 * @param {Object} server
 * @returns {string}
 */
function computeServerFingerprint(server = {}) {
  return versionFingerprint({
    server_id: normalizeNumber(server.server_id || server.id),
    sub_url: normalizeValue(server.sub_url),
    host: normalizeValue(server.host),
    client_port: normalizeNumber(server.client_port)
  });
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

  const versionPrefix = `${SOURCE_FINGERPRINT_VERSION}:`;
  if (!String(source.node_fingerprint || '').startsWith(versionPrefix)
    || !String(source.server_fingerprint || '').startsWith(versionPrefix)) {
    logCacheInvalid('来源缓存失效：指纹版本需要升级', silent);
    return { usable: false, reason: 'fingerprint_version_mismatch' };
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

  return { usable: true, reason: 'ok' };
}

module.exports = {
  SOURCE_FINGERPRINT_VERSION,
  stableJson,
  computeNodeFingerprint,
  computeServerFingerprint,
  isSourceCacheUsable
};

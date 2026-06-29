const { generateSubscriptionUrls } = require('../../utils/site-url');
const { createLogger } = require('../../utils/logger');
const cfOptimizeRepository = require('../../repositories/cf-optimize-repository');

const logger = createLogger('USER-CF');

// 单次返回给用户的 CF 优选 IP 候选数量，固定包含 19 个 IPv4 和 1 个 IPv6。
const CF_IPV4_CANDIDATE_COUNT = 19;
const CF_IPV6_CANDIDATE_COUNT = 1;

/**
 * 用户端 CF 优选服务。
 * 负责随机优选 IP 展示、用户选择保存与订阅链接回传，保持旧接口语义不变。
 */

function createLegacyBusinessError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  return error;
}

/**
 * 原地打乱数组并返回新副本。
 *
 * @param {Array} list - 原始数组
 * @returns {Array} 打乱后的新数组
 */
function shuffle(list) {
  const copied = [...list];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copied[index], copied[randomIndex]] = [copied[randomIndex], copied[index]];
  }
  return copied;
}

/**
 * 规整用户选择的 IP ID 列表，去重并拦截非法值。
 *
 * @param {Array<*>} ipIds - 原始 IP ID 列表
 * @returns {Array<number>} 规整后的 ID 列表
 */
function normalizeIpIds(ipIds) {
  if (!Array.isArray(ipIds) || ipIds.length === 0) {
    throw createLegacyBusinessError('至少选择1个IP');
  }

  const normalized = [];
  const seen = new Set();

  for (const ipId of ipIds) {
    const parsedId = Number(ipId);
    if (!Number.isInteger(parsedId) || parsedId < 1) {
      throw createLegacyBusinessError('IP ID 必须是大于0的整数');
    }
    if (seen.has(parsedId)) {
      continue;
    }
    seen.add(parsedId);
    normalized.push(parsedId);
  }

  return normalized;
}

/**
 * 规整用户选择的 IP 地址列表，去重并拦截空值。
 *
 * @param {Array<*>} ips - 原始 IP 地址列表
 * @returns {Array<string>} 规整后的地址列表
 */
function normalizeIpAddresses(ips) {
  if (!Array.isArray(ips) || ips.length === 0) {
    throw createLegacyBusinessError('至少选择1个IP');
  }

  const normalized = [];
  const seen = new Set();

  for (const ip of ips) {
    const value = String(ip || '').trim();
    if (!value) {
      throw createLegacyBusinessError('IP地址必须是字符串');
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

/**
 * 将优选 IP 列表映射为旧接口节点展示结构。
 *
 * @param {Array<Object>} ipRows - 优选 IP 列表
 * @returns {Array<Object>} 节点展示列表
 */
function formatNodes(ipRows) {
  return ipRows.map((ipRow) => ({
    server_name: 'CF优选',
    address: ipRow.ip,
    port: ipRow.port || 443,
    protocol: 'vmess',
    remark: `CF-${ipRow.ip}`
  }));
}

async function getCfIps(db, user) {
  const allIps = await cfOptimizeRepository.listEnabledCfIps(db);
  const ipv4List = allIps.filter((item) => !item.ip.includes(':'));
  const ipv6List = allIps.filter((item) => item.ip.includes(':'));

  const selectedIpv6 = shuffle(ipv6List).slice(
    0,
    Math.min(CF_IPV6_CANDIDATE_COUNT, ipv6List.length)
  );
  const selectedIpv4 = shuffle(ipv4List).slice(
    0,
    Math.min(CF_IPV4_CANDIDATE_COUNT, ipv4List.length)
  );
  const ips = shuffle([...selectedIpv4, ...selectedIpv6]);

  const currentIps = await cfOptimizeRepository.listCurrentUserCfIps(db, user.id);
  if (currentIps.length === 0) {
    currentIps.push({ ip: '8.8.8.8', source: 'default' });
  }

  logger.info(
    `获取CF IP池成功，用户: ${user.email}，返回${ips.length} 个IP（IPv4: ${selectedIpv4.length}, IPv6: ${selectedIpv6.length}）`
  );

  return {
    ips,
    current_ips: currentIps
  };
}

/**
 * 保存用户按 ID 选择的优选 IP。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} req - Express 请求对象
 * @param {Object} user - 当前用户信息
 * @param {Array<*>} ipIds - 原始 IP ID 列表
 * @returns {Promise<Object>} 兼容旧接口的应用结果
 */
async function applyCfIpsByIds(db, req, user, ipIds) {
  const normalizedIpIds = normalizeIpIds(ipIds);
  const validIps = await cfOptimizeRepository.findEnabledCfIpsByIds(db, normalizedIpIds);

  if (validIps.length !== normalizedIpIds.length) {
    throw createLegacyBusinessError('IP ID 无效或已禁用', {
      code: 4002
    });
  }

  await cfOptimizeRepository.replaceUserCfIps(db, user.id, normalizedIpIds);

  const subscriptionIdentity = await cfOptimizeRepository.findUserSubscriptionIdentity(db, user.id);
  const urls = generateSubscriptionUrls(req, subscriptionIdentity ? subscriptionIdentity.sub_id : '');

  logger.info(`应用优选IP成功，用户: ${user.email}，选择了${normalizedIpIds.length} 个IP`);

  return {
    applied_count: normalizedIpIds.length,
    subscription_url: urls.subscription_url,
    nodes: formatNodes(validIps),
    message: `已成功应用${normalizedIpIds.length} 个优选 IP，请重新获取订阅`
  };
}

/**
 * 保存用户按 IP 地址选择的优选 IP。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} req - Express 请求对象
 * @param {Object} user - 当前用户信息
 * @param {Array<*>} ips - 原始 IP 地址列表
 * @returns {Promise<Object>} 兼容旧接口的应用结果
 */
async function applyCfIpsByAddress(db, req, user, ips) {
  const normalizedIps = normalizeIpAddresses(ips);
  const validIps = await cfOptimizeRepository.findEnabledCfIpsByAddresses(db, normalizedIps);

  if (validIps.length === 0) {
    throw createLegacyBusinessError('IP 地址无效或已禁用', {
      code: 4002
    });
  }

  await cfOptimizeRepository.replaceUserCfIps(
    db,
    user.id,
    validIps.map((ipRow) => Number(ipRow.id))
  );

  const subscriptionIdentity = await cfOptimizeRepository.findUserSubscriptionIdentity(db, user.id);
  const urls = generateSubscriptionUrls(req, subscriptionIdentity ? subscriptionIdentity.sub_id : '');

  logger.info(`应用优选IP成功，用户: ${user.email}，选择了${validIps.length} 个IP`);

  return {
    applied_count: validIps.length,
    subscription_url: urls.subscription_url,
    message: `已成功应用${validIps.length} 个优选 IP`
  };
}

module.exports = {
  getCfIps,
  applyCfIpsByIds,
  applyCfIpsByAddress
};

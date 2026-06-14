const XuiService = require('../../integrations/xui/xui-service');
const userSubscriptionService = require('../user/subscription-service');
const { DISABLE_REASONS } = require('../shared/renew-policy');
const { parsePagination } = require('../../shared/utils/pagination');
const userRepository = require('../../repositories/user-repository');
const subscriptionRepository = require('../../repositories/subscription-repository');

/**
 * 管理端用户服务。
 * 负责用户分页、详情、编辑、CF IP 分配、订阅生成与 3X-UI 同步编排，
 * 保持现有 admin users 接口的行为与旧响应结构兼容。
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
 * 获取当前秒级时间戳，保持与现有用户时间字段一致。
 *
 * @returns {number} 秒级 Unix 时间戳
 */
function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 将启用状态统一成布尔值，兼容数据库 0/1 和请求布尔值。
 *
 * @param {*} value - 原始启用状态
 * @returns {boolean} 是否启用
 */
function normalizeEnabled(value) {
  return !!value;
}

/**
 * 将字节数统一成数字，兼容数据库字符串数字。
 *
 * @param {*} value - 原始字节数
 * @returns {number} 规范化后的字节数
 */
function normalizeBytes(value) {
  return Number(value) || 0;
}

/**
 * 将到期时间统一成比较值，null、空值和 0 都视为不限期。
 *
 * @param {*} value - 原始秒级时间戳
 * @returns {number} 规范化后的秒级时间戳
 */
function normalizeExpireAt(value) {
  const expireAt = Number(value) || 0;
  return expireAt > 0 ? expireAt : 0;
}

/**
 * 统计订阅缓存中的节点数量，兼容缓存为空或历史脏数据的情况。
 *
 * @param {Object|undefined} subscription - 最新订阅缓存记录
 * @returns {number} 可用节点数量
 */
function countSubscriptionNodes(subscription) {
  if (!subscription || !subscription.nodes_data) {
    return 0;
  }

  try {
    const nodes = JSON.parse(subscription.nodes_data);
    return Array.isArray(nodes) ? nodes.length : 0;
  } catch (error) {
    return 0;
  }
}

/**
 * 格式化流量值，兼容 null、空字符串和字符串数字。
 *
 * @param {*} bytes - 原始流量值
 * @returns {string} 格式化后的流量文本
 */
function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '0 B';
  const numBytes = Number(bytes);
  if (isNaN(numBytes) || numBytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(numBytes) / Math.log(k));
  return parseFloat((numBytes / Math.pow(k, index)).toFixed(2)) + ' ' + sizes[index];
}

/**
 * 格式化到期时间，兼容不限期用户。
 *
 * @param {*} timestamp - 秒级时间戳
 * @returns {string} 格式化后的时间文本
 */
function formatTime(timestamp) {
  if (!timestamp || timestamp === 0 || timestamp === '0') {
    return '无限期';
  }

  return new Date(Number(timestamp) * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false
  });
}

/**
 * 将订单状态转换为旧前端使用的中文文案。
 *
 * @param {string} status - 订单状态
 * @returns {string} 状态文案
 */
function getOrderStatusText(status) {
  const statusMap = {
    pending: '待支付',
    paid: '已支付',
    expired: '已过期'
  };

  return statusMap[status] || status;
}

/**
 * 根据用户启用状态、禁用原因和到期时间推导管理端列表状态。
 *
 * @param {Object} user - 用户记录
 * @returns {{status:string,status_text:string}} 状态信息
 */
function buildUserStatus(user) {
  const now = getNowTimestamp();
  const expireAt = Number(user.expire_at) || 0;
  let status = 'active';
  let statusText = '正常';

  if (!user.enabled) {
    if (user.disable_reason === DISABLE_REASONS.TRAFFIC_LIMIT) {
      status = 'renew';
      statusText = '续费';
    } else {
      status = 'disabled';
      statusText = '已禁用';
    }
  } else if (expireAt !== 0 && expireAt <= now) {
    status = 'expired';
    statusText = '已过期';
  }

  return {
    status,
    status_text: statusText
  };
}

/**
 * 构造管理端用户列表查询条件。
 *
 * @param {Object} query - 路由查询参数
 * @returns {{whereClause:string,params:Array}} SQL 条件与参数
 */
function buildUserListWhere(query) {
  const keyword = query.keyword || '';
  const status = query.status;
  const planId = query.plan_id;
  let whereClause = 'WHERE 1=1';
  const params = [];
  const now = getNowTimestamp();

  if (keyword) {
    whereClause += ' AND u.email LIKE ?';
    params.push(`%${keyword}%`);
  }

  if (status === 'active') {
    whereClause += ' AND u.enabled = 1 AND (u.expire_at = 0 OR u.expire_at = \'0\' OR u.expire_at IS NULL OR u.expire_at > ?)';
    params.push(now);
  } else if (status === 'expired') {
    whereClause += ' AND u.enabled = 1 AND u.expire_at != 0 AND u.expire_at != \'0\' AND u.expire_at IS NOT NULL AND u.expire_at <= ?';
    params.push(now);
  } else if (status === 'disabled') {
    whereClause += ' AND u.enabled = 0';
  }

  if (planId) {
    whereClause += ' AND u.plan_id = ?';
    params.push(planId);
  }

  return {
    whereClause,
    params
  };
}

/**
 * 查询管理端用户分页列表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} query - 路由查询参数
 * @returns {Promise<Object>} 分页结果
 */
async function listUsers(db, query) {
  const { page, limit, offset } = parsePagination(query);
  const { whereClause, params } = buildUserListWhere(query);
  const totalRow = await userRepository.countUsers(db, whereClause, params);
  const users = await userRepository.listUsers(db, whereClause, params, limit, offset);

  return {
    total: Number(totalRow.total) || 0,
    page,
    limit,
    list: users.map((user) => ({
      id: user.id,
      email: user.email,
      plan_id: user.plan_id,
      plan_name: user.plan_name,
      traffic_used: user.traffic_used,
      traffic_limit: user.traffic_limit,
      traffic_used_text: formatTraffic(user.traffic_used),
      traffic_limit_text: formatTraffic(user.traffic_limit),
      expire_at: user.expire_at,
      expire_text: formatTime(user.expire_at),
      enabled: user.enabled,
      disable_reason: user.disable_reason,
      created_at: user.created_at,
      ...buildUserStatus(user)
    }))
  };
}

/**
 * 查询用户详情以及最近订单、CF IP 信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object>} 用户详情
 */
async function getUserDetail(db, userId) {
  const user = await userRepository.findUserDetailById(db, userId);
  if (!user) {
    throw createLegacyBusinessError('用户不存在', {
      code: 2004
    });
  }

  const orders = await userRepository.listUserOrders(db, userId);
  const cfIps = await userRepository.listUserCfIps(db, userId);

  return {
    user: {
      id: user.id,
      email: user.email,
      plan_id: user.plan_id,
      plan_name: user.plan_name,
      sub_id: user.sub_id,
      traffic_used: user.traffic_used,
      traffic_limit: user.traffic_limit,
      traffic_used_text: formatTraffic(user.traffic_used),
      traffic_limit_text: formatTraffic(user.traffic_limit),
      expire_at: user.expire_at,
      expire_text: formatTime(user.expire_at),
      enabled: user.enabled,
      created_at: user.created_at,
      cf_ips: cfIps
    },
    orders: orders.map((order) => ({
      id: order.id,
      out_trade_no: order.out_trade_no,
      plan_name: user.plan_name,
      amount: order.amount,
      amount_text: (Number(order.amount) / 100).toFixed(2),
      status: order.status,
      status_text: getOrderStatusText(order.status),
      paid_at: order.paid_at,
      created_at: order.created_at
    })),
    cf_ips: cfIps
  };
}

/**
 * 将用户启用状态、流量和到期时间同步到各个在线 3X-UI 节点。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} user - 用户记录
 * @returns {Promise<void>}
 */
async function syncUserToXuiServers(db, user) {
  const servers = await userRepository.listOnlineXuiServersForSync(db);
  if (servers.length === 0) {
    return;
  }

  const userNodes = await userRepository.listNodeSyncTargetsByServer(db);
  const nodesByServer = {};

  for (const node of userNodes) {
    if (!nodesByServer[node.server_id]) {
      nodesByServer[node.server_id] = [];
    }
    nodesByServer[node.server_id].push(node.inbound_id);
  }

  const expireAt = Number(user.expire_at) || 0;
  const expiryTime = expireAt > 0 ? expireAt * 1000 : 0;
  const trafficLimit = Number(user.traffic_limit) || 0;
  const totalGB = trafficLimit > 0 ? trafficLimit / (1024 * 1024 * 1024) : 0;

  for (const server of servers) {
    const inboundIds = nodesByServer[server.id] || [];
    if (inboundIds.length === 0) {
      continue;
    }

    try {
      const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
        apiVersion: server.panel_version || '3.0.2'
      });
      for (const inboundId of inboundIds) {
        const node = await userRepository.findXuiNodeByServerAndInbound(db, server.id, inboundId);
        const strategy = getNodeUpdateStrategy(node);
        const nodeEmail = `${user.email}-${node?.remark || inboundId}`;
        await xuiService.updateClientByContext(inboundId, nodeEmail, {
          protocol: node?.protocol || '',
          strategy,
          enabled: !!user.enabled,
          expiryTime,
          totalGB,
          flow: strategy === 'direct' ? 'xtls-rprx-vision' : ''
        });
      }
    } catch (error) {
      // 保持旧逻辑：单台服务同步失败只影响日志，不阻止接口返回。
    }
  }
}

/**
 * 更新用户基础资料并触发 3X-UI 同步。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {Object} payload - 更新参数
 * @returns {Promise<Object>} 更新后的用户概要信息
 */
async function updateUser(db, userId, payload) {
  const user = await userRepository.findUserDetailById(db, userId);
  if (!user) {
    throw createLegacyBusinessError('用户不存在', {
      code: 2004
    });
  }

  const updates = [];
  const values = [];

  if (payload.enabled !== undefined && normalizeEnabled(payload.enabled) !== normalizeEnabled(user.enabled)) {
    const nextEnabled = normalizeEnabled(payload.enabled);
    updates.push('enabled = ?');
    values.push(nextEnabled ? 1 : 0);
    updates.push('disable_reason = ?');
    values.push(nextEnabled ? null : DISABLE_REASONS.ADMIN);
  }

  if (payload.plan_id !== undefined && Number(payload.plan_id) !== Number(user.plan_id)) {
    updates.push('plan_id = ?');
    values.push(payload.plan_id);
  }

  if (payload.traffic_limit !== undefined && normalizeBytes(payload.traffic_limit) !== normalizeBytes(user.traffic_limit)) {
    updates.push('traffic_limit = ?');
    values.push(payload.traffic_limit);
  }

  if (payload.expire_at !== undefined && normalizeExpireAt(payload.expire_at) !== normalizeExpireAt(user.expire_at)) {
    updates.push('expire_at = ?');
    values.push(payload.expire_at);
  }

  if (updates.length === 0) {
    throw createLegacyBusinessError('没有要更新的字段');
  }

  updates.push('updated_at = ?');
  values.push(getNowTimestamp());
  await userRepository.updateUserFields(db, userId, updates, values);

  const updatedUser = await userRepository.findUserDetailById(db, userId);
  await syncUserToXuiServers(db, updatedUser);

  return {
    id: updatedUser.id,
    email: updatedUser.email,
    plan_id: updatedUser.plan_id,
    plan_name: updatedUser.plan_name,
    traffic_limit: updatedUser.traffic_limit,
    traffic_limit_text: formatTraffic(updatedUser.traffic_limit),
    expire_at: updatedUser.expire_at,
    expire_text: formatTime(updatedUser.expire_at),
    enabled: updatedUser.enabled,
    message: '用户信息已更新，已同步到 3X-UI 服务器'
  };
}

/**
 * 更新用户绑定的 CF 优选 IP。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {Array<number|string>} ipPoolIds - IP 池 ID 列表
 * @returns {Promise<Object>} 更新结果
 */
async function updateUserCfIps(db, userId, ipPoolIds) {
  const currentUser = await userRepository.findUserDetailById(db, userId);
  if (!currentUser) {
    throw createLegacyBusinessError('用户不存在', {
      code: 2004
    });
  }

  const uniqueIds = [...new Set(ipPoolIds.map((id) => Number(id)))];
  const validIps = await userRepository.findEnabledCfIpsByIds(db, uniqueIds);
  if (validIps.length !== uniqueIds.length) {
    throw createLegacyBusinessError('IP ID 无效或已禁用', {
      code: 4002
    });
  }

  const transaction = db.transaction(async (transactionDb) => {
    await userRepository.replaceUserCfIps(transactionDb, userId, uniqueIds);
  });
  await transaction();

  return {
    cf_ips: validIps
  };
}

/**
 * 复用用户端增量流程重新生成指定用户的订阅缓存。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {Object} logger - 日志实例，用于透传用户端订阅生成过程
 * @returns {Promise<{sub_id:string,node_count:number}>} 生成结果
 */
async function generateSubscription(db, userId, logger) {
  const subId = await userSubscriptionService.generateSubscription(db, userId, logger);
  const latestSubscription = await subscriptionRepository.findLatestUserSubscription(db, userId);

  return {
    sub_id: subId,
    node_count: countSubscriptionNodes(latestSubscription)
  };
}

/**
 * 根据节点备注和协议判断 3X-UI 客户端更新策略。
 *
 * @param {Object} node - 节点快照
 * @returns {string} 策略类型：hy2 / direct / cf
 */
function getNodeUpdateStrategy(node = {}) {
  const remark = String(node.remark || '').toLowerCase();
  const protocol = String(node.protocol || '').toLowerCase();

  if (remark.includes('hy2') || protocol === 'hysteria' || protocol === 'hysteria2') {
    return 'hy2';
  }
  if (remark.includes('direct')) {
    return 'direct';
  }
  return 'cf';
}

module.exports = {
  listUsers,
  getUserDetail,
  updateUser,
  updateUserCfIps,
  generateSubscription
};

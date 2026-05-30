const XuiService = require('../xui-service');
const { syncAllServers } = require('../xui-sync');
const { fetchOriginalSubscription, parseSubscriptionContent } = require('../subscription-service');
const { getStrategyFromRemark, processNodeLink } = require('../subscription-strategy');
const { DISABLE_REASONS } = require('../renew-policy');
const { parsePagination } = require('../../shared/utils/pagination');
const userRepository = require('../../repositories/user-repository');

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

function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '0 B';
  const numBytes = Number(bytes);
  if (isNaN(numBytes) || numBytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(numBytes) / Math.log(k));
  return parseFloat((numBytes / Math.pow(k, index)).toFixed(2)) + ' ' + sizes[index];
}

function formatTime(timestamp) {
  if (!timestamp || timestamp === 0 || timestamp === '0') {
    return '无限期';
  }

  return new Date(Number(timestamp) * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false
  });
}

function getOrderStatusText(status) {
  const statusMap = {
    pending: '待支付',
    paid: '已支付',
    expired: '已过期'
  };

  return statusMap[status] || status;
}

function buildUserStatus(user) {
  const now = getNowTimestamp();
  const expireAt = Number(user.expire_at) || 0;
  let status = 'active';
  let statusText = '正常';

  if (!user.enabled) {
    status = 'disabled';
    statusText = '已禁用';
  } else if (expireAt !== 0 && expireAt <= now) {
    status = 'expired';
    statusText = '已过期';
  }

  return {
    status,
    status_text: statusText
  };
}

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
      created_at: user.created_at,
      ...buildUserStatus(user)
    }))
  };
}

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
      const xuiService = await XuiService.getInstance(server.api_url, server.api_token);
      for (const inboundId of inboundIds) {
        const node = await userRepository.findXuiNodeByServerAndInbound(db, server.id, inboundId);
        const nodeEmail = `${user.email}-${node?.remark || inboundId}`;
        await xuiService.updateClient(inboundId, nodeEmail, {
          enabled: !!user.enabled,
          expiryTime,
          totalGB
        });
      }
    } catch (error) {
      // 保持旧逻辑：单台服务同步失败只影响日志，不阻止接口返回。
    }
  }
}

async function updateUser(db, userId, payload) {
  const user = await userRepository.findUserDetailById(db, userId);
  if (!user) {
    throw createLegacyBusinessError('用户不存在', {
      code: 2004
    });
  }

  const updates = [];
  const values = [];

  if (payload.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(payload.enabled ? 1 : 0);
    updates.push('disable_reason = ?');
    values.push(payload.enabled ? null : DISABLE_REASONS.ADMIN);
  }

  if (payload.plan_id !== undefined) {
    updates.push('plan_id = ?');
    values.push(payload.plan_id);
  }

  if (payload.traffic_limit !== undefined) {
    updates.push('traffic_limit = ?');
    values.push(payload.traffic_limit);
  }

  if (payload.expire_at !== undefined) {
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

async function generateSubscription(db, userId) {
  const user = await userRepository.findUserDetailById(db, userId);
  if (!user) {
    throw createLegacyBusinessError('用户不存在', {
      code: 2004
    });
  }

  if (!user.enabled) {
    throw createLegacyBusinessError('账号已被禁用', {
      code: 2003
    });
  }

  const cfIps = await userRepository.findActiveCfIpsForUser(db, userId);
  if (cfIps.length === 0) {
    throw createLegacyBusinessError('请先配置优选 IP', {
      code: 3001
    });
  }

  await syncAllServers(db);
  const servers = await userRepository.listActiveXuiServersForSubscription(db);
  const allNodes = [];

  for (const server of servers) {
    try {
      const nodeConfigs = await userRepository.listUserNodeConfigsByServer(db, userId, server.id);
      if (nodeConfigs.length === 0 || !server.sub_url) {
        continue;
      }

      const subscriptionResults = await Promise.all(nodeConfigs.map(async (config) => {
        try {
          const originalContent = await fetchOriginalSubscription(server.sub_url, config.sub_id);
          const links = parseSubscriptionContent(originalContent);
          return {
            config,
            originalLink: links[0] || null
          };
        } catch (error) {
          return {
            config,
            originalLink: null
          };
        }
      }));

      for (const { config, originalLink } of subscriptionResults) {
        if (!originalLink) {
          continue;
        }

        const strategy = getStrategyFromRemark(config.remark);
        if (strategy === 'cf') {
          for (let index = 0; index < cfIps.length; index++) {
            let processedLink = processNodeLink(originalLink, 'cf', {
              cfIp: cfIps[index].ip,
              clientPort: server.client_port,
              host: server.host
            });
            const baseName = `${server.name}-${config.remark}`;
            const nodeName = cfIps.length > 1 ? `${baseName}-${index + 1}` : baseName;
            const hashIndex = processedLink.indexOf('#');
            if (hashIndex > 0) {
              processedLink = processedLink.substring(0, hashIndex + 1) + encodeURIComponent(nodeName);
            }
            allNodes.push({
              server_name: server.name,
              node_name: nodeName,
              protocol: config.protocol,
              strategy,
              link: processedLink,
              original_link: originalLink
            });
          }
        } else {
          let processedLink = processNodeLink(originalLink, 'direct');
          const nodeName = `${server.name}-${config.remark}`;
          const hashIndex = processedLink.indexOf('#');
          if (hashIndex > 0) {
            processedLink = processedLink.substring(0, hashIndex + 1) + encodeURIComponent(nodeName);
          }
          allNodes.push({
            server_name: server.name,
            node_name: nodeName,
            protocol: config.protocol,
            strategy,
            link: processedLink,
            original_link: originalLink
          });
        }
      }
    } catch (error) {
      // 保持旧逻辑：单台服务异常不影响整体继续处理。
    }
  }

  await userRepository.saveUserSubscriptionCache(db, {
    userId,
    subId: user.sub_id,
    nodesData: JSON.stringify(allNodes),
    updatedAt: getNowTimestamp()
  });

  return {
    sub_id: user.sub_id,
    node_count: allNodes.length
  };
}

module.exports = {
  listUsers,
  getUserDetail,
  updateUser,
  updateUserCfIps,
  generateSubscription
};

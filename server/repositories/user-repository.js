/**
 * 用户仓储。
 * 负责 auth 与 admin users 模块涉及的 users/orders/cf_ip/xui 相关 SQL 访问，
 * 保持 route/controller/service 不直接拼接查询语句。
 */

/**
 * 根据邮箱查询完整用户记录。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} email - 用户邮箱
 * @returns {Promise<Object|undefined>} 用户记录
 */
async function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

/**
 * 查询注册流程需要的用户快照信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} email - 用户邮箱
 * @returns {Promise<Object|undefined>} 用户快照
 */
async function findUserRegisterSnapshotByEmail(db, email) {
  return db.prepare('SELECT id, enabled, expire_at FROM users WHERE email = ?').get(email);
}

/**
 * 查询启用中的套餐记录。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number|string} planId - 套餐 ID
 * @returns {Promise<Object|undefined>} 套餐记录
 */
async function findEnabledPlanById(db, planId) {
  return db.prepare('SELECT * FROM plans WHERE id = ? AND enabled = 1').get(planId);
}

/**
 * 为已存在但已失效的用户更新注册套餐信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 更新参数
 * @returns {Promise<void>}
 */
async function updateRegisteredUserForPlan(db, payload) {
  const {
    userId,
    passwordHash,
    planId,
    subscriptionToken,
    subId,
    trafficLimit,
    updatedAt
  } = payload;

  await db.prepare(`
    UPDATE users SET
      password_hash = ?,
      plan_id = ?,
      subscription_token = ?,
      sub_id = ?,
      traffic_used = 0,
      traffic_limit = ?,
      enabled = 0,
      updated_at = ?
    WHERE id = ?
  `).run(
    passwordHash,
    planId,
    subscriptionToken,
    subId,
    trafficLimit,
    updatedAt,
    userId
  );
}

/**
 * 创建新的待支付注册用户。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 新用户参数
 * @returns {Promise<Object>} 插入结果
 */
async function createRegisteredUser(db, payload) {
  const {
    email,
    passwordHash,
    planId,
    subscriptionToken,
    subId,
    trafficLimit
  } = payload;

  return db.prepare(`
    INSERT INTO users (email, password_hash, plan_id, subscription_token, sub_id, traffic_used, traffic_limit, enabled)
    VALUES (?, ?, ?, ?, ?, 0, ?, 0)
  `).run(
    email,
    passwordHash,
    planId,
    subscriptionToken,
    subId,
    trafficLimit
  );
}

/**
 * 创建注册流程的待支付订单。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 订单参数
 * @returns {Promise<Object>} 插入结果
 */
async function createPendingOrder(db, payload) {
  const {
    userId,
    email,
    planId,
    amount,
    outTradeNo,
    referrerUserId = null
  } = payload;

  return db.prepare(`
    INSERT INTO orders (user_id, email, plan_id, amount, out_trade_no, referrer_user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    userId,
    email,
    planId,
    amount,
    outTradeNo,
    referrerUserId
  );
}

/**
 * 按商户订单号将订单标记为过期。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} outTradeNo - 商户订单号
 * @returns {Promise<void>}
 */
async function markOrderExpiredByOutTradeNo(db, outTradeNo) {
  await db.prepare(`
    UPDATE orders SET status = 'expired'
    WHERE out_trade_no = ?
  `).run(outTradeNo);
}

/**
 * 更新订单的支付流水号、支付链接和实付金额。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 支付信息
 * @returns {Promise<void>}
 */
async function updateOrderPaymentInfo(db, payload) {
  const {
    outTradeNo,
    tradeNo,
    paymentUrl,
    amount
  } = payload;

  await db.prepare(`
    UPDATE orders SET
      trade_no = ?,
      payment_url = ?,
      amount = ?
    WHERE out_trade_no = ?
  `).run(tradeNo, paymentUrl, amount, outTradeNo);
}

/**
 * 查询登录流程所需的用户和套餐信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} email - 用户邮箱
 * @returns {Promise<Object|undefined>} 用户记录
 */
async function findLoginUserByEmail(db, email) {
  return db.prepare(`
    SELECT u.*, p.name as plan_name
    FROM users u
    LEFT JOIN plans p ON u.plan_id = p.id
    WHERE u.email = ?
  `).get(email);
}

/**
 * 查询密码重置流程需要的用户记录。
 * 职责：只返回生成重置 Token 所需的最小字段，避免服务层读取多余隐私信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} email - 用户邮箱
 * @returns {Promise<Object|undefined>} 用户基础记录
 */
async function findPasswordResetUserByEmail(db, email) {
  return db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
}

/**
 * 统计指定用户最近一次密码重置申请窗口内的 Token 数量。
 * 职责：支撑“单邮箱每天最多申请一次”的频率限制。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {number} createdAfter - 统计起点秒级时间戳
 * @returns {Promise<Object>} 统计结果
 */
async function countPasswordResetTokensSince(db, userId, createdAfter) {
  return db.prepare(`
    SELECT COUNT(*) as count
    FROM password_reset_tokens
    WHERE user_id = ? AND created_at >= ?
  `).get(userId, createdAfter);
}

/**
 * 创建密码重置 Token。
 * 职责：记录高熵 Token、过期时间与请求 IP，Token 明文仅用于一次性邮件链接。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - Token 创建参数
 * @returns {Promise<Object>} 插入结果
 */
async function createPasswordResetToken(db, payload) {
  const {
    userId,
    token,
    expiresAt,
    requestIp,
    createdAt
  } = payload;

  return db.prepare(`
    INSERT INTO password_reset_tokens (user_id, token, expires_at, request_ip, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, token, expiresAt, requestIp, createdAt);
}

/**
 * 按 Token 查询密码重置记录及用户邮箱。
 * 职责：验证 Token 状态时一次性拿到用户 ID 与密码更新所需信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} token - 重置 Token
 * @returns {Promise<Object|undefined>} Token 记录
 */
async function findPasswordResetToken(db, token) {
  return db.prepare(`
    SELECT prt.*, u.email
    FROM password_reset_tokens prt
    JOIN users u ON u.id = prt.user_id
    WHERE prt.token = ?
  `).get(token);
}

/**
 * 标记密码重置 Token 已使用。
 * 职责：实现提交即失效，防止同一 Token 被重复播放。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} token - 重置 Token
 * @param {number} usedAt - 使用时间戳
 * @returns {Promise<Object>} 更新结果
 */
async function markPasswordResetTokenUsed(db, token, usedAt) {
  return db.prepare(`
    UPDATE password_reset_tokens
    SET used_at = ?
    WHERE token = ? AND used_at IS NULL
  `).run(usedAt, token);
}

/**
 * 更新用户密码哈希。
 * 职责：只接受已经完成 bcrypt/argon2 等安全哈希后的密码摘要。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {string} passwordHash - 新密码哈希
 * @param {number} updatedAt - 更新时间戳
 * @returns {Promise<Object>} 更新结果
 */
async function updateUserPasswordHash(db, userId, passwordHash, updatedAt) {
  return db.prepare(`
    UPDATE users SET
      password_hash = ?,
      updated_at = ?
    WHERE id = ?
  `).run(passwordHash, updatedAt, userId);
}

/**
 * 查询用户个人中心展示所需资料。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户资料
 */
async function findUserProfileById(db, userId) {
  return db.prepare(`
    SELECT
      u.id, u.email, u.plan_id, u.subscription_token, u.sub_id,
      u.traffic_used, u.traffic_limit, u.referral_traffic_limit, u.balance, u.expire_at, u.enabled, u.disable_reason, u.created_at,
      u.payment_count, u.sync_status, u.onboarding_completed,
      p.name as plan_name, p.plan_type as plan_type
    FROM users u
    LEFT JOIN plans p ON u.plan_id = p.id
    WHERE u.id = ?
  `).get(userId);
}

/**
 * 按键读取系统设置。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} key - 系统设置键名
 * @returns {Promise<Object|undefined>} 设置记录
 */
async function findSystemSettingByKey(db, key) {
  return db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
}

/**
 * 查询用户当前同步状态。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 同步状态记录
 */
async function findUserSyncStatusById(db, userId) {
  return db.prepare('SELECT sync_status FROM users WHERE id = ?').get(userId);
}

/**
 * 将用户新手引导标记为已完成。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<void>}
 */
async function markUserOnboardingCompleted(db, userId) {
  await db.prepare('UPDATE users SET onboarding_completed = 1, updated_at = EXTRACT(EPOCH FROM NOW()) WHERE id = ?').run(userId);
}

/**
 * 检查用户是否已分配 CF 优选 IP。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 查询结果
 */
async function hasUserCfIps(db, userId) {
  return db.prepare('SELECT 1 FROM user_cf_ips WHERE user_id = ? LIMIT 1').get(userId);
}

/**
 * 检查用户订阅缓存是否已生成。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} subId - 订阅子 ID
 * @returns {Promise<Object|undefined>} 查询结果
 */
async function hasUserSubscriptionCache(db, subId) {
  return db.prepare('SELECT 1 FROM user_subscriptions WHERE sub_id = ?').get(subId);
}

/**
 * 统计管理端用户总数。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} whereClause - SQL 条件片段
 * @param {Array} params - 绑定参数
 * @returns {Promise<Object>} 统计结果
 */
async function countUsers(db, whereClause, params) {
  return db.prepare(`SELECT COUNT(*) as total FROM users u ${whereClause}`).get(...params);
}

/**
 * 构造管理端用户列表排序 SQL。
 * 关键分支：仅允许仓储内置字段，避免请求参数直接进入 ORDER BY。
 *
 * @param {Object} sort - 排序配置
 * @param {string} sort.sortBy - 排序字段
 * @param {string} sort.sortOrder - 排序方向
 * @returns {string} ORDER BY 片段
 */
function buildUserListOrderBy(sort = {}) {
  if (sort.sortBy === 'traffic_used' && sort.sortOrder === 'desc') {
    return 'ORDER BY COALESCE(u.traffic_used, 0) DESC, u.created_at DESC';
  }

  return 'ORDER BY u.created_at DESC';
}

/**
 * 查询管理端用户分页列表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {string} whereClause - SQL 条件片段
 * @param {Array} params - 绑定参数
 * @param {number} limit - 分页数量
 * @param {number} offset - 分页偏移
 * @param {Object} [sort] - 排序配置
 * @returns {Promise<Array>} 用户列表
 */
async function listUsers(db, whereClause, params, limit, offset, sort) {
  const orderBy = buildUserListOrderBy(sort);

  return db.prepare(`
    SELECT
      u.id, u.email, u.plan_id, u.traffic_used, u.traffic_limit,
      u.expire_at, u.enabled, u.disable_reason, u.ip_location, u.created_at,
      p.name as plan_name
    FROM users u
    LEFT JOIN plans p ON u.plan_id = p.id
    ${whereClause}
    ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

/**
 * 查询管理端用户详情。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户详情
 */
async function findUserDetailById(db, userId) {
  return db.prepare(`
    SELECT
      u.id, u.email, u.plan_id, u.subscription_token, u.sub_id,
      u.traffic_used, u.traffic_limit, u.expire_at, u.enabled, u.created_at,
      p.name as plan_name
    FROM users u
    LEFT JOIN plans p ON u.plan_id = p.id
    WHERE u.id = ?
  `).get(userId);
}

/**
 * 查询用户最近订单列表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} 订单列表
 */
async function listUserOrders(db, userId) {
  return db.prepare(`
    SELECT id, out_trade_no, plan_id, amount, status, paid_at, created_at
    FROM orders
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(userId);
}

/**
 * 查询用户绑定的 CF 优选 IP 列表。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} IP 列表
 */
async function listUserCfIps(db, userId) {
  return db.prepare(`
    SELECT
      uci.id,
      uci.ip_pool_id,
      uci.custom_ip,
      COALESCE(uci.source, 'pool') AS source,
      uci.slot_index,
      COALESCE(cp.ip, uci.custom_ip) AS ip,
      cp.enabled
    FROM user_cf_ips uci
    LEFT JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
    WHERE uci.user_id = ?
    ORDER BY COALESCE(uci.slot_index, uci.id) ASC, uci.id ASC
  `).all(userId);
}

/**
 * 按动态字段更新用户记录。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {Array<string>} updates - 更新表达式列表
 * @param {Array} values - 绑定值列表
 * @returns {Promise<void>}
 */
async function updateUserFields(db, userId, updates, values) {
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values, userId);
}

/**
 * 查询用户 IP 归属地 JSON。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户 IP 归属地快照
 */
async function findUserIpLocationById(db, userId) {
  return db.prepare('SELECT ip_location FROM users WHERE id = ?').get(userId);
}

/**
 * 更新用户指定来源的 IP 归属地 JSON。
 * 职责：只更新 login/subscription 中的一个来源，保留另一个来源已有数据。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {'login'|'subscription'} source - 归属地来源
 * @param {Object} location - 已确认属于中国大陆的归属地结构
 * @returns {Promise<void>}
 */
async function updateUserIpLocation(db, userId, source, location) {
  const current = await findUserIpLocationById(db, userId);
  let data = {};

  try {
    data = JSON.parse(current?.ip_location || '{}');
  } catch (error) {
    data = {};
  }

  data[source] = location;
  await db.prepare('UPDATE users SET ip_location = ?, updated_at = EXTRACT(EPOCH FROM NOW()) WHERE id = ?')
    .run(JSON.stringify(data), userId);
}

/**
 * 删除系统本地数据库中指定用户的全部关联记录。
 * 职责：只清理本地表数据，不调用 3X-UI；由调用方负责包裹事务。
 * 核心分支语义：先删可能被其它表引用的推广奖励、工单子表等明细，最后删除 users 主记录。
 *
 * @param {Object} db - 数据库代理对象，通常是事务态 transactionDb
 * @param {Object} user - 待删除用户快照
 * @param {number} user.id - 用户 ID
 * @param {string} user.email - 用户邮箱，用于清理仅保存邮箱的本地日志/订单
 * @returns {Promise<Object>} 各表删除行数统计
 */
async function deleteUserLocalRelatedData(db, user) {
  const userId = Number(user.id);
  const email = user.email;
  const deletedRows = {};
  const statements = [
    {
      key: 'referral_rewards',
      sql: 'DELETE FROM referral_rewards WHERE referrer_user_id = ? OR referred_user_id = ?',
      params: [userId, userId]
    },
    {
      key: 'referral_clicks',
      sql: 'DELETE FROM referral_clicks WHERE referrer_user_id = ?',
      params: [userId]
    },
    {
      key: 'referral_codes',
      sql: 'DELETE FROM referral_codes WHERE user_id = ?',
      params: [userId]
    },
    {
      key: 'ticket_replies',
      sql: `
        DELETE FROM ticket_replies
        WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = ?)
           OR user_id = ?
      `,
      params: [userId, userId]
    },
    {
      key: 'ticket_reads',
      sql: `
        DELETE FROM ticket_reads
        WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = ?)
           OR user_id = ?
      `,
      params: [userId, userId]
    },
    {
      key: 'tickets',
      sql: 'DELETE FROM tickets WHERE user_id = ?',
      params: [userId]
    },
    {
      key: 'password_reset_tokens',
      sql: 'DELETE FROM password_reset_tokens WHERE user_id = ?',
      params: [userId]
    },
    {
      key: 'resource_distributions',
      sql: 'DELETE FROM resource_distributions WHERE user_id = ?',
      params: [userId]
    },
    {
      key: 'email_logs',
      sql: 'DELETE FROM email_logs WHERE user_id = ? OR email = ?',
      params: [userId, email]
    },
    {
      key: 'user_cf_ips',
      sql: 'DELETE FROM user_cf_ips WHERE user_id = ?',
      params: [userId]
    },
    {
      key: 'user_announcement_popup_stats',
      sql: 'DELETE FROM user_announcement_popup_stats WHERE user_id = ?',
      params: [userId]
    },
    {
      key: 'xui_sync_tasks',
      sql: 'DELETE FROM xui_sync_tasks WHERE user_id = ?',
      params: [userId]
    },
    {
      key: 'batch_subscription_task_items',
      sql: 'DELETE FROM batch_subscription_task_items WHERE user_id = ?',
      params: [userId]
    },
    {
      key: 'user_subscription_sources',
      sql: 'DELETE FROM user_subscription_sources WHERE user_id = ?',
      params: [userId]
    },
    {
      key: 'user_subscriptions',
      sql: 'DELETE FROM user_subscriptions WHERE user_id = ?',
      params: [userId]
    },
    {
      key: 'user_node_configs',
      sql: 'DELETE FROM user_node_configs WHERE user_id = ?',
      params: [userId]
    },
    {
      key: 'traffic_sync_log',
      sql: 'DELETE FROM traffic_sync_log WHERE user_id = ?',
      params: [userId]
    },
    {
      key: 'orders_referrer_links',
      sql: 'UPDATE orders SET referrer_user_id = NULL WHERE referrer_user_id = ?',
      params: [userId]
    },
    {
      key: 'orders',
      sql: 'DELETE FROM orders WHERE user_id = ? OR email = ?',
      params: [userId, email]
    },
    {
      key: 'users',
      sql: 'DELETE FROM users WHERE id = ?',
      params: [userId]
    }
  ];

  for (const statement of statements) {
    const result = await db.prepare(statement.sql).run(...statement.params);
    deletedRows[statement.key] = Number(result.changes) || 0;
  }

  return deletedRows;
}

/**
 * 查询指定 ID 列表里仍启用的 CF IP。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Array<number>} ipPoolIds - IP 池 ID 列表
 * @returns {Promise<Array>} IP 列表
 */
async function findEnabledCfIpsByIds(db, ipPoolIds) {
  return db.prepare(`
    SELECT id, ip, enabled
    FROM cf_ip_pool
    WHERE id = ANY(?) AND enabled = 1
  `).all(ipPoolIds);
}

/**
 * 覆盖用户绑定的 CF IP 关系。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {Array<number>} ipPoolIds - IP 池 ID 列表
 * @returns {Promise<void>}
 */
async function replaceUserCfIps(db, userId, ipPoolIds) {
  await db.prepare('DELETE FROM user_cf_ips WHERE user_id = ?').run(userId);
  const insertStatement = db.prepare(`
    INSERT INTO user_cf_ips (
      user_id, ip_pool_id, custom_ip, source, slot_index, created_at, updated_at
    )
    VALUES (?, ?, NULL, 'pool', ?, EXTRACT(EPOCH FROM NOW()), EXTRACT(EPOCH FROM NOW()))
  `);

  for (let index = 0; index < ipPoolIds.length; index += 1) {
    await insertStatement.run(userId, ipPoolIds[index], index + 1);
  }
}

/**
 * 查询用户当前启用的 CF 优选 IP。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} IP 列表
 */
async function findActiveCfIpsForUser(db, userId) {
  return db.prepare(`
    SELECT
      uci.id,
      uci.ip_pool_id,
      uci.custom_ip,
      COALESCE(uci.source, 'pool') AS source,
      uci.slot_index,
      COALESCE(cp.ip, uci.custom_ip) AS ip,
      cp.enabled
    FROM user_cf_ips uci
    LEFT JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
    WHERE uci.user_id = ?
      AND (COALESCE(uci.source, 'pool') = 'custom' OR cp.enabled = 1)
    ORDER BY COALESCE(uci.slot_index, uci.id) ASC, uci.id ASC
  `).all(userId);
}

/**
 * 查询生成订阅所需的在线 3X-UI 服务器。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 服务器列表
 */
async function listActiveXuiServersForSubscription(db) {
  return db.prepare(`
    SELECT id, name, api_url, host, client_port, sub_url
    FROM xui_servers
    WHERE status = 1
  `).all();
}

/**
 * 查询同步用户信息所需的在线 3X-UI 服务器。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 服务器列表
 */
async function listOnlineXuiServersForSync(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token, panel_version
    FROM xui_servers
    WHERE status = 1
  `).all();
}

/**
 * 查询某个服务器上用户已有的节点配置。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {number} serverId - 服务器 ID
 * @returns {Promise<Array>} 节点配置列表
 */
async function listUserNodeConfigsByServer(db, userId, serverId) {
  return db.prepare(`
    SELECT unc.uuid, unc.auth, unc.sub_id, xn.remark, xn.protocol, xn.inbound_id
    FROM user_node_configs unc
    JOIN xui_nodes xn ON unc.server_id = xn.server_id AND unc.inbound_id = xn.inbound_id
    WHERE unc.user_id = ? AND unc.server_id = ?
  `).all(userId, serverId);
}

/**
 * 保存用户订阅缓存，已存在时执行覆盖更新。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} payload - 订阅缓存数据
 * @returns {Promise<void>}
 */
async function saveUserSubscriptionCache(db, payload) {
  const {
    userId,
    subId,
    nodesData,
    updatedAt
  } = payload;

  await db.pool.query(
    `
      INSERT INTO user_subscriptions (user_id, sub_id, nodes_data, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (sub_id) DO UPDATE SET
        nodes_data = EXCLUDED.nodes_data,
        updated_at = EXCLUDED.updated_at
    `,
    [userId, subId, nodesData, updatedAt]
  );
}

/**
 * 查询需要同步用户状态的节点目标集合。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 节点目标列表
 */
async function listNodeSyncTargetsByServer(db) {
  return db.prepare(`
    SELECT server_id, inbound_id
    FROM xui_nodes
    WHERE user_count > 0
  `).all();
}

/**
 * 根据服务器与入站 ID 查询节点信息。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} serverId - 服务器 ID
 * @param {number} inboundId - 入站 ID
 * @returns {Promise<Object|undefined>} 节点信息
 */
async function findXuiNodeByServerAndInbound(db, serverId, inboundId) {
  return db.prepare(`
    SELECT remark, protocol
    FROM xui_nodes
    WHERE server_id = ? AND inbound_id = ?
  `).get(serverId, inboundId);
}

module.exports = {
  findUserByEmail,
  findUserRegisterSnapshotByEmail,
  findEnabledPlanById,
  updateRegisteredUserForPlan,
  createRegisteredUser,
  createPendingOrder,
  markOrderExpiredByOutTradeNo,
  updateOrderPaymentInfo,
  findLoginUserByEmail,
  findPasswordResetUserByEmail,
  countPasswordResetTokensSince,
  createPasswordResetToken,
  findPasswordResetToken,
  markPasswordResetTokenUsed,
  updateUserPasswordHash,
  findUserProfileById,
  findSystemSettingByKey,
  findUserSyncStatusById,
  markUserOnboardingCompleted,
  hasUserCfIps,
  hasUserSubscriptionCache,
  countUsers,
  listUsers,
  findUserDetailById,
  listUserOrders,
  listUserCfIps,
  updateUserFields,
  findUserIpLocationById,
  updateUserIpLocation,
  deleteUserLocalRelatedData,
  findEnabledCfIpsByIds,
  replaceUserCfIps,
  findActiveCfIpsForUser,
  listActiveXuiServersForSubscription,
  listOnlineXuiServersForSync,
  listUserNodeConfigsByServer,
  saveUserSubscriptionCache,
  listNodeSyncTargetsByServer,
  findXuiNodeByServerAndInbound
};

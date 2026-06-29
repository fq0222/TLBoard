const { withTransaction } = require('../shared/utils/db-transaction');

/**
 * CF 优选仓储。
 * 负责 cf_ip_pool / user_cf_ips / users 的数据访问，供用户端 CF 优选模块复用。
 */

async function listEnabledCfIps(db) {
  return db.prepare(`
    SELECT id, ip
    FROM cf_ip_pool
    WHERE enabled = 1
    ORDER BY id
  `).all();
}

/**
 * 查询用户当前已绑定的启用中优选 IP。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>} 当前绑定 IP 列表
 */
async function listCurrentUserCfIps(db, userId) {
  return db.prepare(`
    SELECT
      uci.id,
      uci.user_id,
      uci.ip_pool_id,
      uci.custom_ip,
      COALESCE(uci.source, 'pool') AS source,
      uci.slot_index,
      COALESCE(cp.ip, uci.custom_ip) AS ip,
      cp.enabled,
      uci.created_at,
      uci.updated_at
    FROM user_cf_ips uci
    LEFT JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
    WHERE uci.user_id = ?
      AND (COALESCE(uci.source, 'pool') = 'custom' OR cp.enabled = 1)
    ORDER BY COALESCE(uci.slot_index, uci.id) ASC, uci.id ASC
  `).all(userId);
}

/**
 * 根据 IP 池 ID 列表查询启用中的优选 IP。
 *
 * @param {Object} db - 数据库实例
 * @param {Array<number>} ipIds - IP 池 ID 列表
 * @returns {Promise<Array>} 匹配到的 IP 列表
 */
async function findEnabledCfIpsByIds(db, ipIds) {
  return db.prepare(`
    SELECT id, ip
    FROM cf_ip_pool
    WHERE id = ANY(?) AND enabled = 1
  `).all(ipIds);
}

/**
 * 根据 IP 地址列表查询启用中的优选 IP。
 *
 * @param {Object} db - 数据库实例
 * @param {Array<string>} ips - IP 地址列表
 * @returns {Promise<Array>} 匹配到的 IP 列表
 */
async function findEnabledCfIpsByAddresses(db, ips) {
  return db.prepare(`
    SELECT id, ip
    FROM cf_ip_pool
    WHERE ip = ANY(?) AND enabled = 1
  `).all(ips);
}

/**
 * 查询用户订阅 ID。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @returns {Promise<Object|undefined>} 用户订阅信息
 */
async function findUserSubscriptionIdentity(db, userId) {
  return db.prepare('SELECT sub_id FROM users WHERE id = ?').get(userId);
}

/**
 * 事务内覆盖用户绑定的优选 IP 关系。
 * 这里使用显式事务，避免删旧插新之间出现半成功状态。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户 ID
 * @param {Array<number>} ipIds - 新的 IP 池 ID 列表
 * @returns {Promise<void>}
 */
async function replaceUserCfIps(db, userId, ipIds) {
  await withTransaction(db, async (client) => {
    await client.query('DELETE FROM user_cf_ips WHERE user_id = $1', [userId]);

    for (let index = 0; index < ipIds.length; index += 1) {
      await client.query(
        `INSERT INTO user_cf_ips (
          user_id, ip_pool_id, custom_ip, source, slot_index, created_at, updated_at
        )
        VALUES ($1, $2, NULL, 'pool', $3, EXTRACT(EPOCH FROM NOW()), EXTRACT(EPOCH FROM NOW()))`,
        [userId, ipIds[index], index + 1]
      );
    }
  });
}

/**
 * 将用户指定 CF IP 槽位替换为用户私有 IP。
 *
 * @param {Object} db - 数据库实例
 * @param {number} userId - 当前用户 ID
 * @param {number} slotIndex - 1~5 的槽位序号
 * @param {string} ip - 用户手动输入的 IPv4/IPv6 地址
 * @returns {Promise<Object>} 替换后的槽位记录
 */
async function replaceUserCfIpSlotWithCustomIp(db, userId, slotIndex, ip) {
  return db.prepare(`
    INSERT INTO user_cf_ips (
      user_id, ip_pool_id, custom_ip, source, slot_index, created_at, updated_at
    )
    VALUES (?, NULL, ?, 'custom', ?, EXTRACT(EPOCH FROM NOW()), EXTRACT(EPOCH FROM NOW()))
    ON CONFLICT (user_id, slot_index)
    DO UPDATE SET
      ip_pool_id = NULL,
      custom_ip = EXCLUDED.custom_ip,
      source = 'custom',
      updated_at = EXTRACT(EPOCH FROM NOW())
    RETURNING
      id,
      user_id,
      ip_pool_id,
      custom_ip,
      source,
      slot_index,
      custom_ip AS ip,
      created_at,
      updated_at
  `).get(userId, ip, slotIndex);
}

module.exports = {
  listEnabledCfIps,
  listCurrentUserCfIps,
  findEnabledCfIpsByIds,
  findEnabledCfIpsByAddresses,
  findUserSubscriptionIdentity,
  replaceUserCfIps,
  replaceUserCfIpSlotWithCustomIp
};

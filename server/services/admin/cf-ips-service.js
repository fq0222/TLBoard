const { parsePagination } = require('../../shared/utils/pagination');
const { withTransaction } = require('../../shared/utils/db-transaction');
const adminCfIpsRepository = require('../../repositories/admin-cf-ips-repository');

/**
 * 管理端 CF IP 池服务。
 * 负责分页查询、增删改与批量导入规则，并保持旧接口响应语义兼容。
 */

function createLegacyBusinessError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  return error;
}

async function listCfIps(db, query) {
  const { page, limit, offset } = parsePagination(query, {
    defaultPage: 1,
    defaultLimit: 20,
    maxLimit: 200
  });
  const totalRow = await adminCfIpsRepository.countCfIps(db);
  const list = await adminCfIpsRepository.listCfIps(db, limit, offset);

  return {
    total: Number(totalRow.total) || 0,
    page,
    limit,
    list
  };
}

/**
 * 创建单个 CF IP 记录。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 创建参数
 * @returns {Promise<Object>} 新建记录
 */
async function createCfIp(db, payload) {
  const existingIp = await adminCfIpsRepository.findCfIpByIp(db, payload.ip);
  if (existingIp) {
    throw createLegacyBusinessError('IP已存在');
  }

  const enabled = payload.enabled === undefined ? 1 : (payload.enabled ? 1 : 0);
  const result = await adminCfIpsRepository.createCfIp(db, payload.ip, enabled);

  return {
    id: result.lastInsertRowid,
    ip: payload.ip,
    enabled,
    created_at: Math.floor(Date.now() / 1000)
  };
}

/**
 * 更新单个 CF IP 记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ipId - IP 记录 ID
 * @param {Object} payload - 更新参数
 * @returns {Promise<Object>} 更新后的记录
 */
async function updateCfIp(db, ipId, payload) {
  const existingIp = await adminCfIpsRepository.findCfIpById(db, ipId);
  if (!existingIp) {
    throw createLegacyBusinessError('IP不存在');
  }

  if (payload.ip !== undefined && payload.ip !== existingIp.ip) {
    const duplicatedIp = await adminCfIpsRepository.findCfIpByIp(db, payload.ip);
    if (duplicatedIp) {
      throw createLegacyBusinessError('IP已存在');
    }
  }

  const updates = [];
  const values = [];

  if (payload.ip !== undefined) {
    updates.push('ip = ?');
    values.push(payload.ip);
  }
  if (payload.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(payload.enabled ? 1 : 0);
  }

  if (updates.length === 0) {
    throw createLegacyBusinessError('没有要更新的字段');
  }

  await adminCfIpsRepository.updateCfIpFields(db, ipId, updates, values);
  const updatedIp = await adminCfIpsRepository.findCfIpById(db, ipId);

  return {
    id: updatedIp.id,
    ip: updatedIp.ip,
    enabled: updatedIp.enabled,
    created_at: updatedIp.created_at
  };
}

/**
 * 删除单个 CF IP 记录。
 *
 * @param {Object} db - 数据库实例
 * @param {number} ipId - IP 记录 ID
 * @returns {Promise<Object>} 删除结果
 */
async function deleteCfIp(db, ipId) {
  const existingIp = await adminCfIpsRepository.findCfIpById(db, ipId);
  if (!existingIp) {
    throw createLegacyBusinessError('IP不存在');
  }

  await adminCfIpsRepository.deleteCfIp(db, ipId);
  return {
    message: 'IP 已删除'
  };
}

/**
 * 批量导入 CF IP。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 导入参数
 * @returns {Promise<Object>} 导入统计结果
 */
async function importCfIps(db, payload) {
  const enabled = payload.enabled === undefined ? 1 : (payload.enabled ? 1 : 0);
  let imported = 0;
  let skipped = 0;

  await withTransaction(db, async (client) => {
    for (const item of payload.ips) {
      const ip = typeof item === 'string' ? item : item.ip;
      const normalizedIp = String(ip || '').trim();
      if (!normalizedIp) {
        continue;
      }

      const existing = await client.query(
        'SELECT id FROM cf_ip_pool WHERE ip = $1',
        [normalizedIp]
      );

      if (existing.rows.length > 0) {
        skipped += 1;
        continue;
      }

      await client.query(
        'INSERT INTO cf_ip_pool (ip, enabled) VALUES ($1, $2)',
        [normalizedIp, enabled]
      );
      imported += 1;
    }
  });

  return {
    imported,
    skipped,
    message: skipped > 0
      ? `成功导入 ${imported} 个IP，跳过 ${skipped} 个重复IP`
      : `成功导入 ${imported} 个IP`
  };
}

module.exports = {
  listCfIps,
  createCfIp,
  updateCfIp,
  deleteCfIp,
  importCfIps
};

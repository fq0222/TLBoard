const crypto = require('crypto');
const adminRepository = require('../../repositories/admin-repository');
const telegramRepository = require('../../repositories/telegram-repository');
const userRepository = require('../../repositories/user-repository');

/**
 * 创建兼容旧响应结构的业务异常。
 *
 * @param {string} message - 错误消息
 * @param {Object} [options] - 附加配置
 * @returns {Error} 业务异常
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
 * 获取当前秒级时间戳。
 *
 * @returns {number} 秒级 Unix 时间戳
 */
function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 格式化流量，兼容 null、空串和字符串数字。
 *
 * @param {*} bytes - 原始流量值
 * @returns {string} 格式化后的流量文本
 */
function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') {
    return '0 B';
  }

  const numberValue = Number(bytes);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let currentValue = numberValue;
  let unitIndex = 0;
  while (currentValue >= 1024 && unitIndex < units.length - 1) {
    currentValue /= 1024;
    unitIndex += 1;
  }

  return `${Number(currentValue.toFixed(2))} ${units[unitIndex]}`;
}

/**
 * 记录 Telegram 命令执行日志。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 命令数据
 * @returns {Promise<void>}
 */
async function logTelegramCommand(db, payload) {
  await telegramRepository.createCommandLog(db, {
    ...payload,
    createdAt: payload.createdAt || getNowTimestamp()
  });
}

/**
 * 确认 chat_id 已绑定管理员，否则抛出权限异常。
 *
 * @param {Object} db - 数据库实例
 * @param {string} chatId - Telegram chat_id
 * @returns {Promise<Object>} 绑定后的管理员信息
 */
async function requireBoundAdminByChatId(db, chatId) {
  const binding = await getAdminByChatId(db, chatId);
  if (!binding.bound) {
    throw createLegacyBusinessError('当前 chat 未绑定管理员', {
      statusCode: 403,
      code: 1004
    });
  }

  return binding;
}

/**
 * 验证管理员绑定码并建立绑定关系。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - Telegram 绑定信息
 * @returns {Promise<Object>} 绑定结果
 */
async function verifyAdminBindCode(db, payload) {
  const bindCode = await telegramRepository.findBindCodeByCode(db, payload.bind_code);
  const now = getNowTimestamp();

  if (!bindCode) {
    throw createLegacyBusinessError('绑定码无效', {
      statusCode: 400,
      code: 4001
    });
  }

  if (bindCode.used_at) {
    throw createLegacyBusinessError('绑定码已使用', {
      statusCode: 400,
      code: 4001
    });
  }

  if (Number(bindCode.expires_at) > 0 && Number(bindCode.expires_at) < now) {
    throw createLegacyBusinessError('绑定码已过期', {
      statusCode: 400,
      code: 4001
    });
  }

  const existingBinding = await telegramRepository.findAdminBindingByChatId(db, payload.chat_id);
  if (existingBinding && Number(existingBinding.admin_id) !== Number(bindCode.admin_id)) {
    throw createLegacyBusinessError('当前 chat 已绑定其他管理员', {
      statusCode: 400,
      code: 4001
    });
  }

  await telegramRepository.createAdminBinding(db, {
    adminId: bindCode.admin_id,
    chatId: payload.chat_id,
    telegramUserId: payload.telegram_user_id,
    telegramUsername: payload.telegram_username,
    telegramFirstName: payload.telegram_first_name,
    telegramLastName: payload.telegram_last_name,
    createdAt: now
  });
  await telegramRepository.markBindCodeUsed(db, bindCode.id, now);

  return {
    admin_id: bindCode.admin_id,
    username: bindCode.username,
    role: 'admin',
    bound: true
  };
}

/**
 * 按 chat_id 查询管理员绑定状态。
 *
 * @param {Object} db - 数据库实例
 * @param {string} chatId - Telegram chat_id
 * @returns {Promise<Object>} 绑定状态
 */
async function getAdminByChatId(db, chatId) {
  const binding = await telegramRepository.findAdminBindingByChatId(db, chatId);
  if (!binding) {
    return { bound: false };
  }

  return {
    bound: true,
    binding_id: binding.id,
    admin_id: binding.admin_id,
    username: binding.username,
    status: 'active',
    is_super: !!binding.is_super
  };
}

/**
 * 生成管理员 Telegram 绑定码。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} payload - 生成参数
 * @returns {Promise<Object>} 新的绑定码信息
 */
async function createAdminBindCode(db, payload) {
  const adminId = Number(payload.admin_id || payload.created_by_admin_id);
  const admin = await adminRepository.findAdminById(db, adminId);
  if (!admin) {
    throw createLegacyBusinessError('管理员不存在', {
      statusCode: 404,
      code: 1004
    });
  }

  const now = getNowTimestamp();
  const bindCode = `TG-ADMIN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const expiresAt = now + (Number(payload.expires_in_seconds) || 15 * 60);

  await telegramRepository.createBindCode(db, {
    adminId,
    bindCode,
    expiresAt,
    createdByAdminId: Number(payload.created_by_admin_id || adminId),
    createdAt: now
  });

  return {
    admin_id: adminId,
    username: admin.username,
    bind_code: bindCode,
    expires_at: expiresAt
  };
}

/**
 * 查询已绑定管理员列表。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 绑定列表
 */
async function listAdminBindings(db) {
  const list = await telegramRepository.listAdminBindings(db);
  return {
    list: list.map((item) => ({
      id: item.id,
      admin_id: item.admin_id,
      username: item.username,
      is_super: item.is_super,
      chat_id: item.chat_id,
      telegram_user_id: item.telegram_user_id,
      telegram_username: item.telegram_username,
      telegram_first_name: item.telegram_first_name,
      telegram_last_name: item.telegram_last_name,
      created_at: item.created_at,
      updated_at: item.updated_at
    }))
  };
}

/**
 * 供 Telegram 管理员按 email 或 user_id 代查用户概览。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} query - 查询条件
 * @returns {Promise<Object>} 用户概览
 */
async function lookupUserOverview(db, query) {
  let user = null;
  if (query.user_id) {
    user = await userRepository.findUserProfileById(db, Number(query.user_id));
  } else if (query.email) {
    const basicUser = await userRepository.findUserByEmail(db, String(query.email).trim());
    if (basicUser) {
      user = await userRepository.findUserProfileById(db, basicUser.id);
    }
  }

  if (!user) {
    throw createLegacyBusinessError('用户不存在', {
      statusCode: 404,
      code: 2004
    });
  }

  return {
    user_id: user.id,
    email: user.email,
    enabled: user.enabled,
    plan_name: user.plan_name || '',
    traffic_used: Number(user.traffic_used) || 0,
    traffic_limit: (Number(user.traffic_limit) || 0) + (Number(user.referral_traffic_limit) || 0),
    traffic_used_text: formatTraffic(user.traffic_used),
    traffic_limit_text: formatTraffic((Number(user.traffic_limit) || 0) + (Number(user.referral_traffic_limit) || 0)),
    expire_at: user.expire_at,
    sync_status: user.sync_status
  };
}

module.exports = {
  createAdminBindCode,
  createLegacyBusinessError,
  getAdminByChatId,
  listAdminBindings,
  logTelegramCommand,
  lookupUserOverview,
  requireBoundAdminByChatId,
  verifyAdminBindCode
};


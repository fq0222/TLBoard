/**
 * 系统设置仓储。
 * 职责：集中封装 system_settings 表的读取与 UPSERT 写入，避免各业务模块重复拼 SQL。
 */

/**
 * 按键读取单个系统设置。
 *
 * @param {Object} db - 数据库实例
 * @param {string} key - 设置键名
 * @returns {Promise<{value:string}|undefined>} 设置记录
 */
async function findSettingByKey(db, key) {
  return db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
}

/**
 * 按键批量读取系统设置。
 * 核心分支：为兼容测试替身和现有 db 代理，批量读取复用单键查询而不依赖数组 SQL 语法。
 *
 * @param {Object} db - 数据库实例
 * @param {Array<string>} keys - 设置键名列表
 * @returns {Promise<Object>} 以 key 为属性名的设置值映射
 */
async function findSettingsByKeys(db, keys) {
  const result = {};

  for (const key of keys) {
    const row = await findSettingByKey(db, key);
    if (row) {
      result[key] = row.value;
    }
  }

  return result;
}

/**
 * 保存单个系统设置。
 * system_settings 的 UPSERT 使用 pool.query，避免 prepare().run() 自动拼接 RETURNING。
 *
 * @param {Object} db - 数据库实例
 * @param {string} key - 设置键名
 * @param {string|number} value - 设置值
 * @param {number} updatedAt - 更新时间戳
 * @returns {Promise<void>}
 */
async function saveSetting(db, key, value, updatedAt) {
  await db.pool.query(
    `
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `,
    [key, String(value), updatedAt]
  );
}

module.exports = {
  findSettingByKey,
  findSettingsByKeys,
  saveSetting
};

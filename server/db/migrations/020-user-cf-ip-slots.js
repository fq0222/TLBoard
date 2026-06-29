/**
 * 数据库迁移脚本：020-user-cf-ip-slots
 *
 * 变更内容：
 * 1. 将 user_cf_ips 升级为用户当前 CF IP 槽位表
 * 2. 支持公共 IP 池来源 pool 与用户私有 IP 来源 custom
 * 3. 为每个用户保留 1~5 号槽位，便于逐个替换和整体覆盖
 *
 * 使用方式：
 * node server/db/migrations/020-user-cf-ip-slots.js
 */

const databaseManager = require('../init');

/**
 * 检查指定约束是否已经存在。
 *
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {string} constraintName - 约束名称
 * @returns {Promise<boolean>} true 表示约束已存在
 */
async function constraintExists(client, constraintName) {
  const result = await client.query(`
    SELECT 1
    FROM pg_constraint
    WHERE conname = $1
  `, [constraintName]);

  return result.rows.length > 0;
}

/**
 * 检查指定字段是否已经存在。
 *
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {string} columnName - user_cf_ips 字段名
 * @returns {Promise<boolean>} true 表示字段已存在
 */
async function columnExists(client, columnName) {
  const result = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_cf_ips'
      AND column_name = $1
  `, [columnName]);

  return result.rows.length > 0;
}

/**
 * 确保 user_cf_ips 存在指定字段。
 *
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {string} columnName - 字段名
 * @param {string} columnDefinition - ALTER TABLE 使用的字段定义
 * @param {string[]} addedColumns - 新增字段记录
 * @param {string[]} skippedColumns - 跳过字段记录
 * @returns {Promise<void>}
 */
async function ensureColumn(client, columnName, columnDefinition, addedColumns, skippedColumns) {
  if (await columnExists(client, columnName)) {
    skippedColumns.push(columnName);
    return;
  }

  await client.query(`ALTER TABLE user_cf_ips ADD COLUMN ${columnDefinition}`);
  addedColumns.push(columnName);
}

/**
 * 执行 user_cf_ips 槽位迁移。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{addedColumns:string[],skippedColumns:string[]}>} 迁移结果
 */
async function up(pool) {
  const client = await pool.connect();
  const addedColumns = [];
  const skippedColumns = [];

  try {
    console.log('开始执行迁移：020-user-cf-ip-slots');
    await client.query('BEGIN');

    await ensureColumn(client, 'custom_ip', 'custom_ip VARCHAR(45)', addedColumns, skippedColumns);
    await ensureColumn(client, 'source', "source VARCHAR(20) DEFAULT 'pool'", addedColumns, skippedColumns);
    await ensureColumn(client, 'slot_index', 'slot_index INTEGER', addedColumns, skippedColumns);
    await ensureColumn(client, 'updated_at', 'updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())', addedColumns, skippedColumns);

    await client.query(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC, id ASC) AS rn
        FROM user_cf_ips
      )
      UPDATE user_cf_ips u
      SET slot_index = ranked.rn,
          source = COALESCE(NULLIF(u.source, ''), 'pool'),
          updated_at = COALESCE(u.updated_at, EXTRACT(EPOCH FROM NOW()))
      FROM ranked
      WHERE u.id = ranked.id
    `);

    await client.query('DELETE FROM user_cf_ips WHERE slot_index > 5');
    await client.query("UPDATE user_cf_ips SET custom_ip = NULL WHERE source = 'pool'");
    await client.query("UPDATE user_cf_ips SET ip_pool_id = NULL WHERE source = 'custom'");

    await client.query("ALTER TABLE user_cf_ips ALTER COLUMN source SET DEFAULT 'pool'");
    await client.query('ALTER TABLE user_cf_ips ALTER COLUMN source SET NOT NULL');
    await client.query('ALTER TABLE user_cf_ips ALTER COLUMN slot_index SET DEFAULT 1');
    await client.query('ALTER TABLE user_cf_ips ALTER COLUMN slot_index SET NOT NULL');
    await client.query('ALTER TABLE user_cf_ips ALTER COLUMN ip_pool_id DROP NOT NULL');

    if (!(await constraintExists(client, 'user_cf_ips_source_check'))) {
      await client.query(`
        ALTER TABLE user_cf_ips
        ADD CONSTRAINT user_cf_ips_source_check CHECK (source IN ('pool', 'custom'))
      `);
    }

    if (!(await constraintExists(client, 'user_cf_ips_value_check'))) {
      await client.query(`
        ALTER TABLE user_cf_ips
        ADD CONSTRAINT user_cf_ips_value_check CHECK (
          (source = 'pool' AND ip_pool_id IS NOT NULL AND custom_ip IS NULL)
          OR
          (source = 'custom' AND ip_pool_id IS NULL AND custom_ip IS NOT NULL)
        )
      `);
    }

    if (!(await constraintExists(client, 'user_cf_ips_slot_check'))) {
      await client.query(`
        ALTER TABLE user_cf_ips
        ADD CONSTRAINT user_cf_ips_slot_check CHECK (slot_index BETWEEN 1 AND 5)
      `);
    }

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_cf_ips_user_slot
      ON user_cf_ips(user_id, slot_index)
    `);

    await client.query('COMMIT');
    console.log('迁移完成：020-user-cf-ip-slots');

    return { addedColumns, skippedColumns };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败：020-user-cf-ip-slots', error.message);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  databaseManager.init()
    .then((db) => up(db.pool))
    .finally(() => databaseManager.close());
}

module.exports = {
  up,
  columnExists,
  constraintExists
};

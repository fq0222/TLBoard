/**
 * 数据库迁移脚本：018-xui-server-cascade-cleanup
 *
 * 变更内容：
 * 1. 清理四张服务器关联表中的孤儿 server_id 数据
 * 2. 为四张关联表补充 xui_servers(id) ON DELETE CASCADE 外键
 *
 * 使用方式：
 * node server/db/migrations/018-xui-server-cascade-cleanup.js
 */

const databaseManager = require('../init');

const SERVER_RELATIONS = [
  {
    tableName: 'xui_nodes',
    constraintName: 'fk_xui_nodes_server_id'
  },
  {
    tableName: 'traffic_sync_log',
    constraintName: 'fk_traffic_sync_log_server_id'
  },
  {
    tableName: 'user_node_configs',
    constraintName: 'fk_user_node_configs_server_id'
  },
  {
    tableName: 'user_subscription_sources',
    constraintName: 'fk_user_subscription_sources_server_id'
  }
];

/**
 * 清理指定表中不再对应任何 xui_servers.id 的孤儿记录。
 *
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {string} tableName - 允许列表中的关联表名
 * @returns {Promise<number>} 删除的记录数
 */
async function deleteOrphanRows(client, tableName) {
  const result = await client.query(`
    DELETE FROM ${tableName}
    WHERE NOT EXISTS (
      SELECT 1
      FROM xui_servers
      WHERE xui_servers.id = ${tableName}.server_id
    )
  `);

  return result.rowCount || 0;
}

/**
 * 判断指定外键约束是否已经存在。
 *
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {string} constraintName - 外键约束名
 * @returns {Promise<boolean>} true 表示约束已存在
 */
async function constraintExists(client, constraintName) {
  const result = await client.query(`
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = $1
  `, [constraintName]);

  return result.rows.length > 0;
}

/**
 * 为指定关联表添加 server_id 级联外键。
 *
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {string} tableName - 允许列表中的关联表名
 * @param {string} constraintName - 外键约束名
 * @returns {Promise<void>}
 */
async function addCascadeForeignKey(client, tableName, constraintName) {
  await client.query(`
    ALTER TABLE ${tableName}
    ADD CONSTRAINT ${constraintName}
    FOREIGN KEY (server_id)
    REFERENCES xui_servers(id)
    ON DELETE CASCADE
  `);
}

/**
 * 执行迁移：先清理孤儿数据，再幂等添加级联外键。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<Object>} 清理和约束处理结果
 */
async function up(pool) {
  const client = await pool.connect();
  const deletedRows = {};
  const addedConstraints = [];
  const skippedConstraints = [];

  try {
    console.log('开始执行迁移：018-xui-server-cascade-cleanup');
    await client.query('BEGIN');

    for (const relation of SERVER_RELATIONS) {
      const deletedCount = await deleteOrphanRows(client, relation.tableName);
      deletedRows[relation.tableName] = deletedCount;
      console.log(`已清理 ${relation.tableName} 孤儿记录: ${deletedCount}`);
    }

    for (const relation of SERVER_RELATIONS) {
      if (await constraintExists(client, relation.constraintName)) {
        skippedConstraints.push(relation.constraintName);
        console.log(`约束已存在，跳过: ${relation.constraintName}`);
        continue;
      }

      await addCascadeForeignKey(client, relation.tableName, relation.constraintName);
      addedConstraints.push(relation.constraintName);
      console.log(`已添加级联外键: ${relation.constraintName}`);
    }

    await client.query('COMMIT');
    console.log('迁移完成：018-xui-server-cascade-cleanup');

    return {
      deletedRows,
      addedConstraints,
      skippedConstraints
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败：018-xui-server-cascade-cleanup', error.message);
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
  deleteOrphanRows,
  constraintExists,
  addCascadeForeignKey
};

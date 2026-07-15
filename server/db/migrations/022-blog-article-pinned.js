/**
 * 数据库迁移脚本：022-blog-article-pinned
 *
 * 变更内容：
 * 1. blog_articles 表新增 pinned 字段，用于帮助文章置顶排序。
 * 2. 新增 pinned 索引，保持后台和用户端列表排序稳定。
 *
 * 使用方式：
 * node server/db/migrations/022-blog-article-pinned.js
 */

const databaseManager = require('../init');

/**
 * 检查 blog_articles 表中指定字段是否存在。
 *
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {string} columnName - 需要检查的字段名
 * @returns {Promise<boolean>} 字段存在时返回 true
 */
async function columnExists(client, columnName) {
  const result = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'blog_articles'
      AND column_name = $1
  `, [columnName]);

  return result.rows.length > 0;
}

/**
 * 执行博客文章置顶字段迁移。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{addedColumns:string[],skippedColumns:string[]}>} 字段处理结果
 */
async function up(pool) {
  const client = await pool.connect();
  const addedColumns = [];
  const skippedColumns = [];

  try {
    console.log('开始执行迁移：022-blog-article-pinned');
    await client.query('BEGIN');

    if (await columnExists(client, 'pinned')) {
      skippedColumns.push('pinned');
    } else {
      await client.query(`
        ALTER TABLE blog_articles
        ADD COLUMN pinned INTEGER DEFAULT 0
      `);
      addedColumns.push('pinned');
    }

    await client.query('CREATE INDEX IF NOT EXISTS idx_blog_articles_pinned ON blog_articles(pinned)');
    await client.query('COMMIT');
    console.log('迁移完成：022-blog-article-pinned');

    return { addedColumns, skippedColumns };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('迁移失败：022-blog-article-pinned', error.message);
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
  columnExists
};

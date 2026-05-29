/**
 * 显式事务辅助方法
 * 基于当前项目的 db.pool.connect() 模式封装，确保同一事务中的所有 SQL 都走同一个 client。
 *
 * @param {Object} db - 数据库代理对象，要求暴露 pool.connect()
 * @param {Function} handler - 事务回调，接收已开启事务的 client
 * @returns {Promise<*>} 返回事务回调的执行结果
 */
async function withTransaction(db, handler) {
  if (!db || !db.pool || typeof db.pool.connect !== 'function') {
    throw new Error('db.pool.connect 不可用，无法开启事务');
  }

  if (typeof handler !== 'function') {
    throw new Error('事务处理函数 handler 必须为函数');
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // 事务内的所有查询都应使用同一个 client，避免落到连接池默认连接。
    const result = await handler(client);

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  withTransaction
};

/**
 * 数据库兼容代理模块
 * 负责构建与原 SQLite 风格兼容的数据库代理对象。
 */

/**
 * 创建语句执行器。
 * @param {Function} executeQuery - SQL 执行函数
 * @param {Function} convertPlaceholders - 占位符转换函数
 * @param {object} logger - 日志实例
 * @returns {object} 兼容原 SQLite 风格的语句接口
 */
function createStatementExecutor(executeQuery, convertPlaceholders, logger) {
  return {
    /**
     * 准备 SQL 语句。
     * @param {string} sql - SQL 语句，使用 ? 作为参数占位符
     */
    prepare(sql) {
      const convertedSql = convertPlaceholders(sql);

      return {
        async run(...params) {
          try {
            const result = await executeQuery(convertedSql + ' RETURNING id', params);
            const lastId = result.rows.length > 0 ? result.rows[0].id : 0;
            return { lastInsertRowid: lastId, changes: result.rowCount };
          } catch (error) {
            logger.error(`SQL执行错误(run): ${convertedSql} - ${error.message}`);
            throw error;
          }
        },
        async get(...params) {
          try {
            const result = await executeQuery(convertedSql, params);
            return result.rows[0] || undefined;
          } catch (error) {
            logger.error(`SQL执行错误(get): ${convertedSql} - ${error.message}`);
            throw error;
          }
        },
        async all(...params) {
          try {
            const result = await executeQuery(convertedSql, params);
            return result.rows;
          } catch (error) {
            logger.error(`SQL执行错误(all): ${convertedSql} - ${error.message}`);
            throw error;
          }
        }
      };
    }
  };
}

/**
 * 创建事务态数据库代理。
 * 负责保证事务回调中的 SQL 全部落到同一个 client。
 * @param {object} options - 事务代理构建参数
 * @param {import('pg').PoolClient} options.client - PostgreSQL 事务连接
 * @param {Function} options.convertPlaceholders - 占位符转换函数
 * @param {object} options.logger - 日志实例
 * @returns {object} 事务态数据库代理
 */
function createTransactionDbProxy({ client, convertPlaceholders, logger }) {
  const executeQuery = (sql, params = []) => client.query(sql, params);
  const statementExecutor = createStatementExecutor(executeQuery, convertPlaceholders, logger);

  const transactionDb = {
    /**
     * 暴露当前事务连接，兼容需要直接操作连接的场景。
     */
    pool: client,
    ...statementExecutor,

    /**
     * 直接执行 SQL 语句。
     * @param {string} sql - SQL 语句
     */
    async exec(sql) {
      try {
        await executeQuery(sql);
      } catch (error) {
        logger.error(`SQL执行错误(exec): ${error.message}`);
        throw error;
      }
    },

    /**
     * 事务内继续调用 transaction 时，复用当前事务态 proxy。
     * @param {Function} fn - 事务执行函数
     * @returns {Function} 事务包装后的函数
     */
    transaction(fn) {
      return async function(...args) {
        return fn.apply(transactionDb, [transactionDb, ...args]);
      };
    },

    /**
     * 兼容原 save 接口。
     */
    save() {
      logger.info('PostgreSQL 自动持久化，无需手动保存');
    }
  };

  return transactionDb;
}

/**
 * 创建数据库兼容代理对象。
 * @param {object} options - 代理构建参数
 * @param {import('pg').Pool} options.pool - PostgreSQL 连接池
 * @param {Function} options.queryWithRetry - 带重试的查询函数
 * @param {Function} options.convertPlaceholders - 占位符转换函数
 * @param {object} options.logger - 日志实例
 * @returns {object} 兼容原 SQLite 风格的代理对象
 */
function createDbProxy({ pool, queryWithRetry, convertPlaceholders, logger }) {
  const statementExecutor = createStatementExecutor(queryWithRetry, convertPlaceholders, logger);

  return {
    /**
     * 获取连接池（用于需要直接使用连接的场景，如事务）。
     */
    pool,
    ...statementExecutor,

    /**
     * 直接执行 SQL 语句。
     * @param {string} sql - SQL 语句
     */
    async exec(sql) {
      try {
        await pool.query(sql);
      } catch (error) {
        logger.error(`SQL执行错误(exec): ${error.message}`);
        throw error;
      }
    },

    /**
     * 构建事务包装器。
     * @param {Function} fn - 事务执行函数
     * @returns {Function} 事务包装后的函数
     */
    transaction(fn) {
      return async function(...args) {
        const client = await pool.connect();
        const transactionDb = createTransactionDbProxy({
          client,
          convertPlaceholders,
          logger
        });

        try {
          await client.query('BEGIN');
          const result = await fn.apply(transactionDb, [transactionDb, ...args]);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      };
    },

    /**
     * 兼容原 save 接口。
     */
    save() {
      logger.info('PostgreSQL 自动持久化，无需手动保存');
    }
  };
}

module.exports = {
  createDbProxy
};

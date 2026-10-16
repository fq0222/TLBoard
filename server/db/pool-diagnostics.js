/**
 * PostgreSQL 连接池诊断工具。
 * 负责在连接获取失败和连接池错误时附加池容量快照，便于定位连接耗尽问题。
 */

const INSTRUMENTED_CONNECT = Symbol('instrumentedPoolConnect');

/**
 * 格式化连接池当前计数；字段不可用时保留 unknown，避免诊断逻辑覆盖原始异常。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {string} 可直接写入日志的连接池快照
 */
function formatPoolSnapshot(pool) {
  const readCount = key => Number.isFinite(Number(pool?.[key]))
    ? Number(pool[key])
    : 'unknown';
  const totalCount = readCount('totalCount');
  const idleCount = readCount('idleCount');
  const activeCount = typeof totalCount === 'number' && typeof idleCount === 'number'
    ? totalCount - idleCount
    : 'unknown';

  return `totalCount=${totalCount}, idleCount=${idleCount}, activeCount=${activeCount}, waitingCount=${readCount('waitingCount')}`;
}

/**
 * 包装连接池的 connect 方法，在 Promise 与回调两种获取连接方式失败时记录池状态。
 * 核心分支：回调方式保持 node-postgres 原签名；Promise 方式记录后继续抛出原错误。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {{error: Function}} logger - 数据库日志器
 * @returns {import('pg').Pool} 已添加诊断能力的原连接池
 */
function instrumentPoolConnectionDiagnostics(pool, logger) {
  if (pool[INSTRUMENTED_CONNECT]) {
    return pool;
  }

  const originalConnect = pool.connect.bind(pool);
  pool.connect = function connectWithDiagnostics(callback) {
    if (typeof callback === 'function') {
      return originalConnect((error, client, release) => {
        if (error) {
          logger.error(`数据库连接获取失败: ${error.message}; pool={${formatPoolSnapshot(pool)}}`);
        }
        callback(error, client, release);
      });
    }

    return originalConnect().catch(error => {
      logger.error(`数据库连接获取失败: ${error.message}; pool={${formatPoolSnapshot(pool)}}`);
      throw error;
    });
  };
  pool[INSTRUMENTED_CONNECT] = true;
  return pool;
}

/**
 * 注册连接池后台错误监听，在空闲连接异常等场景输出连接池计数。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {{error: Function}} logger - 数据库日志器
 * @returns {void}
 */
function registerPoolErrorDiagnostics(pool, logger) {
  pool.on('error', error => {
    logger.error(`连接池错误: ${error.message}; pool={${formatPoolSnapshot(pool)}}`);
  });
}

module.exports = {
  formatPoolSnapshot,
  instrumentPoolConnectionDiagnostics,
  registerPoolErrorDiagnostics
};

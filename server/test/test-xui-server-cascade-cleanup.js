const test = require('node:test');
const assert = require('node:assert/strict');

const migration = require('../db/migrations/018-xui-server-cascade-cleanup');
const serversService = require('../services/admin/servers-service');
const serversRepository = require('../repositories/servers-repository');
const userHomeRoutingRepository = require('../repositories/user-home-routing-repository');
const { createDbProxy } = require('../db/proxy');

/**
 * 构造迁移脚本专用的 PostgreSQL 连接池桩。
 * @param {Object} options - 测试分支配置
 * @param {Set<string>} options.existingConstraints - 已存在的约束名集合
 * @returns {{pool:Object,calls:Array}} 连接池桩与 SQL 调用记录
 */
function createPoolStub(options = {}) {
  const existingConstraints = options.existingConstraints || new Set();
  const calls = [];
  const client = {
    /**
     * 记录 SQL 并按查询类型返回模拟结果。
     * @param {string} sql - PostgreSQL SQL 文本
     * @param {Array<*>} params - 绑定参数
     * @returns {Promise<Object|undefined>} 查询结果
     */
    async query(sql, params = []) {
      calls.push({ sql: normalizeSql(sql), params });

      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
        return undefined;
      }

      if (sql.includes('information_schema.table_constraints')) {
        return {
          rows: existingConstraints.has(params[0]) ? [{ constraint_name: params[0] }] : []
        };
      }

      if (sql.trim().startsWith('DELETE FROM')) {
        return { rowCount: 2 };
      }

      if (sql.trim().startsWith('ALTER TABLE')) {
        return { rowCount: 0 };
      }

      throw new Error(`unexpected sql: ${sql}`);
    },

    /**
     * 兼容 pg client.release，测试中无需执行动作。
     */
    release() {}
  };

  return {
    calls,
    pool: {
      /**
       * 返回同一个连接桩，便于断言事务内调用顺序。
       * @returns {Promise<Object>} PostgreSQL client 桩
       */
      async connect() {
        return client;
      }
    }
  };
}

/**
 * 压缩 SQL 空白，降低测试对格式换行的敏感度。
 * @param {string} sql - 原始 SQL
 * @returns {string} 压缩后的 SQL
 */
function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

test('迁移脚本先清理孤儿记录再添加四个级联外键', async () => {
  const { pool, calls } = createPoolStub();

  const result = await migration.up(pool);

  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls[calls.length - 1].sql, 'COMMIT');
  assert.deepEqual(result.deletedRows, {
    xui_nodes: 2,
    traffic_sync_log: 2,
    user_node_configs: 2,
    user_subscription_sources: 2
  });
  assert.deepEqual(result.addedConstraints, [
    'fk_xui_nodes_server_id',
    'fk_traffic_sync_log_server_id',
    'fk_user_node_configs_server_id',
    'fk_user_subscription_sources_server_id'
  ]);

  const deleteCalls = calls.filter((call) => call.sql.startsWith('DELETE FROM'));
  assert.equal(deleteCalls.length, 4);
  assert.ok(deleteCalls[0].sql.includes('DELETE FROM xui_nodes'));
  assert.ok(deleteCalls[1].sql.includes('DELETE FROM traffic_sync_log'));
  assert.ok(deleteCalls[2].sql.includes('DELETE FROM user_node_configs'));
  assert.ok(deleteCalls[3].sql.includes('DELETE FROM user_subscription_sources'));

  const alterCalls = calls.filter((call) => call.sql.startsWith('ALTER TABLE'));
  assert.equal(alterCalls.length, 4);
  assert.ok(alterCalls.every((call) => call.sql.includes('ON DELETE CASCADE')));
});

test('迁移脚本检测到已有约束时跳过重复添加', async () => {
  const existingConstraints = new Set([
    'fk_xui_nodes_server_id',
    'fk_traffic_sync_log_server_id',
    'fk_user_node_configs_server_id',
    'fk_user_subscription_sources_server_id'
  ]);
  const { pool, calls } = createPoolStub({ existingConstraints });

  const result = await migration.up(pool);

  assert.deepEqual(result.addedConstraints, []);
  assert.deepEqual(result.skippedConstraints, Array.from(existingConstraints));
  assert.equal(calls.filter((call) => call.sql.startsWith('ALTER TABLE')).length, 0);
});

test('迁移脚本失败时回滚事务', async () => {
  const calls = [];
  const originalConsoleError = console.error;
  const pool = {
    /**
     * 返回会在清理阶段失败的连接桩，覆盖回滚分支。
     * @returns {Promise<Object>} PostgreSQL client 桩
     */
    async connect() {
      return {
        /**
         * 在第一条 DELETE 时抛错，验证脚本进入 ROLLBACK。
         * @param {string} sql - PostgreSQL SQL 文本
         * @returns {Promise<Object|undefined>} 查询结果
         */
        async query(sql) {
          calls.push(normalizeSql(sql));
          if (sql === 'BEGIN' || sql === 'ROLLBACK') {
            return undefined;
          }
          throw new Error('delete failed');
        },

        /**
         * 兼容 pg client.release，测试中无需执行动作。
         */
        release() {}
      };
    }
  };

  try {
    console.error = () => {};
    await assert.rejects(() => migration.up(pool), /delete failed/);
    assert.deepEqual(calls, ['BEGIN', 'DELETE FROM xui_nodes WHERE NOT EXISTS ( SELECT 1 FROM xui_servers WHERE xui_servers.id = xui_nodes.server_id )', 'ROLLBACK']);
  } finally {
    console.error = originalConsoleError;
  }
});

/**
 * 删除编排测试夹具：保留真实数据库事务代理，仅替换数据库连接与仓储边界。
 * 记录调用参数和提交/回滚顺序，不重复实现仓储层的数组清理算法。
 */
class DeleteServerFixture {
  /** 构造独立调用日志和真实数据库事务代理。 */
  constructor() {
    this.calls = [];
    this.transactionDb = null;
    this.db = createDbProxy({
      pool: this,
      queryWithRetry: (sql) => this.query(sql),
      convertPlaceholders: (sql) => sql,
      logger: { error() {}, info() {} }
    });
  }

  /** @returns {Promise<Object>} 返回可记录事务操作的连接。 */
  async connect() {
    return this;
  }

  /** @param {string} sql - 事务控制 SQL；仓储操作由单独边界桩记录。 */
  async query(sql) {
    this.calls.push([sql]);
    return { rows: [], rowCount: 0 };
  }

  /** 记录连接归还，确保失败路径也释放连接。 */
  release() {
    this.calls.push(['release']);
  }

  /**
   * 安装自动恢复的仓储边界桩，保留服务与真实事务代理的调用行为。
   * @param {Object} t - node:test 上下文
   * @param {Object} options - 不存在、清理失败或删除失败的分支配置
   */
  mockRepositories(t, options = {}) {
    t.mock.method(serversRepository, 'findServerById', async (db, serverId) => {
      this.calls.push(['findServerById', db, serverId]);
      return options.missing ? undefined : { id: serverId, name: '测试服务器' };
    });
    t.mock.method(userHomeRoutingRepository, 'removeServerIdFromAllHomeRoutes', async (db, serverId) => {
      this.transactionDb = db;
      this.calls.push(['removeServerIdFromAllHomeRoutes', db, serverId]);
      if (options.cleanupError) {
        throw options.cleanupError;
      }
    });
    t.mock.method(serversRepository, 'deleteServer', async (db, serverId) => {
      this.calls.push(['deleteServer', db, serverId]);
      if (options.deleteError) {
        throw options.deleteError;
      }
    });
  }
}

test('管理端删除服务器时在同一事务内先清理 route 引用再删除服务器并提交', async (t) => {
  const fixture = new DeleteServerFixture();
  fixture.mockRepositories(t);

  const result = await serversService.deleteServer(fixture.db, 12);

  assert.equal(result.message, '服务器已删除');
  assert.ok(fixture.transactionDb);
  assert.notEqual(fixture.transactionDb, fixture.db);
  assert.equal(fixture.transactionDb.pool, fixture);
  assert.deepEqual(fixture.calls, [
    ['findServerById', fixture.db, 12],
    ['BEGIN'],
    ['removeServerIdFromAllHomeRoutes', fixture.transactionDb, 12],
    ['deleteServer', fixture.transactionDb, 12],
    ['COMMIT'],
    ['release']
  ]);
});

test('管理端清理 route 引用失败时回滚且不删除服务器', async (t) => {
  const fixture = new DeleteServerFixture();
  const cleanupError = new Error('route cleanup failed');
  fixture.mockRepositories(t, { cleanupError });

  await assert.rejects(() => serversService.deleteServer(fixture.db, 12), cleanupError);

  assert.deepEqual(fixture.calls, [
    ['findServerById', fixture.db, 12],
    ['BEGIN'],
    ['removeServerIdFromAllHomeRoutes', fixture.transactionDb, 12],
    ['ROLLBACK'],
    ['release']
  ]);
});

test('管理端删除服务器失败时回滚 route 清理所在事务', async (t) => {
  const fixture = new DeleteServerFixture();
  const deleteError = new Error('server delete failed');
  fixture.mockRepositories(t, { deleteError });

  await assert.rejects(() => serversService.deleteServer(fixture.db, 12), deleteError);

  assert.deepEqual(fixture.calls, [
    ['findServerById', fixture.db, 12],
    ['BEGIN'],
    ['removeServerIdFromAllHomeRoutes', fixture.transactionDb, 12],
    ['deleteServer', fixture.transactionDb, 12],
    ['ROLLBACK'],
    ['release']
  ]);
});

test('管理端删除不存在服务器时保留业务错误且不进入事务', async (t) => {
  const fixture = new DeleteServerFixture();
  fixture.mockRepositories(t, { missing: true });

  await assert.rejects(() => serversService.deleteServer(fixture.db, 12), {
    message: '服务器不存在',
    isLegacyBusinessError: true,
    statusCode: 400,
    code: 1001,
    data: null
  });
  assert.deepEqual(fixture.calls, [['findServerById', fixture.db, 12]]);
});

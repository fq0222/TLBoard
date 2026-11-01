/**
 * 家宽 routing 待清理仓储测试。
 * 使用数据库代理桩验证候选记录查询与事务安全写回，不连接真实 PostgreSQL。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const repository = require('../repositories/user-home-routing-repository');

/**
 * 压缩 SQL 空白，降低断言对换行和缩进的敏感度。
 * @param {string} sql - 原始 SQL。
 * @returns {string} 单空格 SQL。
 */
function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

/**
 * 构造带事务事件记录的数据库代理桩。
 * @param {Object|undefined} route - `FOR UPDATE` 查询返回的最新 routing 记录。
 * @returns {{db:Object,events:Array,updates:Array,deletes:Array}} 数据库桩及可观察副作用。
 */
function createTransactionDb(route) {
  const events = [];
  const updates = [];
  const deletes = [];
  const transactionDb = {
    prepare(sql) {
      const normalized = normalizeSql(sql);
      return {
        async get(...params) {
          events.push({ type: 'SELECT', sql: normalized, params });
          return route ? JSON.parse(JSON.stringify(route)) : undefined;
        },
        async run(...params) {
          if (normalized.startsWith('UPDATE')) {
            events.push({ type: 'UPDATE', sql: normalized, params });
            updates.push(params);
          } else if (normalized.startsWith('DELETE')) {
            events.push({ type: 'DELETE', sql: normalized, params });
            deletes.push(params);
          } else {
            throw new Error(`unexpected write sql: ${normalized}`);
          }
          return { changes: 1 };
        }
      };
    }
  };
  const db = {
    transaction(callback) {
      return async () => {
        events.push({ type: 'BEGIN' });
        try {
          const result = await callback(transactionDb);
          events.push({ type: 'COMMIT' });
          return result;
        } catch (error) {
          events.push({ type: 'ROLLBACK' });
          throw error;
        }
      };
    }
  };

  return { db, events, updates, deletes };
}

test('只查询 pending_cleanup_server_ids 非空的路由并返回清理上下文', async () => {
  const calls = [];
  const expectedRows = [{
    user_id: 7,
    email: 'pending@example.com',
    home_proxy_tag: 'local-ip-lax',
    server_ids: '[1]',
    pending_cleanup_server_ids: '[2]'
  }];
  const db = {
    prepare(sql) {
      calls.push(normalizeSql(sql));
      return {
        async all() {
          return expectedRows;
        }
      };
    }
  };

  const rows = await repository.listPendingCleanupRoutes(db);

  assert.deepEqual(rows, expectedRows);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /FROM user_home_proxy_routes r JOIN users u ON u\.id = r\.user_id/);
  assert.match(calls[0], /r\.pending_cleanup_server_ids <> '\[\]'/);
  assert.match(calls[0], /u\.email/);
});

test('在短事务中锁定最新记录且只移除指定 pending ID', async () => {
  const fixture = createTransactionDb({
    user_id: 1,
    server_ids: '[9]',
    pending_cleanup_server_ids: '[2,3]'
  });

  const result = await repository.removePendingCleanupServerIds(fixture.db, 1, [2]);

  assert.deepEqual(result, { status: 'updated', remainingPendingServerIds: [3] });
  assert.deepEqual(fixture.events.map(event => event.type), ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT']);
  assert.match(fixture.events[1].sql, /FOR UPDATE$/);
  assert.deepEqual(fixture.updates, [['[3]', 1]]);
  assert.deepEqual(fixture.deletes, []);
});

test('当前绑定和待清理列表都为空时删除整条 routing 记录', async () => {
  const fixture = createTransactionDb({
    user_id: 1,
    server_ids: '[]',
    pending_cleanup_server_ids: '[2]'
  });

  const result = await repository.removePendingCleanupServerIds(fixture.db, 1, [2]);

  assert.deepEqual(result, { status: 'deleted', remainingPendingServerIds: [] });
  assert.deepEqual(fixture.events.map(event => event.type), ['BEGIN', 'SELECT', 'DELETE', 'COMMIT']);
  assert.deepEqual(fixture.updates, []);
  assert.deepEqual(fixture.deletes, [[1]]);
});

test('routing 已不存在时返回 missing 且不执行写入', async () => {
  const fixture = createTransactionDb(undefined);

  const result = await repository.removePendingCleanupServerIds(fixture.db, 99, [2]);

  assert.deepEqual(result, { status: 'missing' });
  assert.deepEqual(fixture.events.map(event => event.type), ['BEGIN', 'SELECT', 'COMMIT']);
  assert.deepEqual(fixture.updates, []);
  assert.deepEqual(fixture.deletes, []);
});

for (const scenario of [
  { name: 'server_ids 损坏', serverIds: '{bad', pendingIds: '[2]' },
  { name: 'pending_cleanup_server_ids 不是数组', serverIds: '[]', pendingIds: '{}' },
  { name: 'pending_cleanup_server_ids 包含布尔值', serverIds: '[]', pendingIds: '[true]' }
]) {
  test(`${scenario.name} 时返回 invalid 且不执行写入`, async () => {
    const fixture = createTransactionDb({
      user_id: 1,
      server_ids: scenario.serverIds,
      pending_cleanup_server_ids: scenario.pendingIds
    });

    const result = await repository.removePendingCleanupServerIds(fixture.db, 1, [2]);

    assert.deepEqual(result, { status: 'invalid' });
    assert.deepEqual(fixture.events.map(event => event.type), ['BEGIN', 'SELECT', 'COMMIT']);
    assert.deepEqual(fixture.updates, []);
    assert.deepEqual(fixture.deletes, []);
  });
}

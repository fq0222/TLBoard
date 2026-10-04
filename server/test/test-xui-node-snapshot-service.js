const assert = require('assert');
const xuiNodeSnapshotRepository = require('../repositories/xui-node-snapshot-repository');
const snapshotService = require('../services/shared/xui-node-snapshot-service');

function createFakeDb(options = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: sql.trim().replace(/\s+/g, ' '), params });
      if (options.failOnInsert && sql.includes('INSERT INTO xui_nodes')) {
        throw new Error('insert failed');
      }
      if (options.failOnConfigCleanup && sql.includes('DELETE FROM user_node_configs')) {
        throw new Error('config cleanup failed');
      }
      if (sql.includes('SELECT DISTINCT user_id') && options.affectedUserIds) {
        return {
          rows: options.affectedUserIds.map((userId) => ({ user_id: userId })),
          rowCount: options.affectedUserIds.length
        };
      }
      if (sql.includes('DELETE FROM user_subscription_sources')) {
        return { rows: [], rowCount: options.removedSourceCount || 0 };
      }
      if (sql.includes('DELETE FROM user_node_configs')) {
        return { rows: [], rowCount: options.removedConfigCount || 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      calls.push({ sql: 'RELEASE', params: [] });
    }
  };

  return {
    calls,
    pool: {
      async connect() {
        calls.push({ sql: 'CONNECT', params: [] });
        return client;
      }
    }
  };
}

async function testNormalizeInboundSnapshotSupportsCamelAndSnakeFields() {
  const row = snapshotService.normalizeInboundSnapshot({
    id: 12,
    remark: 'direct-node',
    port: '443',
    protocol: 'vless',
    settings: { clients: [{ email: 'a@test.com' }] },
    streamSettings: { network: 'tcp' },
    clientStats: [{}, {}]
  }, { onlineCount: 1 });

  assert.strictEqual(row.inbound_id, 12);
  assert.strictEqual(row.port, 443);
  assert.strictEqual(row.user_count, 2);
  assert.strictEqual(row.online_count, 1);
  assert.strictEqual(row.settings, JSON.stringify({ clients: [{ email: 'a@test.com' }] }));
  assert.strictEqual(row.stream_settings, JSON.stringify({ network: 'tcp' }));

  const snakeRow = snapshotService.normalizeInboundSnapshot({
    inbound_id: 13,
    stream_settings: '{"network":"ws"}',
    settings: '{}',
    user_count: 5,
    online_count: 3
  });

  assert.strictEqual(snakeRow.inbound_id, 13);
  assert.strictEqual(snakeRow.stream_settings, '{"network":"ws"}');
  assert.strictEqual(snakeRow.user_count, 5);
  assert.strictEqual(snakeRow.online_count, 3);
}

async function testRefreshSkipsEmptyByDefault() {
  const db = createFakeDb();
  const result = await snapshotService.refreshServerNodeSnapshots(db, 1, []);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.nodeCount, 0);
  assert.deepStrictEqual(db.calls, []);
}

async function testRepositoryReplacesInsideTransactionWithServerLock() {
  const db = createFakeDb();

  await xuiNodeSnapshotRepository.replaceServerNodeSnapshots(db, 7, [{
    inbound_id: 100,
    remark: 'cf-node',
    port: 443,
    protocol: 'vless',
    settings: '{}',
    stream_settings: '{}',
    user_count: 2,
    online_count: 1
  }]);

  assert.strictEqual(db.calls[0].sql, 'CONNECT');
  assert.strictEqual(db.calls[1].sql, 'BEGIN');
  assert.ok(db.calls[2].sql.includes('pg_advisory_xact_lock'));
  assert.deepStrictEqual(db.calls[2].params, [31001, 7]);
  assert.ok(db.calls[3].sql.includes('DELETE FROM xui_nodes'));
  assert.ok(db.calls[4].sql.includes('INSERT INTO xui_nodes'));
  assert.strictEqual(db.calls[db.calls.length - 2].sql, 'COMMIT');
  assert.strictEqual(db.calls[db.calls.length - 1].sql, 'RELEASE');
}

/**
 * 验证节点快照刷新会在同一事务中删除已不存在 inbound 的用户配置和订阅缓存。
 */
async function testRepositoryCleansStaleInboundDataAndInvalidatesSubscriptions() {
  const db = createFakeDb({
    affectedUserIds: [51, 52],
    removedConfigCount: 2,
    removedSourceCount: 2
  });

  const result = await xuiNodeSnapshotRepository.replaceServerNodeSnapshots(db, 7, [
    {
      inbound_id: 100,
      remark: 'node-100',
      port: 443,
      protocol: 'vless',
      settings: '{}',
      stream_settings: '{}',
      user_count: 2,
      online_count: 1
    },
    {
      inbound_id: 101,
      remark: 'node-101',
      port: 8443,
      protocol: 'vless',
      settings: '{}',
      stream_settings: '{}',
      user_count: 2,
      online_count: 1
    }
  ]);

  const affectedQuery = db.calls.find((call) => call.sql.includes('SELECT DISTINCT user_id'));
  const sourceDelete = db.calls.find((call) => call.sql.includes('DELETE FROM user_subscription_sources'));
  const configDelete = db.calls.find((call) => call.sql.includes('DELETE FROM user_node_configs'));
  const subscriptionDelete = db.calls.find((call) => call.sql.includes('DELETE FROM user_subscriptions'));

  assert.deepStrictEqual(affectedQuery.params, [7, [100, 101]]);
  assert.deepStrictEqual(sourceDelete.params, [7, [100, 101]]);
  assert.deepStrictEqual(configDelete.params, [7, [100, 101]]);
  assert.deepStrictEqual(subscriptionDelete.params, [[51, 52]]);
  assert.deepStrictEqual(result, {
    removedNodeConfigCount: 2,
    removedSourceCount: 2,
    invalidatedUserCount: 2
  });
}

async function testRepositoryRollsBackOnInsertFailure() {
  const db = createFakeDb({ failOnInsert: true });

  await assert.rejects(
    () => xuiNodeSnapshotRepository.replaceServerNodeSnapshots(db, 7, [{
      inbound_id: 100,
      remark: 'cf-node',
      port: 443,
      protocol: 'vless',
      settings: '{}',
      stream_settings: '{}',
      user_count: 2,
      online_count: 1
    }]),
    /insert failed/
  );

  assert.ok(db.calls.some(call => call.sql === 'ROLLBACK'));
  assert.strictEqual(db.calls[db.calls.length - 1].sql, 'RELEASE');
}

async function testRepositoryRollsBackOnCleanupFailure() {
  const db = createFakeDb({ failOnConfigCleanup: true });

  await assert.rejects(
    () => xuiNodeSnapshotRepository.replaceServerNodeSnapshots(db, 7, [{
      inbound_id: 100,
      remark: 'cf-node',
      port: 443,
      protocol: 'vless',
      settings: '{}',
      stream_settings: '{}',
      user_count: 2,
      online_count: 1
    }]),
    /config cleanup failed/
  );

  assert.ok(db.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!db.calls.some((call) => call.sql === 'COMMIT'));
  assert.strictEqual(db.calls[db.calls.length - 1].sql, 'RELEASE');
}

async function testRefreshAllowsExplicitEmptyReplace() {
  const db = createFakeDb({ affectedUserIds: [51] });
  const result = await snapshotService.refreshServerNodeSnapshots(db, 1, [], { allowEmpty: true });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(result.nodeCount, 0);
  assert.ok(db.calls.some(call => call.sql.includes('DELETE FROM xui_nodes')));
  assert.ok(!db.calls.some(call => call.sql.includes('INSERT INTO xui_nodes')));
  assert.ok(db.calls.some(call => call.sql.includes('DELETE FROM user_node_configs')));
  assert.ok(db.calls.some(call => call.sql.includes('DELETE FROM user_subscription_sources')));
  assert.ok(db.calls.some(call => call.sql.includes('DELETE FROM user_subscriptions')));
}

async function run() {
  await testNormalizeInboundSnapshotSupportsCamelAndSnakeFields();
  await testRefreshSkipsEmptyByDefault();
  await testRepositoryReplacesInsideTransactionWithServerLock();
  await testRepositoryCleansStaleInboundDataAndInvalidatesSubscriptions();
  await testRepositoryRollsBackOnInsertFailure();
  await testRepositoryRollsBackOnCleanupFailure();
  await testRefreshAllowsExplicitEmptyReplace();
  console.log('xui node snapshot service tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

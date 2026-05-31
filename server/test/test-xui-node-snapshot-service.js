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
  assert.strictEqual(db.calls[5].sql, 'COMMIT');
  assert.strictEqual(db.calls[6].sql, 'RELEASE');
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

async function testRefreshAllowsExplicitEmptyReplace() {
  const db = createFakeDb();
  const result = await snapshotService.refreshServerNodeSnapshots(db, 1, [], { allowEmpty: true });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(result.nodeCount, 0);
  assert.ok(db.calls.some(call => call.sql.includes('DELETE FROM xui_nodes')));
  assert.ok(!db.calls.some(call => call.sql.includes('INSERT INTO xui_nodes')));
}

async function run() {
  await testNormalizeInboundSnapshotSupportsCamelAndSnakeFields();
  await testRefreshSkipsEmptyByDefault();
  await testRepositoryReplacesInsideTransactionWithServerLock();
  await testRepositoryRollsBackOnInsertFailure();
  await testRefreshAllowsExplicitEmptyReplace();
  console.log('xui node snapshot service tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

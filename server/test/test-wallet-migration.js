/**
 * 钱包与提现数据库迁移测试。
 * 职责：通过可记录 SQL 的假连接池验证迁移事务、幂等 DDL、默认配置、期初流水与失败回滚。
 */

const assert = require('assert');
const { up } = require('../db/migrations/019-wallet-withdrawals');
const { initTables } = require('../db/schema/tables');
const { createIndexes } = require('../db/schema/indexes');

/** 离线 DDL 替身：执行建表/约束升级并按外键动作模拟删除，不连接 PostgreSQL。 */
class WalletSchemaDatabase {
  /** upgraded 为已部署旧 019；每张审计表分别测试，避免另一张表的限制掩盖级联错误。 */
  constructor(upgraded = false) {
    this.constraints = {};
    this.tables = ['balance_transactions', 'withdrawal_requests', 'user_payment_qr_codes'];
    if (upgraded) for (const table of this.tables) this.constraints[table] = 'CASCADE';
    this.rows = Object.fromEntries(this.tables.map(table => [table, []]));
    this.users = [];
    this.indexes = new Set();
    this.pool = { connect: async () => ({ query: sql => this.query(sql), release() {} }) };
  }

  /** 执行目标表的 CREATE/ALTER 语义；其它初始化 SQL 由原有记录测试覆盖。 */
  async query(statement) {
    const sql = statement.replace(/\s+/g, ' ').trim();
    const index = sql.match(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/);
    if (index) this.indexes.add(index[1]);
    if (sql.startsWith('INSERT INTO balance_transactions')) {
      // 执行迁移 SELECT 的正余额过滤、相关 NOT EXISTS 与业务唯一键冲突语义。
      assert.match(sql, /COALESCE\((?:\w+\.)?balance, 0\) > 0/);
      const exclusion = sql.match(/NOT EXISTS \(\s*SELECT 1 FROM balance_transactions (\w+) WHERE \1.user_id = (?:users|u).id\s*\)/);
      if (sql.includes('NOT EXISTS')) assert.ok(exclusion, '期初过滤只接受按本人全流水关联的反存在查询');
      for (const user of this.users) {
        if (!(Number(user.balance) > 0)) continue;
        if (exclusion && this.rows.balance_transactions.some(row => row.user_id === user.id)) continue;
        if (this.rows.balance_transactions.some(row => row.type === 'opening_balance' && row.reference_id === user.id)) continue;
        this.rows.balance_transactions.push({ user_id: user.id, type: 'opening_balance', amount: user.balance, balance_after: user.balance, reference_type: 'opening_balance', reference_id: user.id });
      }
    }
    for (const table of this.tables) {
      if (sql.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`) && !this.constraints[table]) {
        const action = sql.match(/user_id INTEGER NOT NULL(?: UNIQUE)? REFERENCES users\(id\) ON DELETE (CASCADE|RESTRICT|NO ACTION)/);
        assert.ok(action, `${table} 必须明确用户外键删除策略`);
        this.constraints[table] = action[1];
      }
      if (sql.startsWith(`ALTER TABLE ${table} `)) {
        assert.match(sql, new RegExp(`DROP CONSTRAINT IF EXISTS ${table}_user_id_fkey`));
        const action = sql.match(/ADD CONSTRAINT \w+ FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE (RESTRICT|NO ACTION)/);
        assert.ok(action, '升级必须重建具名用户外键');
        this.constraints[table] = action[1];
      }
    }
    return { rows: [], rowCount: 0 };
  }

  /** 将数据库外键执行为可观察行为：审计记录禁止父行删除，当前二维码允许级联清理。 */
  deleteUser(userId) {
    for (const table of this.tables) {
      if (this.rows[table].some(row => row.user_id === userId) && this.constraints[table] !== 'CASCADE') {
        throw Object.assign(new Error('外键阻止删除'), { code: '23503' });
      }
    }
    for (const table of this.tables) this.rows[table] = this.rows[table].filter(row => row.user_id !== userId);
  }
}

/** 首次仅回填历史正余额；零余额用户入账后重跑不得伪造期初，旧版重跑仍需补新索引。 */
async function testOpeningBalanceStatefulRerun() {
  const database = new WalletSchemaDatabase();
  database.users = [{ id: 7, balance: 1234 }, { id: 8, balance: 0 }, { id: 9, balance: null }];
  await up(database.pool);
  assert.deepStrictEqual(database.rows.balance_transactions, [
    { user_id: 7, type: 'opening_balance', amount: 1234, balance_after: 1234, reference_type: 'opening_balance', reference_id: 7 }
  ]);
  database.users[1].balance = 500;
  database.rows.balance_transactions.push({ user_id: 8, type: 'referral_reward', amount: 500, balance_after: 500, reference_type: 'referral_reward', reference_id: 21 });
  const ledgerBeforeRerun = structuredClone(database.rows.balance_transactions);
  database.indexes.delete('idx_balance_transactions_user_created_id');
  await up(database.pool);
  assert.deepStrictEqual(database.rows.balance_transactions, ledgerBeforeRerun, '已有奖励流水的用户不得再次生成期初余额');
  assert.ok(database.indexes.has('idx_balance_transactions_user_created_id'));

  const upgraded = new WalletSchemaDatabase(true);
  upgraded.users = [{ id: 8, balance: 500 }];
  upgraded.rows.balance_transactions = [structuredClone(ledgerBeforeRerun[1])];
  await up(upgraded.pool);
  assert.deepStrictEqual(upgraded.rows.balance_transactions, [ledgerBeforeRerun[1]], '旧 019 升级不得伪造 opening');
  assert.ok(upgraded.indexes.has('idx_withdrawal_requests_status_created_at'));
}

/** 新安装、首次迁移和旧版升级都必须保留两张财务审计表；当前收款码仍可级联删除。 */
async function testAuditRecordsPreventUserDeletion() {
  for (const mode of ['fresh-schema', 'fresh-migration', 'upgrade']) {
    const database = new WalletSchemaDatabase(mode === 'upgrade');
    if (mode === 'fresh-schema') await initTables(database, { info() {}, error() {} });
    else await up(database.pool);
    for (const table of ['balance_transactions', 'withdrawal_requests']) {
      database.rows[table] = [{ user_id: 7 }];
      assert.throws(() => database.deleteUser(7), error => error.code === '23503', `${mode}: ${table} 不得随用户删除`);
      assert.equal(database.rows[table].length, 1);
      database.rows[table] = [];
    }
    database.rows.user_payment_qr_codes = [{ user_id: 7 }];
    database.deleteUser(7);
    assert.equal(database.rows.user_payment_qr_codes.length, 0);
  }
}

/**
 * 创建会记录查询事件的连接池替身。
 * @param {object} [options] - 可选故障注入配置
 * @param {string} [options.failOn] - SQL 包含该文本时抛出模拟错误
 * @returns {{pool: object, events: string[], queries: string[]}} 连接池、事务事件和 SQL 记录
 */
function createRecordingPool({ failOn } = {}) {
  const events = [];
  const queries = [];
  const client = {
    async query(statement) {
      const sql = String(statement).trim();
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        events.push(sql);
      } else {
        queries.push(sql);
      }

      if (failOn && sql.includes(failOn)) {
        throw new Error('模拟迁移失败');
      }

      return { rows: [], rowCount: 0 };
    },
    release() {
      events.push('RELEASE');
    }
  };

  return {
    events,
    queries,
    pool: {
      async connect() {
        return client;
      }
    }
  };
}

/**
 * 合并 SQL 并验证三张表的字段、约束和业务索引。
 * @param {string[]} queries - 待验证的 SQL 语句列表
 */
function assertWalletSql(queries) {
  const sql = queries.join('\n');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS balance_transactions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_payment_qr_codes/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS withdrawal_requests/);
  assert.match(sql, /CHECK \(amount <> 0\)/);
  assert.match(sql, /CHECK \(balance_after >= 0\)/);
  assert.match(sql, /CHECK \(amount > 0\)/);
  assert.match(sql, /type IN \('opening_balance', 'referral_reward', 'plan_payment', 'withdrawal', 'withdrawal_refund'\)/);
  assert.match(sql, /status IN \('pending', 'completed', 'rejected'\)/);
  assert.match(sql, /payment_type IN \('wechat', 'alipay'\)/);
  assert.match(sql, /status <> 'rejected' OR NULLIF\(BTRIM\(reject_reason\), ''\) IS NOT NULL/);
  assert.match(sql, /UNIQUE \(reference_type, reference_id, type\)/);
  assert.doesNotMatch(sql, /CREATE INDEX IF NOT EXISTS idx_balance_transactions_user_created_at\b/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_balance_transactions_user_created_id[\s\S]*ON balance_transactions\(user_id, created_at DESC, id DESC\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status_created_at[\s\S]*ON withdrawal_requests\(status, created_at DESC\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawal_requests_one_pending_per_user[\s\S]*WHERE status = 'pending'/);
}

/**
 * 验证正常迁移会在单个事务内完成全部结构及数据初始化。
 */
async function testSuccessfulMigration() {
  const { pool, events, queries } = createRecordingPool();

  await up(pool);

  assert.deepStrictEqual(events.slice(0, 1), ['BEGIN']);
  assert.equal(events.at(-2), 'COMMIT');
  assert.equal(events.at(-1), 'RELEASE');
  assertWalletSql(queries);

  const sql = queries.join('\n');
  assert.match(sql, /minimum_withdrawal_amount/);
  assert.match(sql, /VALUES \('minimum_withdrawal_amount', '2000'/);
  assert.match(sql, /'opening_balance', id, '期初余额'/);
  assert.match(sql, /WHERE COALESCE\(balance, 0\) > 0/);
  assert.match(sql, /ON CONFLICT \(reference_type, reference_id, type\) DO NOTHING/);
}

/**
 * 验证重复执行仍使用幂等语句完成提交。
 */
async function testIdempotentMigration() {
  const { pool, events, queries } = createRecordingPool();

  await up(pool);
  await up(pool);

  assert.equal(events.filter((event) => event === 'COMMIT').length, 2);
  assert.equal(queries.filter((sql) => sql.includes('CREATE TABLE IF NOT EXISTS')).length, 6);
  assert.equal(queries.filter((sql) => sql.includes('ON CONFLICT (key) DO NOTHING')).length, 2);
  assert.equal(queries.filter((sql) => sql.includes('ON CONFLICT (reference_type, reference_id, type) DO NOTHING')).length, 2);
}

/**
 * 验证任一中途 SQL 失败时回滚且始终释放连接。
 */
async function testRollbackOnFailure() {
  const { pool, events } = createRecordingPool({ failOn: 'withdrawal_requests' });

  await assert.rejects(() => up(pool), /模拟迁移失败/);

  assert.deepStrictEqual(events, ['BEGIN', 'ROLLBACK', 'RELEASE']);
}

/**
 * 验证全新数据库初始化定义包含同样的表、约束和部分唯一索引。
 */
async function testFreshDatabaseSchema() {
  const tableQueries = [];
  const indexQueries = [];
  const logger = { info() {}, error() {} };

  await initTables({ query: async (sql) => tableQueries.push(String(sql).trim()) }, logger);
  await createIndexes({ query: async (sql) => indexQueries.push(String(sql).trim()) }, logger);

  assertWalletSql([...tableQueries, ...indexQueries]);
}

async function run() {
  await testOpeningBalanceStatefulRerun();
  console.log('✓ 期初余额状态化首次/奖励后重跑/旧版补索引测试通过');
  await testAuditRecordsPreventUserDeletion();
  console.log('✓ 财务外键新库、首次迁移、旧版升级保护通过');
  await testSuccessfulMigration();
  console.log('✓ 迁移成功测试通过');
  await testIdempotentMigration();
  console.log('✓ 迁移幂等测试通过');
  await testRollbackOnFailure();
  console.log('✓ 迁移回滚测试通过');
  await testFreshDatabaseSchema();
  console.log('✓ 全新数据库表结构测试通过');
}

run().catch((error) => {
  console.error('钱包与提现迁移测试失败:', error);
  process.exit(1);
});

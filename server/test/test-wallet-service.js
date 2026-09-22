/** 用户钱包服务测试：保留真实仓储、余额服务、二维码加密和事务代理，仅替换外部数据库。 */
const assert = require('node:assert/strict');
const QRCode = require('qrcode');
const { createDbProxy } = require('../db/proxy');
const { convertPlaceholders } = require('../db/sql-utils');
const PaymentQrService = require('../services/shared/payment-qr-service');
const { UserWalletService } = require('../services/user/wallet-service');

/** 可控连接池：模拟同一用户行锁、事务私有写集与提交/回滚，以验证业务交错而不访问业务库。 */
class WalletDatabase {
  /** options 为余额、二维码、最低额及 SQL 故障；默认用户 7，另一个用户的查询必须为空。 */
  constructor({ balance = 5000, qr = true, minimum, pending = false, failOn, conflict } = {}) {
    this.state = {
      user: { id: 7, balance }, minimum,
      qr: qr ? { user_id: 7, payment_type: 'wechat', qr_payload_encrypted: 'v1.saved-encrypted', qr_payload_digest: 'saved-digest' } : undefined,
      withdrawals: pending ? [{ id: 1, user_id: 7, amount: 2000, status: 'pending', created_at: 123 }] : [],
      transactions: []
    };
    this.calls = [];
    this.lockTail = Promise.resolve();
    this.nextClientId = 0;
    this.failOn = failOn;
    this.conflict = conflict;
    this.db = createDbProxy({
      pool: { connect: async () => this.connect() },
      queryWithRetry: (sql, params) => this.query(null, sql, params),
      convertPlaceholders,
      logger: { info() {}, error() {} }
    });
  }

  /** 每次 connect 返回独立客户端；释放不会提交尚未提交的写集。 */
  connect() {
    const client = { id: ++this.nextClientId, local: null, unlock: null };
    client.query = (sql, params) => this.query(client, sql, params);
    client.release = () => this.calls.push({ client: client.id, sql: 'RELEASE', params: [] });
    return client;
  }

  /** 同一客户端可重入同一行锁；其他连接等到提交/回滚后才能读取最新余额和 pending。 */
  async lock(client) {
    assert.ok(client, '用户锁必须使用专用事务连接');
    if (client.unlock) return;
    const previous = this.lockTail;
    this.lockTail = new Promise(resolve => { client.unlock = resolve; });
    await previous;
    client.local = structuredClone(this.state);
  }

  /** 根据真实仓储 SQL 执行最小数据库语义，未知 SQL 立即失败以捕获实现偏差。 */
  async query(client, statement, params = []) {
    const sql = statement.replace(/\s+/g, ' ').trim();
    this.calls.push({ client: client ? client.id : 0, sql, params });
    if (sql === 'BEGIN') return { rows: [] };
    if (sql === 'COMMIT' || sql === 'ROLLBACK') {
      if (sql === 'COMMIT' && client.local) this.state = client.local;
      if (client.unlock) client.unlock();
      client.unlock = null;
      client.local = null;
      return { rows: [] };
    }
    if (sql.includes('FOR NO KEY UPDATE')) await this.lock(client);
    const state = client && client.local ? client.local : this.state;
    if (this.failOn && sql.startsWith(this.failOn)) throw new Error('模拟持久化失败');
    let rows;
    if (sql.includes('FROM users')) {
      rows = params[0] === 7 ? [structuredClone(state.user)] : [];
    } else if (sql.includes('FROM system_settings')) {
      assert.deepEqual(params, ['minimum_withdrawal_amount']);
      rows = state.minimum === undefined ? [] : [{ value: state.minimum }];
    } else if (sql.includes('FROM user_payment_qr_codes')) {
      rows = params[0] === 7 && state.qr ? [structuredClone(state.qr)] : [];
    } else if (sql.startsWith('INSERT INTO user_payment_qr_codes')) {
      assert.ok(client && client.local, '收款码保存必须锁定用户并在事务中写入');
      assert.deepEqual(params.slice(0, 2), [7, 'wechat']);
      state.qr = { user_id: params[0], payment_type: params[1], qr_payload_encrypted: params[2], qr_payload_digest: params[3] };
      rows = [structuredClone(state.qr)];
    } else if (sql.includes('FROM withdrawal_requests')) {
      assert.match(sql, /user_id = \$1/);
      assert.match(sql, /status = 'pending'/);
      rows = state.withdrawals.filter(item => item.user_id === params[0] && item.status === 'pending');
    } else if (sql.startsWith('INSERT INTO withdrawal_requests')) {
      assert.ok(client && client.local, '申请必须在持有用户锁的事务中插入');
      if (this.conflict) throw Object.assign(new Error('duplicate key'), this.conflict);
      const [userId, amount, paymentType, encrypted, digest] = params;
      const row = { id: 2, user_id: userId, amount, status: 'pending', payment_type: paymentType, qr_payload_encrypted: encrypted, qr_payload_digest: digest, created_at: 456 };
      state.withdrawals.push(row);
      rows = [structuredClone(row)];
    } else if (sql.startsWith('UPDATE users')) {
      assert.ok(client && client.local, '扣款必须使用同一事务连接');
      assert.deepEqual(params, [2000, 7, 2000]);
      if (state.user.balance >= params[0]) {
        state.user.balance -= params[0];
        rows = [{ balance: state.user.balance }];
      } else rows = [];
    } else if (sql.startsWith('INSERT INTO balance_transactions')) {
      assert.ok(client && client.local, '流水必须使用同一事务连接');
      const [userId, type, amount, balanceAfter, referenceType, referenceId, description] = params;
      const row = { id: 3, user_id: userId, type, amount, balance_after: balanceAfter, reference_type: referenceType, reference_id: referenceId, description, created_at: 456 };
      state.transactions.push(row);
      rows = [structuredClone(row)];
    } else if (sql.includes('FROM balance_transactions')) {
      assert.match(sql, /user_id = \$1/);
      const matches = state.transactions.filter(item => item.user_id === params[0]);
      rows = sql.includes('COUNT(*)') ? [{ total: String(matches.length) }] : matches;
    } else throw new Error(`测试未实现 SQL: ${sql}`);
    return { rows, rowCount: rows.length };
  }
}

/** 测试专用随机性无关密钥，不使用本地配置或环境中的真实密钥。 */
function createService() {
  return new UserWalletService({ paymentQrService: new PaymentQrService({ encryptionKey: Buffer.alloc(32, 7).toString('base64') }) });
}

/** 捕获摘要或 pending 直接返回整行导致的密文、摘要、明文泄漏。 */
async function testSummaryAndOverviewArePrivate() {
  const database = new WalletDatabase({ balance: '5000', pending: true });
  const service = createService();
  assert.deepEqual(await service.getSummary(database.db, 7), { balance: 5000, balance_text: '50.00元', payment_type: 'wechat', has_payment_qr: true });
  const overview = await service.getWithdrawalOverview(database.db, 7);
  assert.equal(overview.minimum_withdrawal_amount, 2000);
  assert.deepEqual(overview.pending_withdrawal, { id: 1, amount: 2000, status: 'pending', created_at: 123 });
  assert.doesNotMatch(JSON.stringify(overview), /encrypted|digest|payload/);
  await assert.rejects(() => service.getSummary(database.db, 8), /用户不存在/);
}

/** 验证实际 PNG 解码后只保存密文与摘要，更新收款码不会覆盖历史申请快照。 */
async function testSaveQrEncryptsAndPreservesSnapshot() {
  const database = new WalletDatabase();
  const service = createService();
  await service.createWithdrawal(database.db, 7, { amount: 2000 });
  const snapshot = database.state.withdrawals[0].qr_payload_encrypted;
  const fileBuffer = await QRCode.toBuffer('wxp://wallet-private-fixture', { width: 300 });
  const result = await service.savePaymentQr(database.db, 7, { paymentType: 'wechat', fileBuffer });
  assert.deepEqual(result, { payment_type: 'wechat', has_payment_qr: true });
  assert.notEqual(database.state.qr.qr_payload_encrypted, snapshot);
  assert.equal(service.paymentQrService.decryptPayload(database.state.qr.qr_payload_encrypted), 'wxp://wallet-private-fixture');
  assert.equal(database.state.withdrawals[0].qr_payload_encrypted, snapshot);
  assert.doesNotMatch(JSON.stringify(result), /private-fixture|encrypted|digest|payload/);
  assert.doesNotMatch(JSON.stringify(database.calls), /wallet-private-fixture/);
  await assert.rejects(() => service.savePaymentQr(database.db, 7, { paymentType: 'other', fileBuffer }), /收款方式/);
  await assert.rejects(() => service.savePaymentQr(database.db, 7, { paymentType: 'wechat', fileBuffer: Buffer.from('invalid') }), /图片/);
}

/** 捕获最低额缺失/空值默认错误、边界拒绝错误及非整数金额穿透。 */
async function testMinimumAndValidation() {
  const service = createService();
  for (const minimum of [undefined, null, '', 'invalid', '2000']) {
    const database = new WalletDatabase({ minimum });
    await assert.rejects(() => service.createWithdrawal(database.db, 7, { amount: 1999 }), /最低提现金额为20.00元/);
    await service.createWithdrawal(database.db, 7, { amount: 2000 });
  }
  const configured = new WalletDatabase({ minimum: '3000' });
  await assert.rejects(() => service.createWithdrawal(configured.db, 7, { amount: 2000 }), /最低提现金额为30.00元/);
  for (const amount of [0, -1, 20.5, '2000', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(() => service.createWithdrawal(new WalletDatabase().db, 7, { amount }), /金额/);
  }
}

/** 捕获无收款码、余额不足、已有 pending 时仍写入或扣款的错误。 */
async function testRejectionsDoNotMutate() {
  const service = createService();
  for (const [options, message] of [[{ balance: 1999 }, /余额不足/], [{ qr: false }, /收款码/], [{ pending: true }, /已有处理中提现申请/]]) {
    const database = new WalletDatabase(options);
    const before = structuredClone(database.state);
    await assert.rejects(() => service.createWithdrawal(database.db, 7, { amount: 2000 }), message);
    assert.deepEqual(database.state, before);
    assert.equal(database.calls.filter(call => call.sql.startsWith('UPDATE users')).length, 0);
  }
}

/** 验证申请、二维码快照、一次扣款、一次负数流水均落在同一个专用事务并一起提交。 */
async function testCreateIsAtomic() {
  const database = new WalletDatabase({ balance: 2000 });
  const result = await createService().createWithdrawal(database.db, 7, { amount: 2000 });
  assert.deepEqual(result, { id: 2, amount: 2000, status: 'pending', created_at: 456 });
  assert.equal(database.state.user.balance, 0);
  assert.equal(database.state.withdrawals[0].qr_payload_encrypted, database.state.qr.qr_payload_encrypted);
  assert.equal(database.state.withdrawals[0].qr_payload_digest, database.state.qr.qr_payload_digest);
  assert.deepEqual(database.state.transactions, [{ id: 3, user_id: 7, type: 'withdrawal', amount: -2000, balance_after: 0, reference_type: 'withdrawal_request', reference_id: 2, description: '提现申请', created_at: 456 }]);
  const operations = database.calls.filter(call => /^(INSERT|UPDATE)/.test(call.sql));
  assert.equal(operations.length, 3);
  assert.ok(operations.every(call => call.client === 1));
  assert.equal(database.calls.filter(call => call.sql === 'COMMIT').length, 1);
  assert.equal(database.calls.filter(call => call.sql.includes('FOR NO KEY UPDATE')).length, 2);
}

/** 验证流水写入失败时已插入申请和已扣余额都会回滚。 */
async function testFailureRollsEverythingBack() {
  const database = new WalletDatabase({ failOn: 'INSERT INTO balance_transactions' });
  const before = structuredClone(database.state);
  await assert.rejects(() => createService().createWithdrawal(database.db, 7, { amount: 2000 }), /模拟持久化失败/);
  assert.deepEqual(database.state, before);
  assert.ok(database.calls.some(call => call.sql === 'ROLLBACK'));
  assert.equal(database.calls.at(-1).sql, 'RELEASE');
}

/** 两个同时申请共用余额，第二个必须等待行锁并读取首个已提交 pending，只能扣款一次。 */
async function testConcurrentRequestsOnlyDebitOnce() {
  const database = new WalletDatabase();
  const service = createService();
  const results = await Promise.allSettled([service.createWithdrawal(database.db, 7, { amount: 2000 }), service.createWithdrawal(database.db, 7, { amount: 2000 })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.match(results.find(item => item.status === 'rejected').reason.message, /已有处理中提现申请/);
  assert.equal(database.state.user.balance, 3000);
  assert.equal(database.state.withdrawals.length, 1);
  assert.equal(database.state.transactions.length, 1);
  assert.equal(database.calls.filter(call => call.sql.startsWith('UPDATE users')).length, 1);
  assert.equal(database.nextClientId, 2);
}

/** 仅 pending 部分唯一索引的 23505 转为重复申请，其他数据库异常不得冒充业务冲突。 */
async function testUniqueConflictMapping() {
  const service = createService();
  const database = new WalletDatabase({ conflict: { code: '23505', constraint: 'idx_withdrawal_requests_one_pending_per_user' } });
  await assert.rejects(() => service.createWithdrawal(database.db, 7, { amount: 2000 }), /已有处理中提现申请/);
  assert.equal(database.state.user.balance, 5000);
  assert.equal(database.state.withdrawals.length, 0);
  const other = new WalletDatabase({ conflict: { code: '23505', constraint: 'other_index' } });
  await assert.rejects(() => service.createWithdrawal(other.db, 7, { amount: 2000 }), error => error.code === '23505');
}

/** 查询强制使用登录用户 ID，分页最大 100，关键字仍交给已有安全查询处理。 */
async function testTransactionsAreScopedAndPaginated() {
  const database = new WalletDatabase();
  const service = createService();
  await service.createWithdrawal(database.db, 7, { amount: 2000 });
  const result = await service.listUserTransactions(database.db, 7, { userId: 8, page: 2, limit: 999, keyword: '50%_' });
  assert.equal(result.total, 1);
  assert.equal(result.page, 2);
  assert.equal(result.limit, 100);
  const call = database.calls.at(-1);
  assert.equal(call.params[0], 7);
  assert.deepEqual(call.params.slice(-2), [100, 100]);
  assert.equal((await service.listUserTransactions(database.db, 8, {})).total, 0);
}

/** 按行为顺序运行测试；失败输出名称和堆栈，成功输出可追溯统计。 */
async function run() {
  const tests = [testSummaryAndOverviewArePrivate, testSaveQrEncryptsAndPreservesSnapshot, testMinimumAndValidation, testRejectionsDoNotMutate, testCreateIsAtomic, testFailureRollsEverythingBack, testConcurrentRequestsOnlyDebitOnce, testUniqueConflictMapping, testTransactionsAreScopedAndPaginated];
  for (const test of tests) { await test(); console.log(`✓ ${test.name}`); }
  console.log(`钱包服务测试通过：${tests.length}/${tests.length}`);
}
run().catch(error => { console.error('钱包服务测试失败:', error); process.exitCode = 1; });

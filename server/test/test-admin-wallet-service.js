/** 管理端钱包服务测试：执行真实仓储、余额服务和事务代理，只替换外部 PostgreSQL 与二维码密钥。 */
const assert = require('node:assert/strict');
const { createDbProxy } = require('../db/proxy');
const { convertPlaceholders } = require('../db/sql-utils');
const PaymentQrService = require('../services/shared/payment-qr-service');
const { AdminWalletService } = require('../services/admin/wallet-service');

/** 单申请数据库夹具：模拟申请行互斥锁、事务私有写集及自动提交，用于确定性并发验证。 */
class AdminWalletDatabase {
  /** failOn 指定需抛错的 SQL 前缀；钱包余额和历史累计奖励有意使用不同数值。 */
  constructor({ failOn } = {}) {
    this.state = {
      users: [{ id: 7, email: 'wallet@example.invalid', balance: 3000 }, { id: 8, email: 'empty@example.invalid', balance: 0 }],
      rewards: [{ referrer_user_id: 7, reward_amount: 6000 }, { referrer_user_id: 7, reward_amount: 1500 }],
      withdrawals: [{ id: 12, user_id: 7, amount: 2000, payment_type: 'wechat', status: 'pending', qr_payload_encrypted: 'private-cipher', qr_payload_digest: 'private-digest', reject_reason: null, processed_by: null, processed_at: null, created_at: 123 }],
      transactions: []
    };
    this.calls = [];
    this.lockTail = Promise.resolve();
    this.nextClientId = 0;
    this.failOn = failOn;
    this.db = createDbProxy({ pool: { connect: async () => this.connect() }, queryWithRetry: (sql, params) => this.query(null, sql, params), convertPlaceholders, logger: { info() {}, error() {} } });
  }

  /** 显式事务和自动提交各占独立连接；只有 COMMIT 可发布本连接写集。 */
  connect() {
    const client = { id: ++this.nextClientId, local: null, unlock: null };
    client.query = (sql, params) => this.query(client, sql, params);
    client.release = () => this.calls.push({ client: client.id, sql: 'RELEASE', params: [] });
    return client;
  }

  /** 等待申请锁后读取最新提交版本；同一事务后续用户锁不得改变快照。 */
  async lock(client) {
    if (client.unlock) return;
    const previous = this.lockTail;
    this.lockTail = new Promise(resolve => { client.unlock = resolve; });
    await previous;
    client.local = structuredClone(this.state);
  }

  /** 按真实 SQL 边界模拟最低所需语义；未知 SQL 和丢失状态条件立即失败。 */
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
    // 单条条件 UPDATE 也取得申请锁，不能绕过正在进行的驳回事务。
    if (!client && sql.startsWith('UPDATE withdrawal_requests')) {
      const automatic = this.connect();
      try {
        const result = await this.query(automatic, sql, params);
        await this.query(automatic, 'COMMIT');
        return result;
      } catch (error) {
        await this.query(automatic, 'ROLLBACK');
        throw error;
      } finally { automatic.release(); }
    }
    if (sql.includes('FOR UPDATE') || sql.startsWith('UPDATE withdrawal_requests')) await this.lock(client);
    if (sql.includes('FOR NO KEY UPDATE')) assert.ok(client && client.local, '必须先锁申请，再锁用户');
    const state = client && client.local ? client.local : this.state;
    if (this.failOn && sql.startsWith(this.failOn)) throw new Error('模拟持久化失败');
    let rows;
    if (sql.includes('FROM users u')) {
      let users = [...state.users].sort((left, right) => right.id - left.id);
      if (sql.includes('u.email ILIKE')) {
        const keyword = params[0].slice(1, -1).replace(/\\([\\%_])/g, '$1');
        users = users.filter(user => user.email.toLowerCase().includes(keyword.toLowerCase()));
      }
      if (sql.includes('u.id = $1')) users = users.filter(user => user.id === params[0]);
      if (sql.startsWith('SELECT COUNT(*)')) rows = [{ total: String(users.length) }];
      else {
        assert.match(sql, /SUM\(reward_amount\)/);
        assert.match(sql, /referrer_user_id = u.id/);
        assert.match(sql, /AS reward_total/);
        rows = users.map(user => ({ ...user, reward_total: String(state.rewards.filter(reward => reward.referrer_user_id === user.id).reduce((sum, reward) => sum + reward.reward_amount, 0)) }));
        if (sql.includes('LIMIT')) rows = rows.slice(params.at(-1), params.at(-1) + params.at(-2));
      }
    } else if (sql.includes('FROM users')) {
      rows = state.users.filter(user => user.id === params[0]);
    } else if (sql.startsWith('SELECT') && sql.includes('FROM withdrawal_requests')) {
      const key = sql.includes('user_id = $1') ? 'user_id' : 'id';
      rows = state.withdrawals.filter(row => row[key] === params[0]);
      if (sql.includes("status = 'pending'")) rows = rows.filter(row => row.status === 'pending');
    } else if (sql.startsWith('UPDATE withdrawal_requests')) {
      assert.match(sql, /WHERE id = \$\d+ AND status = 'pending'/);
      assert.match(sql, /RETURNING/);
      const row = state.withdrawals.find(item => item.id === params.at(-1) && item.status === 'pending');
      if (row) Object.assign(row, { status: sql.includes("status = 'rejected'") ? 'rejected' : 'completed', processed_by: params[0], processed_at: 456, reject_reason: params.length === 3 ? params[1] : null });
      rows = row ? [row] : [];
    } else if (sql.startsWith('UPDATE users')) {
      assert.ok(client && client.local, '退款必须使用同一事务连接');
      assert.match(sql, /COALESCE\(balance, 0\) \+/);
      const user = state.users.find(item => item.id === params[1]);
      user.balance += params[0];
      rows = [{ balance: user.balance }];
    } else if (sql.startsWith('INSERT INTO balance_transactions')) {
      assert.ok(client && client.local, '退款流水必须使用同一事务连接');
      const [userId, type, amount, balanceAfter, referenceType, referenceId, description] = params;
      const row = { id: 1, user_id: userId, type, amount, balance_after: balanceAfter, reference_type: referenceType, reference_id: referenceId, description };
      state.transactions.push(row);
      rows = [row];
    } else if (sql.includes('FROM balance_transactions')) {
      assert.match(sql, /user_id = \$1/);
      const items = state.transactions.filter(row => row.user_id === params[0]);
      rows = sql.includes('COUNT(*)') ? [{ total: String(items.length) }] : items;
    } else throw new Error(`测试未实现 SQL: ${sql}`);
    return { rows: structuredClone(rows), rowCount: rows.length };
  }
}

/** 防止累计奖励误用当前余额，同时覆盖无奖励用户、分页及邮箱搜索。 */
async function testUsersAndRewardTotals() {
  const database = new AdminWalletDatabase();
  const service = new AdminWalletService();
  const result = await service.listUsers(database.db, { email: 'wallet', page: 1, limit: 25 });
  assert.deepEqual(result, { list: [{ id: 7, email: 'wallet@example.invalid', balance: 3000, reward_total: 7500 }], total: 1, page: 1, limit: 25 });
  const empty = await service.listUsers(database.db, { email: 'empty' });
  assert.equal(empty.list[0].reward_total, 0);
  assert.equal((await service.listUsers(database.db, { page: 2, limit: 1 })).list[0].id, 7);
  assert.equal((await service.listUsers(database.db, { email: '50%_' })).total, 0);
  assert.equal(database.calls.at(-1).params[0], '%50\\%\\_%');
}

/** 详情只允许用户概览和待处理申请元数据；没有用户为 404，密文/摘要不可进入 JSON。 */
async function testDetailAndPrivacy() {
  const database = new AdminWalletDatabase();
  const service = new AdminWalletService();
  const result = await service.getUserDetail(database.db, 7);
  assert.deepEqual(Object.keys(result).sort(), ['pending_withdrawal', 'user']);
  assert.equal(result.user.balance, 3000);
  assert.equal(result.user.reward_total, 7500);
  assert.equal(result.pending_withdrawal.id, 12);
  assert.equal(result.pending_withdrawal.payment_type, 'wechat');
  assert.doesNotMatch(JSON.stringify(result), /private-|payload|digest/);
  assert.equal((await service.getUserDetail(database.db, 8)).pending_withdrawal, null);
  await assert.rejects(() => service.getUserDetail(database.db, 99), error => error.statusCode === 404);
}

/** 实际解密并生成 PNG，处理完成后同一二维码请求必须失败。 */
async function testPendingQrOnly() {
  const database = new AdminWalletDatabase();
  const paymentQrService = new PaymentQrService({ encryptionKey: Buffer.alloc(32, 9).toString('base64') });
  database.state.withdrawals[0].qr_payload_encrypted = paymentQrService.encryptPayload('wxp://admin-wallet-test');
  const service = new AdminWalletService({ paymentQrService });
  const png = await service.getWithdrawalQr(database.db, 12);
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  await service.completeWithdrawal(database.db, 12, { adminId: 1 });
  await assert.rejects(() => service.getWithdrawalQr(database.db, 12), error => error.statusCode === 409);
  database.state.withdrawals[0].status = 'rejected';
  await assert.rejects(() => service.getWithdrawalQr(database.db, 12), error => error.statusCode === 409);
  await assert.rejects(() => service.getWithdrawalQr(database.db, 99), error => error.statusCode === 404);
}

/** 确认仅设置完成状态与管理员信息，不产生第二次扣款或任何余额流水。 */
async function testCompleteDoesNotChangeBalance() {
  const database = new AdminWalletDatabase();
  const service = new AdminWalletService();
  const result = await service.completeWithdrawal(database.db, 12, { adminId: 2 });
  assert.equal(result.status, 'completed');
  assert.equal(result.processed_by, 2);
  assert.equal(database.state.users[0].balance, 3000);
  assert.deepEqual(database.state.transactions, []);
  assert.doesNotMatch(JSON.stringify(result), /private-|payload|digest/);
  await assert.rejects(() => service.completeWithdrawal(database.db, 12, { adminId: 1 }), error => error.statusCode === 409);
  await assert.rejects(() => service.completeWithdrawal(database.db, 99, { adminId: 1 }), error => error.statusCode === 404);
  await assert.rejects(() => service.completeWithdrawal(database.db, 12), error => error.statusCode === 400);
}

/** 驳回前检查非空原因与处理身份，不合法输入不能启动退款事务。 */
async function testRejectValidatesInput() {
  const database = new AdminWalletDatabase();
  const service = new AdminWalletService();
  for (const reason of [undefined, null, '', '   ', 123, {}]) {
    await assert.rejects(() => service.rejectWithdrawal(database.db, 12, { adminId: 1, reason }), error => error.statusCode === 400);
  }
  await assert.rejects(() => service.rejectWithdrawal(database.db, 12, { reason: '信息不符' }), error => error.statusCode === 400);
  assert.equal(database.calls.length, 0);
}

/** 原子驳回先锁申请再锁用户；退款金额和引用必须来自申请记录。 */
async function testRejectRefundsAtomically() {
  const database = new AdminWalletDatabase();
  const result = await new AdminWalletService().rejectWithdrawal(database.db, 12, { adminId: 1, reason: ' 信息不符 ', amount: 9999, userId: 8 });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reject_reason, '信息不符');
  assert.equal(result.processed_by, 1);
  assert.equal(database.state.users[0].balance, 5000);
  assert.deepEqual(database.state.transactions, [{ id: 1, user_id: 7, type: 'withdrawal_refund', amount: 2000, balance_after: 5000, reference_type: 'withdrawal_request', reference_id: 12, description: '提现驳回退款' }]);
  const writes = database.calls.filter(call => /^(INSERT|UPDATE)/.test(call.sql));
  assert.equal(writes.length, 3);
  assert.ok(writes.every(call => call.client === 1));
  const locks = database.calls.filter(call => /FOR (UPDATE|NO KEY UPDATE)/.test(call.sql));
  assert.match(locks[0].sql, /FROM withdrawal_requests/);
  assert.match(locks[1].sql, /FROM users/);
  assert.doesNotMatch(JSON.stringify(result), /private-|payload|digest/);
}

/** 任何持久化步骤失败，都不能留下已驳回状态、退款余额或半条流水。 */
async function testRejectRollback() {
  for (const failOn of ['UPDATE withdrawal_requests', 'UPDATE users', 'INSERT INTO balance_transactions']) {
    const database = new AdminWalletDatabase({ failOn });
    const before = structuredClone(database.state);
    await assert.rejects(() => new AdminWalletService().rejectWithdrawal(database.db, 12, { adminId: 1, reason: '信息不符' }), /模拟持久化失败/);
    assert.deepEqual(database.state, before);
    assert.ok(database.calls.some(call => call.sql === 'ROLLBACK'));
    assert.equal(database.calls.at(-1).sql, 'RELEASE');
  }
  const missing = new AdminWalletDatabase();
  await assert.rejects(() => new AdminWalletService().rejectWithdrawal(missing.db, 99, { adminId: 1, reason: '信息不符' }), error => error.statusCode === 404);
  assert.equal(missing.state.transactions.length, 0);
}

/** 两次确认、两次驳回和交叉处理都只允许一个成功，退款最多一次且金额准确。 */
async function testConcurrentProcessing() {
  for (const actions of [['rejectWithdrawal', 'completeWithdrawal'], ['completeWithdrawal', 'rejectWithdrawal'], ['rejectWithdrawal', 'rejectWithdrawal'], ['completeWithdrawal', 'completeWithdrawal']]) {
    const database = new AdminWalletDatabase();
    const service = new AdminWalletService();
    const results = await Promise.allSettled(actions.map((action, index) => service[action](database.db, 12, { adminId: index + 1, reason: '信息不符' })));
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1, actions.join('/'));
    assert.equal(results.find(item => item.status === 'rejected').reason.statusCode, 409);
    const rejected = database.state.withdrawals[0].status === 'rejected';
    assert.equal(database.state.transactions.length, rejected ? 1 : 0);
    assert.equal(database.state.users[0].balance, rejected ? 5000 : 3000);
  }
}

/** 管理员可查看指定用户流水，但用户筛选不可被查询参数覆盖，页大小和偏移有界。 */
async function testTransactionsAndPagination() {
  const database = new AdminWalletDatabase();
  const service = new AdminWalletService();
  await service.rejectWithdrawal(database.db, 12, { adminId: 1, reason: '信息不符' });
  const result = await service.listUserTransactions(database.db, 7, { userId: 8, page: 2, limit: 25, type: 'withdrawal_refund', keyword: '退款' });
  assert.equal(result.total, 1);
  assert.equal(result.page, 2);
  assert.deepEqual(database.calls.at(-1).params, [7, 'withdrawal_refund', '%退款%', '%退款%', 25, 25]);
  assert.equal((await service.listUserTransactions(database.db, 8)).total, 0);
  await assert.rejects(() => service.listUserTransactions(database.db, 99), error => error.statusCode === 404);
  assert.equal((await service.listUsers(database.db, { limit: 999 })).limit, 100);
  await assert.rejects(() => service.listUsers(database.db, { page: Number.MAX_SAFE_INTEGER, limit: 100 }), error => error.statusCode === 400);
}

/** 独立运行全部行为断言，成功输出数量，失败保留原始断言供定位。 */
async function run() {
  const tests = [testUsersAndRewardTotals, testDetailAndPrivacy, testPendingQrOnly, testCompleteDoesNotChangeBalance, testRejectValidatesInput, testRejectRefundsAtomically, testRejectRollback, testConcurrentProcessing, testTransactionsAndPagination];
  for (const test of tests) { await test(); console.log(`✓ ${test.name}`); }
  console.log(`管理端钱包服务测试通过：${tests.length}/${tests.length}`);
}
run().catch(error => { console.error('管理端钱包服务测试失败:', error); process.exitCode = 1; });

/**
 * 统一余额仓储与服务测试。
 * 职责：覆盖余额原子增减、流水幂等、金额/类型校验以及流水筛选分页的边界行为。
 */

const assert = require('assert');
const balanceRepository = require('../repositories/balance-repository');
const { BalanceService } = require('../services/shared/balance-service');

const VALID_PAYLOAD = Object.freeze({
  userId: 7,
  amount: 2000,
  type: 'withdrawal',
  referenceType: 'withdrawal_request',
  referenceId: 9,
  description: '提现申请'
});

/**
 * 创建记录仓储调用的替身。
 * @param {Object} [overrides] - 覆盖指定仓储方法的返回值或实现。
 * @returns {{repository:Object,calls:Array}} 仓储替身与调用记录。
 * 核心分支：函数值作为自定义实现执行，其他值作为该方法的固定返回值。
 */
function createRecordingRepository(overrides = {}) {
  const calls = [];
  const defaults = {
    lockUser: { id: 7, balance: 5000 },
    incrementBalance: { balance: 7000 },
    decrementBalance: { balance: 3000 },
    insertTransaction: { id: 31 },
    countTransactions: { total: '0' },
    listTransactions: []
  };
  const repository = {};

  for (const name of Object.keys(defaults)) {
    repository[name] = async (...args) => {
      calls.push({ name, args });
      const implementation = Object.prototype.hasOwnProperty.call(overrides, name)
        ? overrides[name]
        : defaults[name];
      return typeof implementation === 'function'
        ? implementation(...args)
        : implementation;
    };
  }

  return { repository, calls };
}

/**
 * 创建记录 prepare/get/all 的数据库替身。
 * @param {Array} responses - 各次执行按顺序返回的结果。
 * @returns {{db:Object,calls:Array}} 数据库替身与 SQL 调用记录。
 * 核心分支：get/all 共用响应队列，便于验证仓储发出的 SQL 与绑定参数。
 */
function createRecordingDb(responses = []) {
  const calls = [];
  let responseIndex = 0;

  return {
    calls,
    db: {
      prepare(sql) {
        return {
          async get(...params) {
            calls.push({ method: 'get', sql, params });
            return responses[responseIndex++];
          },
          async all(...params) {
            calls.push({ method: 'all', sql, params });
            return responses[responseIndex++];
          }
        };
      }
    }
  };
}

/** 验证正数入账按锁定、更新、写流水顺序执行，并记录 SQL 返回的新余额。 */
async function testCreditUsesReturnedBalance() {
  const transactionDb = { marker: 'same-transaction' };
  const { repository, calls } = createRecordingRepository({
    lockUser: { id: 7, balance: 5000 },
    incrementBalance: { balance: 7000 },
    insertTransaction: (_db, { balanceAfter, amount }) => ({ id: 31, balance_after: balanceAfter, amount })
  });
  const service = new BalanceService({ repository });

  const result = await service.credit(transactionDb, {
    ...VALID_PAYLOAD,
    type: 'referral_reward'
  });

  assert.deepStrictEqual(calls.map(call => call.name), ['lockUser', 'incrementBalance', 'insertTransaction']);
  assert.ok(calls.every(call => call.args[0] === transactionDb));
  assert.equal(calls[1].args[2], 2000);
  assert.deepStrictEqual(calls[2].args[1], {
    userId: 7,
    amount: 2000,
    balanceAfter: 7000,
    type: 'referral_reward',
    referenceType: 'withdrawal_request',
    referenceId: 9,
    description: '提现申请'
  });
  assert.deepStrictEqual(result, { id: 31, balance_after: 7000, amount: 2000 });
}

/** 验证余额充足扣款的调用顺序、负数流水与 SQL 返回的新余额。 */
async function testDebitUsesReturnedBalance() {
  const transactionDb = { marker: 'same-transaction' };
  const { repository, calls } = createRecordingRepository({
    decrementBalance: { balance: 3000 },
    insertTransaction: (_db, { amount, balanceAfter }) => ({ id: 32, amount, balance_after: balanceAfter })
  });
  const service = new BalanceService({ repository });

  const result = await service.debit(transactionDb, VALID_PAYLOAD);

  assert.deepStrictEqual(calls.map(call => call.name), ['lockUser', 'decrementBalance', 'insertTransaction']);
  assert.ok(calls.every(call => call.args[0] === transactionDb));
  assert.deepStrictEqual(calls[2].args[1], {
    userId: 7,
    amount: -2000,
    balanceAfter: 3000,
    type: 'withdrawal',
    referenceType: 'withdrawal_request',
    referenceId: 9,
    description: '提现申请'
  });
  assert.deepStrictEqual(result, { id: 32, amount: -2000, balance_after: 3000 });
}

/** 验证金额恰好等于余额时允许扣款并形成零余额流水。 */
async function testDebitExactBalance() {
  const { repository, calls } = createRecordingRepository({
    lockUser: { id: 7, balance: 2000 },
    decrementBalance: { balance: 0 }
  });
  const service = new BalanceService({ repository });

  await service.debit({}, VALID_PAYLOAD);

  assert.equal(calls[1].name, 'decrementBalance');
  assert.equal(calls[2].args[1].balanceAfter, 0);
}

/** 验证余额不足在锁定后立即返回稳定业务错误，且不执行写操作。 */
async function testDebitRejectsInsufficientBalance() {
  const { repository, calls } = createRecordingRepository({
    lockUser: { id: 7, balance: 1999 }
  });
  const service = new BalanceService({ repository });

  await assert.rejects(
    () => service.debit({}, VALID_PAYLOAD),
    error => error.status === 409 && error.statusCode === 409 &&
      error.code === 'INSUFFICIENT_BALANCE' && /余额不足/.test(error.message)
  );
  assert.deepStrictEqual(calls.map(call => call.name), ['lockUser']);
}

/** 验证用户不存在会映射为稳定业务错误。 */
async function testRejectsMissingUser() {
  const { repository, calls } = createRecordingRepository({ lockUser: undefined });
  const service = new BalanceService({ repository });

  await assert.rejects(
    () => service.credit({}, { ...VALID_PAYLOAD, type: 'referral_reward' }),
    error => error.status === 404 && error.code === 'BALANCE_USER_NOT_FOUND'
  );
  assert.deepStrictEqual(calls.map(call => call.name), ['lockUser']);
}

/** 验证 0、负数、小数、非数字及超安全整数金额在访问仓储前被拒绝。 */
async function testRejectsInvalidAmounts() {
  const invalidAmounts = [0, -1, 1.5, '2000', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];

  for (const amount of invalidAmounts) {
    const { repository, calls } = createRecordingRepository();
    const service = new BalanceService({ repository });
    await assert.rejects(
      () => service.credit({}, { ...VALID_PAYLOAD, amount, type: 'referral_reward' }),
      error => error.status === 400 && error.code === 'INVALID_BALANCE_AMOUNT'
    );
    assert.equal(calls.length, 0);
  }
}

/** 验证写入和筛选只能使用数据库约束允许的流水类型。 */
async function testRejectsInvalidTransactionType() {
  const { repository, calls } = createRecordingRepository();
  const service = new BalanceService({ repository });

  await assert.rejects(
    () => service.credit({}, { ...VALID_PAYLOAD, type: 'unknown' }),
    error => error.status === 400 && error.code === 'INVALID_BALANCE_TRANSACTION_TYPE'
  );
  await assert.rejects(
    () => service.listTransactions({}, { userId: 7, type: 'unknown' }),
    error => error.status === 400 && error.code === 'INVALID_BALANCE_TRANSACTION_TYPE'
  );
  assert.equal(calls.length, 0);
}

/** 验证业务引用唯一冲突会转换为稳定、可供控制器映射的幂等错误。 */
async function testMapsDuplicateReferenceError() {
  const duplicate = Object.assign(new Error('duplicate key'), {
    code: '23505',
    constraint: 'balance_transactions_reference_type_reference_id_type_key'
  });
  const { repository } = createRecordingRepository({
    insertTransaction: async () => { throw duplicate; }
  });
  const service = new BalanceService({ repository });

  await assert.rejects(
    () => service.credit({}, { ...VALID_PAYLOAD, type: 'referral_reward' }),
    error => error !== duplicate && error.status === 409 && error.statusCode === 409 &&
      error.code === 'DUPLICATE_BALANCE_TRANSACTION' && /重复/.test(error.message)
  );
}

/** 验证非唯一约束数据库错误不会被错误包装。 */
async function testPreservesUnexpectedRepositoryError() {
  const failure = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
  const { repository } = createRecordingRepository({
    insertTransaction: async () => { throw failure; }
  });
  const service = new BalanceService({ repository });

  await assert.rejects(
    () => service.credit({}, { ...VALID_PAYLOAD, type: 'referral_reward' }),
    error => error === failure
  );
}

/** 验证列表结果统一转换总数，并将分页边界规范为 limit 1-100、offset 非负。 */
async function testListTransactionsPaginationBoundaries() {
  const { repository, calls } = createRecordingRepository({
    countTransactions: { total: '2' },
    listTransactions: [{ id: 2 }, { id: 1 }]
  });
  const service = new BalanceService({ repository });

  const upper = await service.listTransactions({}, { userId: 7, limit: 999, offset: -3 });
  assert.deepStrictEqual(upper, { items: [{ id: 2 }, { id: 1 }], total: 2 });
  assert.deepStrictEqual(calls[0].args[1], { userId: 7, type: undefined, keyword: undefined });
  assert.deepStrictEqual(calls[1].args[1], {
    userId: 7,
    type: undefined,
    keyword: undefined,
    limit: 100,
    offset: 0
  });

  calls.length = 0;
  await service.listTransactions({}, { userId: 7, limit: 0, offset: Number.MAX_SAFE_INTEGER + 1 });
  assert.equal(calls[1].args[1].limit, 20);
  assert.equal(calls[1].args[1].offset, 0);
}

/** 验证仓储锁定用户、条件扣款与余额返回均使用调用方传入的同一 db。 */
async function testRepositoryBalanceSql() {
  const { db, calls } = createRecordingDb([
    { id: 7, balance: 5000 },
    { balance: 3000 },
    { balance: 7000 }
  ]);

  await balanceRepository.lockUser(db, 7);
  await balanceRepository.decrementBalance(db, 7, 2000);
  await balanceRepository.incrementBalance(db, 7, 4000);

  // 余额锁必须兼容订单/奖励 INSERT 外键持有的 KEY SHARE，避免并发锁升级死锁。
  assert.match(calls[0].sql, /SELECT[\s\S]+COALESCE\(balance, 0\)[\s\S]+FROM users[\s\S]+FOR NO KEY UPDATE/i);
  assert.deepStrictEqual(calls[0].params, [7]);
  assert.match(calls[1].sql, /UPDATE users[\s\S]+COALESCE\(balance, 0\) - \?[\s\S]+COALESCE\(balance, 0\) >= \?[\s\S]+RETURNING balance/i);
  assert.deepStrictEqual(calls[1].params, [2000, 7, 2000]);
  assert.match(calls[2].sql, /UPDATE users[\s\S]+COALESCE\(balance, 0\) \+ \?[\s\S]+RETURNING balance/i);
  assert.deepStrictEqual(calls[2].params, [4000, 7]);
}

/** 验证流水插入只允许追加，并完整绑定余额快照和业务引用。 */
async function testRepositoryInsertsTransaction() {
  const expected = { id: 31, balance_after: 3000 };
  const { db, calls } = createRecordingDb([expected]);

  const result = await balanceRepository.insertTransaction(db, {
    userId: 7,
    amount: -2000,
    balanceAfter: 3000,
    type: 'withdrawal',
    referenceType: 'withdrawal_request',
    referenceId: 9,
    description: '提现申请'
  });

  assert.strictEqual(result, expected);
  assert.match(calls[0].sql, /^\s*INSERT INTO balance_transactions/i);
  assert.match(calls[0].sql, /RETURNING \*/i);
  assert.deepStrictEqual(calls[0].params, [7, 'withdrawal', -2000, 3000, 'withdrawal_request', 9, '提现申请']);
}

/** 验证关键字通配符被转义且只作为 ILIKE 参数传入，计数和列表条件保持一致。 */
async function testRepositoryEscapesKeywordAndPaginates() {
  const { db, calls } = createRecordingDb([{ total: '1' }, [{ id: 8 }]]);
  const filters = {
    userId: 7,
    type: 'withdrawal',
    keyword: '50%_\\VIP'
  };

  const totalRow = await balanceRepository.countTransactions(db, filters);
  const items = await balanceRepository.listTransactions(db, { ...filters, limit: 25, offset: 50 });

  assert.deepStrictEqual(totalRow, { total: '1' });
  assert.deepStrictEqual(items, [{ id: 8 }]);
  for (const call of calls) {
    assert.match(call.sql, /user_id = \?/i);
    assert.match(call.sql, /type = \?/i);
    assert.match(call.sql, /ILIKE \? ESCAPE '\\'/i);
    assert.doesNotMatch(call.sql, /50%/);
    assert.deepStrictEqual(call.params.slice(0, 4), [7, 'withdrawal', '%50\\%\\_\\\\VIP%', '%50\\%\\_\\\\VIP%']);
  }
  assert.match(calls[1].sql, /ORDER BY bt\.created_at DESC, bt\.id DESC[\s\S]+LIMIT \? OFFSET \?/i);
  assert.deepStrictEqual(calls[1].params.slice(-2), [25, 50]);
}

/** 提现流水只关联同一用户的申请，并返回状态、处理时间与驳回原因供本人展示。 */
async function testRepositoryJoinsOwnWithdrawalStatus() {
  const expected = [{
    id: 8,
    withdrawal_status: 'rejected',
    withdrawal_processed_at: 1700000000,
    withdrawal_reject_reason: '收款信息不符'
  }];
  const { db, calls } = createRecordingDb([expected]);

  const items = await balanceRepository.listTransactions(db, {
    userId: 7,
    limit: 20,
    offset: 0
  });

  assert.deepStrictEqual(items, expected);
  assert.match(calls[0].sql, /LEFT JOIN withdrawal_requests wr/i);
  assert.match(calls[0].sql, /bt\.reference_type = 'withdrawal_request'/i);
  assert.match(calls[0].sql, /bt\.reference_id = wr\.id/i);
  assert.match(calls[0].sql, /bt\.user_id = wr\.user_id/i);
  assert.match(calls[0].sql, /wr\.status AS withdrawal_status/i);
  assert.match(calls[0].sql, /wr\.processed_at AS withdrawal_processed_at/i);
  assert.match(calls[0].sql, /wr\.reject_reason AS withdrawal_reject_reason/i);
  assert.deepStrictEqual(calls[0].params, [7, 20, 0]);
}

/** 按行为顺序运行全部用例，任一失败时保留完整堆栈。 */
async function run() {
  const tests = [
    testCreditUsesReturnedBalance,
    testDebitUsesReturnedBalance,
    testDebitExactBalance,
    testDebitRejectsInsufficientBalance,
    testRejectsMissingUser,
    testRejectsInvalidAmounts,
    testRejectsInvalidTransactionType,
    testMapsDuplicateReferenceError,
    testPreservesUnexpectedRepositoryError,
    testListTransactionsPaginationBoundaries,
    testRepositoryBalanceSql,
    testRepositoryInsertsTransaction,
    testRepositoryEscapesKeywordAndPaginates,
    testRepositoryJoinsOwnWithdrawalStatus
  ];

  for (const test of tests) {
    await test();
    console.log(`✓ ${test.name}`);
  }
  console.log(`余额服务测试通过：${tests.length}/${tests.length}`);
}

run().catch((error) => {
  console.error('余额服务测试失败:', error);
  process.exit(1);
});

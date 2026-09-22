/**
 * 续费测试：默认运行离线账务事务专项，不登录、不创建真实订单。
 * 使用 --live 显式运行原有 HTTP 流程（需已启动服务并事先确认测试账号）。
 * 真实模式从 RENEW_TEST_EMAIL/RENEW_TEST_PASSWORD 读取凭据，避免把测试账号提交到仓库。
 */

const http = require('http');
const assert = require('assert');
const { createDbProxy } = require('../db/proxy');
const { convertPlaceholders } = require('../db/sql-utils');
const renewService = require('../services/user/renew-service');
const xuiSyncTaskService = require('../integrations/xui/xui-sync-task-service');
const orderActivationEmailService = require('../services/shared/order-activation-email-service');
const vmqService = require('../integrations/vmq/vmq-service');

const BASE_URL = 'http://localhost:30000';
let authToken = null;

/**
 * 发送HTTP请求
 */
function request(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * 测试用户登录
 */
async function testLogin() {
  console.log('\n=== 测试用户登录 ===');
  assert.ok(process.env.RENEW_TEST_EMAIL && process.env.RENEW_TEST_PASSWORD, '真实测试需先确认账号并设置 RENEW_TEST_EMAIL/RENEW_TEST_PASSWORD');

  const result = await request('POST', '/api/user/login', {
    email: process.env.RENEW_TEST_EMAIL,
    password: process.env.RENEW_TEST_PASSWORD
  });

  console.log('登录结果:', { code: result.code, message: result.message });

  if (result.code === 0) {
    authToken = result.data.token;
    console.log('✅ 登录成功');
    return true;
  } else {
    console.log('❌ 登录失败:', result.message);
    return false;
  }
}

/**
 * 测试获取套餐列表
 */
async function testGetPlans() {
  console.log('\n=== 测试获取套餐列表 ===');

  const result = await request('GET', '/api/user/plans');
  console.log('套餐列表:', result);

  if (result.code === 0 && result.data.plans && result.data.plans.length > 0) {
    console.log('✅ 获取套餐列表成功，共', result.data.plans.length, '个套餐');
    return result.data.plans[0].id; // 返回第一个套餐ID
  } else {
    console.log('❌ 获取套餐列表失败');
    return null;
  }
}

/**
 * 测试续费接口
 */
async function testRenew(planId) {
  console.log('\n=== 测试续费接口 ===');
  console.log('续费套餐ID:', planId);

  const result = await request('POST', '/api/user/renew', {
    plan_id: planId
  }, authToken);

  console.log('续费结果:', result);

  if (result.code === 0) {
    console.log('✅ 续费订单创建成功');
    console.log('   订单号:', result.data.out_trade_no);
    console.log('   VMQ订单号:', result.data.vmq_order_id);
    console.log('   支付金额:', result.data.really_price, '元');
    console.log('   支付链接:', result.data.payment_url ? result.data.payment_url.substring(0, 50) + '...' : '无');
    return result.data;
  } else {
    console.log('❌ 续费失败:', result.message);
    return null;
  }
}

/**
 * 测试未登录访问续费接口
 */
async function testRenewWithoutAuth() {
  console.log('\n=== 测试未登录访问续费接口 ===');

  const result = await request('POST', '/api/user/renew', {
    plan_id: 1
  });

  console.log('未登录访问结果:', result);

  if (result.code === 1002) {
    console.log('✅ 正确返回未登录错误');
    return true;
  } else {
    console.log('❌ 未正确处理未登录情况');
    return false;
  }
}

/**
 * 测试无效套餐ID
 */
async function testRenewWithInvalidPlan() {
  console.log('\n=== 测试无效套餐ID ===');

  const result = await request('POST', '/api/user/renew', {
    plan_id: 99999
  }, authToken);

  console.log('无效套餐ID结果:', result);

  if (result.code === 1001) {
    console.log('✅ 正确返回套餐不存在错误');
    return true;
  } else {
    console.log('❌ 未正确处理无效套餐ID');
    return false;
  }
}

/**
 * 运行真实 HTTP 测试，任一步失败立即终止并设置非零退出码。
 */
async function runAllTests() {
  console.log('🚀 开始续费功能测试\n');
  console.log('测试时间:', new Date().toLocaleString());

  try {
    // 1. 测试登录
    const loginSuccess = await testLogin();
    if (!loginSuccess) {
      console.log('\n❌ 登录失败，终止测试');
      process.exitCode = 1;
      return;
    }

    // 2. 测试获取套餐列表
    const planId = await testGetPlans();
    if (!planId) {
      console.log('\n❌ 获取套餐列表失败，终止测试');
      process.exitCode = 1;
      return;
    }

    // 3. 测试未登录访问
    if (!(await testRenewWithoutAuth())) {
      process.exitCode = 1;
      return;
    }

    // 4. 测试无效套餐ID
    if (!(await testRenewWithInvalidPlan())) {
      process.exitCode = 1;
      return;
    }

    // 5. 测试正常续费
    const renewResult = await testRenew(planId);
    if (!renewResult) {
      process.exitCode = 1;
      return;
    }

    console.log('\n=== 测试完成 ===');
    console.log('测试时间:', new Date().toLocaleString());

    if (renewResult) {
      console.log('\n✅ 所有测试通过！');
      console.log('\n⚠️  注意事项:');
      console.log('1. 续费订单已创建，需要手动在VMQ后台模拟支付回调');
      console.log('2. 支付回调地址: POST /api/user/payment/notify');
      console.log('3. 回调参数示例:');
      console.log(`   payId=${renewResult.out_trade_no}`);
      console.log('   orderId=VMQ订单号');
      console.log('   type=2');
      console.log('   price=套餐金额');
      console.log('   reallyPrice=实付金额');
      console.log('   sign=MD5签名');
    }
  } catch (error) {
    console.error('\n❌ 测试过程中发生错误:', error.message);
    process.exitCode = 1;
  }
}

/**
 * 余额支付 PostgreSQL 边界，执行真实续费、订单、余额服务及仓储与事务代理。
 * 职责：保留可回滚业务状态和 SQL 连接证据；failure 注入流水/权益/提交故障。
 * 核心分支：snapshot 表示未提交事务，外部效果记录执行时是否仍持有事务。
 */
class BalanceRenewDatabase {
  /** balance 为初始余额；lockedBalance 模拟余额竞态；price/name 指定套餐边界；home 控制家宽分支。 */
  constructor({ balance = 2000, lockedBalance, failure, home = false, price = '1500', name = '离线测试套餐' } = {}) {
    this.failure = failure;
    this.lockedBalance = lockedBalance;
    this.state = {
      balance, orders: [], transactions: [],
      user: { id: 8, email: 'offline-user@example.test', plan_id: 1, enabled: 1, traffic_limit: 1024, traffic_used: 0, payment_count: 1 }
    };
    this.plan = { id: 1, name, price, plan_type: home ? 'home_ip' : 'lifetime', duration_days: home ? 30 : 0, traffic_limit: home ? 0 : 2048, sales_limit: -1 };
    this.snapshot = null;
    this.calls = [];
    this.effects = [];
    this.client = {
      query: (sql, params) => this.query(sql, params, 'client'),
      release: () => this.calls.push({ sql: 'RELEASE', source: 'client' })
    };
    this.db = createDbProxy({
      pool: { connect: async () => this.client },
      queryWithRetry: (sql, params) => this.query(sql, params, 'pool'),
      convertPlaceholders,
      logger: { error() {}, info() {} }
    });
  }

  /** 匹配仓储发出的 SQL；未知语句直接失败，防止遗漏数据库访问落入默认成功。 */
  async query(sql, params = [], source) {
    sql = sql.replace(/\s+/g, ' ').trim();
    this.calls.push({ sql, params, source });
    let rows = [];
    if (sql === 'BEGIN') {
      if (this.lockedBalance !== undefined) this.state.balance = this.lockedBalance;
      this.snapshot = structuredClone(this.state);
    } else if (sql === 'ROLLBACK') {
      this.state = this.snapshot;
      this.snapshot = null;
    } else if (sql === 'COMMIT') {
      if (this.failure === 'commit') throw new Error('提交失败');
      this.snapshot = null;
    } else if (sql.startsWith('SELECT * FROM users')) {
      rows = [{ ...this.state.user, balance: this.state.balance }];
    } else if (sql.startsWith('SELECT * FROM plans')) {
      rows = [this.plan];
    } else if (sql.startsWith('INSERT INTO orders')) {
      const [userId, email, planId, amount, outTradeNo] = params;
      rows = [{ id: 66, user_id: userId, email, plan_id: planId, amount, out_trade_no: outTradeNo, status: 'pending' }];
      this.state.orders.push(rows[0]);
    } else if (sql.includes('FROM users') && sql.includes('FOR NO KEY UPDATE')) {
      assert.strictEqual(params[0], 8);
      rows = [{ id: 8, balance: this.state.balance }];
    } else if (sql.startsWith('UPDATE users') && sql.includes('balance')) {
      assert.deepStrictEqual(params, [1500, 8, 1500]);
      if (Number(this.state.balance) >= params[0]) {
        this.state.balance -= params[0];
        rows = [{ id: 8, balance: this.state.balance }];
      }
    } else if (sql.startsWith('INSERT INTO balance_transactions')) {
      if (this.failure === 'ledger') throw Object.assign(new Error('重复流水'), { code: '23505' });
      const [userId, type, amount, balanceAfter, referenceType, referenceId, description] = params;
      rows = [{ id: 77, user_id: userId, type, amount, balance_after: balanceAfter, reference_type: referenceType, reference_id: referenceId, description }];
      this.state.transactions.push(rows[0]);
    } else if (sql.includes('FROM orders o')) {
      if (this.failure !== 'missing-order') {
        const user = this.state.user;
        rows = [{ ...this.state.orders[0], current_plan_id: user.plan_id, current_plan_type: this.plan.plan_type, current_traffic_limit: user.traffic_limit, current_traffic_used: user.traffic_used, current_payment_count: user.payment_count }];
      }
    } else if (sql.startsWith('UPDATE orders')) {
      const order = this.state.orders.find(row => row.out_trade_no === params[2]);
      order.status = 'paid';
      order.trade_no = params[0];
      rows = [{ id: order.id }];
    } else if (sql.startsWith('UPDATE users')) {
      if (this.failure === 'entitlement') throw new Error('权益写入失败');
      if (sql.includes('home_plan_id')) {
        this.state.user.home_plan_id = params[0];
        this.state.user.home_expire_at = params[1];
      } else {
        this.state.user.plan_id = params[0];
        this.state.user.traffic_limit = params[1];
        this.state.user.payment_count += 1;
      }
      rows = [{ id: 8 }];
    } else {
      throw new Error(`未覆盖的续费 SQL: ${sql}`);
    }
    return { rows, rowCount: rows.length };
  }

  /** 记录真正外部边界的调用时间与数据库对象，供测试验证仅提交后用根代理执行。 */
  recordEffect(name, db) {
    this.effects.push({ name, db, inTransaction: this.snapshot !== null });
    return Promise.resolve(name === 'enqueue' ? 99 : undefined);
  }

  /** 隔离 VMQ/3X-UI/邮件网络入口，内部业务及全部 SQL 仍运行真实代码。 */
  async renew() {
    const originals = [xuiSyncTaskService.enqueueTask, xuiSyncTaskService.processTask, orderActivationEmailService.sendOrderActivationEmail, vmqService.createOrder, vmqService.isMonitorOnline];
    xuiSyncTaskService.enqueueTask = db => this.recordEffect('enqueue', db);
    xuiSyncTaskService.processTask = db => this.recordEffect('process', db);
    orderActivationEmailService.sendOrderActivationEmail = db => this.recordEffect('email', db);
    vmqService.createOrder = () => { throw new Error('余额支付不应调用 VMQ'); };
    vmqService.isMonitorOnline = () => { throw new Error('余额支付不应查询 VMQ'); };
    try {
      return await renewService.createRenewOrder(this.db, 8, { plan_id: 1, pay_type: 9 });
    } finally {
      [xuiSyncTaskService.enqueueTask, xuiSyncTaskService.processTask, orderActivationEmailService.sendOrderActivationEmail, vmqService.createOrder, vmqService.isMonitorOnline] = originals;
    }
  }
}

/** 验证成功支付形成唯一负数流水，权益与扣款同事务，提交后仅执行一次副作用。 */
async function testBalancePaymentCommitsTogether() {
  for (const options of [{ balance: 2000 }, { balance: '1500' }, { balance: 1500, home: true }]) {
    const database = new BalanceRenewDatabase(options);
    const result = await database.renew();
    assert.strictEqual(database.state.transactions.length, 1, '余额支付缺少 plan_payment 流水');
    const ledger = database.state.transactions[0];
    assert.deepStrictEqual({ ...ledger, description: '' }, {
      id: 77, user_id: 8, type: 'plan_payment', amount: -1500,
      balance_after: Number(options.balance) - 1500, reference_type: 'order', reference_id: 66, description: ''
    });
    assert.ok(ledger.description.includes('离线测试套餐'));
    assert.ok(ledger.description.includes(result.out_trade_no));
    assert.ok(!ledger.description.includes(database.state.user.email));
    assert.strictEqual(database.state.balance, Number(options.balance) - 1500);
    assert.strictEqual(database.state.orders[0].status, 'paid');
    assert.strictEqual(database.state.orders[0].trade_no, `BALANCE-${result.out_trade_no}`);
    assert.strictEqual(result.paid, true);
    assert.strictEqual(result.payment_method, 'balance');
    const begin = database.calls.findIndex(call => call.sql === 'BEGIN');
    const transactionCalls = database.calls.slice(begin);
    assert.ok(transactionCalls.every(call => call.source === 'client'));
    assert.strictEqual(transactionCalls.filter(call => call.sql === 'BEGIN').length, 1);
    assert.strictEqual(transactionCalls.filter(call => call.sql.includes('FOR NO KEY UPDATE')).length, 1);
    assert.deepStrictEqual(transactionCalls.slice(-2).map(call => call.sql), ['COMMIT', 'RELEASE']);
    assert.ok(transactionCalls.findIndex(call => call.sql.startsWith('INSERT INTO orders')) < transactionCalls.findIndex(call => call.sql.startsWith('INSERT INTO balance_transactions')));
    assert.ok(transactionCalls.findIndex(call => call.sql.startsWith('INSERT INTO balance_transactions')) < transactionCalls.findIndex(call => call.sql.startsWith('UPDATE orders')));
    assert.deepStrictEqual(database.effects.map(effect => effect.name).sort(), options.home ? ['email'] : ['email', 'enqueue', 'process']);
    assert.ok(database.effects.every(effect => !effect.inTransaction && effect.db === database.db));
    if (options.home) assert.strictEqual(database.state.user.home_plan_id, 1);
    else assert.strictEqual(database.state.user.traffic_limit, 3072);
  }
  console.log('PASS 余额支付：充足/恰好相等/字符串金额/家宽套餐，同事务提交和提交后副作用');
}

/** 验证零价套餐无需余额变更或流水，订单和权益仍原子完成，失败仍可全量回滚。 */
async function testZeroPricePlanCompletesWithoutBalanceTransaction() {
  for (const price of [0, '0']) {
    const database = new BalanceRenewDatabase({ balance: 0, price });
    let result;
    await assert.doesNotReject(async () => {
      result = await database.renew();
    }, '零价套餐应正常完成，不能调用仅接受正金额的扣款服务');
    assert.strictEqual(result.paid, true);
    assert.strictEqual(result.really_price, '0.00');
    assert.strictEqual(database.state.balance, 0);
    assert.deepStrictEqual(database.state.transactions, []);
    assert.strictEqual(database.state.orders[0].status, 'paid');
    assert.strictEqual(Number(database.state.orders[0].amount), 0);
    assert.strictEqual(database.state.user.traffic_limit, 3072);
    const begin = database.calls.findIndex(call => call.sql === 'BEGIN');
    const transactionCalls = database.calls.slice(begin);
    assert.ok(transactionCalls.every(call => call.source === 'client'));
    assert.strictEqual(transactionCalls.filter(call => call.sql === 'BEGIN').length, 1);
    assert.ok(!transactionCalls.some(call => call.sql.includes('FOR NO KEY UPDATE') || /UPDATE users.*balance/.test(call.sql)));
    assert.deepStrictEqual(transactionCalls.slice(-2).map(call => call.sql), ['COMMIT', 'RELEASE']);
    assert.deepStrictEqual(database.effects.map(effect => effect.name).sort(), ['email', 'enqueue', 'process']);
    assert.ok(database.effects.every(effect => !effect.inTransaction && effect.db === database.db));
  }

  const failed = new BalanceRenewDatabase({ balance: 0, price: 0, failure: 'entitlement' });
  await assert.rejects(() => failed.renew(), /权益写入失败/);
  assert.strictEqual(failed.state.balance, 0);
  assert.deepStrictEqual(failed.state.orders, []);
  assert.deepStrictEqual(failed.state.transactions, []);
  assert.strictEqual(failed.state.user.traffic_limit, 1024);
  assert.deepStrictEqual(failed.effects, []);
  assert.deepStrictEqual(failed.calls.slice(-2).map(call => call.sql), ['ROLLBACK', 'RELEASE']);

  // 无法转换的金额不能因零价兼容分支被静默当成免费订单。
  const invalid = new BalanceRenewDatabase({ balance: 0, price: 'invalid-price' });
  await assert.rejects(() => invalid.renew(), error => error.code === 'INVALID_BALANCE_AMOUNT');
  assert.deepStrictEqual(invalid.state.orders, []);
  assert.deepStrictEqual(invalid.state.transactions, []);
  assert.deepStrictEqual(invalid.effects, []);
  console.log('PASS 零价套餐：数字/字符串零金额无扣款和流水，订单权益同事务提交或回滚');
}

/** 验证流水描述最长 255 个 JS 字符，保留完整订单号且不截断中文或 UTF-16 代理对。 */
async function testPlanPaymentDescriptionLengthBoundary() {
  const cases = [
    { name: '普通套餐😀', expectedName: '普通套餐😀' },
    { name: '中'.repeat(255), expectedName: '中'.repeat(223) },
    { name: 'A'.repeat(255), expectedName: 'A'.repeat(223) },
    { name: '中'.repeat(222) + '😀' + '尾'.repeat(31), expectedName: '中'.repeat(222) }
  ];
  for (const fixture of cases) {
    const database = new BalanceRenewDatabase({ name: fixture.name });
    const result = await database.renew();
    const description = database.state.transactions[0].description;
    assert.ok(description.length <= 255, `流水描述超过 255：${description.length}`);
    assert.strictEqual(description, `套餐支付：${fixture.expectedName}，订单号：${result.out_trade_no}`);
    assert.ok(!/[\uD800-\uDFFF]/u.test(description), '描述不应包含被截断的 UTF-16 代理对');
    assert.strictEqual(database.state.orders[0].status, 'paid');
    assert.strictEqual(database.state.balance, 500);
  }
  console.log('PASS 流水描述：255 字中英文套餐名、完整订单号与 UTF-16 代理对边界');
}

/** 验证余额竞态、流水冲突、完成异常或提交失败时全部回滚且无外部副作用。 */
async function testBalancePaymentRollback() {
  const cases = [
    { lockedBalance: 1499, code: 4001 },
    { failure: 'ledger', code: 'DUPLICATE_BALANCE_TRANSACTION' },
    { failure: 'entitlement', message: '权益写入失败' },
    { failure: 'missing-order', code: 5002 },
    { failure: 'commit', message: '提交失败' },
    { failure: 'commit', home: true, message: '提交失败' }
  ];
  for (const options of cases) {
    const database = new BalanceRenewDatabase(options);
    const initialUser = structuredClone(database.state.user);
    await assert.rejects(() => database.renew(), error => options.code ? error.code === options.code : error.message === options.message);
    assert.strictEqual(database.state.balance, options.lockedBalance ?? 2000);
    assert.deepStrictEqual(database.state.orders, []);
    assert.deepStrictEqual(database.state.transactions, []);
    assert.deepStrictEqual(database.state.user, initialUser);
    assert.deepStrictEqual(database.effects, []);
    assert.deepStrictEqual(database.calls.slice(-2).map(call => call.sql), ['ROLLBACK', 'RELEASE']);
  }
  console.log('PASS 余额支付回滚：余额竞态/流水冲突/权益异常/无法完成/提交失败，无副作用');
}

/** 用离线步骤替身验证 --live 协调器任一步失败或抛错都会返回非零退出码。 */
async function testLiveModeFailureExitCodes() {
  const originals = [testLogin, testGetPlans, testRenewWithoutAuth, testRenewWithInvalidPlan, testRenew];
  const originalExitCode = process.exitCode;
  const originalConsole = [console.log, console.error];
  try {
    console.log = () => {};
    console.error = () => {};
    for (const failure of [0, 1, 2, 3, 4, 'throw', null]) {
      const steps = [true, 1, true, true, { out_trade_no: 'REN-OFFLINE-TEST' }].map((value, index) => async () => {
        if (failure === 'throw' && index === 0) throw new Error('离线模拟 HTTP 错误');
        return failure === index ? null : value;
      });
      [testLogin, testGetPlans, testRenewWithoutAuth, testRenewWithInvalidPlan, testRenew] = steps;
      process.exitCode = undefined;
      await runAllTests();
      assert.strictEqual(process.exitCode, failure === null ? undefined : 1, `--live 步骤 ${failure} 的退出码不正确`);
    }
  } finally {
    [testLogin, testGetPlans, testRenewWithoutAuth, testRenewWithInvalidPlan, testRenew] = originals;
    [console.log, console.error] = originalConsole;
    process.exitCode = originalExitCode;
  }
  console.log('PASS --live 退出码：五个步骤失败及异常均返回 1，成功不影响退出码');
}

/** 执行离线专项并保证失败返回非零退出码；真实 HTTP 流程仅在显式参数下启动。 */
async function runOfflineTests() {
  await testLiveModeFailureExitCodes();
  await testPlanPaymentDescriptionLengthBoundary();
  await testZeroPricePlanCompletesWithoutBalanceTransaction();
  await testBalancePaymentCommitsTogether();
  await testBalancePaymentRollback();
  console.log('renew balance transaction tests passed');
}

if (process.argv.includes('--live')) {
  runAllTests();
} else {
  runOfflineTests().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

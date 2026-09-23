/** 钱包 HTTP 契约测试：真实 Express、JWT、Multer，仅替换服务的外部业务执行边界。 */
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const walletRouter = require('../routes/user/wallet');
const walletService = require('../services/user/wallet-service');
const config = require('../config');

const calls = [];
const db = { marker: 'wallet-http-test' };
const originals = new Map();
const capturedLogs = [];

/** 记录真实控制器传入的业务参数并返回安全结果；finally 会还原全部服务方法。 */
function stubService(name, result) {
  originals.set(name, walletService[name]);
  walletService[name] = async (...args) => {
    calls.push({ name, args });
    return typeof result === 'function' ? result(...args) : result;
  };
}

/** 手工创建 multipart 字节流以覆盖字段名、大小限制及损坏边界，不依赖浏览器容错。 */
function multipart({ field = 'qr_code', paymentType = 'wechat', buffer = Buffer.from('image-fixture'), extraFile = false } = {}) {
  const boundary = 'wallet-test-boundary';
  const parts = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="payment_type"\r\n\r\n${paymentType}\r\n`), Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="wallet.png"\r\nContent-Type: image/png\r\n\r\n`), buffer, Buffer.from('\r\n')];
  if (extraFile) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="qr_code"; filename="second.png"\r\nContent-Type: image/png\r\n\r\nsecond\r\n`));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** 请求仅发送到测试用临时随机端口；返回响应格式与 HTTP 状态供独立断言。 */
function request(port, path, { method = 'GET', body, contentType = 'application/json', authenticated = true } = {}) {
  const data = Buffer.isBuffer(body) ? body : body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers = { 'Content-Type': contentType };
  if (data) headers['Content-Length'] = data.length;
  if (authenticated) headers.Authorization = `Bearer ${jwt.sign({ id: 7, email: 'wallet-route-test@example.invalid' }, config.user.jwtSecret, { expiresIn: '1m' })}`;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: `/api/user/wallet${path}`, method, headers }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw), headers: res.headers }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

/** 每个响应必须保持 code/message/data，禁止 HTML、堆栈和原始异常逃逸。 */
function assertEnvelope(response, status) {
  assert.equal(response.status, status);
  assert.deepEqual(Object.keys(response.body).sort(), ['code', 'data', 'message']);
  assert.equal(typeof response.body.message, 'string');
}

/** 所有钱包接口都需鉴权，未经登录的上传不得进入 Multer 或业务层。 */
async function testAuthentication(port) {
  calls.length = 0;
  for (const [method, path] of [['GET', '/summary'], ['PUT', '/payment-qr'], ['GET', '/withdrawal'], ['POST', '/withdrawals'], ['GET', '/transactions']]) {
    assertEnvelope(await request(port, path, { method, authenticated: false }), 401);
  }
  assert.equal(calls.length, 0);
}

/** 请求中的 userId/user_id 永远不能替换 JWT 用户，成功响应沿用旧结构。 */
async function testReadEndpointsAndOwnership(port) {
  const cases = [
    ['/summary?user_id=8', 'getSummary'],
    ['/withdrawal?userId=8', 'getWithdrawalOverview'],
    ['/transactions?page=2&limit=100&type=withdrawal&keyword=abc&userId=8', 'listUserTransactions', { page: '2', limit: '100', type: 'withdrawal', keyword: 'abc' }]
  ];
  for (const [path, method, expectedFilters] of cases) {
    const response = await request(port, path);
    assertEnvelope(response, 200);
    assert.equal(response.body.code, 0);
    const call = calls.at(-1);
    assert.equal(call.name, method);
    assert.strictEqual(call.args[0], db);
    assert.equal(call.args[1], 7);
    if (expectedFilters) assert.deepEqual(call.args[2], expectedFilters);
  }
}

/** 捕获 parseFloat 截断、隐式类型转换和浮点金额损失，包含精确安全整数上界。 */
async function testStrictMoneyConversion(port) {
  for (const [amount, expected] of [['20', 2000], ['20.0', 2000], ['20.00', 2000], ['00020.01', 2001], ['90071992547409.91', 9007199254740991]]) {
    const response = await request(port, '/withdrawals', { method: 'POST', body: { amount, userId: 8 } });
    assertEnvelope(response, 200);
    assert.equal(calls.at(-1).args[1], 7);
    assert.deepEqual(calls.at(-1).args[2], { amount: expected });
  }
  const before = calls.length;
  for (const amount of ['20.001', '2e1', ' 20', '20 ', '+20', '-20', '0', '0.00', '.5', '20.', '20x', '90071992547409.92', '', 'Infinity', 20, null, {}, ['20']]) {
    assertEnvelope(await request(port, '/withdrawals', { method: 'POST', body: { amount } }), 400);
  }
  assert.equal(calls.length, before);
}

/** 路由分页边界拒绝非法输入，服务自身还会封顶 limit 防止非 HTTP 调用绕过。 */
async function testPaginationValidation(port) {
  const before = calls.length;
  for (const query of ['limit=101', 'limit=0', 'page=0', 'page=1.5', 'page=9007199254740992', 'type=invalid', 'keyword[]=x']) {
    assertEnvelope(await request(port, `/transactions?${query}`), 400);
  }
  assert.equal(calls.length, before);
}

/** 成功上传传递内存 Buffer；错误字段名、额外文件、非 multipart、超大文件和非法平台均拒绝。 */
async function testUploadBoundary(port) {
  const payload = multipart();
  const uploaded = await request(port, '/payment-qr', { method: 'PUT', ...payload });
  assertEnvelope(uploaded, 200);
  const call = calls.at(-1);
  assert.equal(call.name, 'savePaymentQr');
  assert.equal(call.args[1], 7);
  assert.equal(call.args[2].paymentType, 'wechat');
  assert.ok(Buffer.isBuffer(call.args[2].fileBuffer));
  assert.equal(call.args[2].fileBuffer.toString(), 'image-fixture');
  assert.deepEqual(Object.keys(call.args[2]).sort(), ['fileBuffer', 'paymentType']);

  const exactLimit = multipart({ buffer: Buffer.alloc(5 * 1024 * 1024) });
  assertEnvelope(await request(port, '/payment-qr', { method: 'PUT', ...exactLimit }), 200);
  assert.equal(calls.at(-1).args[2].fileBuffer.length, 5 * 1024 * 1024);
  const before = calls.length;
  for (const upload of [multipart({ field: 'image' }), multipart({ paymentType: 'bank' }), multipart({ extraFile: true }), multipart({ buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })]) {
    assertEnvelope(await request(port, '/payment-qr', { method: 'PUT', ...upload }), 400);
  }
  assertEnvelope(await request(port, '/payment-qr', { method: 'PUT', body: { payment_type: 'wechat', qr_code: 'fake' } }), 400);
  assertEnvelope(await request(port, '/payment-qr', { method: 'PUT', body: Buffer.from('bad boundary'), contentType: 'multipart/form-data; boundary=broken' }), 400);
  assert.equal(calls.length, before);
}

/** 业务冲突仍为统一 JSON；未知异常不得把收款码内容、SQL 或堆栈发给客户端。 */
async function testErrorsNeverLeakPayload(port) {
  const previous = walletService.getSummary;
  try {
    walletService.getSummary = async () => { throw Object.assign(new Error('已有处理中提现申请'), { expose: true, statusCode: 409, code: 409 }); };
    const conflict = await request(port, '/summary');
    assertEnvelope(conflict, 409);
    assert.equal(conflict.body.message, '已有处理中提现申请');
    walletService.getSummary = async () => { throw new Error('wxp://private-fixture SQL failed encrypted-payload'); };
    const failure = await request(port, '/summary');
    assertEnvelope(failure, 500);
    assert.doesNotMatch(JSON.stringify(failure.body), /private-fixture|encrypted|SQL|stack/);
    assert.doesNotMatch(capturedLogs.join('\n'), /private-fixture|encrypted-payload|image-fixture|wallet\.png/);
  } finally { walletService.getSummary = previous; }
}

/** 验证应用注册入口实际挂载钱包，避免单独 Router 测试通过但生产 URL 返回 404。 */
async function testWalletRouteIsMounted() {
  const registerUserRoutes = require('../bootstrap/register-user-routes');
  const mounted = [];
  registerUserRoutes({ use: (...args) => mounted.push(args) }, { error() {} });
  assert.ok(mounted.some(([path, route]) => path === '/api/user/wallet' && route === walletRouter));
}

/** 只启动与关闭临时 HTTP 测试夹具，不加载 app.js 或连接数据库。 */
async function run() {
  stubService('getSummary', { balance: 5000, payment_type: 'wechat', has_payment_qr: true });
  stubService('getWithdrawalOverview', { balance: 5000, minimum_withdrawal_amount: 2000, pending_withdrawal: null });
  stubService('listUserTransactions', { list: [], total: 0, page: 2, limit: 100 });
  stubService('createWithdrawal', { id: 1, amount: 2000, status: 'pending', created_at: 123 });
  stubService('savePaymentQr', { payment_type: 'wechat', has_payment_qr: true });
  const app = express();
  app.locals.db = db;
  app.use(express.json());
  app.use('/api/user/wallet', walletRouter);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const consoleMethods = Object.fromEntries(['log', 'warn', 'error'].map(name => [name, console[name]]));
  for (const name of Object.keys(consoleMethods)) console[name] = (...args) => capturedLogs.push(args.map(String).join(' '));
  try {
    const port = server.address().port;
    const tests = [testAuthentication, testReadEndpointsAndOwnership, testStrictMoneyConversion, testPaginationValidation, testUploadBoundary, testErrorsNeverLeakPayload, testWalletRouteIsMounted];
    for (const test of tests) { await test(port); consoleMethods.log(`✓ ${test.name}`); }
    consoleMethods.log(`钱包路由测试通过：${tests.length}/${tests.length}`);
  } finally {
    Object.assign(console, consoleMethods);
    await new Promise(resolve => server.close(resolve));
    for (const [name, original] of originals) walletService[name] = original;
  }
}
run().catch(error => { console.error('钱包路由测试失败:', error); process.exitCode = 1; });

const assert = require('assert');
const subscriptionService = require('../services/user/subscription-service');
const subscriptionController = require('../controllers/user/subscription-controller');

/** 构造最小 Express 响应替身，记录真实控制器写入的状态、头和 JSON。 */
function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = String(value); },
    json(body) { this.body = body; return this; }
  };
}

/** 构造带当前用户、数据库和请求 host 的最小请求。 */
function createRequest() {
  return {
    app: { locals: { db: { name: 'controller-db' } } },
    user: { id: 7 },
    get(name) { return name === 'host' ? 'example.test' : ''; }
  };
}

/** 成功响应保持旧 code=0，并让三个公开 URL 和 pending 元数据同时指向本轮结果。 */
async function testReplaceReturnsUrlsAndPendingServers() {
  const original = subscriptionService.replaceSubscriptionLink;
  subscriptionService.replaceSubscriptionLink = async () => ({
    subId: 'new-token',
    pendingServerIds: [2],
    pendingServerNames: ['香港'],
    retryScheduled: true
  });
  try {
    const res = createResponse();
    await subscriptionController.replaceSubscriptionLink(createRequest(), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.code, 0);
    assert.ok(res.body.data.subscription_url.endsWith('/new-token'));
    assert.ok(res.body.data.clash_url.endsWith('/new-token?clash=1'));
    assert.ok(res.body.data.v2ray_url.endsWith('/new-token?v2ray=1'));
    assert.deepStrictEqual(res.body.data.pending_server_ids, [2]);
    assert.deepStrictEqual(res.body.data.pending_server_names, ['香港']);
    assert.strictEqual(res.body.data.retry_scheduled, true);
  } finally {
    subscriptionService.replaceSubscriptionLink = original;
  }
}

/** 一小时冷却业务错误必须返回 429、整数 Retry-After 与原中文提示。 */
async function testReplaceCooldownSetsRetryAfter() {
  const original = subscriptionService.replaceSubscriptionLink;
  subscriptionService.replaceSubscriptionLink = async () => {
    throw Object.assign(new Error('一小时内只能更换一次，请稍后再试'), {
      isLegacyBusinessError: true,
      statusCode: 429,
      code: 3004,
      data: null,
      retryAfter: 1837
    });
  };
  try {
    const res = createResponse();
    await subscriptionController.replaceSubscriptionLink(createRequest(), res);
    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(res.headers['Retry-After'], '1837');
    assert.strictEqual(res.body.code, 3004);
    assert.strictEqual(res.body.message, '一小时内只能更换一次，请稍后再试');
  } finally {
    subscriptionService.replaceSubscriptionLink = original;
  }
}

/** 部分远端失败属于成功响应，不得被控制器改写成 500。 */
async function testPartialRemoteFailureStillReturnsSuccess() {
  const original = subscriptionService.replaceSubscriptionLink;
  subscriptionService.replaceSubscriptionLink = async () => ({
    subId: 'partial-token',
    pendingServerIds: [3, 4],
    pendingServerNames: ['美国', '新加坡'],
    retryScheduled: true
  });
  try {
    const res = createResponse();
    await subscriptionController.replaceSubscriptionLink(createRequest(), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.code, 0);
    assert.deepStrictEqual(res.body.data.pending_server_ids, [3, 4]);
    assert.strictEqual(res.body.data.retry_scheduled, true);
  } finally {
    subscriptionService.replaceSubscriptionLink = original;
  }
}

/** 非冷却业务错误保留自身状态码/业务码，且不能误写 Retry-After。 */
async function testRegularBusinessErrorKeepsLegacyResponseWithoutRetryHeader() {
  const original = subscriptionService.replaceSubscriptionLink;
  subscriptionService.replaceSubscriptionLink = async () => {
    throw Object.assign(new Error('订阅状态不可用'), {
      isLegacyBusinessError: true,
      statusCode: 409,
      code: 3002,
      data: { reason: 'inactive' }
    });
  };
  try {
    const res = createResponse();
    await subscriptionController.replaceSubscriptionLink(createRequest(), res);
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.headers['Retry-After'], undefined);
    assert.deepStrictEqual(res.body, {
      code: 3002,
      message: '订阅状态不可用',
      data: { reason: 'inactive' }
    });
  } finally {
    subscriptionService.replaceSubscriptionLink = original;
  }
}

/** 非业务异常继续使用兼容的 500 响应，不能泄露内部错误文本。 */
async function testUnexpectedErrorKeepsGenericInternalResponse() {
  const original = subscriptionService.replaceSubscriptionLink;
  subscriptionService.replaceSubscriptionLink = async () => {
    throw new Error('数据库连接串包含敏感信息');
  };
  try {
    const res = createResponse();
    await subscriptionController.replaceSubscriptionLink(createRequest(), res);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.headers['Retry-After'], undefined);
    assert.deepStrictEqual(res.body, {
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  } finally {
    subscriptionService.replaceSubscriptionLink = original;
  }
}

async function run() {
  await testReplaceReturnsUrlsAndPendingServers();
  await testReplaceCooldownSetsRetryAfter();
  await testPartialRemoteFailureStillReturnsSuccess();
  await testRegularBusinessErrorKeepsLegacyResponseWithoutRetryHeader();
  await testUnexpectedErrorKeepsGenericInternalResponse();
  console.log('user subscription controller tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

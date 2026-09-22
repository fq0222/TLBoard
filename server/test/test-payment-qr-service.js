/**
 * 收款码安全边界回归：仅使用内存图片和固定测试密钥，不连接数据库或支付平台。
 * 覆盖认证加密、协议白名单、恶意输入以及真实图片上的多码拒绝。
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const PaymentQrService = require('../services/shared/payment-qr-service');
const sharp = require('sharp');
const QRCode = require('qrcode');
const { prepareZXingModule } = require('zxing-wasm/reader');

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
const PAYLOAD = 'wxp://f2f/example';

/** 创建独立实例；options 仅替换需要隔离的解码边界。 */
function createService(options = {}) {
  return new PaymentQrService({ encryptionKey: TEST_KEY, ...options });
}

/** 验证业务错误不泄露载荷，所有非法上传均应在返回可存储结果前失败。 */
function isSafeError(error) {
  assert.equal(error.status, 400);
  assert.ok(!error.message.includes(PAYLOAD));
  return true;
}

test('AES-GCM 往返、随机 IV 与稳定摘要', async () => {
  const service = createService();
  const first = service.encryptPayload(PAYLOAD);
  const second = service.encryptPayload(PAYLOAD);
  assert.notEqual(first, second);
  assert.match(first, /^v1\.[^.]+\.[^.]+\.[^.]+$/);
  assert.ok(!first.includes(PAYLOAD));
  assert.equal(service.decryptPayload(first), PAYLOAD);
  const png = await QRCode.toBuffer(PAYLOAD);
  const parsed = await service.parseAndEncrypt(png, 'wechat');
  assert.deepEqual(Object.keys(parsed).sort(), ['digest', 'encryptedPayload']);
  assert.equal(parsed.digest, crypto.createHash('sha256').update(PAYLOAD).digest('hex'));
  assert.equal(service.decryptPayload(parsed.encryptedPayload), PAYLOAD);
});

test('认证标签、IV、密文和版本篡改均拒绝且无明文错误', () => {
  const service = createService();
  const encrypted = service.encryptPayload(PAYLOAD);
  for (const index of [1, 2, 3]) {
    const parts = encrypted.split('.');
    const bytes = Buffer.from(parts[index], 'base64');
    bytes[0] ^= 1;
    parts[index] = bytes.toString('base64');
    assert.throws(() => service.decryptPayload(parts.join('.')), isSafeError);
  }
  for (const value of [null, '', encrypted.replace('v1.', 'v2.'), 'v1.YQ==.YQ==.YQ==', encrypted + '.extra']) {
    assert.throws(() => service.decryptPayload(value), isSafeError);
  }
  assert.throws(() => createService({ encryptionKey: Buffer.alloc(32, 8).toString('base64') }).decryptPayload(encrypted), isSafeError);
});

test('缺失、非规范 Base64 或非 32 字节密钥拒绝', () => {
  for (const encryptionKey of ['', 'secret', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), TEST_KEY + '!']) {
    assert.throws(() => createService({ encryptionKey }), /密钥/);
  }
  const previous = process.env.WITHDRAWAL_QR_ENCRYPTION_KEY;
  try {
    delete process.env.WITHDRAWAL_QR_ENCRYPTION_KEY;
    assert.throws(() => new PaymentQrService(), /密钥/);
    process.env.WITHDRAWAL_QR_ENCRYPTION_KEY = TEST_KEY;
    assert.equal(new PaymentQrService().decryptPayload(createService().encryptPayload(PAYLOAD)), PAYLOAD);
  } finally {
    if (previous === undefined) delete process.env.WITHDRAWAL_QR_ENCRYPTION_KEY;
    else process.env.WITHDRAWAL_QR_ENCRYPTION_KEY = previous;
  }
});

test('仅批准的微信与支付宝白名单通过，域名伪造与跨平台拒绝', () => {
  const service = createService();
  for (const payload of [PAYLOAD, 'WXP://f2f/example', 'weixin://wxpay/example', 'WEIXIN://WXPAY/example']) {
    assert.doesNotThrow(() => service.validatePaymentPayload(payload, 'wechat'));
    assert.throws(() => service.validatePaymentPayload(payload, 'alipay'), isSafeError);
  }
  for (const payload of ['https://qr.alipay.com/example', 'HTTPS://QR.ALIPAY.COM/example']) {
    assert.doesNotThrow(() => service.validatePaymentPayload(payload, 'alipay'));
    assert.throws(() => service.validatePaymentPayload(payload, 'wechat'), isSafeError);
  }
  for (const payload of ['', 'wxp://', 'weixin://wxpay/', 'weixin://wxpayevil/a', 'https://example.com',
    'https://payapp.weixin.qq.com/qr/a', 'http://qr.alipay.com/a', 'https://qr.alipay.com.evil/a',
    'https://qr.alipay.com@evil.com/a', 'https://evil@qr.alipay.com/a', 'https://qr.alipay.com/',
    'https://qr.alipay.com', 'https://qr.alipay.com:444/a', 'https://qr.alipay.com/../',
    'https://qr.alipay.com\\evil/a', ' wxp://f2f/example', 'wxp://a\n', 'wxp://' + 'x'.repeat(2048)]) {
    for (const platform of ['wechat', 'alipay']) {
      assert.throws(() => service.validatePaymentPayload(payload, platform), isSafeError);
    }
  }
  assert.throws(() => service.validatePaymentPayload(PAYLOAD, 'bank'), isSafeError);
});

test('无效文件、超限字节、像素炸弹及伪造 MIME 拒绝', async () => {
  const service = createService();
  for (const buffer of [null, 'png', Buffer.alloc(0), Buffer.alloc(5 * 1024 * 1024 + 1), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"></svg>'), Buffer.from('not an image')]) {
    await assert.rejects(service.parseAndEncrypt(buffer, 'wechat'), isSafeError);
  }
  const bomb = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(service.parseAndEncrypt(bomb, 'wechat'), isSafeError);
});

test('注入解码边界的空结果、多结果、损坏元数据和依赖异常安全拒绝', async () => {
  const png = await QRCode.toBuffer(PAYLOAD);
  const pixels = { data: Buffer.alloc(16), width: 2, height: 2, format: 'png', pages: 1 };
  for (const results of [[], [{ text: PAYLOAD }, { text: 'wxp://second' }], [{ text: PAYLOAD }, { text: PAYLOAD }], null, [null], [{}], [{ text: PAYLOAD, error: 'decode failure' }]]) {
    const service = createService({ imageDecoder: async () => pixels, qrDecoder: async () => results });
    let encrypted = false;
    service.encryptPayload = () => { encrypted = true; throw new Error('should not encrypt'); };
    await assert.rejects(service.parseAndEncrypt(png, 'wechat'), isSafeError);
    assert.equal(encrypted, false);
  }
  for (const decoded of [{ ...pixels, width: 100000 }, { ...pixels, format: 'svg' }, { ...pixels, pages: 2 }, { ...pixels, data: Buffer.alloc(1) }]) {
    await assert.rejects(createService({ imageDecoder: async () => decoded }).parseAndEncrypt(png, 'wechat'), isSafeError);
  }
  for (const key of ['imageDecoder', 'qrDecoder']) {
    await assert.rejects(createService({ [key]: async () => { throw new Error(PAYLOAD); } }).parseAndEncrypt(png, 'wechat'), isSafeError);
  }
});

test('真实 PNG 无码拒绝，双码（不同与相同内容）均拒绝', async () => {
  const service = createService();
  const first = await QRCode.toBuffer(PAYLOAD, { width: 240, margin: 4 });
  const blank = await sharp({ create: { width: 560, height: 280, channels: 4, background: '#fff' } }).png().toBuffer();
  await assert.rejects(service.parseAndEncrypt(blank, 'wechat'), isSafeError);
  for (const secondPayload of ['https://qr.alipay.com/second', PAYLOAD]) {
    const second = await QRCode.toBuffer(secondPayload, { width: 240, margin: 4 });
    const combined = await sharp(blank).composite([{ input: first, left: 20, top: 20 }, { input: second, left: 300, top: 20 }]).png().toBuffer();
    await assert.rejects(service.parseAndEncrypt(combined, 'wechat'), error => {
      isSafeError(error);
      assert.match(error.message, /一个二维码/);
      return true;
    });
  }
});

test('重建 PNG 可再次解析且不泄露注入编码器错误', async () => {
  const service = createService();
  const result = await service.renderQrPng(service.encryptPayload(PAYLOAD));
  assert.ok(Buffer.isBuffer(result));
  assert.equal((await sharp(result).metadata()).format, 'png');
  assert.equal(service.decryptPayload((await service.parseAndEncrypt(result, 'wechat')).encryptedPayload), PAYLOAD);
  const broken = createService({ qrEncoder: async () => { throw new Error(PAYLOAD); } });
  await assert.rejects(broken.renderQrPng(service.encryptPayload(PAYLOAD)), error => !error.message.includes(PAYLOAD));
});

test('连续 50 次真实解码及读取异常均释放 WASM 结果向量和输入内存', async context => {
  const wasm = await prepareZXingModule({ fireImmediately: true });
  const originalRead = wasm.readBarcodesFromPixmap;
  const originalMalloc = wasm._malloc;
  const originalFree = wasm._free;
  const vectors = [];
  let allocated = 0;
  let deleted = 0;
  let failureMode;
  const outstanding = new Set();
  // 包装真实 WASM 边界，仅计数；不替代解码结果，以观察实际资源生命周期。
  wasm.readBarcodesFromPixmap = function (...args) {
    if (failureMode === 'read') throw new Error('模拟底层解码异常');
    const vector = originalRead.apply(this, args);
    const originalDelete = vector.delete.bind(vector);
    allocated++;
    vectors.push(vector);
    vector.delete = () => { deleted++; return originalDelete(); };
    if (failureMode === 'get') vector.get = () => { throw new Error('模拟结果复制异常'); };
    return vector;
  };
  wasm._malloc = function (size) {
    const pointer = originalMalloc.call(this, size);
    if (pointer) outstanding.add(pointer);
    return pointer;
  };
  wasm._free = function (pointer) {
    outstanding.delete(pointer);
    return originalFree.call(this, pointer);
  };
  try {
    const service = createService();
    const png = await QRCode.toBuffer(PAYLOAD);
    for (let index = 0; index < 50; index++) await service.parseAndEncrypt(png, 'wechat');
    assert.equal(allocated, 50);
    assert.equal(deleted, allocated, `WASM vectors allocated=${allocated}, deleted=${deleted}`);
    assert.equal(outstanding.size, 0, 'WASM 输入缓冲区必须全部释放');
    context.diagnostic(`真实解码: allocated=${allocated}, deleted=${deleted}, outstandingInputs=${outstanding.size}`);
    for (const mode of ['get', 'read']) {
      failureMode = mode;
      await assert.rejects(service.parseAndEncrypt(png, 'wechat'), isSafeError);
      assert.equal(deleted, allocated, `${mode} 异常必须释放所有结果向量`);
      assert.equal(outstanding.size, 0, `${mode} 异常必须释放输入内存`);
    }
    context.diagnostic(`异常回收: allocated=${allocated}, deleted=${deleted}, outstandingInputs=${outstanding.size}`);
  } finally {
    wasm.readBarcodesFromPixmap = originalRead;
    wasm._malloc = originalMalloc;
    wasm._free = originalFree;
    // RED 阶段也回收探针发现的泄漏，避免测试自身留下 WASM 资源。
    for (const vector of vectors) if (!vector.isDeleted()) vector.delete();
    for (const pointer of outstanding) originalFree(pointer);
  }
});

/**
 * 收款二维码安全服务：内存解码、平台校验、认证加密及按需重建 PNG。
 * 原图与明文只在当前调用内使用；持久化调用方仅接收密文和 SHA-256 摘要。
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const sharp = require('sharp');
const QRCode = require('qrcode');
const { prepareZXingModule, defaultReaderOptions, barcodeFormats, binarizers, eanAddOnSymbols, textModes, characterSets } = require('zxing-wasm/reader');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 12 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 2048;
const IMAGE_FORMATS = new Set(['png', 'jpeg', 'webp']);

// WASM 从已安装依赖读取，避免运行时向 CDN 请求或发送图片内容。
prepareZXingModule({
  overrides: { wasmBinary: fs.readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) }
});

class PaymentQrService {
  /**
   * @param {Object} options - 测试或运行时依赖；密钥为严格 Base64 编码的 32 字节值。
   * 缺失环境密钥立即失败，绝不回退到开发用密钥。
   */
  constructor({ encryptionKey = process.env.WITHDRAWAL_QR_ENCRYPTION_KEY, imageDecoder, qrDecoder, qrEncoder } = {}) {
    try {
      this.encryptionKey = this.decodeBase64(encryptionKey);
      if (this.encryptionKey.length !== 32) throw new Error();
    } catch {
      throw new Error('收款码加密密钥未配置或格式错误，必须为 Base64 编码的 32 字节密钥');
    }
    this.imageDecoder = imageDecoder || this.decodeImage.bind(this);
    this.qrDecoder = qrDecoder || this.decodeQr.bind(this);
    this.qrEncoder = qrEncoder || (payload => QRCode.toBuffer(payload, { type: 'png', errorCorrectionLevel: 'M', margin: 4, width: 512 }));
  }

  /** 生成不包含输入内容的业务错误；message 必须为服务内部固定文案。 */
  badRequest(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
  }

  /** 严格解析规范 Base64，拒绝 Node 宽松解码会忽略的垃圾字符。 */
  decodeBase64(value) {
    if (typeof value !== 'string' || !value.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      throw new Error('无效编码');
    }
    const decoded = Buffer.from(value, 'base64');
    if (decoded.toString('base64') !== value) throw new Error('无效编码');
    return decoded;
  }

  /** 校验图片元数据；拒绝未知格式、多帧及像素超限，防止压缩图片耗尽内存。 */
  validateImageInfo({ width, height, format, pages = 1 } = {}) {
    if (!IMAGE_FORMATS.has(format) || pages !== 1 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width < 1 || height < 1 || width * height > MAX_IMAGE_PIXELS) {
      throw this.badRequest('图片格式或尺寸不受支持');
    }
  }

  /** buffer 仅在内存中交给 Sharp；先识别真实格式和尺寸，再解压为 RGBA。 */
  async decodeImage(buffer) {
    const source = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
    const metadata = await source.metadata();
    this.validateImageInfo(metadata);
    const { data, info } = await source.rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, format: metadata.format, pages: metadata.pages || 1 };
  }

  /**
   * 枚举图片内所有 QR，不按内容去重；相同内容出现两次也必须拒绝。
   * 固定 zxing-wasm 2.1.2 的底层 RGBA API，绕过其未释放结果向量的包装方法。
   * 仅复制需要的标量字段，finally 无论成功、识别失败或复制异常均释放向量及输入。
   */
  async decodeQr({ data, width, height }) {
    const wasm = await prepareZXingModule({ fireImmediately: true });
    const pointer = wasm._malloc(data.byteLength);
    if (!pointer) throw new Error('二维码解码内存分配失败');
    let results;
    try {
      wasm.HEAPU8.set(data, pointer);
      results = wasm.readBarcodesFromPixmap(pointer, width, height, {
        ...defaultReaderOptions,
        formats: 1 << barcodeFormats.indexOf('QRCode'),
        binarizer: binarizers.indexOf('LocalAverage'),
        eanAddOnSymbol: eanAddOnSymbols.indexOf('Ignore'),
        textMode: textModes.indexOf('Plain'),
        characterSet: characterSets.indexOf('Unknown'),
        tryHarder: true,
        maxNumberOfSymbols: 255,
        returnErrors: true
      });
      const decoded = [];
      for (let index = 0; index < results.size(); index++) {
        const result = results.get(index);
        decoded.push({ text: result.text, error: result.error, isValid: result.isValid });
      }
      return decoded;
    } finally {
      try {
        if (results) results.delete();
      } finally {
        wasm._free(pointer);
      }
    }
  }

  /**
   * @param {string} payload - 解出的支付载荷，最多 2048 UTF-8 字节，禁止空白/控制字符。
   * @param {'wechat'|'alipay'} paymentType - 平台白名单；URL 验证仅解析字符串，不访问网络。
   */
  validatePaymentPayload(payload, paymentType) {
    if (typeof payload !== 'string' || !payload.length || Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES
      || /[\s\x00-\x1f\x7f\\]/u.test(payload)) {
      throw this.badRequest('收款码内容不受支持');
    }
    if (paymentType === 'wechat' && (/^wxp:\/\/.+$/i.test(payload) || /^weixin:\/\/wxpay\/.+$/i.test(payload))) return;
    if (paymentType === 'alipay') {
      try {
        const url = new URL(payload);
        if (/^https:\/\//i.test(payload) && url.protocol === 'https:' && url.hostname === 'qr.alipay.com'
          && !url.username && !url.password && !url.port && url.pathname.length > 1) return;
      } catch {
        // URL 解析失败使用统一业务错误，不向外传播可能包含载荷的原始异常。
      }
    }
    throw this.badRequest('收款码平台或协议不受支持');
  }

  /** 对 buffer 完成全部安全校验后才加密，返回值始终仅包含密文与摘要。 */
  async parseAndEncrypt(buffer, paymentType) {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      throw this.badRequest('请上传不超过 5 MB 的有效收款码图片');
    }
    let results;
    try {
      const decoded = await this.imageDecoder(buffer);
      this.validateImageInfo(decoded);
      if (!(decoded.data instanceof Uint8Array) || decoded.data.length !== decoded.width * decoded.height * 4) {
        throw new Error('无效像素数据');
      }
      results = await this.qrDecoder(decoded);
    } catch {
      throw this.badRequest('图片无法解析或格式尺寸不受支持');
    }
    if (!Array.isArray(results) || results.length !== 1) {
      throw this.badRequest('图片中必须恰好包含一个二维码');
    }
    if (!results[0] || typeof results[0] !== 'object' || results[0].error || results[0].isValid === false) {
      throw this.badRequest('二维码无法识别');
    }
    const payload = results[0].text;
    this.validatePaymentPayload(payload, paymentType);
    return { encryptedPayload: this.encryptPayload(payload), digest: crypto.createHash('sha256').update(payload, 'utf8').digest('hex') };
  }

  /** AES-256-GCM 使用随机 12 字节 IV；输出 v1.iv.tag.ciphertext 便于后续格式迁移。 */
  encryptPayload(payload) {
    if (typeof payload !== 'string' || !payload.length || Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) {
      throw this.badRequest('收款码内容不受支持');
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
  }

  /** 验证版本、编码、IV 和认证标签；认证失败时不返回部分明文，也不传播输入。 */
  decryptPayload(value) {
    try {
      if (typeof value !== 'string' || value.length > 4096) throw new Error();
      const parts = value.split('.');
      if (parts.length !== 4 || parts[0] !== 'v1') throw new Error();
      const [iv, tag, encrypted] = parts.slice(1).map(part => this.decodeBase64(part));
      if (iv.length !== 12 || tag.length !== 16 || encrypted.length > MAX_PAYLOAD_BYTES) throw new Error();
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      throw this.badRequest('收款码密文无效或认证失败');
    }
  }

  /** 只对已认证解密的内容生成内存 PNG Buffer，调用方负责权限验证及响应防缓存。 */
  async renderQrPng(encryptedPayload) {
    const payload = this.decryptPayload(encryptedPayload);
    try {
      const png = await this.qrEncoder(payload);
      if (!Buffer.isBuffer(png) || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error();
      return png;
    } catch {
      throw new Error('收款码图片生成失败');
    }
  }
}

module.exports = PaymentQrService;

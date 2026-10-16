/**
 * 用户 Passkey 管理服务。
 * 职责：编排密码复验、注册选项、一次性挑战、真实证明验证、列表及用户撤销。
 * 安全边界：来源只读取部署配置；公开密钥记录只包含四项元数据，协议细节不得记录日志。
 */
const bcrypt = require('bcrypt');
const config = require('../../config');
const PasskeyRepository = require('../../repositories/passkey-repository');
const PasskeyConfig = require('../shared/passkey-config');
const authService = require('./auth-service');

let webauthnModule;

/** 创建兼容现有 controller 的业务异常；code 为数字业务码，statusCode 为 HTTP 状态。 */
function businessError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = statusCode;
  error.code = code;
  error.data = null;
  return error;
}

/** 将内部数据库异常映射为安全业务错误；未知异常保留给统一错误处理器。 */
function mapRepositoryError(error) {
  if (error.code === 'USER_NOT_FOUND') return businessError('用户不存在', 2108, 404);
  if (error.code === 'PASSKEY_LIMIT_REACHED') return businessError('每个用户最多绑定两个 Passkey', 2103);
  if (error.code === '23505') return businessError('该 Passkey 已经绑定', 2106, 409);
  return error;
}

/** 规范化用户展示名称；name 为空时交由仓储在持锁事务内生成，非字符串及超过 50 字符拒绝。 */
function normalizeName(name) {
  if (name === null || name === undefined) return '';
  if (typeof name !== 'string') throw businessError('Passkey 名称必须为不超过 50 个字符的文本', 2102);
  const normalized = name.trim();
  if (Array.from(normalized).length > 50) throw businessError('Passkey 名称最长 50 个字符', 2102);
  return normalized;
}

/** 提取对外密钥元数据；row 为仓储记录，禁止透传归属、凭据或公钥字段。 */
function publicMetadata(row) {
  return { id: row.id, name: row.name, created_at: row.created_at, last_used_at: row.last_used_at };
}

class PasskeyService {
  /** 保存 db、可选 webauthn 和秒级 now 依赖；挑战有效性仍由仓储数据库时钟裁定。 */
  constructor({ db, webauthn, now = () => Math.floor(Date.now() / 1000) }) {
    PasskeyConfig.assertAvailable();
    this.repository = new PasskeyRepository(db);
    this.webauthn = webauthn;
    this.now = now;
  }

  /** 获取注入验证器或缓存的 ESM 模块；动态导入兼容当前 CommonJS 服务。 */
  async getWebauthn() {
    if (this.webauthn) return this.webauthn;
    if (!webauthnModule) webauthnModule = import('@simplewebauthn/server');
    return webauthnModule;
  }

  /**
   * 发起无用户名认证；无请求参数，RP 配置只读取部署配置。
   * 核心分支：不发送 allowCredentials，要求用户验证，保存匿名 120 秒一次性挑战。
   */
  async createAuthenticationOptions() {
    const webauthn = await this.getWebauthn();
    const options = await webauthn.generateAuthenticationOptions({
      rpID: config.webauthn.rpId,
      timeout: config.webauthn.challengeTtlSeconds * 1000,
      userVerification: 'required'
    });
    // 部分版本会默认输出空数组；省略字段让浏览器自行发现已有 Passkey。
    delete options.allowCredentials;
    const challenge = await this.repository.createChallenge({ type: 'authentication', userId: null, challenge: options.challenge });
    return { ceremony_id: challenge.id, options };
  }

  /**
   * 验证 payload.ceremony_id/response 并签发共享登录结果。
   * 核心分支：先一次性消费匿名挑战；查凭据、验证签名/UV/handle，账号检查后以旧计数器 CAS 更新。
   * 未知、撤销、过期、重放及验证失败均返回同一错误；合法同步凭据允许计数器保持 0。
   */
  async verifyAuthentication(payload = {}) {
    const failure = () => businessError('Passkey 登录失败，请重试或使用密码登录', 2109, 401);
    if (typeof payload.ceremony_id !== 'string' || !payload.ceremony_id) throw failure();
    const challenge = await this.repository.consumeChallenge({ id: payload.ceremony_id, type: 'authentication', userId: null });
    if (!challenge || typeof payload.response?.id !== 'string' || !payload.response.id) throw failure();
    const credential = await this.repository.findCredentialForAuthentication(payload.response.id);
    if (!credential || !credential.user) throw failure();
    const handle = payload.response.response?.userHandle;
    if (handle && handle !== credential.user.webauthn_user_id) throw failure();
    const webauthn = await this.getWebauthn();
    let verification;
    try {
      verification = await webauthn.verifyAuthenticationResponse({
        response: payload.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.webauthn.origin,
        expectedRPID: config.webauthn.rpId,
        requireUserVerification: true,
        credential: { id: credential.credential_id, publicKey: new Uint8Array(credential.public_key),
          counter: Number(credential.counter), transports: credential.transports || [] }
      });
    } catch (error) {
      // 验证器错误可能包含协议内容，禁止透传或记录该异常。
      throw failure();
    }
    if (!verification.verified || !verification.authenticationInfo) throw failure();
    authService.assertUserCanLogin(credential.user);
    const updated = await this.repository.updateAuthenticationState({ passkeyId: credential.id,
      expectedCounter: credential.counter, counter: verification.authenticationInfo.newCounter,
      backedUp: verification.authenticationInfo.credentialBackedUp });
    if (!updated) throw failure();
    return authService.issueLoginResult(credential.user);
  }

  /** 复验 userId 当前密码；password 缺失或错误均拒绝，查询结果仅供内部生成选项。 */
  async verifyPassword(userId, password) {
    const user = await this.repository.findUserForRegistration(userId);
    if (!user) throw businessError('用户不存在', 2108, 404);
    if (typeof password !== 'string' || !password || !await bcrypt.compare(password, user.password_hash)) {
      throw businessError('当前密码错误', 2101);
    }
    return user;
  }

  /** 返回 userId 的公开密钥列表、固定上限和剩余名额；内部字段始终显式剔除。 */
  async listForUser(userId) {
    const rows = await this.repository.listUserPasskeys(userId);
    const limit = config.webauthn.maxPasskeys;
    return { list: rows.map(publicMetadata), limit, remaining: Math.max(0, limit - rows.length) };
  }

  /**
   * 为 userId 发起注册；payload 为 password/name，返回 ceremony_id/options。
   * 核心分支：先复验密码和名称/名额，再生成稳定 handle、固定安全选项及 120 秒挑战。
   */
  async createRegistrationOptions(userId, payload = {}) {
    const user = await this.verifyPassword(userId, payload.password);
    normalizeName(payload.name);
    const credentials = await this.repository.listCredentialsForRegistration(userId);
    if (credentials.length >= config.webauthn.maxPasskeys) throw businessError('每个用户最多绑定两个 Passkey', 2103);
    try {
      const handle = await this.repository.getOrCreateUserHandle(userId);
      const webauthn = await this.getWebauthn();
      const options = await webauthn.generateRegistrationOptions({
        rpName: config.webauthn.rpName,
        rpID: config.webauthn.rpId,
        userName: user.email,
        userID: Buffer.from(handle, 'base64url'),
        timeout: config.webauthn.challengeTtlSeconds * 1000,
        attestationType: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        excludeCredentials: credentials.map(row => ({ id: row.credential_id, transports: row.transports || [] }))
      });
      const challenge = await this.repository.createChallenge({ type: 'registration', userId, challenge: options.challenge });
      return { ceremony_id: challenge.id, options };
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  /**
   * 完成 userId 注册；payload 为 ceremony_id/response/name，返回安全元数据。
   * 核心分支：先原子消费挑战，任何后续失败均不可重用；名称重新校验，最终名额由仓储事务锁保证。
   */
  async verifyRegistration(userId, payload = {}) {
    if (typeof payload.ceremony_id !== 'string' || !payload.ceremony_id) {
      throw businessError('注册挑战无效或已过期，请重新发起', 2104);
    }
    const challenge = await this.repository.consumeChallenge({ id: payload.ceremony_id, type: 'registration', userId });
    if (!challenge) throw businessError('注册挑战无效或已过期，请重新发起', 2104);
    const name = normalizeName(payload.name);
    let verification;
    const webauthn = await this.getWebauthn();
    try {
      verification = await webauthn.verifyRegistrationResponse({
        response: payload.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.webauthn.origin,
        expectedRPID: config.webauthn.rpId,
        requireUserVerification: true
      });
    } catch (error) {
      // 验证器错误可能包含挑战或响应片段；只对外返回固定业务文案。
      throw businessError('Passkey 验证失败，请重新发起注册', 2105);
    }
    if (!verification.verified || !verification.registrationInfo) {
      throw businessError('Passkey 验证失败，请重新发起注册', 2105);
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    try {
      const row = await this.repository.insertCredentialWithinLimit({ userId, name,
        credentialId: credential.id, publicKey: credential.publicKey, counter: credential.counter,
        transports: credential.transports || [], deviceType: credentialDeviceType, backedUp: credentialBackedUp });
      return publicMetadata(row);
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  /** 撤销 userId 拥有的 passkeyId；password 重新复验，归属不符或不存在返回同一安全错误。 */
  async deleteForUser(userId, passkeyId, password) {
    await this.verifyPassword(userId, password);
    const deleted = await this.repository.deleteOwnedCredential(userId, passkeyId);
    if (!deleted) throw businessError('Passkey 不存在', 2107, 404);
    return publicMetadata(deleted);
  }
}

module.exports = PasskeyService;

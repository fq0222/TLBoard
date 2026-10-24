/**
 * 服务器级凭证生成服务：轮换和首次同步共用服务器事务锁与三字段碰撞检查。
 * 凭证只返回调用方供本地事务写入，不记录日志或写入任务 payload。
 */
const crypto = require('crypto');
const rotationRepository = require('../../repositories/subscription-credential-rotation-repository');
const { generateXuiAuth, isValidXuiAuth } = require('../../utils/xui-auth');
const { resolveServerClientCredentials } = require('./xui-credential-resolver');

class XuiServerCredentialService {
  /** repository 负责事务 SQL，generators 提供三个同步随机生成器以便确定性测试。 */
  constructor({ repository = rotationRepository, generators = {} } = {}) {
    this.repository = repository;
    this.generators = {
      uuid: () => crypto.randomUUID(),
      password: () => crypto.randomBytes(8).toString('hex'),
      auth: () => generateXuiAuth(),
      subId: () => crypto.randomBytes(8).toString('hex'),
      ...generators
    };
  }

  /** 在给定专用事务连接上获取服务器锁，锁的生命周期由调用方 COMMIT/ROLLBACK 控制。 */
  async lockServerCredentials(client, serverId) {
    await this.repository.lockServerCredentials(client, serverId);
  }

  /**
   * 生成同服务器其他用户未使用的三字段；轮换默认全量生成，任一碰撞整组重生。
   * @param {Object} client - 已开启事务的 PostgreSQL 专用连接。
   * @param {number} serverId - 唯一性作用域；userId 排除本用户各 inbound 的重复凭证。
   * @param {number} userId - 当前用户 ID。
   * @param {Object} options - 修复时可提供 preservedCredentials 保留合法字段，仅生成并检查其余字段。
   */
  async generateUniqueCredentials(client, serverId, userId, options = {}) {
    await this.lockServerCredentials(client, serverId);
    const preserved = options.preservedCredentials || {};
    const generatedFields = ['uuid', 'password', 'auth'].filter(field => !preserved[field]);
    for (let attempt = 0; attempt < 100; attempt++) {
      const credentials = {
        uuid: preserved.uuid || this.generators.uuid(),
        password: preserved.password || this.generators.password(),
        auth: preserved.auth || this.generators.auth()
      };
      // 修复不改变合法旧字段；仅新生成字段参与唯一检查，碰撞时重生本轮全部待修复字段。
      const candidates = Object.fromEntries(generatedFields.map(field => [field, credentials[field]]));
      if (!await this.repository.findCredentialCollision(client, serverId, userId, candidates)) return credentials;
    }
    // 防御异常随机源或数据库持续冲突；错误不包含候选值。
    throw new Error('无法生成唯一服务器凭证，请稍后重试');
  }

  /**
   * 修复锁内重读的 canonical 本地配置，只为空 uuid/password 或非法 auth 生成新值。
   * client/serverId/userId 指定事务和唯一性范围；全部合法时直接复用，不消耗随机源。
   */
  async repairLocalCredentials(client, serverId, userId, local) {
    const preserved = {
      uuid: String(local.uuid || '').trim(),
      password: String(local.password || '').trim(),
      auth: isValidXuiAuth(local.auth) ? local.auth : ''
    };
    if (preserved.uuid && preserved.password && preserved.auth) return preserved;
    return this.generateUniqueCredentials(client, serverId, userId, { preservedCredentials: preserved });
  }

  /**
   * 首次建档在同一锁内收编合法远端凭证；缺字段或碰撞时统一使用共享生成入口。
   * user 提供 id/email 校验远端归属，overrideSubId 仅用于现有内部 ID 冲突恢复。
   */
  async resolveInitialCredentials(client, serverId, user, remoteClient = null, overrideSubId = '') {
    await this.lockServerCredentials(client, serverId);
    if (remoteClient && String(remoteClient.email || '').trim().toLowerCase() !== String(user.email || '').trim().toLowerCase()) {
      throw new Error('远端 client 与本地用户 email 不一致，禁止收编');
    }
    const remote = remoteClient || {};
    const complete = String(remote.uuid || remote.id || '').trim() && String(remote.password || '').trim() && isValidXuiAuth(remote.auth);
    const fallback = complete ? null : await this.generateUniqueCredentials(client, serverId, user.id);
    const credentials = resolveServerClientCredentials({
      remoteClient,
      expectedEmail: user.email,
      overrideSubId,
      generators: {
        uuid: () => fallback.uuid,
        password: () => fallback.password,
        auth: () => fallback.auth,
        subId: this.generators.subId
      }
    });
    if (await this.repository.findCredentialCollision(client, serverId, user.id, credentials)) {
      Object.assign(credentials, await this.generateUniqueCredentials(client, serverId, user.id));
    }
    return { uuid: credentials.uuid, password: credentials.password, auth: credentials.auth, subId: credentials.subId };
  }
}

const defaultService = new XuiServerCredentialService();

/** 函数式入口：client/serverId/userId 指定事务与唯一范围；碰撞重试仍由同一服务类维护。 */
async function generateUniqueServerCredentials(client, serverId, userId) {
  return defaultService.generateUniqueCredentials(client, serverId, userId);
}

module.exports = { XuiServerCredentialService, generateUniqueServerCredentials };

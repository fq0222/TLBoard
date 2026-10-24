/**
 * 用户订阅凭证本地轮换：原子提交公开 token、服务器凭证、旧缓存基线和补偿任务。
 * 本地事务提交后逐台同步远端，成功服务器通过独立来源刷新渐进替换缓存。
 */
const crypto = require('crypto');
const rotationRepository = require('../../repositories/subscription-credential-rotation-repository');
const { XuiServerCredentialService } = require('../shared/xui-server-credential-service');
const { generatePublicSubscriptionId } = require('../../utils/subscription-id');
const { createLogger } = require('../../utils/logger');
const XuiService = require('../../integrations/xui/xui-service');
const xuiSyncRepository = require('../../repositories/xui-sync-repository');
const { normalizeInboundSnapshot } = require('../shared/xui-node-snapshot-service');
const { getStrategyFromRemark } = require('../shared/subscription-strategy');
const { runWithConcurrency } = require('../../utils/concurrency');

/**
 * 为当前 inbound 集合选择 canonical 配置；优先 active inbound，只有 active 全缺失时才回退历史行。
 * @param {Array<Object>} configs - 同一用户、服务器的全部本地配置，调用方应保持稳定排序。
 * @param {number[]} inboundIds - 本次服务器快照中的 active inbound ID。
 * @returns {Object|null} 用于复用凭证与 sub_id 的配置，全部缺失时返回 null。
 */
function selectCanonicalServerConfig(configs, inboundIds) {
  const activeIds = new Set((inboundIds || []).map(Number));
  return (configs || []).find(config => activeIds.has(Number(config.inbound_id))) || configs?.[0] || null;
}

class SubscriptionCredentialRotationService {
  /** repository/随机生成器/时钟均显式注入；默认使用生产仓储和密码学随机源。 */
  constructor({ repository = rotationRepository, generators = {}, nowSeconds = () => Date.now() / 1000,
    credentialService, logger = createLogger('SUBSCRIPTION-ROTATION'), getXuiService,
    withServerClientLock = xuiSyncRepository.withServerClientLock, refreshAndMergeRotatedServers } = {}) {
    this.repository = repository;
    this.generators = {
      publicToken: generatePublicSubscriptionId,
      subId: () => crypto.randomBytes(8).toString('hex'),
      ...generators
    };
    this.nowSeconds = nowSeconds;
    this.credentialService = credentialService || new XuiServerCredentialService({ repository, generators });
    this.logger = logger;
    this.getXuiService = getXuiService || (server => XuiService.getInstance(server.api_url, server.api_token, { apiVersion: server.panel_version }));
    this.withServerClientLock = withServerClientLock;
    // 延迟加载避免后续 API 集成订阅服务时形成循环依赖。
    this.refreshAndMergeRotatedServers = refreshAndMergeRotatedServers
      || ((...args) => require('./subscription-service').refreshAndMergeRotatedServers(...args));
  }

  /**
   * 同步单台 3.4.2+ 服务器；userId/serverId 每次从数据库重读，任何失败均返回脱敏结果。
   * 缺快照可远端只读获取，但用户行锁→凭证锁事务先提交配置，再调用远端 client API。
   */
  async syncServerWithLatestCredentials(db, userId, serverId, logger = this.logger) {
    let userEmail = '';
    try {
      const initial = await this.repository.withRotationTransaction(db, userId, async (client, user) => ({
        ...await this.repository.findServerState(client, serverId), email: user.email
      }));
      userEmail = initial.email;
      if (!initial.server || !rotationRepository.supportsCredentialRotation(initial.server.panel_version)) {
        throw new Error('不支持的服务器配置');
      }
      const xui = await this.getXuiService(initial.server);
      let fetchedNodes = [];
      if (initial.nodes.length === 0) {
        const response = await xui.getInbounds({ timeout: 10000 });
        if (!response.success || !Array.isArray(response.data)) throw new Error('读取 inbound 失败');
        fetchedNodes = response.data.map(node => normalizeInboundSnapshot(node));
      }
      // 与通用 client API 共享同一锁，锁内再读最新凭证；不向 upsert 再传 db，避免重入会话锁。
      return await this.withServerClientLock(db, serverId, initial.email, async lockedClient => {
        const latest = await this.repository.withRotationTransaction(db, userId, async (client, user) => {
          await this.credentialService.lockServerCredentials(client, serverId);
          const { server, nodes: currentNodes } = await this.repository.findServerState(client, serverId);
          if (!server || !rotationRepository.supportsCredentialRotation(server.panel_version)) throw new Error('不支持的服务器配置');
          const nodes = currentNodes.length ? currentNodes : fetchedNodes;
          const inboundIds = [...new Set(nodes.map(node => Number(node.inbound_id)))];
          if (!inboundIds.length || inboundIds.some(id => !Number.isInteger(id) || id <= 0)) throw new Error('缺少有效 inbound');
          // 快照清理器持快照锁后可能删除配置；补快照必须在配置写入前取锁，避免锁环。
          if (!currentNodes.length) await this.repository.insertMissingSnapshots(client, serverId, nodes);
          const configs = await this.repository.listServerConfigs(client, userId, serverId);
          const canonical = selectCanonicalServerConfig(configs, inboundIds);
          const credentials = canonical || await this.credentialService.generateUniqueCredentials(client, serverId, userId);
          const subId = canonical?.sub_id || this.generators.subId();
          await this.repository.upsertServerConfigs(client, { userId, serverId, inboundIds, credentials, subId });
          const writtenConfigs = (await this.repository.listServerConfigs(client, userId, serverId))
            .filter(config => inboundIds.includes(Number(config.inbound_id)));
          const serverSubIds = [...new Set(writtenConfigs.map(config => String(config.sub_id || '').trim()))];
          if (serverSubIds.length !== 1 || !serverSubIds[0]) throw new Error('服务器 subId 配置不一致');
          return { user, nodes, inboundIds, credentials, subId: serverSubIds[0],
            credentialRevision: rotationRepository.computeCredentialRevision(writtenConfigs) };
        }, lockedClient);
        const { user, nodes, inboundIds, credentials, subId } = latest;
        const existingRemote = await xui.getServerClientByEmail(user.email);
        if (existingRemote.status === 'error') throw new Error('读取远端客户端失败');
        const remoteClient = { id: credentials.uuid, password: credentials.password, auth: credentials.auth,
          email: user.email, enable: [true, 1, '1'].includes(user.enabled), expiryTime: Number(user.expire_at) * 1000 || 0,
          totalGB: Number(user.traffic_limit) || 0, limitIp: 0, tgId: 0, subId };
        if (existingRemote.status === 'found') {
          if (existingRemote.client?.flow) remoteClient.flow = existingRemote.client.flow;
        } else {
          const strategies = new Set(nodes.map(node => getStrategyFromRemark(node.remark)));
          const hasDirect = strategies.has('direct');
          if (hasDirect && strategies.size > 1) throw new Error('混合节点策略无法初始化服务器级 flow');
          if (hasDirect) remoteClient.flow = 'xtls-rprx-vision';
        }
        const result = await xui.upsertServerClient({ serverId, email: user.email, inboundIds, client: remoteClient });
        if (!result.success) throw new Error('远端更新失败');
        logger?.info?.(
          `凭证轮换远端同步成功: user=${userId}, email=${user.email}, `
          + `server=${serverId}, phase=remote, action=${result.action || 'upsert'}`
        );
        // 指纹只返回当前进程编排调用方，禁止转存任务 payload 或记录日志。
        return { success: true, message: '服务器凭证同步成功', credentialRevision: latest.credentialRevision };
      });
    } catch (error) {
      logger?.warn?.(
        `凭证轮换远端同步失败: user=${userId}, email=${userEmail || 'unknown'}, `
        + `server=${serverId}, phase=remote`
      );
      return { success: false, message: '服务器凭证同步失败' };
    }
  }

  /** task 只消费 user_id/serverIds 白名单；受控并发隔离服务器，刷新失败降级并保留重试目标。 */
  async processRotationTask(db, task, logger = this.logger) {
    const payload = task.payload_data || {};
    const userId = task.user_id || payload.user_id;
    const serverIds = [...new Set((payload.serverIds || []).map(Number))].filter(id => Number.isInteger(id) && id > 0);
    const results = await runWithConcurrency(serverIds, 10, serverId => this.syncServerWithLatestCredentials(db, userId, serverId, logger));
    const remoteSuccess = serverIds.filter((_id, index) => results[index].status === 'fulfilled' && results[index].value.success);
    let successfulServerIds = [];
    try {
      const expectedCredentialRevisions = Object.fromEntries(remoteSuccess.map(serverId => [serverId,
        results[serverIds.indexOf(serverId)].value.credentialRevision]));
      const refresh = await this.refreshAndMergeRotatedServers(db, userId, remoteSuccess, logger, { expectedCredentialRevisions });
      successfulServerIds = remoteSuccess.filter(id => refresh.successfulServerIds.includes(id));
    } catch (error) {
      logger?.warn?.(`凭证轮换缓存处理失败: user=${userId}, task=${task.id || 0}, phase=cache`);
    }
    const failedServerIds = serverIds.filter(id => !successfulServerIds.includes(id));
    return { success: failedServerIds.length === 0, message: failedServerIds.length ? '部分服务器等待重试' : '凭证同步与缓存更新成功',
      successfulServerIds, failedServerIds };
  }

  /** code/message/statusCode 构成兼容旧用户端的业务错误；冷却调用方额外设置 retryAfter。 */
  businessError(code, message, statusCode = 400) {
    return Object.assign(new Error(message), { isLegacyBusinessError: true, statusCode, code, data: null });
  }

  /** 校验 subscription.nodes_data；缺缓存或真实节点无有效 server_id 时拒绝，明确虚拟节点放行。 */
  validateBaseline(subscription) {
    if (!subscription?.nodes_data) throw this.businessError(3002, '请先生成订阅链接');
    let nodes;
    try { nodes = typeof subscription.nodes_data === 'string' ? JSON.parse(subscription.nodes_data) : subscription.nodes_data; }
    catch (error) { throw this.businessError(3002, '请先重新生成订阅，再更换订阅链接'); }
    if (!Array.isArray(nodes) || nodes.some(node => {
      if (node && (node.is_announcement === true || node.strategy === 'announcement' || node.is_virtual === true)) return false;
      return !node || !Number.isInteger(Number(node.server_id)) || Number(node.server_id) <= 0;
    })) throw this.businessError(3002, '请先重新生成订阅，再更换订阅链接');
  }

  /** client 内校验锁定 user 的启用状态与套餐类型；禁用或限时到期拒绝轮换。 */
  async validateUser(client, user) {
    if (![true, 1, '1'].includes(user.enabled)) throw this.businessError(2003, '账号已被禁用，请联系管理员');
    const planType = user.plan_type || (user.plan_id ? await this.repository.findUserPlanType(client, user.plan_id) : 'lifetime');
    if (planType === 'timed' && !(Number(user.expire_at) > this.nowSeconds())) {
      throw this.businessError(2003, '套餐已到期，请续费后使用订阅');
    }
  }

  /** 读取行锁返回 user 的冷却时间；空值放行，未满小时向上取整剩余秒数并拒绝。 */
  assertCooldown(user) {
    if (user.subscription_credentials_rotated_at == null) return;
    const remaining = Number(user.subscription_credentials_rotated_at) + 3600 - this.nowSeconds();
    if (remaining > 0) {
      const error = this.businessError(429, '1 小时内只能更换一次订阅链接，请稍后重试', 429);
      error.retryAfter = Math.max(1, Math.ceil(remaining));
      throw error;
    }
  }

  /**
   * 公开 token 冲突使用 SAVEPOINT 有限重试，仅重做 token/基线替换，不重复生成服务器凭证。
   * 只有明确的 sub_id 唯一约束冲突可重试，其他 SQL 错误交由外层事务整体回滚。
   * client 为专用事务连接；userId/nodesData 指定旧基线，oldSubId 防止随机值复用当前链接。
   */
  async replaceTokenAndBaseline(client, userId, nodesData, oldSubId) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const subId = this.generators.publicToken();
      if (subId === oldSubId) continue;
      const rotatedAt = Math.floor(this.nowSeconds());
      await client.query('SAVEPOINT rotation_public_token');
      try {
        await this.repository.replacePublicTokenAndBaseline(client, { userId, subId, rotatedAt, nodesData });
        await client.query('RELEASE SAVEPOINT rotation_public_token');
        return { subId, rotatedAt };
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT rotation_public_token');
        await client.query('RELEASE SAVEPOINT rotation_public_token');
        if (error.code !== '23505' || !['users_sub_id_key', 'user_subscriptions_sub_id_key'].includes(error.constraint)) throw error;
        if (attempt === 4) throw new Error('无法生成唯一订阅链接，请稍后重试');
      }
    }
    throw new Error('无法生成唯一订阅链接，请稍后重试');
  }

  /**
   * 在专用事务中准备本地轮换；缺快照服务器仍进入任务，已有内部 sub_id 始终保留。
   * @param {Object} db - 提供 pool.connect() 的数据库代理。
   * @param {number} userId - 当前用户 ID；返回值仅在 COMMIT 成功后交付。
   */
  async prepareRotation(db, userId) {
    try {
      return await this.repository.withRotationTransaction(db, userId, async (client, user) => {
        await this.validateUser(client, user);
        const baseline = await this.repository.findLatestSubscription(client, userId);
        this.validateBaseline(baseline);
        this.assertCooldown(user);
        const { servers, unsupportedServers, configs, nodes } = await this.repository.listRotationTargets(client, userId);
        for (const server of unsupportedServers) this.logger?.warn?.(`凭证轮换排除不支持的服务器: user=${userId}, server=${server.id}`);
        for (const server of servers) {
          const serverId = Number(server.id);
          const serverConfigs = configs.filter(row => Number(row.server_id) === serverId)
            .sort((left, right) => Number(left.inbound_id) - Number(right.inbound_id));
          const inboundIds = nodes.filter(row => Number(row.server_id) === serverId)
            .map(row => Number(row.inbound_id)).filter(id => Number.isInteger(id) && id > 0);
          if (serverConfigs.length === 0 && inboundIds.length === 0) continue;
          const credentials = await this.credentialService.generateUniqueCredentials(client, serverId, userId);
          const subId = selectCanonicalServerConfig(serverConfigs, inboundIds)?.sub_id || this.generators.subId();
          await this.repository.upsertServerConfigs(client, { userId, serverId, inboundIds, credentials, subId });
        }
        const { subId, rotatedAt } = await this.replaceTokenAndBaseline(client, userId, baseline.nodes_data, user.sub_id);
        const serverIds = servers.map(server => Number(server.id));
        const task = await this.repository.insertRotationTask(client, { userId, serverIds, now: rotatedAt });
        return { taskId: task.id, subId, user: { ...user, sub_id: subId, subscription_credentials_rotated_at: rotatedAt },
          serverIds, serverNames: servers.map(server => server.name) };
      });
    } catch (error) {
      if (error.code === 'ROTATION_USER_NOT_FOUND') throw this.businessError(2004, '用户不存在');
      throw error;
    }
  }
}

const defaultService = new SubscriptionCredentialRotationService();

/** 默认编排入口：db 提供连接池，userId 标识用户；事务失败由服务原样抛出。 */
async function prepareRotation(db, userId) { return defaultService.prepareRotation(db, userId); }

/** 默认任务入口：仅消费非敏感目标 ID，执行最新数据库凭证同步。 */
async function processRotationTask(db, task, logger) { return defaultService.processRotationTask(db, task, logger); }

/** 默认单服务器入口：每次重读本地凭证并隔离远端异常。 */
async function syncServerWithLatestCredentials(db, userId, serverId, logger) { return defaultService.syncServerWithLatestCredentials(db, userId, serverId, logger); }

module.exports = { SubscriptionCredentialRotationService, prepareRotation, processRotationTask, syncServerWithLatestCredentials };

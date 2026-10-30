/**
 * 家宽 IP 套餐到期清理测试。
 * 职责：覆盖数据库状态字段、支付恢复、到期清理服务、家宽邮件和用户端 API 状态。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tablesPath = path.join(__dirname, '../db/schema/tables.js');
const migrationPath = path.join(__dirname, '../db/migrations/030-home-ip-expiration-state.js');
const trafficManagerPath = path.join(__dirname, '../services/shared/traffic-manager.js');

function createDbStub(options = {}) {
  const calls = [];

  return {
    calls,
    db: {
      prepare(sql) {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        return {
          async get(...params) {
            calls.push({ method: 'get', sql: normalizedSql, params });
            if (normalizedSql.includes('pg_try_advisory_lock')) {
              return { locked: options.locked !== false };
            }
            if (normalizedSql.includes('pg_advisory_unlock')) {
              return { unlocked: true };
            }
            return options.getResult;
          },
          async all(...params) {
            calls.push({ method: 'all', sql: normalizedSql, params });
            return options.allResult || [];
          },
          async run(...params) {
            calls.push({ method: 'run', sql: normalizedSql, params });
            return { changes: 1 };
          }
        };
      }
    }
  };
}

function createPoolStub(options = {}) {
  const existingColumns = options.existingColumns || new Set();
  const calls = [];
  const state = { released: false };
  const client = {
    async query(sql, params = []) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalizedSql, params });

      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalizedSql)) {
        return undefined;
      }
      if (normalizedSql.includes('information_schema.columns')) {
        return {
          rows: existingColumns.has(params[0]) ? [{ column_name: params[0] }] : []
        };
      }
      if (normalizedSql.startsWith('ALTER TABLE users')) {
        return { rowCount: 0 };
      }
      throw new Error(`unexpected sql: ${normalizedSql}`);
    },
    release() {
      state.released = true;
    }
  };

  return {
    calls,
    state,
    pool: {
      async connect() {
        return client;
      }
    }
  };
}

test('迁移和新库表定义包含家宽到期状态字段', async () => {
  const tablesSource = fs.readFileSync(tablesPath, 'utf8');
  const migration = require('../db/migrations/030-home-ip-expiration-state');
  const migrationSource = fs.readFileSync(migrationPath, 'utf8');
  const { pool, calls, state } = createPoolStub();

  const result = await migration.up(pool);

  assert.match(tablesSource, /home_status\s+VARCHAR\(20\)\s+DEFAULT\s+'normal'/);
  assert.match(tablesSource, /home_expired_notice_sent_at\s+BIGINT/);
  assert.match(migrationSource, /columnExists\(client,\s*['"]home_status['"]\)/);
  assert.match(migrationSource, /columnExists\(client,\s*['"]home_expired_notice_sent_at['"]\)/);
  assert.deepEqual(result, {
    addedColumns: ['home_status', 'home_expired_notice_sent_at'],
    skippedColumns: []
  });
  assert.equal(calls.filter((call) => call.sql.startsWith('ALTER TABLE users')).length, 2);
  assert.equal(calls[calls.length - 1].sql, 'COMMIT');
  assert.equal(state.released, true);
});

test('家宽套餐支付成功会恢复家宽状态并清空过期提醒标记', async () => {
  const orderRepository = require('../repositories/order-repository');
  const { db, calls } = createDbStub();

  await orderRepository.updateUserHomePlanAfterPaidOrder(db, {
    userId: 7,
    homePlanId: 3,
    homeExpireAt: 1900000000,
    updatedAt: 1800000000
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /home_plan_id = \?/);
  assert.match(calls[0].sql, /home_expire_at = \?/);
  assert.match(calls[0].sql, /home_status = 'normal'/);
  assert.match(calls[0].sql, /home_expired_notice_sent_at = NULL/);
  assert.deepEqual(calls[0].params, [3, 1900000000, 1800000000, 7]);
});

test('家宽到期仓储只选择已到期且仍有 routing 的未过期用户', async () => {
  const trafficRepository = require('../repositories/traffic-repository');
  const { db, calls } = createDbStub({
    allResult: [{ id: 1, email: 'home@example.com' }]
  });

  const rows = await trafficRepository.listExpiredHomeIpUsers(db, 2000);

  assert.equal(rows.length, 1);
  assert.match(calls[0].sql, /u\.home_plan_id IS NOT NULL/);
  assert.match(calls[0].sql, /u\.home_expire_at <= \?/);
  assert.match(calls[0].sql, /COALESCE\(u\.home_status, 'normal'\) != 'expired'/);
  assert.match(calls[0].sql, /JOIN user_home_proxy_routes r ON r\.user_id = u\.id/);
  assert.deepEqual(calls[0].params, [2000]);
});

test('家宽过期标记会二次确认权益仍然到期', async () => {
  const trafficRepository = require('../repositories/traffic-repository');
  const { db, calls } = createDbStub();

  const result = await trafficRepository.markHomeIpExpired(db, 8, 2000);

  assert.deepEqual(result, { expired: true });
  assert.match(calls[0].sql, /home_status = 'expired'/);
  assert.match(calls[0].sql, /home_expire_at <= \?/);
  assert.deepEqual(calls[0].params, [2000, 8, 2000]);
});

test('家宽过期超过一天才释放用户表套餐占用', async () => {
  const trafficRepository = require('../repositories/traffic-repository');
  const { db, calls } = createDbStub();

  const result = await trafficRepository.releaseExpiredHomeIpSlots(db, 200000);

  assert.deepEqual(result, { releasedCount: 1 });
  assert.match(calls[0].sql, /home_plan_id = NULL/);
  assert.match(calls[0].sql, /home_expire_at = NULL/);
  assert.match(calls[0].sql, /COALESCE\(home_status, 'normal'\) = 'expired'/);
  assert.match(calls[0].sql, /home_expire_at < \?/);
  assert.deepEqual(calls[0].params, [200000, 113600]);
});

test('家宽到期清理成功后标记过期并只触发一次邮件', async () => {
  const trafficRepository = require('../repositories/traffic-repository');
  const homeRoutingService = require('../services/shared/home-routing-service');
  const emailService = require('../services/shared/renewal-required-email-service');
  const homeIpExpirationService = require('../services/shared/home-ip-expiration-service');
  const originals = {
    listExpiredHomeIpUsers: trafficRepository.listExpiredHomeIpUsers,
    markHomeIpExpired: trafficRepository.markHomeIpExpired,
    claimHomeIpExpiredNotice: trafficRepository.claimHomeIpExpiredNotice,
    releaseExpiredHomeIpSlots: trafficRepository.releaseExpiredHomeIpSlots,
    cleanupHomeRoutingForUser: homeRoutingService.cleanupHomeRoutingForUser,
    sendRenewalRequiredEmail: emailService.sendRenewalRequiredEmail
  };
  const events = [];
  const { db } = createDbStub();

  trafficRepository.listExpiredHomeIpUsers = async () => [
    { id: 12, email: 'home@example.com', home_expire_at: 1000 }
  ];
  homeRoutingService.cleanupHomeRoutingForUser = async (receivedDb, userId, options) => {
    events.push(['cleanup', receivedDb === db, userId, options.skipCooldown]);
    return { success: true };
  };
  trafficRepository.markHomeIpExpired = async (receivedDb, userId, now) => {
    events.push(['mark-expired', receivedDb === db, userId, now]);
    return { expired: true };
  };
  trafficRepository.claimHomeIpExpiredNotice = async (receivedDb, userId, now) => {
    events.push(['claim-notice', receivedDb === db, userId, now]);
    return { claimed: true };
  };
  trafficRepository.releaseExpiredHomeIpSlots = async (receivedDb, now) => {
    events.push(['release-slots', receivedDb === db, now]);
    return { releasedCount: 2 };
  };
  emailService.sendRenewalRequiredEmail = async (receivedDb, payload) => {
    events.push(['email', receivedDb === db, payload.userId, payload.reason]);
    return { sent: true, status: 'email_sent' };
  };

  try {
    const result = await homeIpExpirationService.cleanupExpiredHomeIpPlans(db, 2000);

    assert.deepEqual(result, {
      expiredCount: 1,
      skippedCount: 0,
      failedCount: 0,
      retryCount: 0,
      emailCount: 1,
      releasedCount: 2
    });
    assert.deepEqual(events, [
      ['cleanup', true, 12, true],
      ['mark-expired', true, 12, 2000],
      ['claim-notice', true, 12, 2000],
      ['email', true, 12, 'home_ip_expired'],
      ['release-slots', true, 2000]
    ]);
  } finally {
    Object.assign(trafficRepository, {
      listExpiredHomeIpUsers: originals.listExpiredHomeIpUsers,
      markHomeIpExpired: originals.markHomeIpExpired,
      claimHomeIpExpiredNotice: originals.claimHomeIpExpiredNotice,
      releaseExpiredHomeIpSlots: originals.releaseExpiredHomeIpSlots
    });
    homeRoutingService.cleanupHomeRoutingForUser = originals.cleanupHomeRoutingForUser;
    emailService.sendRenewalRequiredEmail = originals.sendRenewalRequiredEmail;
  }
});

test('家宽到期清理失败时不标记过期也不发送邮件', async () => {
  const trafficRepository = require('../repositories/traffic-repository');
  const homeRoutingService = require('../services/shared/home-routing-service');
  const emailService = require('../services/shared/renewal-required-email-service');
  const homeIpExpirationService = require('../services/shared/home-ip-expiration-service');
  const originals = {
    listExpiredHomeIpUsers: trafficRepository.listExpiredHomeIpUsers,
    markHomeIpExpired: trafficRepository.markHomeIpExpired,
    claimHomeIpExpiredNotice: trafficRepository.claimHomeIpExpiredNotice,
    releaseExpiredHomeIpSlots: trafficRepository.releaseExpiredHomeIpSlots,
    cleanupHomeRoutingForUser: homeRoutingService.cleanupHomeRoutingForUser,
    sendRenewalRequiredEmail: emailService.sendRenewalRequiredEmail
  };
  let marked = 0;
  let emailed = 0;
  const { db } = createDbStub();

  trafficRepository.listExpiredHomeIpUsers = async () => [
    { id: 13, email: 'fail@example.com', home_expire_at: 1000 }
  ];
  homeRoutingService.cleanupHomeRoutingForUser = async () => ({
    success: false,
    retryable: true,
    message: '远端删除失败'
  });
  trafficRepository.markHomeIpExpired = async () => {
    marked += 1;
    return { expired: true };
  };
  trafficRepository.claimHomeIpExpiredNotice = async () => ({ claimed: true });
  trafficRepository.releaseExpiredHomeIpSlots = async () => ({ releasedCount: 0 });
  emailService.sendRenewalRequiredEmail = async () => {
    emailed += 1;
  };

  try {
    const result = await homeIpExpirationService.cleanupExpiredHomeIpPlans(db, 2000);

    assert.deepEqual(result, {
      expiredCount: 0,
      skippedCount: 0,
      failedCount: 1,
      retryCount: 1,
      emailCount: 0,
      releasedCount: 0
    });
    assert.equal(marked, 0);
    assert.equal(emailed, 0);
  } finally {
    Object.assign(trafficRepository, {
      listExpiredHomeIpUsers: originals.listExpiredHomeIpUsers,
      markHomeIpExpired: originals.markHomeIpExpired,
      claimHomeIpExpiredNotice: originals.claimHomeIpExpiredNotice,
      releaseExpiredHomeIpSlots: originals.releaseExpiredHomeIpSlots
    });
    homeRoutingService.cleanupHomeRoutingForUser = originals.cleanupHomeRoutingForUser;
    emailService.sendRenewalRequiredEmail = originals.sendRenewalRequiredEmail;
  }
});

/**
 * 到期清理集成夹具：仅替换数据库、远端 XUI 和邮件边界，使用真实 routing 清理。
 * scenario 指定离线服务器或在线写入失败，保留本地记录与远端配置供断言。
 */
class ExpirationCleanupFixture {
  constructor(scenario) {
    this.scenario = scenario;
    this.route = {
      user_id: 21, home_proxy_tag: 'home-proxy', server_ids: '[1]',
      pending_cleanup_server_ids: '[2]', last_synced_at: 1999, show_home_node_prefix: true
    };
    this.servers = [1, 2].map((id) => ({
      id, name: `服务器${id}`, status: scenario.offlineIds.includes(id) ? 0 : 1,
      api_url: String(id), api_token: 'test-token'
    }));
    this.requested = [];
    this.updated = [];
    this.marked = 0;
    this.configs = { 1: { routing: { rules: [] } }, 2: { routing: { rules: [] } } };
  }

  /** 按 userId 返回测试用户；到期服务负责跳过近期同步的冷却。 */
  async findUserHomeRoutingContext(db, userId) {
    assert.equal(userId, 21);
    return { user_id: 21, email: 'expired@example.com' };
  }

  /** 返回当前持久化记录；在线失败时应保持原值。 */
  async findUserHomeRoute() { return this.route; }

  /** 提供独立在线快照，避免将离线记录当作在线请求目标。 */
  async listOnlineServers() { return this.servers.filter((server) => server.status === 1); }

  /** 按目标 ID 读取完整服务器列表，包含离线记录。 */
  async listServersByIds(db, ids) { return this.servers.filter((server) => ids.includes(server.id)); }

  /** 保存清理结果，区分 active 解绑与内部 pending 残留。 */
  async upsertUserHomeRoute(db, payload) {
    this.route = {
      ...this.route, server_ids: JSON.stringify(payload.serverIds),
      pending_cleanup_server_ids: JSON.stringify(payload.pendingCleanupServerIds)
    };
  }

  /** 两个列表都已完成清理时删除本地 route。 */
  async deleteUserHomeRoute() { this.route = undefined; }

  /** 为 apiUrl 指定服务器提供远端边界；在线写入失败用于验证下轮重试。 */
  async createXui(apiUrl) {
    const id = Number(apiUrl);
    this.requested.push(id);
    return {
      getXrayConfig: async () => ({ obj: { xraySetting: this.configs[id] } }),
      updateXrayConfig: async (config) => {
        if (this.scenario.failedId === id) { throw new Error('在线写入失败'); }
        this.updated.push(id);
        this.configs[id] = config;
        return { success: true };
      }
    };
  }
}

for (const scenario of [
  { name: '离线跳过仍标记过期并保留 pending-only route', offlineIds: [1], expired: 1, failed: 0, requested: [2], updated: [2] },
  { name: '在线 pending 删除失败不标记过期并保留原记录', offlineIds: [], failedId: 2, expired: 0, failed: 1, requested: [1, 2], updated: [1] },
  { name: '在线全部成功清理 active 和 pending 后删除 route', offlineIds: [], expired: 1, failed: 0, requested: [1, 2], updated: [1, 2] }
]) {
  test(`真实家宽到期流程：${scenario.name}`, async () => {
    const trafficRepository = require('../repositories/traffic-repository');
    const homeRoutingService = require('../services/shared/home-routing-service');
    const expirationService = require('../services/shared/home-ip-expiration-service');
    const originals = { ...trafficRepository };
    const fixture = new ExpirationCleanupFixture(scenario);
    const originalRoute = { ...fixture.route };
    const { db } = createDbStub();
    homeRoutingService.setRepositoryForTest(fixture);
    homeRoutingService.setXuiServiceFactoryForTest(fixture.createXui.bind(fixture));
    trafficRepository.listExpiredHomeIpUsers = async () => [{ id: 21, email: 'expired@example.com' }];
    trafficRepository.markHomeIpExpired = async () => { fixture.marked += 1; return { expired: true }; };
    trafficRepository.claimHomeIpExpiredNotice = async () => ({ claimed: false });
    trafficRepository.releaseExpiredHomeIpSlots = async () => ({ releasedCount: 0 });

    try {
      const result = await expirationService.cleanupExpiredHomeIpPlans(db, 2000);
      assert.equal(result.expiredCount, scenario.expired);
      assert.equal(result.failedCount, scenario.failed);
      assert.equal(result.retryCount, scenario.failed);
      assert.equal(fixture.marked, scenario.expired);
      assert.deepEqual(fixture.requested, scenario.requested);
      assert.deepEqual(fixture.updated, scenario.updated);
      if (scenario.failed) {
        assert.deepEqual(fixture.route, originalRoute);
      } else if (scenario.offlineIds.length) {
        assert.deepEqual(JSON.parse(fixture.route.server_ids), []);
        assert.deepEqual(JSON.parse(fixture.route.pending_cleanup_server_ids), [1]);
      } else {
        assert.equal(fixture.route, undefined);
      }
    } finally {
      Object.assign(trafficRepository, originals);
      homeRoutingService.resetTestDependencies();
    }
  });
}

test('traffic-manager 在流量到期检查后调度家宽到期服务', () => {
  const source = fs.readFileSync(trafficManagerPath, 'utf8');

  assert.match(source, /home-ip-expiration-service/);
  assert.match(source, /await checkAndDisableExpiredUsers\(db\);\s+await homeIpExpirationService\.cleanupExpiredHomeIpPlans\(db\);/);
});

test('家宽到期邮件使用家宽文案且不展示流量字段', () => {
  const service = require('../services/shared/renewal-required-email-service');
  const html = service.buildRenewalRequiredEmailContent({
    email: 'home@example.com',
    home_plan_name: '精品家宽',
    home_expire_at: 1900000000,
    traffic_used: 1024,
    traffic_limit: 2048
  }, 'home_ip_expired');

  assert.match(html, /家宽 IP 套餐已经到期/);
  assert.match(html, /精品家宽/);
  assert.doesNotMatch(html, /已用流量/);
  assert.doesNotMatch(html, /流量上限/);
});

test('用户家宽 routing 选项为过期权益返回可展示状态并禁止编辑', async () => {
  const homeRoutingService = require('../services/shared/home-routing-service');
  const repository = require('../repositories/user-home-routing-repository');
  const originals = {
    findHomeRoutingEntitlement: repository.findHomeRoutingEntitlement,
    listOnlineServers: repository.listOnlineServers,
    findUserHomeRoute: repository.findUserHomeRoute,
    listServersByIds: repository.listServersByIds
  };

  repository.findHomeRoutingEntitlement = async () => ({
    user_id: 9,
    email: 'expired-home@example.com',
    home_plan_id: 4,
    home_expire_at: 1000,
    home_status: 'expired',
    home_plan_name: '过期家宽',
    plan_type: 'home_ip',
    home_proxy_tag: 'home-proxy',
    home_proxy_id: 1
  });
  repository.listOnlineServers = async () => [{ id: 1, name: '节点1', status: 1 }];
  repository.findUserHomeRoute = async () => ({
    user_id: 9,
    home_proxy_tag: 'home-proxy',
    server_ids: '[1]',
    last_synced_at: 900
  });
  repository.listServersByIds = async () => [{ id: 1, name: '节点1', status: 1 }];

  try {
    const result = await homeRoutingService.getHomeRoutingOptions({}, 9);

    assert.equal(result.available, true);
    assert.equal(result.editable, false);
    assert.equal(result.home_status, 'expired');
    assert.equal(result.home_status_text, '过期');
    assert.equal(result.route.home_proxy_tag, 'home-proxy');
    assert.deepEqual(result.servers, []);
  } finally {
    Object.assign(repository, originals);
  }
});

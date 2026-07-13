/**
 * 3X-UI 3.4.2+ 客户端模型迁移脚本。
 * 职责：把全部本地用户迁移为每台服务器一个 canonical email 全量 client，并清理旧后缀 client。
 *
 * 使用：
 * node server/scripts/migrate-xui-client-model-v342.js --dry-run
 * node server/scripts/migrate-xui-client-model-v342.js
 */

const databaseManager = require('../db/init');
const XuiService = require('../integrations/xui/xui-service');
const orderService = require('../services/shared/order-service');
const xuiSyncRepository = require('../repositories/xui-sync-repository');
const { runWithConcurrency } = require('../utils/concurrency');

const MIGRATION_CONCURRENCY = 10;

function isPanelVersionAtLeast(version, minimum) {
  const left = String(version || '').split('.').map(Number);
  const right = String(minimum || '').split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = Number.isFinite(left[index]) ? left[index] : 0;
    const b = Number.isFinite(right[index]) ? right[index] : 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function extractOldSuffixEmails(userEmail, inbounds = []) {
  const emails = new Set();
  for (const inbound of inbounds) {
    let settings = {};
    try {
      settings = typeof inbound.settings === 'string'
        ? JSON.parse(inbound.settings || '{}')
        : (inbound.settings || {});
    } catch (error) {
      settings = {};
    }

    for (const client of settings.clients || []) {
      if (client?.email && String(client.email).startsWith(`${userEmail}-`)) {
        emails.add(client.email);
      }
    }
  }
  return [...emails];
}

async function deleteOldSuffixClients(service, oldEmails) {
  for (const oldEmail of oldEmails) {
    await service.deleteClientByEmail(0, oldEmail);
  }
}

async function migrateUserOnServer(db, user, server, dryRun) {
  const service = await XuiService.getInstance(server.api_url, server.api_token, {
    apiVersion: server.panel_version || '3.4.2'
  });
  const inboundsResult = await service.getInbounds();
  if (!inboundsResult.success) {
    throw new Error(inboundsResult.message || '获取 inbounds 失败');
  }

  const inboundIds = (inboundsResult.data || []).map((inbound) => inbound.id);
  const oldEmails = extractOldSuffixEmails(user.email, inboundsResult.data || []);
  console.log(`[PLAN] user=${user.email}, server=${server.name}, inboundIds=${inboundIds.join(',')}, old=${oldEmails.length}`);

  if (dryRun) {
    return { oldEmails, inboundIds, status: 'dry-run', message: 'dry-run only' };
  }

  const syncResult = await orderService.syncUserToXuiServers(db, user, {
    serverIds: [server.id],
    total_traffic_limit: Number(user.traffic_limit || 0)
  });
  if (!syncResult.success) {
    throw new Error(syncResult.message || '同步 canonical client 失败');
  }

  await xuiSyncRepository.clearUserSubscriptionCachesForMigration(db, user.id);
  await deleteOldSuffixClients(service, oldEmails);

  return { oldEmails, inboundIds, status: 'success', message: 'ok' };
}

/**
 * 生成迁移审计的任务键，粒度与审计表唯一约束一致。
 * @param {number} userId - 用户 ID。
 * @param {number} serverId - 3X-UI 服务器 ID。
 * @returns {string} user/server 组合键。
 */
function buildMigrationKey(userId, serverId) {
  return `${userId}:${serverId}`;
}

/**
 * 读取已成功迁移的 user/server 组合，用于重跑脚本时跳过已完成任务。
 * @param {Object} db - 数据库实例。
 * @returns {Promise<Set<string>>} 已成功迁移的任务键集合。
 */
async function listCompletedMigrationKeys(db) {
  const rows = await db.prepare(`
    SELECT user_id, server_id
    FROM xui_client_model_migrations
    WHERE status = 'success'
  `).all();
  return new Set((rows || []).map((row) => buildMigrationKey(row.user_id, row.server_id)));
}

/**
 * 根据用户和服务器笛卡尔积生成待迁移任务，并跳过审计表已成功的组合。
 * @param {Array<Object>} users - 全量用户列表。
 * @param {Array<Object>} servers - 3X-UI 3.4.2+ 服务器列表。
 * @param {Set<string>} completedKeys - 已成功迁移的任务键集合。
 * @returns {Array<{user:Object,server:Object}>} 待执行迁移任务。
 */
function buildMigrationTasks(users, servers, completedKeys) {
  const tasks = [];
  for (const server of servers) {
    for (const user of users) {
      if (completedKeys.has(buildMigrationKey(user.id, server.id))) {
        console.log(`[SKIP] user=${user.email}, server=${server.name}, reason=already success`);
        continue;
      }
      tasks.push({ user, server });
    }
  }
  return tasks;
}

/**
 * 写入成功迁移审计记录，保持脚本调度和审计字段组装集中在一处。
 * @param {Object} db - 数据库实例。
 * @param {Object} user - 当前用户。
 * @param {Object} server - 当前服务器。
 * @param {Object} result - 单任务迁移结果。
 * @returns {Promise<void>}
 */
async function writeMigrationAudit(db, user, server, result) {
  await xuiSyncRepository.upsertClientModelMigrationAudit(db, {
    userId: user.id,
    serverId: server.id,
    status: result.status,
    oldEmails: result.oldEmails,
    newEmail: user.email,
    inboundIds: result.inboundIds,
    credentialSource: 'canonical',
    message: result.message
  });
}

/**
 * 写入失败迁移审计记录，让下次重跑可以重新尝试 failed 任务。
 * @param {Object} db - 数据库实例。
 * @param {Object} user - 当前用户。
 * @param {Object} server - 当前服务器。
 * @param {Error} error - 单任务错误。
 * @returns {Promise<void>}
 */
async function writeMigrationFailureAudit(db, user, server, error) {
  await xuiSyncRepository.upsertClientModelMigrationAudit(db, {
    userId: user.id,
    serverId: server.id,
    status: 'failed',
    oldEmails: [],
    newEmail: user.email,
    inboundIds: [],
    credentialSource: '',
    message: error.message
  });
}

/**
 * 按固定并发执行迁移任务；只改变脚本调度，不修改单任务业务迁移逻辑。
 * @param {Object} options - 调度参数。
 * @param {Object} options.db - 数据库实例。
 * @param {Array<{user:Object,server:Object}>} options.tasks - 待迁移任务。
 * @param {boolean} options.dryRun - 是否只预演。
 * @param {number} options.concurrency - 最大并发数。
 * @returns {Promise<{success:number,failed:number}>} 本轮执行统计。
 */
async function runMigrationTasks({
  db,
  tasks,
  dryRun,
  concurrency = MIGRATION_CONCURRENCY,
  logger = console,
  migrateUserOnServer: migrateTask = migrateUserOnServer,
  writeAudit = writeMigrationAudit,
  writeFailureAudit = writeMigrationFailureAudit
}) {
  let success = 0;
  let failed = 0;

  await runWithConcurrency(tasks, concurrency, async ({ user, server }) => {
    try {
      const result = await migrateTask(db, user, server, dryRun);
      if (!dryRun) {
        await writeAudit(db, user, server, result);
      }
      success += 1;
    } catch (error) {
      failed += 1;
      logger.error(`[FAIL] user=${user.email}, server=${server.name}, error=${error.message}`);
      if (!dryRun) {
        await writeFailureAudit(db, user, server, error);
      }
    }
  });

  return { success, failed };
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const db = await databaseManager.init();

  try {
    const servers = (await xuiSyncRepository.listOnlineXuiServers(db))
      .filter((server) => isPanelVersionAtLeast(server.panel_version, '3.4.2'));
    const users = await xuiSyncRepository.listAllUsersForClientModelMigration(db);
    const completedKeys = await listCompletedMigrationKeys(db);
    const tasks = buildMigrationTasks(users, servers, completedKeys);
    const skipped = (servers.length * users.length) - tasks.length;

    console.log(`[START] dryRun=${dryRun}, servers=${servers.length}, users=${users.length}, skipped=${skipped}, tasks=${tasks.length}, concurrency=${MIGRATION_CONCURRENCY}`);
    const result = await runMigrationTasks({
      db,
      tasks,
      dryRun,
      concurrency: MIGRATION_CONCURRENCY
    });
    console.log(`[DONE] success=${result.success}, failed=${result.failed}, skipped=${skipped}`);
  } finally {
    await databaseManager.close();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  MIGRATION_CONCURRENCY,
  buildMigrationKey,
  listCompletedMigrationKeys,
  buildMigrationTasks,
  runMigrationTasks,
  extractOldSuffixEmails,
  migrateUserOnServer,
  run
};

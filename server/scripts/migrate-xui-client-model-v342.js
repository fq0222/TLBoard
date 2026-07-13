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

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const db = await databaseManager.init();

  try {
    const servers = (await xuiSyncRepository.listOnlineXuiServers(db))
      .filter((server) => isPanelVersionAtLeast(server.panel_version, '3.4.2'));
    const users = await xuiSyncRepository.listAllUsersForClientModelMigration(db);

    console.log(`[START] dryRun=${dryRun}, servers=${servers.length}, users=${users.length}`);
    for (const server of servers) {
      for (const user of users) {
        try {
          const result = await migrateUserOnServer(db, user, server, dryRun);
          if (!dryRun) {
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
        } catch (error) {
          console.error(`[FAIL] user=${user.email}, server=${server.name}, error=${error.message}`);
          if (!dryRun) {
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
        }
      }
    }
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
  extractOldSuffixEmails,
  migrateUserOnServer,
  run
};

/**
 * 管理端服务器人数统计测试。
 * 验证跨 inbound 去重后的远端邮箱只统计 users 表中真实存在的用户。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const serversService = require('../services/admin/servers-service');
const serversRepository = require('../repositories/servers-repository');
const xuiSyncRepository = require('../repositories/xui-sync-repository');
const xuiNodeSnapshotService = require('../services/shared/xui-node-snapshot-service');
const XuiService = require('../integrations/xui/xui-service');
const syncXuiUsers = require('../jobs/handlers/sync-xui-users');

test('同步服务器时按邮箱跨 inbound 去重并排除非系统用户', async () => {
  const originals = {
    findServerById: serversRepository.findServerById,
    updateServerStatus: serversRepository.updateServerStatus,
    listUsersForXuiSync: xuiSyncRepository.listUsersForXuiSync,
    updateServerManagedCounts: serversRepository.updateServerManagedCounts,
    refreshSnapshots: xuiNodeSnapshotService.refreshServerNodeSnapshots,
    getInstance: XuiService.getInstance
  };
  let savedCounts = null;

  serversRepository.findServerById = async () => ({
    id: 7, api_url: 'https://xui.example.com', api_token: 'token', panel_version: '3.4.2'
  });
  serversRepository.updateServerStatus = async () => {};
  xuiSyncRepository.listUsersForXuiSync = async () => ([
    { email: 'a@example.com' },
    { email: 'b@example.com' }
  ]);
  serversRepository.updateServerManagedCounts = async (_db, serverId, counts) => {
    savedCounts = { serverId, ...counts };
  };
  xuiNodeSnapshotService.refreshServerNodeSnapshots = async () => ({ nodeCount: 2 });
  XuiService.getInstance = async () => ({
    syncServerStatus: async () => ({
      success: true,
      status: 1,
      node_count: 2,
      client_emails: ['a@example.com', 'a@example.com', 'b@example.com', 'manual@example.com'],
      online_clients: ['a@example.com', 'a@example.com', 'manual@example.com'],
      nodes: [{ inbound_id: 1 }, { inbound_id: 2 }]
    })
  });

  try {
    const result = await serversService.syncServer({}, 7);
    assert.equal(result.user_count, 2);
    assert.equal(result.online_count, 1);
    assert.deepEqual(savedCounts, { serverId: 7, userCount: 2, onlineCount: 1 });
  } finally {
    serversRepository.findServerById = originals.findServerById;
    serversRepository.updateServerStatus = originals.updateServerStatus;
    xuiSyncRepository.listUsersForXuiSync = originals.listUsersForXuiSync;
    serversRepository.updateServerManagedCounts = originals.updateServerManagedCounts;
    xuiNodeSnapshotService.refreshServerNodeSnapshots = originals.refreshSnapshots;
    XuiService.getInstance = originals.getInstance;
  }
});

test('实时在线人数按邮箱去重并排除非系统用户', async () => {
  const originals = {
    findServerById: serversRepository.findServerById,
    listUsersForXuiSync: xuiSyncRepository.listUsersForXuiSync,
    updateOnlineCount: serversRepository.updateServerManagedOnlineCount,
    getInstance: XuiService.getInstance
  };
  let savedOnlineCount = null;

  serversRepository.findServerById = async () => ({
    id: 8, api_url: 'https://xui.example.com', api_token: 'token', panel_version: '3.4.2'
  });
  xuiSyncRepository.listUsersForXuiSync = async () => ([{ email: 'a@example.com' }]);
  serversRepository.updateServerManagedOnlineCount = async (_db, serverId, onlineCount) => {
    savedOnlineCount = { serverId, onlineCount };
  };
  XuiService.getInstance = async () => ({
    getOnlineClients: async () => ({
      success: true,
      data: ['a@example.com', 'a@example.com', 'manual@example.com']
    })
  });

  try {
    const result = await serversService.getServerOnlineCount({}, 8);
    assert.equal(result.online_count, 1);
    assert.deepEqual(savedOnlineCount, { serverId: 8, onlineCount: 1 });
  } finally {
    serversRepository.findServerById = originals.findServerById;
    xuiSyncRepository.listUsersForXuiSync = originals.listUsersForXuiSync;
    serversRepository.updateServerManagedOnlineCount = originals.updateOnlineCount;
    XuiService.getInstance = originals.getInstance;
  }
});

test('读取服务器详情后刷新服务器级去重人数缓存', async () => {
  const originals = {
    findServerById: serversRepository.findServerById,
    listUsersForXuiSync: xuiSyncRepository.listUsersForXuiSync,
    updateCounts: serversRepository.updateServerManagedCounts,
    refreshSnapshots: xuiNodeSnapshotService.refreshServerNodeSnapshots,
    getInstance: XuiService.getInstance
  };
  let savedCounts = null;

  serversRepository.findServerById = async () => ({
    id: 9, api_url: 'https://xui.example.com', api_token: 'token', panel_version: '3.4.2', status: 1
  });
  xuiSyncRepository.listUsersForXuiSync = async () => ([
    { email: 'a@example.com' },
    { email: 'b@example.com' }
  ]);
  serversRepository.updateServerManagedCounts = async (_db, serverId, counts) => {
    savedCounts = { serverId, ...counts };
  };
  xuiNodeSnapshotService.refreshServerNodeSnapshots = async () => ({ nodeCount: 2 });
  XuiService.getInstance = async () => ({
    getInbounds: async () => ({
      success: true,
      data: [
        { id: 1, clientStats: [{ email: 'a@example.com' }, { email: 'manual@example.com' }] },
        { id: 2, clientStats: [{ email: 'a@example.com' }, { email: 'b@example.com' }] }
      ]
    }),
    getOnlineClients: async () => ({
      success: true,
      data: ['a@example.com', 'a@example.com', 'manual@example.com']
    }),
    extractClientsFromSettings: () => []
  });

  try {
    await serversService.getServerDetail({}, 9);
    assert.deepEqual(savedCounts, { serverId: 9, userCount: 2, onlineCount: 1 });
  } finally {
    serversRepository.findServerById = originals.findServerById;
    xuiSyncRepository.listUsersForXuiSync = originals.listUsersForXuiSync;
    serversRepository.updateServerManagedCounts = originals.updateCounts;
    xuiNodeSnapshotService.refreshServerNodeSnapshots = originals.refreshSnapshots;
    XuiService.getInstance = originals.getInstance;
  }
});

test('六小时同步复用 inbounds 和待同步用户更新用户数且不查询在线接口', async () => {
  let savedUserCount = null;
  const xuiService = {
    getOnlineClients: async () => {
      throw new Error('不应查询在线接口');
    }
  };
  const serverRepository = {
    updateServerManagedUserCount: async (_db, serverId, userCount) => {
      savedUserCount = { serverId, userCount };
    }
  };

  const count = await syncXuiUsers.__testables.updateManagedUserCountFromInbounds(
    {},
    10,
    [
      { clientStats: [{ email: 'a@example.com' }, { email: 'manual@example.com' }] },
      { clientStats: [{ email: 'a@example.com' }, { email: 'b@example.com' }] }
    ],
    [{ email: 'a@example.com' }, { email: 'b@example.com' }],
    { xuiService, serverRepository }
  );

  assert.equal(count, 2);
  assert.deepEqual(savedUserCount, { serverId: 10, userCount: 2 });
});

test('六小时同步没有有效用户时将服务器用户数缓存归零', async () => {
  const originalListUsers = xuiSyncRepository.listUsersForXuiSync;
  const originalResetCounts = serversRepository.resetAllManagedUserCounts;
  let resetCalled = false;

  xuiSyncRepository.listUsersForXuiSync = async () => [];
  serversRepository.resetAllManagedUserCounts = async () => {
    resetCalled = true;
  };

  try {
    await syncXuiUsers.__testables.runXuiSync({});
    assert.equal(resetCalled, true);
  } finally {
    xuiSyncRepository.listUsersForXuiSync = originalListUsers;
    serversRepository.resetAllManagedUserCounts = originalResetCounts;
  }
});

/**
 * 验证 Telegram 健康巡检维护连续失败次数和服务器在线状态。
 *
 * 关键参数：已有健康记录中的 consecutive_failures、巡检 API 结果。
 * 核心分支：失败累加到 3 后标记服务器离线；成功时清零并恢复在线。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const XuiService = require('../integrations/xui/xui-service');
const telegramRepository = require('../repositories/telegram-repository');
const serversRepository = require('../repositories/servers-repository');
const trafficRepository = require('../repositories/traffic-repository');
const telegramMonitorService = require('../services/shared/telegram-monitor-service');

const originals = {
  getInstance: XuiService.getInstance,
  findServerHealthDetail: telegramRepository.findServerHealthDetail,
  upsertServerHealthCheck: telegramRepository.upsertServerHealthCheck,
  findOpenAlertByServerAndType: telegramRepository.findOpenAlertByServerAndType,
  createAlert: telegramRepository.createAlert,
  updateOpenAlert: telegramRepository.updateOpenAlert,
  resolveAlert: telegramRepository.resolveAlert,
  updateServerStatus: serversRepository.updateServerStatus,
  listAllServersForHealthCheck: trafficRepository.listAllServersForHealthCheck
};

function restoreMocks() {
  XuiService.getInstance = originals.getInstance;
  telegramRepository.findServerHealthDetail = originals.findServerHealthDetail;
  telegramRepository.upsertServerHealthCheck = originals.upsertServerHealthCheck;
  telegramRepository.findOpenAlertByServerAndType = originals.findOpenAlertByServerAndType;
  telegramRepository.createAlert = originals.createAlert;
  telegramRepository.updateOpenAlert = originals.updateOpenAlert;
  telegramRepository.resolveAlert = originals.resolveAlert;
  serversRepository.updateServerStatus = originals.updateServerStatus;
  trafficRepository.listAllServersForHealthCheck = originals.listAllServersForHealthCheck;
}

test.afterEach(restoreMocks);

test('服务器仓储可只更新最近检查时间而不修改在线状态', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        async run(...params) {
          calls.push({ sql, params });
        }
      };
    }
  };

  await serversRepository.updateServerLastCheckAt(db, 9, 123456);

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SET last_check_at = \?/);
  assert.equal(calls[0].sql.includes('status'), false);
  assert.deepEqual(calls[0].params, [123456, 9]);
});

test('健康巡检连续第三次失败时累加失败次数并标记服务器离线', async () => {
  const healthWrites = [];
  const statusWrites = [];

  XuiService.getInstance = async () => ({
    getServerStatus: async () => ({ success: false, message: 'server/status timeout' }),
    getInbounds: async () => ({ success: false, message: 'connect timeout' })
  });
  telegramRepository.findServerHealthDetail = async () => ({ consecutive_failures: 2 });
  telegramRepository.upsertServerHealthCheck = async (_db, payload) => healthWrites.push(payload);
  telegramRepository.findOpenAlertByServerAndType = async () => null;
  telegramRepository.createAlert = async () => {};
  telegramRepository.updateOpenAlert = async () => {};
  serversRepository.updateServerStatus = async (_db, serverId, status, lastCheckAt) => {
    statusWrites.push({ serverId, status, lastCheckAt });
  };

  await telegramMonitorService.checkSingleServerHealth({}, {
    id: 9,
    name: '意大利[AI]',
    api_url: 'https://it01.example.com',
    api_token: 'token',
    panel_version: '3.4.2'
  });

  assert.equal(healthWrites.length, 1);
  assert.equal(healthWrites[0].consecutiveFailures, 3);
  assert.equal(statusWrites.length, 1);
  assert.equal(statusWrites[0].serverId, 9);
  assert.equal(statusWrites[0].status, 0);
});

test('健康巡检未达到三次失败时仍触发告警但不标记离线', async () => {
  const healthWrites = [];
  const statusWrites = [];
  const alertWrites = [];

  XuiService.getInstance = async () => ({
    getServerStatus: async () => ({ success: false, message: 'server/status timeout' }),
    getInbounds: async () => ({ success: false, message: 'connect timeout' })
  });
  telegramRepository.findServerHealthDetail = async () => ({ consecutive_failures: 1 });
  telegramRepository.upsertServerHealthCheck = async (_db, payload) => healthWrites.push(payload);
  telegramRepository.findOpenAlertByServerAndType = async () => null;
  telegramRepository.createAlert = async (_db, payload) => alertWrites.push(payload);
  telegramRepository.updateOpenAlert = async () => {};
  serversRepository.updateServerStatus = async (_db, serverId, status, lastCheckAt) => {
    statusWrites.push({ serverId, status, lastCheckAt });
  };

  await telegramMonitorService.checkSingleServerHealth({}, {
    id: 9,
    name: '意大利[AI]',
    api_url: 'https://it01.example.com',
    api_token: 'token',
    panel_version: '3.4.2'
  });

  assert.equal(healthWrites.length, 1);
  assert.equal(healthWrites[0].consecutiveFailures, 2);
  assert.equal(alertWrites.length, 1);
  assert.equal(alertWrites[0].alertType, 'panel_unreachable');
  assert.equal(statusWrites.length, 0);
});

test('健康巡检成功时清零失败次数并标记服务器在线', async () => {
  const healthWrites = [];
  const statusWrites = [];

  XuiService.getInstance = async () => ({
    getServerStatus: async () => ({
      success: true,
      data: { xrayState: 'running' }
    })
  });
  telegramRepository.findServerHealthDetail = async () => ({ consecutive_failures: 3 });
  telegramRepository.upsertServerHealthCheck = async (_db, payload) => healthWrites.push(payload);
  telegramRepository.findOpenAlertByServerAndType = async () => null;
  telegramRepository.resolveAlert = async () => {};
  serversRepository.updateServerStatus = async (_db, serverId, status, lastCheckAt) => {
    statusWrites.push({ serverId, status, lastCheckAt });
  };

  await telegramMonitorService.checkSingleServerHealth({}, {
    id: 9,
    name: '意大利[AI]',
    api_url: 'https://it01.example.com',
    api_token: 'token',
    panel_version: '3.4.2'
  });

  assert.equal(healthWrites.length, 1);
  assert.equal(healthWrites[0].consecutiveFailures, 0);
  assert.equal(statusWrites.length, 1);
  assert.equal(statusWrites[0].serverId, 9);
  assert.equal(statusWrites[0].status, 1);
});

test('巡检汇总按服务器健康结果统计而不是按 Promise 完成状态统计', async () => {
  trafficRepository.listAllServersForHealthCheck = async () => ([
    { id: 1, name: '正常服务器', api_url: 'https://healthy.example.com', api_token: 'token' },
    { id: 2, name: '超时服务器', api_url: 'https://timeout.example.com', api_token: 'token' }
  ]);
  XuiService.getInstance = async (apiUrl) => ({
    getServerStatus: async () => apiUrl.includes('healthy')
      ? { success: true, data: { xrayState: 'running' } }
      : { success: false, message: 'Request timeout' },
    getInbounds: async () => ({ success: false, message: 'Request timeout' })
  });
  telegramRepository.findServerHealthDetail = async () => ({ consecutive_failures: 0 });
  telegramRepository.upsertServerHealthCheck = async () => {};
  telegramRepository.findOpenAlertByServerAndType = async () => null;
  telegramRepository.createAlert = async () => {};
  telegramRepository.resolveAlert = async () => {};
  serversRepository.updateServerStatus = async () => {};

  const summary = await telegramMonitorService.checkAllServersHealth({});

  assert.deepEqual(summary, { total: 2, success: 1, failure: 1 });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

/**
 * 按需注入依赖后重新加载模块，便于隔离测试定时任务和健康巡检逻辑。
 *
 * @param {string} entryPath - 目标模块路径
 * @param {Object} stubs - 需要注入的依赖映射
 * @returns {*} 重新加载后的模块导出
 */
function loadWithStubs(entryPath, stubs) {
  const originalLoad = Module._load;

  delete require.cache[require.resolve(entryPath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    return require(entryPath);
  } finally {
    Module._load = originalLoad;
  }
}

/**
 * 创建无副作用日志器，避免测试输出被业务日志污染。
 *
 * @returns {{info: Function, warn: Function, error: Function}}
 */
function createSilentLogger() {
  return {
    info() {},
    warn() {},
    error() {}
  };
}

/**
 * 创建可断言的日志器，便于验证关键巡检日志是否输出。
 *
 * @param {Array} entries - 日志收集数组
 * @returns {{info: Function, warn: Function, error: Function}}
 */
function createCollectingLogger(entries) {
  return {
    info(message) {
      entries.push({ level: 'info', message });
    },
    warn(message) {
      entries.push({ level: 'warn', message });
    },
    error(message) {
      entries.push({ level: 'error', message });
    }
  };
}

/**
 * 创建立即执行处理函数的可控调度器，隔离生产环境的冷却计时器。
 * @returns {{scheduler: {schedule: Function}, scheduledTasks: Array<{name: string, promise: Promise<void>}>}}
 */
function createImmediateSchedulerStub() {
  const scheduledTasks = [];

  return {
    scheduledTasks,
    scheduler: {
      schedule(name, handler) {
        const promise = Promise.resolve().then(handler);
        scheduledTasks.push({ name, promise });
        return true;
      }
    }
  };
}

test('Telegram 服务器健康巡检任务注册周期改为 40 分钟一次', () => {
  let capturedDelay = null;
  const { scheduler } = createImmediateSchedulerStub();

  const { registerTelegramServerHealthCheckJob } = loadWithStubs('../jobs/handlers/telegram-server-health-check', {
    '../../services/shared/telegram-monitor-service': {
      async checkAllServersHealth() {}
    },
    '../../utils/logger': {
      createLogger: createSilentLogger
    },
    '../xui-job-scheduler': scheduler
  });

  const originalSetInterval = global.setInterval;
  global.setInterval = (callback, delay) => {
    capturedDelay = delay;
    return { callback, delay };
  };

  try {
    registerTelegramServerHealthCheckJob({
      db: {},
      intervals: [],
      registerTimeout() {}
    });
  } finally {
    global.setInterval = originalSetInterval;
  }

  assert.equal(capturedDelay, 40 * 60 * 1000);
});

test('Telegram 服务器健康巡检任务在上一轮未完成时不会重复触发且异常不会外抛', async () => {
  let intervalCallback = null;
  let resolveFirstRun = null;
  let callCount = 0;
  const { scheduler, scheduledTasks } = createImmediateSchedulerStub();

  const { registerTelegramServerHealthCheckJob } = loadWithStubs('../jobs/handlers/telegram-server-health-check', {
    '../../services/shared/telegram-monitor-service': {
      async checkAllServersHealth() {
        callCount += 1;
        if (callCount === 1) {
          await new Promise((resolve) => {
            resolveFirstRun = resolve;
          });
          return;
        }

        throw new Error('模拟巡检异常');
      }
    },
    '../../utils/logger': {
      createLogger: createSilentLogger
    },
    '../xui-job-scheduler': scheduler
  });

  const originalSetInterval = global.setInterval;
  global.setInterval = (callback) => {
    intervalCallback = callback;
    return { callback };
  };

  try {
    registerTelegramServerHealthCheckJob({
      db: {},
      intervals: [],
      registerTimeout() {}
    });
  } finally {
    global.setInterval = originalSetInterval;
  }

  assert.equal(typeof intervalCallback, 'function');

  assert.doesNotThrow(() => {
    intervalCallback();
    intervalCallback();
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callCount, 1);
  assert.deepEqual(
    scheduledTasks.map((task) => task.name),
    ['telegram-health-check', 'telegram-health-check']
  );

  resolveFirstRun();
  await assert.doesNotReject(Promise.all(scheduledTasks.map((task) => task.promise)));

  assert.doesNotThrow(() => {
    intervalCallback();
  });
  await assert.doesNotReject(scheduledTasks[2].promise);
  assert.equal(callCount, 2);
  assert.deepEqual(
    scheduledTasks.map((task) => task.name),
    [
      'telegram-health-check',
      'telegram-health-check',
      'telegram-health-check'
    ]
  );
});

test('任务中心会注册 Telegram 服务器健康巡检任务', () => {
  let registerCount = 0;

  const jobs = loadWithStubs('../jobs/index', {
    '../utils/logger': {
      createLogger: createSilentLogger
    },
    './handlers/mark-expired-orders': {
      registerMarkExpiredJob() {}
    },
    './handlers/delete-expired-orders': {
      registerDeleteExpiredJob() {}
    },
    './handlers/clean-zombie-users': {
      registerCleanZombieUsersJob() {}
    },
    './handlers/sync-xui-users': {
      registerXuiSyncJob() {}
    },
    './handlers/sync-xui-tasks': {
      registerXuiSyncTaskJob() {}
    },
    './handlers/clean-xui-sync-tasks': {
      registerCleanXuiSyncTasksJob() {}
    },
    './handlers/sync-traffic': {
      registerTrafficSyncJob() {}
    },
    './handlers/auto-close-tickets': {
      registerTicketAutoCloseJob() {}
    },
    './handlers/process-email-campaigns': {
      registerEmailCampaignJob() {}
    },
    './handlers/clean-email-logs': {
      registerCleanEmailLogsJob() {}
    },
    './handlers/backup-xui-db': {
      registerBackupXuiDbJob() {}
    },
    './handlers/resume-batch-subscription-tasks': {
      registerBatchSubscriptionTaskJob() {}
    },
    './handlers/telegram-server-health-check': {
      registerTelegramServerHealthCheckJob() {
        registerCount += 1;
      }
    }
  });

  jobs.startAllJobs({});
  jobs.stopAllJobs();

  assert.equal(registerCount, 1);
});

test('Telegram 巡检会先尝试 server/status，失败后再用 inbounds 判断鉴权失败', async () => {
  const healthWrites = [];
  const alertWrites = [];
  let getInboundsCallCount = 0;

  const telegramMonitorService = loadWithStubs('../services/shared/telegram-monitor-service', {
    '../../repositories/telegram-repository': {
      async upsertServerHealthCheck(db, payload) {
        healthWrites.push(payload);
      },
      async findOpenAlertByServerAndType() {
        return null;
      },
      async createAlert(db, payload) {
        alertWrites.push(payload);
      },
      async updateOpenAlert() {},
      async resolveAlert() {},
      async listServerHealthSummary() {
        return [];
      },
      async findServerHealthDetail() {
        return null;
      },
      async listRecentAlerts() {
        return [];
      },
      async listPendingAlerts() {
        return [];
      },
      async listAdminBindings() {
        return [];
      },
      async markAlertSent() {}
    },
    '../../repositories/traffic-repository': {
      async listOnlineServers() {
        return [];
      }
    },
    '../../integrations/xui/xui-service': {
      async getInstance() {
        return {
          async getInbounds() {
            getInboundsCallCount += 1;
            return {
              success: false,
              message: '3X-UI API request failed with status 401: Unauthorized'
            };
          },
          async getServerStatus() {
            return {
              success: false,
              message: 'Request timeout - server took too long to respond'
            };
          }
        };
      }
    }
  });

  await telegramMonitorService.checkSingleServerHealth({}, {
    id: 12,
    name: '香港 01',
    api_url: 'https://xui.example.com',
    api_token: 'token',
    panel_version: '3.0.2'
  });

  assert.equal(healthWrites.length, 1);
  assert.equal(getInboundsCallCount, 1);
  assert.equal(healthWrites[0].panelApiStatus, 'healthy');
  assert.equal(healthWrites[0].panelAuthStatus, 'unhealthy');
  assert.equal(healthWrites[0].failureReason, 'panel_auth_failed');
  assert.equal(alertWrites.length, 1);
  assert.equal(alertWrites[0].alertType, 'panel_unreachable');
});

test('Telegram 巡检成功时会写入标准化后的 xray 状态并清理告警', async () => {
  const healthWrites = [];
  const resolvedAlerts = [];
  let getInboundsCallCount = 0;

  const telegramMonitorService = loadWithStubs('../services/shared/telegram-monitor-service', {
    '../../repositories/telegram-repository': {
      async upsertServerHealthCheck(db, payload) {
        healthWrites.push(payload);
      },
      async findOpenAlertByServerAndType(db, serverId, alertType) {
        resolvedAlerts.push({ serverId, alertType, phase: 'find' });
        return {
          id: 99
        };
      },
      async createAlert() {},
      async updateOpenAlert() {},
      async resolveAlert(db, alertId) {
        resolvedAlerts.push({ alertId, phase: 'resolve' });
      },
      async listServerHealthSummary() {
        return [];
      },
      async findServerHealthDetail() {
        return null;
      },
      async listRecentAlerts() {
        return [];
      },
      async listPendingAlerts() {
        return [];
      },
      async listAdminBindings() {
        return [];
      },
      async markAlertSent() {}
    },
    '../../repositories/traffic-repository': {
      async listOnlineServers() {
        return [];
      }
    },
    '../../integrations/xui/xui-service': {
      async getInstance() {
        return {
          async getInbounds() {
            getInboundsCallCount += 1;
            return {
              success: true,
              data: []
            };
          },
          async getServerStatus() {
            return {
              success: true,
              data: {
                xrayState: 'Running'
              }
            };
          }
        };
      }
    }
  });

  await telegramMonitorService.checkSingleServerHealth({}, {
    id: 18,
    name: '美国 01',
    api_url: 'https://xui.example.com',
    api_token: 'token',
    panel_version: '3.0.2'
  });

  assert.equal(healthWrites.length, 1);
  assert.equal(getInboundsCallCount, 0);
  assert.equal(healthWrites[0].panelApiStatus, 'healthy');
  assert.equal(healthWrites[0].panelAuthStatus, 'healthy');
  assert.equal(healthWrites[0].xrayRuntimeStatus, 'running');
  assert.equal(healthWrites[0].failureReason, '');
  assert.deepEqual(resolvedAlerts, [
    { serverId: 18, alertType: 'panel_unreachable', phase: 'find' },
    { alertId: 99, phase: 'resolve' }
  ]);
});

test('Telegram 巡检在 server/status 失败但 inbounds 成功时仍写入 panel healthy 且 xray unknown', async () => {
  const healthWrites = [];
  let getInboundsCallCount = 0;

  const telegramMonitorService = loadWithStubs('../services/shared/telegram-monitor-service', {
    '../../repositories/telegram-repository': {
      async upsertServerHealthCheck(db, payload) {
        healthWrites.push(payload);
      },
      async findOpenAlertByServerAndType() {
        return null;
      },
      async createAlert() {},
      async updateOpenAlert() {},
      async resolveAlert() {},
      async listServerHealthSummary() {
        return [];
      },
      async findServerHealthDetail() {
        return null;
      },
      async listRecentAlerts() {
        return [];
      },
      async listPendingAlerts() {
        return [];
      },
      async listAdminBindings() {
        return [];
      },
      async markAlertSent() {}
    },
    '../../repositories/traffic-repository': {
      async listOnlineServers() {
        return [];
      }
    },
    '../../integrations/xui/xui-service': {
      async getInstance() {
        return {
          async getServerStatus() {
            return {
              success: false,
              message: 'server status unavailable'
            };
          },
          async getInbounds() {
            getInboundsCallCount += 1;
            return {
              success: true,
              data: []
            };
          }
        };
      }
    }
  });

  await telegramMonitorService.checkSingleServerHealth({}, {
    id: 19,
    name: '日本 02',
    api_url: 'https://xui.example.com',
    api_token: 'token',
    panel_version: '3.0.2'
  });

  assert.equal(getInboundsCallCount, 1);
  assert.equal(healthWrites.length, 1);
  assert.equal(healthWrites[0].panelApiStatus, 'healthy');
  assert.equal(healthWrites[0].panelAuthStatus, 'healthy');
  assert.equal(healthWrites[0].xrayRuntimeStatus, 'unknown');
  assert.equal(healthWrites[0].failureDetail, 'server status unavailable');
});

test('Telegram 巡检会输出开始、单机过程和汇总结果日志', async () => {
  const logEntries = [];

  const telegramMonitorService = loadWithStubs('../services/shared/telegram-monitor-service', {
    '../../utils/logger': {
      createLogger() {
        return createCollectingLogger(logEntries);
      }
    },
    '../../repositories/telegram-repository': {
      async upsertServerHealthCheck() {},
      async findOpenAlertByServerAndType() {
        return null;
      },
      async createAlert() {},
      async updateOpenAlert() {},
      async resolveAlert() {},
      async listServerHealthSummary() {
        return [];
      },
      async findServerHealthDetail() {
        return null;
      },
      async listRecentAlerts() {
        return [];
      },
      async listPendingAlerts() {
        return [];
      },
      async listAdminBindings() {
        return [];
      },
      async markAlertSent() {}
    },
    '../../repositories/traffic-repository': {
      async listAllServersForHealthCheck() {
        return [{
          id: 21,
          name: '新加坡 01',
          api_url: 'https://xui.example.com',
          api_token: 'token',
          panel_version: '3.2.5'
        }];
      }
    },
    '../../integrations/xui/xui-service': {
      async getInstance() {
        return {
          async getInbounds() {
            return {
              success: true,
              data: [{ id: 1 }]
            };
          },
          async getServerStatus() {
            return {
              success: true,
              data: {
                xrayState: 'running'
              }
            };
          }
        };
      }
    }
  });

  await telegramMonitorService.checkAllServersHealth({});

  const messages = logEntries.map((entry) => entry.message);
  assert.ok(messages.some((message) => message.includes('开始执行 Telegram 服务器健康巡检')));
  assert.ok(messages.some((message) => message.includes('服务器 新加坡 01 巡检结果: panel_api_status=healthy, panel_auth_status=healthy, xray_runtime_status=running')));
  assert.ok(!messages.some((message) => message.includes('开始巡检服务器 新加坡 01')));
  assert.ok(!messages.some((message) => message.includes('服务器 新加坡 01 面板连通成功')));
  assert.ok(!messages.some((message) => message.includes('服务器 新加坡 01 Xray 状态: running')));
  assert.ok(messages.some((message) => message.includes('Telegram 服务器健康巡检完成')));
});

test('Telegram 巡检应覆盖所有已配置服务器而不只查 status=1', async () => {
  const checkedServerIds = [];
  const healthWrites = [];
  const alertWrites = [];

  const telegramMonitorService = loadWithStubs('../services/shared/telegram-monitor-service', {
    '../../utils/logger': {
      createLogger: createSilentLogger
    },
    '../../repositories/telegram-repository': {
      async upsertServerHealthCheck(db, payload) {
        healthWrites.push(payload);
      },
      async findOpenAlertByServerAndType() {
        return null;
      },
      async createAlert(db, payload) {
        alertWrites.push(payload);
      },
      async updateOpenAlert() {},
      async resolveAlert() {},
      async listServerHealthSummary() {
        return [];
      },
      async findServerHealthDetail() {
        return null;
      },
      async listRecentAlerts() {
        return [];
      },
      async listPendingAlerts() {
        return [];
      },
      async listAdminBindings() {
        return [];
      },
      async markAlertSent() {}
    },
    '../../repositories/traffic-repository': {
      async listOnlineServers() {
        return [{
          id: 1,
          name: 'online-server',
          api_url: 'https://online.example.com',
          api_token: 'token',
          panel_version: '3.2.5'
        }];
      },
      async listAllServersForHealthCheck() {
        return [
          {
            id: 1,
            name: 'online-server',
            api_url: 'https://online.example.com',
            api_token: 'token',
            panel_version: '3.2.5',
            status: 1
          },
          {
            id: 2,
            name: 'offline-server',
            api_url: 'https://offline.example.com',
            api_token: 'token',
            panel_version: '3.2.5',
            status: 0
          }
        ];
      }
    },
    '../../integrations/xui/xui-service': {
      async getInstance(apiUrl) {
        const serverId = apiUrl.includes('offline') ? 2 : 1;
        checkedServerIds.push(serverId);

        if (serverId === 2) {
          throw new Error('connect ECONNREFUSED');
        }

        return {
          async getServerStatus() {
            return {
              success: true,
              data: {
                xrayState: 'running'
              }
            };
          },
          async getInbounds() {
            return {
              success: true,
              data: []
            };
          }
        };
      }
    }
  });

  await telegramMonitorService.checkAllServersHealth({});

  assert.deepEqual([...checkedServerIds].sort((a, b) => a - b), [1, 2]);
  assert.deepEqual(healthWrites.map((item) => item.serverId).sort((a, b) => a - b), [1, 2]);
  assert.equal(healthWrites.find((item) => item.serverId === 2).panelApiStatus, 'unhealthy');
  assert.equal(alertWrites.length, 1);
  assert.equal(alertWrites[0].serverId, 2);
});

test('流量同步任务不再写入 Telegram 健康表', async () => {
  const healthCalls = [];
  const alertCalls = [];

  const trafficManager = loadWithStubs('../services/shared/traffic-manager', {
    '../../integrations/xui/xui-service': {
      async getInstance() {
        return {
          async getInbounds() {
            return {
              success: false,
              message: 'Request timeout - server took too long to respond'
            };
          }
        };
      }
    },
    '../../integrations/xui/xui-sync-task-service': {
      TASK_TYPES: {
        DISABLE_SYNC: 'disable',
        ENABLE_SYNC: 'enable'
      },
      async enqueueTask() {}
    },
    './user-status-lock': {
      async withUserStatusLock(db, userId, handler) {
        return handler();
      }
    },
    './renew-policy': {
      DISABLE_REASONS: {
        TRAFFIC_LIMIT: 'traffic_limit'
      }
    },
    '../../utils/logger': {
      createLogger: createSilentLogger
    },
    '../../repositories/traffic-repository': {
      async listOnlineServers() {
        return [{
          id: 3,
          name: '日本 01',
          api_url: 'https://xui.example.com',
          api_token: 'token',
          panel_version: '3.0.2'
        }];
      },
      async listEnabledUsersForTrafficSync() {
        return [];
      }
    },
    './telegram-monitor-service': {
      async recordServerHealthCheck(db, payload) {
        healthCalls.push(payload);
      },
      async openOrUpdateAlert(db, payload) {
        alertCalls.push(payload);
      },
      async resolveAlert(db, serverId) {
        alertCalls.push({ serverId });
      }
    }
  });

  await trafficManager.syncTrafficAndHandleDisable({});

  assert.equal(healthCalls.length, 0);
  assert.equal(alertCalls.length, 0);
});

test('Telegram 健康巡检最大并发 10 且单台失败不阻断其他服务器', async () => {
  let activeCount = 0;
  let maxActiveCount = 0;
  const checkedServerIds = [];

  const telegramMonitorService = loadWithStubs('../services/shared/telegram-monitor-service', {
    '../../utils/logger': {
      createLogger: createSilentLogger
    },
    '../../repositories/telegram-repository': {
      async upsertServerHealthCheck() {},
      async findOpenAlertByServerAndType() {
        return null;
      },
      async createAlert() {},
      async updateOpenAlert() {},
      async resolveAlert() {}
    },
    '../../repositories/traffic-repository': {
      async listAllServersForHealthCheck() {
        return Array.from({ length: 25 }, (_, index) => ({
          id: index + 1,
          name: `server-${index + 1}`,
          api_url: `https://xui/${index + 1}`,
          api_token: 'token',
          panel_version: '3.0.2'
        }));
      }
    },
    '../../integrations/xui/xui-service': {
      async getInstance(apiUrl) {
        const serverId = Number(apiUrl.split('/').pop());
        return {
          async getServerStatus() {
            checkedServerIds.push(serverId);
            activeCount += 1;
            maxActiveCount = Math.max(maxActiveCount, activeCount);
            try {
              await new Promise((resolve) => setTimeout(resolve, 10));
              if (serverId === 7) {
                throw new Error('模拟单台巡检失败');
              }
              return {
                success: true,
                data: { xrayState: 'running' }
              };
            } finally {
              activeCount -= 1;
            }
          }
        };
      }
    }
  });

  await telegramMonitorService.checkAllServersHealth({});

  assert.equal(maxActiveCount, 10);
  assert.equal(checkedServerIds.length, 25);
  assert.deepEqual(
    [...checkedServerIds].sort((a, b) => a - b),
    Array.from({ length: 25 }, (_, index) => index + 1)
  );
});

test('4 小时账号同步任务仍不写入 Telegram 健康表', async () => {
  const healthCalls = [];
  const alertCalls = [];

  const { registerXuiSyncJob } = loadWithStubs('../jobs/handlers/sync-xui-users', {
    '../../integrations/xui/xui-service': {
      async getInstance() {
        return {
          async getInbounds() {
            return {
              success: true,
              data: [{ id: 101, remark: 'CF-1', protocol: 'vless' }]
            };
          },
          async upsertUniqueClient() {
            return { success: true, action: 'add' };
          }
        };
      }
    },
    '../../repositories/xui-sync-repository': {
      async listUsersForXuiSync() {
        return [{
          id: 1,
          email: 'user@example.com',
          enabled: 1,
          traffic_limit: 0,
          referral_traffic_limit: 0,
          expire_at: 0
        }];
      },
      async listOnlineXuiServers() {
        return [{
          id: 1,
          name: '香港 01',
          api_url: 'https://xui.example.com',
          api_token: 'token',
          panel_version: '3.0.2'
        }];
      },
      async findUserNodeConfig() {
        return null;
      }
    },
    '../../services/shared/xui-node-snapshot-service': {
      async refreshServerNodeSnapshots() {
        return { nodeCount: 1 };
      }
    },
    '../../services/shared/telegram-monitor-service': {
      async recordServerHealthCheck(...args) {
        healthCalls.push(args);
      },
      async openOrUpdateAlert(...args) {
        alertCalls.push(args);
      },
      async resolveAlert(...args) {
        alertCalls.push(args);
      }
    },
    '../../utils/logger': {
      createLogger: createSilentLogger
    },
    '../../utils/xui-auth': {
      isValidXuiAuth() {
        return true;
      },
      generateXuiAuth() {
        return 'generated-auth';
      }
    }
  });

  let firstRun = null;
  const originalSetInterval = global.setInterval;
  global.setInterval = () => ({});

  try {
    registerXuiSyncJob({
      db: {},
      intervals: [],
      registerTimeout(callback) {
        firstRun = callback;
      }
    });

    await firstRun();
  } finally {
    global.setInterval = originalSetInterval;
  }

  assert.equal(healthCalls.length, 0);
  assert.equal(alertCalls.length, 0);
});

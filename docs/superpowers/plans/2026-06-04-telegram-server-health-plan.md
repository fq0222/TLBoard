# Telegram 服务器健康巡检实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立的 Telegram 服务器健康巡检任务，每 40 分钟更新面板健康与 Xray 运行状态，并移除 `traffic-manager` 中原有的 Telegram 健康写入。

**Architecture:** 在 `xui-api-client-v302/v325` 与 `XuiService` 中新增 `server/status` 访问能力，再由独立的 Telegram 巡检任务统一遍历在线服务器、写入 `telegram_server_health_checks`、维护告警。`traffic-manager` 仅保留流量同步职责，不再负责 Telegram 健康状态。

**Tech Stack:** Node.js、Express、PostgreSQL、3X-UI API、node:test、PowerShell 测试脚本

---

### Task 1: 为 XUI API 客户端补齐 server/status 能力

**Files:**
- Modify: `server/integrations/xui/xui-api-client-v302.js`
- Modify: `server/integrations/xui/xui-api-client-v325.js`
- Test: `server/test/test-xui-api-client.js`

- [ ] **Step 1: 在客户端测试中先写失败断言**

```javascript
  await client.getServerStatus();
  await v325Client.getServerStatus();

  assert.strictEqual(requests[3].method, 'get');
  assert.strictEqual(requests[3].url, '/panel/api/server/status');
  assert.strictEqual(requests[3].headers.Authorization, 'Bearer secret-token');

  assert.strictEqual(requests[10].method, 'get');
  assert.strictEqual(requests[10].url, '/panel/api/server/status');
```

- [ ] **Step 2: 运行测试确认当前失败**

Run: `node server/test/test-xui-api-client.js`  
Expected: FAIL，提示 `getServerStatus is not a function` 或请求序列断言不匹配

- [ ] **Step 3: 在 v302 客户端中新增 server/status 方法，并让 v325 复用**

```javascript
  getServerStatus() {
    return this.request('get', `${this.serverBasePath}/status`);
  }
```

```javascript
class XuiApiClientV325 extends XuiApiClientV302 {
  constructor(baseURL, apiToken, options = {}) {
    super(baseURL, apiToken, options);
    this.version = '3.2.5';
    this.supportsClientApi = true;
    this.clientBasePath = '/panel/api/clients';
  }
}
```

- [ ] **Step 4: 重新运行客户端测试确认通过**

Run: `node server/test/test-xui-api-client.js`  
Expected: PASS，输出 `test-xui-api-client: PASS`

- [ ] **Step 5: 提交这一小步变更**

```bash
git add server/integrations/xui/xui-api-client-v302.js server/integrations/xui/xui-api-client-v325.js server/test/test-xui-api-client.js
git commit -m "补充XUI服务状态接口访问能力"
```

### Task 2: 在 XuiService 中增加安全的 server/status 封装

**Files:**
- Modify: `server/integrations/xui/xui-service.js`
- Test: `server/test/test-xui-service.js`

- [ ] **Step 1: 先在 XuiService 测试里写失败用例**

```javascript
async function testGetServerStatusShouldReturnStructuredResult() {
  const service = new XuiService('https://xui.example.com', 'token')
  service.client = {
    async getServerStatus() {
      return {
        success: true,
        obj: {
          xray: {
            state: 'running'
          }
        }
      }
    }
  }

  const result = await service.getServerStatus()
  assert.deepStrictEqual(result, {
    success: true,
    data: {
      xrayState: 'running',
      raw: {
        success: true,
        obj: {
          xray: {
            state: 'running'
          }
        }
      }
    }
  })
}
```

- [ ] **Step 2: 运行测试确认当前失败**

Run: `node server/test/test-xui-service.js`  
Expected: FAIL，提示 `service.getServerStatus is not a function`

- [ ] **Step 3: 在 XuiService 中新增安全封装与解析逻辑**

```javascript
  extractXrayState(payload = {}) {
    const candidates = [
      payload?.obj?.xray?.state,
      payload?.obj?.xrayState,
      payload?.obj?.xray?.status,
      payload?.obj?.state?.xray,
      payload?.xray?.state
    ];

    for (const candidate of candidates) {
      if (candidate !== null && candidate !== undefined && candidate !== '') {
        return String(candidate).trim();
      }
    }

    return '';
  }

  async getServerStatus() {
    try {
      if (!this.client) {
        await this.init();
      }

      const response = await this.client.getServerStatus();
      if (!response || response.success !== true) {
        return {
          success: false,
          message: response?.msg || '获取服务器状态失败',
          data: {
            xrayState: 'unknown',
            raw: response || null
          }
        };
      }

      const xrayState = this.extractXrayState(response) || 'unknown';
      return {
        success: true,
        data: {
          xrayState,
          raw: response
        }
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        data: {
          xrayState: 'unknown',
          raw: null
        }
      };
    }
  }
```

- [ ] **Step 4: 重新运行 XuiService 测试确认通过**

Run: `node server/test/test-xui-service.js`  
Expected: PASS，新增 server/status 相关断言通过

- [ ] **Step 5: 提交这一小步变更**

```bash
git add server/integrations/xui/xui-service.js server/test/test-xui-service.js
git commit -m "封装XUI服务状态安全读取逻辑"
```

### Task 3: 新增 Telegram 独立服务器健康巡检任务

**Files:**
- Create: `server/jobs/handlers/telegram-server-health-check.js`
- Modify: `server/services/shared/telegram-monitor-service.js`
- Modify: `server/jobs/index.js`
- Test: `server/test/test-telegram-health-sync.js`

- [ ] **Step 1: 先补新的失败用例，覆盖独立任务与 40 分钟调度**

```javascript
test('Telegram 服务器健康巡检任务注册周期改为 40 分钟一次', () => {
  let capturedDelay = null;

  const { registerTelegramServerHealthCheckJob } = loadWithStubs('../jobs/handlers/telegram-server-health-check', {
    '../../services/shared/telegram-monitor-service': {
      async checkAllServersHealth() {}
    },
    '../../utils/logger': {
      createLogger: createSilentLogger
    }
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
```

- [ ] **Step 2: 运行测试确认当前失败**

Run: `node --test server/test/test-telegram-health-sync.js`  
Expected: FAIL，提示找不到 `registerTelegramServerHealthCheckJob` 或调度断言失败

- [ ] **Step 3: 在 telegram-monitor-service 中抽出统一巡检入口**

```javascript
async function checkAllServersHealth(db) {
  const servers = await trafficRepository.listOnlineServers(db);
  for (const server of servers) {
    await checkSingleServerHealth(db, server);
  }
}

async function checkSingleServerHealth(db, server) {
  const checkedAt = Math.floor(Date.now() / 1000);
  try {
    const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
      apiVersion: server.panel_version || '3.0.2'
    });

    const inboundsResult = await xuiService.getInbounds();
    if (!inboundsResult.success) {
      return await recordServerHealthCheck(db, {
        server_id: server.id,
        panel_api_status: classifyPanelFailure(inboundsResult.message).panelApiStatus,
        panel_auth_status: classifyPanelFailure(inboundsResult.message).panelAuthStatus,
        xray_runtime_status: 'unknown',
        last_failure_at: checkedAt,
        last_checked_at: checkedAt,
        consecutive_failures: 1,
        failure_reason: classifyPanelFailure(inboundsResult.message).failureReason,
        failure_detail: inboundsResult.message || ''
      });
    }

    const serverStatusResult = await xuiService.getServerStatus();
    const xrayRuntimeStatus = normalizeXrayRuntimeStatus(serverStatusResult.data?.xrayState);

    await recordServerHealthCheck(db, {
      server_id: server.id,
      panel_api_status: 'healthy',
      panel_auth_status: 'healthy',
      xray_runtime_status: xrayRuntimeStatus,
      last_success_at: checkedAt,
      last_checked_at: checkedAt,
      consecutive_failures: 0,
      failure_reason: '',
      failure_detail: serverStatusResult.success ? '' : (serverStatusResult.message || '')
    });
  } catch (error) {
    await recordServerHealthCheck(db, {
      server_id: server.id,
      panel_api_status: 'unhealthy',
      panel_auth_status: 'unknown',
      xray_runtime_status: 'unknown',
      last_failure_at: checkedAt,
      last_checked_at: checkedAt,
      consecutive_failures: 1,
      failure_reason: 'server_health_check_exception',
      failure_detail: error.message
    });
  }
}
```

- [ ] **Step 4: 新建 Telegram 巡检任务文件并注册到 jobs/index.js**

```javascript
const telegramMonitorService = require('../../services/shared/telegram-monitor-service');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('JOBS');

function registerTelegramServerHealthCheckJob({ db, intervals, registerTimeout }) {
  registerTimeout(async () => {
    await telegramMonitorService.checkAllServersHealth(db);
  }, 2 * 60 * 1000);

  const interval = setInterval(async () => {
    await telegramMonitorService.checkAllServersHealth(db);
  }, 40 * 60 * 1000);

  intervals.push(interval);
  logger.info('Telegram 服务器健康巡检任务已注册（每 40 分钟执行一次）');
}

module.exports = {
  registerTelegramServerHealthCheckJob
};
```

- [ ] **Step 5: 重新运行 Telegram 健康测试确认通过**

Run: `node --test server/test/test-telegram-health-sync.js`  
Expected: PASS，新增 40 分钟调度与独立任务断言通过

- [ ] **Step 6: 提交这一小步变更**

```bash
git add server/jobs/handlers/telegram-server-health-check.js server/services/shared/telegram-monitor-service.js server/jobs/index.js server/test/test-telegram-health-sync.js
git commit -m "新增Telegram服务器健康巡检任务"
```

### Task 4: 从 traffic-manager 移除原有 Telegram 健康写入

**Files:**
- Modify: `server/services/shared/traffic-manager.js`
- Test: `server/test/test-telegram-health-sync.js`
- Test: `server/test/test-traffic-manager-reset.js`

- [ ] **Step 1: 先补失败断言，确保 traffic-manager 不再写 Telegram 健康表**

```javascript
test('流量同步任务不再负责写入 Telegram 健康状态', async () => {
  const healthCalls = [];

  const trafficManager = loadWithStubs('../services/shared/traffic-manager', {
    '../../services/shared/telegram-monitor-service': {
      async recordServerHealthCheck(db, payload) {
        healthCalls.push(payload);
      }
    }
  });

  await trafficManager.syncTrafficAndHandleDisable({});
  assert.equal(healthCalls.length, 0);
});
```

- [ ] **Step 2: 运行测试确认当前失败**

Run: `node --test server/test/test-telegram-health-sync.js`  
Expected: FAIL，提示 `healthCalls.length` 不为 0

- [ ] **Step 3: 删除 traffic-manager 中现有面板健康相关逻辑**

```javascript
const logger = createLogger('TRAFFIC-MANAGER');

async function fetchAllServerTraffic(db) {
  try {
    const servers = await trafficRepository.listOnlineServers(db);
    if (servers.length === 0) {
      logger.warn('没有在线服务器');
      return {};
    }

    const serverTrafficData = {};
    const promises = servers.map(async (server) => {
      try {
        const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
          apiVersion: server.panel_version || '3.0.2'
        });

        const inboundsResult = await xuiService.getInbounds();
        if (!inboundsResult.success) {
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败: ${inboundsResult.message}`);
          return;
        }

        // 原有流量汇总逻辑保持不变
      } catch (error) {
        logger.error(`获取服务器 ${server.name} 流量数据错误: ${error.message}`);
      }
    });
```

- [ ] **Step 4: 重新运行相关测试确认 traffic-manager 只保留流量职责**

Run: `node --test server/test/test-telegram-health-sync.js`  
Expected: PASS

Run: `node server/test/test-traffic-manager-reset.js`  
Expected: 退出码 0

- [ ] **Step 5: 提交这一小步变更**

```bash
git add server/services/shared/traffic-manager.js server/test/test-telegram-health-sync.js
git commit -m "移除流量同步中的Telegram健康写入"
```

### Task 5: 用真实脚本验证 server/status 返回结构

**Files:**
- Create: `server/test/test-telegram-server-status-live.js`

- [ ] **Step 1: 新增只读验证脚本**

```javascript
const databaseManager = require('../db/init');
const trafficRepository = require('../repositories/traffic-repository');
const XuiService = require('../integrations/xui/xui-service');

async function main() {
  const db = await databaseManager.init();
  try {
    const servers = await trafficRepository.listOnlineServers(db);
    for (const server of servers) {
      const xuiService = await XuiService.getInstance(server.api_url, server.api_token, {
        apiVersion: server.panel_version || '3.0.2'
      });
      const result = await xuiService.getServerStatus();
      console.log(`SERVER ${server.id} ${server.name}`);
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    await databaseManager.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: 运行只读脚本拿真实返回值**

Run: `node server/test/test-telegram-server-status-live.js`  
Expected: 打印每台服务器 `/panel/api/server/status` 的真实返回结构与解析后的 `xrayState`

- [ ] **Step 3: 根据真实返回值微调 xray state 提取逻辑**

```javascript
  extractXrayState(payload = {}) {
    const candidates = [
      payload?.obj?.xray?.state,
      payload?.obj?.xray?.status,
      payload?.obj?.appStats?.xray?.state,
      payload?.obj?.status?.xray,
      payload?.obj?.state?.xray
    ];
```

- [ ] **Step 4: 再次运行只读脚本确认解析结果稳定**

Run: `node server/test/test-telegram-server-status-live.js`  
Expected: 输出中的 `xrayState` 与面板实际状态一致，且无未处理异常

- [ ] **Step 5: 提交这一小步变更**

```bash
git add server/test/test-telegram-server-status-live.js server/integrations/xui/xui-service.js
git commit -m "验证并适配Xray运行状态返回结构"
```

### Task 6: 完整回归验证

**Files:**
- Test: `server/test/test-xui-api-client.js`
- Test: `server/test/test-xui-service.js`
- Test: `server/test/test-telegram-health-sync.js`
- Test: `server/test/test-traffic-manager-reset.js`
- Test: `server/test/test-xui-unique-client-sync.js`

- [ ] **Step 1: 运行客户端接口测试**

Run: `node server/test/test-xui-api-client.js`  
Expected: 输出 `test-xui-api-client: PASS`

- [ ] **Step 2: 运行 XuiService 测试**

Run: `node server/test/test-xui-service.js`  
Expected: PASS

- [ ] **Step 3: 运行 Telegram 健康巡检测试**

Run: `node --test server/test/test-telegram-health-sync.js`  
Expected: PASS

- [ ] **Step 4: 运行流量与唯一客户端回归测试**

Run: `node server/test/test-traffic-manager-reset.js`  
Expected: 退出码 0

Run: `node server/test/test-xui-unique-client-sync.js`  
Expected: 输出 `xui unique client sync tests passed`

- [ ] **Step 5: 汇总日志并提交最终变更**

```bash
git add server/integrations/xui/xui-api-client-v302.js server/integrations/xui/xui-api-client-v325.js server/integrations/xui/xui-service.js server/services/shared/telegram-monitor-service.js server/jobs/handlers/telegram-server-health-check.js server/jobs/index.js server/services/shared/traffic-manager.js server/test/test-xui-api-client.js server/test/test-xui-service.js server/test/test-telegram-health-sync.js server/test/test-telegram-server-status-live.js
git commit -m "新增Telegram服务器健康巡检任务"
```

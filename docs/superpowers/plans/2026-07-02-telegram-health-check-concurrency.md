# Telegram 服务器健康巡检并发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Telegram 服务器健康巡检改为最大并发数 10，同时保持单服务器探测与回退逻辑不变。

**Architecture:** 保留现有 `checkSingleServerHealth(db, server)`，仅调整 `checkAllServersHealth(db)` 的服务器调度。复用项目已有的 `runWithConcurrency()`，以 all-settled 语义隔离单台失败并汇总执行结果。

**Tech Stack:** Node.js CommonJS、Node.js `node:test`、项目现有并发工具

## Global Constraints

- 最大并发数固定为 10。
- `getServerStatus()` 失败后调用 `getInbounds()` 的逻辑不得修改。
- 单台服务器失败不得中断其他服务器。
- 不新增依赖、配置项或数据库变更。
- 修改 `server/**/*.js` 后不启动服务，只提醒用户重启。

---

## 文件结构

- Modify: `server/services/shared/telegram-monitor-service.js`
  - 引入现有并发工具并定义巡检并发常量。
  - 将服务器串行循环替换为限流并发调度。
- Modify: `server/test/test-telegram-health-sync.js`
  - 增加最大并发数、全量执行和失败隔离的回归测试。

### Task 1: 增加并发调度失败测试

**Files:**
- Modify: `server/test/test-telegram-health-sync.js`
- Test: `server/test/test-telegram-health-sync.js`

**Interfaces:**
- Consumes: `telegramMonitorService.checkAllServersHealth(db)`
- Produces: 最大并发 10、全量执行、单台失败隔离的回归约束

- [ ] **Step 1: 写并发上限测试**

在 `server/test/test-telegram-health-sync.js` 增加测试，构造 25 台服务器，并在模拟 `getServerStatus()` 中记录活动任务数：

```javascript
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
  assert.deepEqual([...checkedServerIds].sort((a, b) => a - b), Array.from({ length: 25 }, (_, index) => index + 1));
});
```

- [ ] **Step 2: 运行测试并确认红灯**

```powershell
node --test server/test/test-telegram-health-sync.js
```

Expected: 新测试在 `maxActiveCount` 断言处失败，实际值为 `1`，证明当前仍是串行调度。

### Task 2: 实现最大并发 10

**Files:**
- Modify: `server/services/shared/telegram-monitor-service.js`
- Test: `server/test/test-telegram-health-sync.js`

**Interfaces:**
- Consumes: `runWithConcurrency(items, limit, worker)` from `../../utils/concurrency`
- Produces: `checkAllServersHealth(db)` 的限流并发行为

- [ ] **Step 1: 引入并发工具并定义常量**

```javascript
const { runWithConcurrency } = require('../../utils/concurrency');

const TELEGRAM_HEALTH_CHECK_CONCURRENCY = 10;
```

- [ ] **Step 2: 替换串行循环**

```javascript
const results = await runWithConcurrency(
  servers,
  TELEGRAM_HEALTH_CHECK_CONCURRENCY,
  (server) => checkSingleServerHealth(db, server)
);

const successCount = results.filter((result) => result.status === 'fulfilled').length;
const failureCount = results.length - successCount;

results.forEach((result, index) => {
  if (result.status === 'rejected') {
    logger.error(`服务器 ${servers[index].name} 巡检执行失败: ${result.reason?.message || result.reason}`);
  }
});
```

不修改 `checkSingleServerHealth()`。

- [ ] **Step 3: 运行测试并确认绿灯**

```powershell
node --test server/test/test-telegram-health-sync.js
```

Expected: 所有 Telegram 健康巡检测试通过，失败数为 0。

### Task 3: 完整验证

**Files:**
- Test: `server/test/test-telegram-health-sync.js`

**Interfaces:**
- Consumes: 修改后的巡检服务
- Produces: 可交付的测试日志

- [ ] **Step 1: 重新运行完整相关测试**

```powershell
node --test server/test/test-telegram-health-sync.js
```

Expected: 测试进程退出码为 0，输出中 `fail 0`。

- [ ] **Step 2: 检查变更**

```powershell
git diff --check
git diff -- server/services/shared/telegram-monitor-service.js server/test/test-telegram-health-sync.js
```

Expected: `git diff --check` 无输出，差异仅包含并发调度和对应测试。

- [ ] **Step 3: 交付提醒**

最终说明中展示测试命令和通过日志，并提醒：

```text
本次修改涉及 server/**/*.js，请重启后端服务使新逻辑生效。
```

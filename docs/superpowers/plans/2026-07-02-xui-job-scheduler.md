# 3X-UI 定时任务统一调度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 3X-UI 用户同步、流量同步和 Telegram 健康巡检串行执行，并在上一任务实际结束后至少等待 5 分钟再启动下一任务。

**Architecture:** 新增一个进程内 FIFO 调度器，负责跨任务互斥、结束后冷却和同名触发合并。三个现有 handler 保留原触发周期，只把业务执行函数提交给调度器；任务中心在停止时同步清理调度器。

**Tech Stack:** Node.js CommonJS、Node.js `node:test`、项目现有日志工具、原生 `setTimeout`

## Global Constraints

- 只调度 `xui-user-sync`、`traffic-sync`、`telegram-health-check`。
- 冷却时间固定为上一任务实际结束后的 5 分钟。
- 第一个任务可立即执行。
- 同名任务正在运行或排队时，重复触发直接合并。
- 保持三个任务现有首次延迟和执行周期不变。
- 成功和失败都必须进入冷却期；失败不能阻塞后续任务。
- 不新增第三方依赖、数据库字段或跨进程协调。
- 不修改 3X-UI 同步重试、数据库备份和批量订阅任务。
- 新增文件和方法补充职责、关键参数及核心分支注释。
- 修改 `server/**/*.js` 后不启动服务，交付时提醒用户重启。

---

## 文件结构

- Create: `server/jobs/xui-job-scheduler.js`
  - 实现单进程 FIFO、同名合并、5 分钟冷却、日志和停止清理。
- Create: `server/test/test-xui-job-scheduler.js`
  - 使用短冷却时间测试调度器，不等待真实 5 分钟。
- Modify: `server/jobs/handlers/sync-xui-users.js`
  - 将用户同步业务调用提交为 `xui-user-sync`。
- Modify: `server/jobs/handlers/sync-traffic.js`
  - 将流量同步业务调用提交为 `traffic-sync`。
- Modify: `server/jobs/handlers/telegram-server-health-check.js`
  - 将健康巡检业务调用提交为 `telegram-health-check`。
- Modify: `server/jobs/index.js`
  - 停止全部任务时清空统一调度器。

### Task 1: 用失败测试定义调度语义

**Files:**
- Create: `server/test/test-xui-job-scheduler.js`
- Test: `server/test/test-xui-job-scheduler.js`

**Interfaces:**
- Consumes: `createXuiJobScheduler(options)`
- Produces: 对 `schedule(name, handler)`、`stop()` 的行为约束

- [ ] **Step 1: 创建最小测试骨架**

使用 Node.js 原生测试模块，并准备事件记录和条件等待工具：

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { createXuiJobScheduler } = require('../jobs/xui-job-scheduler');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 500) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('等待条件超时');
    }
    await delay(2);
  }
}
```

- [ ] **Step 2: 增加串行和结束后冷却测试**

```javascript
test('不同任务串行执行，并从上一任务结束后计算冷却时间', async () => {
  const events = [];
  const scheduler = createXuiJobScheduler({ cooldownMs: 30 });

  scheduler.schedule('first', async () => {
    events.push({ name: 'first-start', at: Date.now() });
    await delay(15);
    events.push({ name: 'first-end', at: Date.now() });
  });
  scheduler.schedule('second', async () => {
    events.push({ name: 'second-start', at: Date.now() });
  });

  await waitFor(() => events.some(event => event.name === 'second-start'));

  const firstEnd = events.find(event => event.name === 'first-end').at;
  const secondStart = events.find(event => event.name === 'second-start').at;
  assert.ok(secondStart - firstEnd >= 25);
  assert.deepEqual(events.map(event => event.name), [
    'first-start',
    'first-end',
    'second-start'
  ]);
  scheduler.stop();
});
```

- [ ] **Step 3: 增加同名运行中与排队中合并测试**

```javascript
test('同名任务运行中或排队时只保留一次执行', async () => {
  const counts = { running: 0, queued: 0 };
  const scheduler = createXuiJobScheduler({ cooldownMs: 10 });

  scheduler.schedule('running', async () => {
    counts.running += 1;
    await delay(20);
  });
  scheduler.schedule('running', async () => {
    counts.running += 1;
  });
  scheduler.schedule('queued', async () => {
    counts.queued += 1;
  });
  scheduler.schedule('queued', async () => {
    counts.queued += 1;
  });

  await waitFor(() => counts.queued === 1);
  assert.deepEqual(counts, { running: 1, queued: 1 });
  scheduler.stop();
});
```

- [ ] **Step 4: 增加异常恢复与停止清理测试**

```javascript
test('任务失败后继续调度，停止后不再启动排队任务', async () => {
  const events = [];
  const scheduler = createXuiJobScheduler({ cooldownMs: 10 });

  scheduler.schedule('failure', async () => {
    events.push('failure');
    throw new Error('模拟失败');
  });
  scheduler.schedule('after-failure', async () => {
    events.push('after-failure');
  });

  await waitFor(() => events.includes('after-failure'));
  assert.deepEqual(events, ['failure', 'after-failure']);

  scheduler.schedule('blocker', async () => {
    events.push('blocker');
    await delay(20);
  });
  scheduler.schedule('discarded', async () => {
    events.push('discarded');
  });
  await waitFor(() => events.includes('blocker'));
  scheduler.stop();
  await delay(40);
  assert.equal(events.includes('discarded'), false);
});
```

- [ ] **Step 5: 运行测试并确认红灯**

```powershell
node --test server/test/test-xui-job-scheduler.js
```

Expected: FAIL，错误包含 `Cannot find module '../jobs/xui-job-scheduler'`。

### Task 2: 实现最小统一调度器

**Files:**
- Create: `server/jobs/xui-job-scheduler.js`
- Test: `server/test/test-xui-job-scheduler.js`

**Interfaces:**
- Consumes: `options.cooldownMs`，默认 `5 * 60 * 1000`
- Produces: `createXuiJobScheduler(options)` 和默认单例 `schedule(name, handler)`、`stop()`

- [ ] **Step 1: 创建调度器状态和公开接口**

实现工厂函数供测试隔离，并导出使用真实 5 分钟冷却的默认单例：

```javascript
const { createLogger } = require('../utils/logger');

const logger = createLogger('XUI-JOB-SCHEDULER');
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

function createXuiJobScheduler(options = {}) {
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const queue = [];
  const scheduledNames = new Set();
  let runningName = null;
  let lastFinishedAt = 0;
  let cooldownTimer = null;
  let stopped = false;

  // 后续步骤在这里实现 schedule、processQueue 和 stop。
}
```

把上述注释替换为实际方法，不在最终实现中保留占位说明。

- [ ] **Step 2: 实现同名合并和 FIFO 入队**

```javascript
function schedule(name, handler) {
  if (stopped) {
    stopped = false;
    logger.info('3X-UI 调度器已重新激活');
  }
  if (runningName === name || scheduledNames.has(name)) {
    logger.info(`合并重复 3X-UI 任务: ${name}`);
    return false;
  }

  queue.push({ name, handler });
  scheduledNames.add(name);
  logger.info(`3X-UI 任务已入队: ${name}, queue=${queue.length}`);
  void processQueue();
  return true;
}
```

- [ ] **Step 3: 实现结束后冷却和异常隔离**

`processQueue()` 在已有任务运行、调度器停止或队列为空时直接返回；否则等待剩余冷却时间，再执行队首：

```javascript
async function processQueue() {
  if (stopped || runningName || queue.length === 0 || cooldownTimer) return;

  const remaining = Math.max(0, lastFinishedAt + cooldownMs - Date.now());
  if (remaining > 0) {
    logger.info(`3X-UI 下一任务等待冷却: ${remaining}ms`);
    cooldownTimer = setTimeout(() => {
      cooldownTimer = null;
      void processQueue();
    }, remaining);
    return;
  }

  const item = queue.shift();
  scheduledNames.delete(item.name);
  runningName = item.name;
  const startedAt = Date.now();
  let status = 'success';

  try {
    logger.info(`开始执行 3X-UI 任务: ${item.name}`);
    await item.handler();
  } catch (error) {
    status = 'failed';
    logger.error(`3X-UI 任务执行失败: ${item.name}, error=${error.message}`);
  } finally {
    lastFinishedAt = Date.now();
    logger.info(`3X-UI 任务执行结束: ${item.name}, status=${status}, duration=${lastFinishedAt - startedAt}ms`);
    runningName = null;
    void processQueue();
  }
}
```

- [ ] **Step 4: 实现停止清理和模块导出**

```javascript
function stop() {
  stopped = true;
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
  const discarded = queue.length;
  queue.length = 0;
  scheduledNames.clear();
  logger.info(`3X-UI 调度器已停止，丢弃待执行任务: ${discarded}`);
}

return { schedule, stop };
}

const scheduler = createXuiJobScheduler();

module.exports = {
  DEFAULT_COOLDOWN_MS,
  createXuiJobScheduler,
  schedule: scheduler.schedule,
  stop: scheduler.stop
};
```

`schedule()` 自动重新激活已停止的调度器，使 `stopAllJobs()` 后再次调用 `startAllJobs()` 时仍可正常工作；已经被 `stop()` 丢弃的旧队列不会恢复。

- [ ] **Step 5: 运行调度器测试并确认绿灯**

```powershell
node --test server/test/test-xui-job-scheduler.js
```

Expected: 4 个测试通过，`fail 0`。

- [ ] **Step 6: 提交调度器和单元测试**

```powershell
git add server/jobs/xui-job-scheduler.js server/test/test-xui-job-scheduler.js
git commit -m "功能：增加3X-UI定时任务统一调度器"
```

### Task 3: 接入三个指定任务并清理停止状态

**Files:**
- Modify: `server/jobs/handlers/sync-xui-users.js:397`
- Modify: `server/jobs/handlers/sync-traffic.js:20`
- Modify: `server/jobs/handlers/telegram-server-health-check.js:43`
- Modify: `server/jobs/index.js:40-156`
- Modify: `server/test/test-xui-job-scheduler.js`

**Interfaces:**
- Consumes: `xuiJobScheduler.schedule(taskName, handler)`、`xuiJobScheduler.stop()`
- Produces: 三个固定任务名称的统一调度接入

- [ ] **Step 1: 增加源码接入约束测试**

在调度器测试文件中读取四个接入文件，明确只接入三个任务：

```javascript
const fs = require('node:fs');
const path = require('node:path');

test('仅三个指定定时任务接入统一调度器', () => {
  const read = relativePath => fs.readFileSync(
    path.join(__dirname, '..', relativePath),
    'utf8'
  );
  const xuiUsers = read('jobs/handlers/sync-xui-users.js');
  const traffic = read('jobs/handlers/sync-traffic.js');
  const telegram = read('jobs/handlers/telegram-server-health-check.js');
  const jobsIndex = read('jobs/index.js');

  assert.match(xuiUsers, /schedule\\('xui-user-sync'/);
  assert.match(traffic, /schedule\\('traffic-sync'/);
  assert.match(telegram, /schedule\\('telegram-health-check'/);
  assert.match(jobsIndex, /xuiJobScheduler\\.stop\\(\\)/);
});
```

- [ ] **Step 2: 运行接入测试并确认红灯**

```powershell
node --test server/test/test-xui-job-scheduler.js
```

Expected: 新增的“仅三个指定定时任务接入统一调度器”测试失败。

- [ ] **Step 3: 接入 3X-UI 用户同步**

在 `sync-xui-users.js` 引入调度器，并让首次与周期触发复用一个提交方法：

```javascript
const xuiJobScheduler = require('../xui-job-scheduler');

function scheduleXuiUserSync(db) {
  xuiJobScheduler.schedule('xui-user-sync', async () => {
    await runXuiSync(db);
  });
}
```

将两个原有 `await runXuiSync(db)` 调用替换为 `scheduleXuiUserSync(db)`；保留 1 分钟首次延迟和 4 小时间隔。

- [ ] **Step 4: 接入流量同步**

在 `sync-traffic.js` 增加：

```javascript
const xuiJobScheduler = require('../xui-job-scheduler');

function scheduleTrafficSync(db) {
  xuiJobScheduler.schedule('traffic-sync', async () => {
    await trafficManager.syncTrafficAndHandleDisable(db);
  });
}
```

首次延迟和 interval 回调均调用 `scheduleTrafficSync(db)`；保留 10 分钟首次延迟和 30 分钟间隔。

- [ ] **Step 5: 接入 Telegram 健康巡检**

在 `telegram-server-health-check.js` 增加：

```javascript
const xuiJobScheduler = require('../xui-job-scheduler');

function scheduleTelegramServerHealthCheck(db, state) {
  xuiJobScheduler.schedule('telegram-health-check', async () => {
    await runTelegramServerHealthCheckSafely(db, state);
  });
}
```

首次延迟和 interval 回调均调用 `scheduleTelegramServerHealthCheck(db, state)`；保留 13 分钟首次延迟和 40 分钟间隔。

- [ ] **Step 6: 在任务中心停止调度器**

在 `server/jobs/index.js` 引入：

```javascript
const xuiJobScheduler = require('./xui-job-scheduler');
```

在 `cleanupJobHandles()` 清理 interval、timeout 和 cron 后调用：

```javascript
xuiJobScheduler.stop();
```

这样启动失败回滚和 `stopAllJobs()` 都走同一清理路径。

- [ ] **Step 7: 运行接入测试并确认绿灯**

```powershell
node --test server/test/test-xui-job-scheduler.js
```

Expected: 5 个测试通过，`fail 0`。

- [ ] **Step 8: 检查仅有三个 handler 接入**

```powershell
rg -n "xuiJobScheduler\\.schedule" server/jobs/handlers
```

Expected: 仅输出 `sync-xui-users.js`、`sync-traffic.js`、`telegram-server-health-check.js`。

### Task 4: 完整验证并整理实现提交

**Files:**
- Test: `server/test/test-xui-job-scheduler.js`
- Test: `server/test/test-traffic-manager.js`
- Test: `server/test/test-telegram-health-sync.js`
- Test: `server/test/test-xui-unique-client-sync.js`

**Interfaces:**
- Consumes: 完成接入后的调度器和三个 handler
- Produces: 可交付测试日志及单笔实现提交

- [ ] **Step 1: 运行调度器测试**

```powershell
node --test server/test/test-xui-job-scheduler.js
```

Expected: 全部通过，`fail 0`。

- [ ] **Step 2: 运行流量管理测试**

```powershell
node server/test/test-traffic-manager.js
```

Expected: 退出码 0，输出流量管理测试通过信息。

- [ ] **Step 3: 运行 Telegram 健康巡检测试**

```powershell
node --test server/test/test-telegram-health-sync.js
```

Expected: 全部通过，`fail 0`。

- [ ] **Step 4: 运行 3X-UI 用户同步相关测试**

```powershell
node server/test/test-xui-unique-client-sync.js
```

Expected: 退出码 0，输出 `xui unique client sync tests passed`。

- [ ] **Step 5: 检查代码与变更范围**

```powershell
git diff --check
git status --short
git diff -- server/jobs/xui-job-scheduler.js server/jobs/handlers/sync-xui-users.js server/jobs/handlers/sync-traffic.js server/jobs/handlers/telegram-server-health-check.js server/jobs/index.js server/test/test-xui-job-scheduler.js
```

Expected: `git diff --check` 无输出；差异只包含调度器、三个指定 handler、停止清理和对应测试。

- [ ] **Step 6: 将接入改动整理进实现提交**

如果 Task 2 已创建实现提交，则把 Task 3 的接入代码和测试暂存后修订到同一笔实现提交：

```powershell
git add server/jobs/xui-job-scheduler.js server/jobs/handlers/sync-xui-users.js server/jobs/handlers/sync-traffic.js server/jobs/handlers/telegram-server-health-check.js server/jobs/index.js server/test/test-xui-job-scheduler.js
git commit --amend --no-edit
```

Expected: 功能实现与测试最终只有一笔中文提交，设计与计划文档保持在文档提交中。

- [ ] **Step 7: 交付提醒**

最终回复必须展示上述测试命令的实际日志，并提醒：

```text
本次修改涉及 server/**/*.js，请重启后端服务器使调度逻辑生效。
```

不要自行启动后端服务器，不要推送远程仓库。

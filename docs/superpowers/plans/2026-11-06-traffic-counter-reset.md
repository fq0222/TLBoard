# 3X-UI 流量计数器回退统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3X-UI 3.4.2+ 服务器级流量计数器重置后，将当前累计值作为重置后的新增量入账，并让管理端最近一轮统计保持相同口径。

**Architecture:** 新增一个无状态的可重置计数器增量计算工具，统一封装正常差值、回退重置和倍率计算。流量入账服务与管理端快照服务共同调用该工具；现有 `traffic_sync_log` 写入仍以本轮当前值作为下一轮基线，不修改续费或 3X-UI 重试链路。

**Tech Stack:** Node.js、CommonJS、PostgreSQL、Node `assert` 测试脚本

**Spec:** `docs/superpowers/specs/2026-11-06-traffic-counter-reset-design.md`

## Global Constraints

- 生产环境参与流量统计的 3X-UI 面板全部为 3.4.2 及以上，按服务器级客户端整体重置流量。
- 不修改续费支付事务、3X-UI 同步任务、重试条件或数据库结构。
- 回退时必须使用 `currentTraffic` 作为原始增量，随后照常应用 `traffic_usage_multiplier` 并四舍五入。
- 正常与回退分支都必须继续把 `currentTraffic` 写入 `traffic_sync_log` 作为新基线。
- 新建文件和方法补充职责、关键参数与核心分支注释；保持现有分号及 CommonJS 风格。
- 不创建或切换分支，不创建 worktree，不启动服务器，不推送远程。
- 文档合并为一笔中文提交，功能实现和测试合并为另一笔中文提交；实施前不得暂存尚未确认的代码。

## Review Focus

- `currentTraffic === lastSyncTraffic` 时增量必须为 0，不能误判为重置。
- 回退到 `currentTraffic === 0` 时增量为 0，但同步基线仍更新为 0。
- 回退后的当前值必须应用小数倍率并四舍五入，与正常增量一致。
- 管理端服务器总量和用户明细必须与实际入账增量采用同一算法。
- 回退日志必须包含服务器、用户、当前值、旧基线和“当前值作为本轮增量”的明确语义。

---

### Task 1: 提取可重置流量计数器算法

**Files:**
- Modify: `.gitignore`
- Create: `server/utils/traffic-counter.js`
- Create: `server/test/test-traffic-counter-reset.js`

**Interfaces:**
- Consumes: 数值型或可转为数值的 `currentTraffic`、`lastSyncTraffic`、`multiplier`
- Produces: `calculateTrafficCounterIncrement(currentTraffic, lastSyncTraffic, multiplier)`，返回 `{ rawIncrement:number, increment:number, resetDetected:boolean }`

- [ ] **Step 1: 编写失败测试，固定计数器语义**

在 `server/test/test-traffic-counter-reset.js` 中用 `assert.deepStrictEqual` 覆盖：

```js
assert.deepStrictEqual(calculateTrafficCounterIncrement(200, 100, 2.5), {
  rawIncrement: 100,
  increment: 250,
  resetDetected: false
});
assert.deepStrictEqual(calculateTrafficCounterIncrement(100, 200, 2.5), {
  rawIncrement: 100,
  increment: 250,
  resetDetected: true
});
assert.deepStrictEqual(calculateTrafficCounterIncrement(0, 200, 2.5), {
  rawIncrement: 0,
  increment: 0,
  resetDetected: true
});
assert.deepStrictEqual(calculateTrafficCounterIncrement(200, 200, 2.5), {
  rawIncrement: 0,
  increment: 0,
  resetDetected: false
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node server/test/test-traffic-counter-reset.js`

Expected: FAIL，提示无法找到 `../utils/traffic-counter` 或导出函数不存在。

- [ ] **Step 3: 实现最小纯函数**

在 `server/utils/traffic-counter.js` 实现并导出：

```js
function calculateTrafficCounterIncrement(currentTraffic, lastSyncTraffic, multiplier = 1)
```

将三个参数转为有限数字；当前值和旧基线按非负流量处理，倍率沿用调用方已验证的非负值。核心分支固定为：`current >= last` 时取差值，否则取 `current`；最后用 `Math.round(rawIncrement * multiplier)` 计算入账增量。函数注释必须说明它处理可重置的 3X-UI 服务器级累计计数器。

- [ ] **Step 4: 运行纯函数测试**

Run: `node server/test/test-traffic-counter-reset.js`

Expected: PASS，输出 `test-traffic-counter-reset: PASS`。

### Task 2: 将回退后的当前值计入用户流量

**Files:**
- Modify: `server/services/shared/traffic-manager.js:408-431`
- Modify: `server/test/test-traffic-server-email-dedup.js`
- Local verification only: `server/test/test-traffic-multiplier.js`（该文件被 Git 忽略）

**Interfaces:**
- Consumes: Task 1 的 `calculateTrafficCounterIncrement(currentTraffic, lastSyncTraffic, multiplier)`
- Produces: `calculateUserTotalTraffic()` 在回退时返回包含重置后当前值的 `increment` 和 `trafficUsed`

- [ ] **Step 1: 更新测试期望并增加等值、归零断言**

在已跟踪的服务器级流量回归脚本中增加 `last=200/current=100/multiplier=2.5` 用例并断言：

```js
assert.strictEqual(resetResult[1].increment, 250);
assert.strictEqual(resetResult[1].trafficUsed, 1250);
```

再补充 `last=200/current=0` 时增量为 0。测试桩记录 `INSERT INTO traffic_sync_log` 的参数，并断言回退后的基线分别写入 100 和 0。纯函数测试负责固定 `last=current` 不误判重置；本地倍率脚本同步更新回退期望。

- [ ] **Step 2: 运行测试并确认旧实现失败**

Run: `node server/test/test-traffic-server-email-dedup.js`

Expected: FAIL，回退用例实际 `increment` 仍为 0。

- [ ] **Step 3: 接入共享算法并更新告警日志**

在 `traffic-manager.js` 顶部引入 Task 1 工具，替换局部增量分支。`resetDetected` 为真时输出 WARN，日志包含 `serverId`、`user.email`、`currentTraffic`、`lastSyncTraffic`，并说明“将当前值作为本轮原始增量并更新同步基线”。保留现有正增量 INFO 日志以及 `syncLogUpdates.push({ currentTraffic })`。

- [ ] **Step 4: 验证用户流量入账与语法**

Run: `node server/test/test-traffic-counter-reset.js`

Expected: PASS。

Run: `node server/test/test-traffic-server-email-dedup.js`

Expected: PASS，回退用例显示倍率后增量为 250 B。

Run: `node --check server/services/shared/traffic-manager.js`

Expected: 无输出，退出码 0。

### Task 3: 统一管理端最近一轮统计口径

**Files:**
- Modify: `server/services/admin/traffic-usage-stats-service.js:52-74`
- Modify: `server/test/test-traffic-server-email-dedup.js`

**Interfaces:**
- Consumes: Task 1 的 `calculateTrafficCounterIncrement(currentTraffic, lastSyncTraffic, multiplier)`
- Produces: `buildCurrentTrafficUsageSnapshot(options)` 在计数器回退时仍生成对应服务器及用户增量快照

- [ ] **Step 1: 编写管理端回退快照失败测试**

新增 `testAdminSnapshotUsesCurrentValueAfterCounterReset()`：构造 `last=200`、`current=100`、`multiplier=2.5`，断言快照包含一个服务器和一个用户，且两处流量均为 250：

```js
assert.equal(snapshot[0].totalTraffic, 250);
assert.deepEqual(snapshot[0].users, [
  { userId: 1, email: 'a@example.com', traffic: 250 }
]);
```

回退到 0 的无增量契约由共享纯函数测试和流量入账基线测试覆盖。

- [ ] **Step 2: 运行测试并确认旧实现失败**

Run: `node server/test/test-traffic-server-email-dedup.js`

Expected: FAIL，旧实现会跳过 `current < last` 的用户，无法生成 250 的快照。

- [ ] **Step 3: 管理端快照复用共享算法**

在 `traffic-usage-stats-service.js` 引入 Task 1 工具，移除 `current < last` 直接 `continue` 的分支，使用返回的 `increment`；继续跳过 `increment <= 0` 的用户，不改变快照格式、显示单位或持久化行为。

- [ ] **Step 4: 运行相关回归测试**

Run: `node server/test/test-traffic-server-email-dedup.js`

Expected: PASS，输出 `test-traffic-server-email-dedup: PASS`。

Run: `node --check server/services/admin/traffic-usage-stats-service.js`

Expected: 无输出，退出码 0。

### Task 4: 完整验证与提交整理

**Files:**
- Modify: `docs/superpowers/specs/2026-11-06-traffic-counter-reset-design.md`（仅在实施发现设计表述需要校正时）
- Modify: `docs/superpowers/plans/2026-11-06-traffic-counter-reset.md`（仅在实施步骤发生必要调整时）

**Interfaces:**
- Consumes: Task 1-3 的实现与测试
- Produces: 两笔可追溯中文提交：文档一笔，功能与测试一笔

- [ ] **Step 1: 运行后端相关测试**

```powershell
node server/test/test-traffic-counter-reset.js
node server/test/test-traffic-multiplier.js
node server/test/test-traffic-usage-stats.js
node server/test/test-traffic-server-email-dedup.js
node server/test/test-traffic-disabled-compensation.js
node server/test/test-traffic-manager.js
```

Expected: 前五个脚本全部 PASS；`test-traffic-manager.js` 若依赖真实 PostgreSQL 或 3X-UI 环境，应记录完整环境错误，不得把环境不可用误报为代码通过。

- [ ] **Step 2: 检查语法和差异**

```powershell
node --check server/utils/traffic-counter.js
node --check server/services/shared/traffic-manager.js
node --check server/services/admin/traffic-usage-stats-service.js
git diff --check
git status --short
```

Expected: 三个语法检查和 `git diff --check` 退出码均为 0；差异只包含本设计、计划、共享工具、两个服务和相关测试。

- [ ] **Step 3: 提交已确认的设计与计划文档**

```powershell
git add docs/superpowers/specs/2026-11-06-traffic-counter-reset-design.md docs/superpowers/plans/2026-11-06-traffic-counter-reset.md
git commit -m "文档：补充流量计数器回退统计方案"
```

- [ ] **Step 4: 提交功能实现与测试**

```powershell
git add .gitignore server/utils/traffic-counter.js server/services/shared/traffic-manager.js server/services/admin/traffic-usage-stats-service.js server/test/test-traffic-counter-reset.js server/test/test-traffic-server-email-dedup.js
git commit -m "修复：统计3X-UI流量重置后的新增量"
```

- [ ] **Step 5: 展示验证日志并提醒部署动作**

向用户展示各测试命令的实际日志和最终 `git status --short`。说明修改了 `server/**/*.js`，部署后需要用户自行重启后端；不得自行启动服务器或执行 `git push`。

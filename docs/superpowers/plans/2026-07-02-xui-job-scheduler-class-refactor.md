# 3X-UI 调度器 Class 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将闭包工厂形式的 3X-UI 调度器等价重构为 `XuiJobScheduler` class，并记录项目代码风格规则。

**Architecture:** 调度状态改为实例字段，调度行为改为类方法。模块继续导出默认单例的 `schedule()` 和 `stop()`，所以三个 handler 无需修改；测试通过构造 class 获得隔离实例。

**Tech Stack:** Node.js CommonJS、Node.js `node:test`

## Global Constraints

- 不改变 FIFO、同名合并、结束后冷却、异常隔离、停止清理和停止后重新激活语义。
- 默认冷却时间仍为 5 分钟。
- 三个现有 handler 的调用方式不变。
- 不新增依赖。
- 新增 class 和方法必须包含中文职责、参数和核心分支注释。
- 在项目根目录 `AGENTS.md` 记录 class 使用规则。
- 修改 `server/**/*.js` 后不启动服务，交付时提醒用户重启。

---

### Task 1: 用测试定义 Class 接口

**Files:**
- Modify: `server/test/test-xui-job-scheduler.js`

**Interfaces:**
- Consumes: `XuiJobScheduler`
- Produces: `new XuiJobScheduler({ cooldownMs })` 的构造契约

- [ ] **Step 1: 将测试导入改为 class**

```javascript
const {
  XuiJobScheduler
} = require('../jobs/xui-job-scheduler');
```

将测试中的：

```javascript
createXuiJobScheduler({ cooldownMs })
```

全部替换为：

```javascript
new XuiJobScheduler({ cooldownMs })
```

- [ ] **Step 2: 运行测试确认红灯**

```powershell
node --test server/test/test-xui-job-scheduler.js
```

Expected: FAIL，错误表明 `XuiJobScheduler` 尚未导出或不是构造函数。

### Task 2: 等价重构为 Class

**Files:**
- Modify: `server/jobs/xui-job-scheduler.js`
- Test: `server/test/test-xui-job-scheduler.js`

**Interfaces:**
- Produces: `class XuiJobScheduler`
- Preserves: 模块级 `schedule(name, handler)`、`stop()`

- [ ] **Step 1: 定义 class 和实例字段**

```javascript
class XuiJobScheduler {
  /**
   * 创建 3X-UI 定时任务调度器。
   * @param {{ cooldownMs?: number }} options 调度选项。
   */
  constructor(options = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.queue = [];
    this.scheduledNames = new Set();
    this.runningName = null;
    this.lastFinishedAt = 0;
    this.cooldownTimer = null;
    this.stopped = false;
  }
}
```

- [ ] **Step 2: 将三个闭包函数改为类方法**

把 `processQueue()`、`schedule()`、`stop()` 移入 class，并将闭包变量替换为对应的 `this.*` 字段。内部递归调用使用：

```javascript
void this.processQueue();
```

冷却计时器回调使用箭头函数，确保 `this` 指向实例：

```javascript
this.cooldownTimer = setTimeout(() => {
  this.cooldownTimer = null;
  void this.processQueue();
}, remaining);
```

- [ ] **Step 3: 保持默认单例接口兼容**

```javascript
const scheduler = new XuiJobScheduler();

module.exports = {
  DEFAULT_COOLDOWN_MS,
  XuiJobScheduler,
  schedule: scheduler.schedule.bind(scheduler),
  stop: scheduler.stop.bind(scheduler)
};
```

- [ ] **Step 4: 运行测试确认绿灯**

```powershell
node --test server/test/test-xui-job-scheduler.js
```

Expected: 6 个测试通过，`fail 0`。

### Task 3: 记录规则并完整验证

**Files:**
- Modify: `AGENTS.md`
- Test: `server/test/test-xui-job-scheduler.js`
- Test: `server/test/test-telegram-health-sync.js`

**Interfaces:**
- Produces: 项目长期代码风格约束

- [ ] **Step 1: 在 AGENTS.md 增加代码组织规则**

在代码提交规范附近增加：

```markdown
### 代码组织

- 对包含多个方法和内部状态的模块，优先使用 `class` 封装。
- 避免使用“工厂函数内嵌套定义多个函数，并通过闭包保存模块状态”的写法。
- 纯函数、无状态工具函数和简单回调不受此规则限制。
```

- [ ] **Step 2: 运行调度器测试**

```powershell
node --test server/test/test-xui-job-scheduler.js
```

Expected: 6 个测试通过，`fail 0`。

- [ ] **Step 3: 运行 Telegram 接入回归测试**

```powershell
node --test server/test/test-telegram-health-sync.js
```

Expected: 11 个测试通过，`fail 0`。

- [ ] **Step 4: 检查变更**

```powershell
git diff --check
git diff -- AGENTS.md server/jobs/xui-job-scheduler.js server/test/test-xui-job-scheduler.js
```

Expected: `git diff --check` 无输出，业务差异仅为 class 等价重构和规则记录。

- [ ] **Step 5: 提交**

```powershell
git add AGENTS.md server/jobs/xui-job-scheduler.js
git add -f server/test/test-xui-job-scheduler.js
git commit -m "重构：使用Class封装3X-UI任务调度器"
```

不要 push；交付时展示测试日志并提醒重启后端服务。

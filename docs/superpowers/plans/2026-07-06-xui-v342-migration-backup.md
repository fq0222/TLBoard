# 3X-UI V3.4.2 迁移备份适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 3X-UI V3.4.2 增加独立 API 客户端，并让 PostgreSQL 面板备份自动使用 `getMigration`。

**Architecture:** V3.4.2 客户端继承现有 V3.2.5 clients API 适配器，只增加版本标识和迁移备份下载能力。备份任务通过能力判断选择 `getMigration()` 或旧版 `getDb()`，不引入新的配置项或依赖。

**Tech Stack:** Node.js、Axios、CommonJS、Node.js `assert`

---

### Task 1: V3.4.2 客户端测试与实现

**Files:**
- Create: `server/integrations/xui/xui-api-client-v342.js`
- Modify: `server/integrations/xui/xui-api-client-factory.js`
- Test: `server/test/test-xui-api-client.js`

- [ ] **Step 1: 编写失败的版本和下载测试**

在 `test-xui-api-client.js` 中创建 V3.4.2 工厂实例并添加断言：

```javascript
const v342FactoryResult = createXuiApiClient('https://xui.example.com/', 'secret-token', {
  timeout: 8901,
  apiVersion: '3.4.2'
});
const v342ResolvedResult = resolveClientVersion('3.4.2');

assert.strictEqual(v342FactoryResult.client.version, '3.4.2');
assert.strictEqual(v342FactoryResult.client.supportsClientApi, true);
assert.strictEqual(v342FactoryResult.requestedVersion, '3.4.2');
assert.strictEqual(v342FactoryResult.resolvedVersion, '3.4.2');
assert.strictEqual(v342ResolvedResult.resolvedVersion, '3.4.2');

await v342FactoryResult.client.getMigration();
const migrationRequest = requests.at(-1);
assert.strictEqual(migrationRequest.method, 'get');
assert.strictEqual(migrationRequest.url, '/panel/api/server/getMigration');
assert.strictEqual(migrationRequest.responseType, 'arraybuffer');
assert.strictEqual(migrationRequest.headers.Authorization, 'Bearer secret-token');
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node server/test/test-xui-api-client.js
```

Expected: FAIL，工厂将 `3.4.2` 回退到 `3.0.2`，或客户端不存在 `getMigration`。

- [ ] **Step 3: 实现最小 V3.4.2 客户端**

创建 `xui-api-client-v342.js`：

```javascript
/**
 * 3X-UI 3.4.2 API 客户端。
 * 复用 3.2.5+ clients API，并提供 PostgreSQL 跨引擎迁移备份下载。
 */

const XuiApiClientV325 = require('./xui-api-client-v325');

class XuiApiClientV342 extends XuiApiClientV325 {
  /**
   * 创建 3.4.2 版本客户端。
   * @param {string} baseURL - 3X-UI 面板地址
   * @param {string} apiToken - 3X-UI API Token
   * @param {Object} options - 客户端配置
   */
  constructor(baseURL, apiToken, options = {}) {
    super(baseURL, apiToken, options);
    this.version = '3.4.2';
  }

  /**
   * 下载跨存储引擎迁移备份；PostgreSQL 面板返回 SQLite 数据库。
   * @returns {Promise<Buffer>} 迁移备份内容
   */
  getMigration() {
    return this.download(`${this.serverBasePath}/getMigration`);
  }
}

module.exports = XuiApiClientV342;
```

在工厂中引入并注册：

```javascript
const XuiApiClientV342 = require('./xui-api-client-v342');

const CLIENT_REGISTRY = {
  '3.0.2': XuiApiClientV302,
  '3.2.5': XuiApiClientV325,
  '3.3.1': XuiApiClientV325,
  '3.4.2': XuiApiClientV342
};
```

- [ ] **Step 4: 运行客户端测试并确认通过**

Run:

```bash
node server/test/test-xui-api-client.js
```

Expected:

```text
test-xui-api-client: PASS
```

### Task 2: 备份任务能力分流

**Files:**
- Modify: `server/jobs/backupDB.js`
- Test: `server/test/test-xui-db-backup-job.js`

- [ ] **Step 1: 编写失败的备份分流测试**

为测试客户端记录调用并提供两个下载方法：

```javascript
class FakeXuiApiClient {
  constructor(apiUrl, apiToken, options = {}) {
    this.apiUrl = apiUrl;
    this.apiToken = apiToken;
    this.version = options.apiVersion;
    this.calls = [];
    FakeXuiApiClient.instances.push(this);
  }

  async getDb() {
    this.calls.push('getDb');
    return Buffer.from('SQLite format 3\0legacy-db');
  }

  async getMigration() {
    this.calls.push('getMigration');
    return Buffer.from('SQLite format 3\0migration-db');
  }
}
```

通过 `createClient` 分别返回具备和不具备 `getMigration` 的客户端，并断言：

```javascript
assert.deepStrictEqual(v342Client.calls, ['getMigration']);
assert.deepStrictEqual(legacyClient.calls, ['getDb']);
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node server/test/test-xui-db-backup-job.js
```

Expected: FAIL，V3.4.2 客户端仍调用 `getDb`。

- [ ] **Step 3: 实现备份能力判断**

在 `backupServer()` 中替换下载调用：

```javascript
const data = typeof client.getMigration === 'function'
  ? await client.getMigration()
  : await client.getDb();
```

不按版本字符串重复判断；客户端能力是唯一分流依据。

- [ ] **Step 4: 运行备份测试并确认通过**

Run:

```bash
node server/test/test-xui-db-backup-job.js
```

Expected:

```text
xui db backup job tests passed
```

### Task 3: 回归验证与功能提交

**Files:**
- Verify: `server/integrations/xui/xui-api-client-v342.js`
- Verify: `server/integrations/xui/xui-api-client-factory.js`
- Verify: `server/jobs/backupDB.js`
- Verify: `server/test/test-xui-api-client.js`
- Verify: `server/test/test-xui-db-backup-job.js`

- [ ] **Step 1: 连续运行目标测试**

Run:

```bash
node server/test/test-xui-api-client.js
node server/test/test-xui-db-backup-job.js
```

Expected: 两个脚本均以退出码 0 结束，并分别输出 PASS 日志。

- [ ] **Step 2: 检查差异和敏感信息**

Run:

```bash
git diff --check
git diff -- server/integrations/xui server/jobs/backupDB.js server/test/test-xui-api-client.js server/test/test-xui-db-backup-job.js
git grep -n -E "<面板账号>|<面板密码>|<API Token>" -- .
```

Expected: `git diff --check` 无输出；差异仅包含计划内代码；敏感信息搜索无匹配。

- [ ] **Step 3: 提交功能与测试**

```bash
git add server/integrations/xui/xui-api-client-v342.js server/integrations/xui/xui-api-client-factory.js server/jobs/backupDB.js server/test/test-xui-api-client.js server/test/test-xui-db-backup-job.js
git commit -m "功能：适配3X-UI 3.4.2迁移备份"
```

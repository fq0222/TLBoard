# XuiService Session 缓存实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 XuiService 添加静态实例缓存，复用 session 连接，减少重复登录

**Architecture:** 在 XuiService 类中添加静态 Map 缓存实例，提供 getInstance() 获取缓存实例，removeInstance() 清除指定缓存。所有调用方从 `new XuiService()` 改为 `XuiService.getInstance()`

**Tech Stack:** Node.js, 3xui-api-client

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/services/xui-service.js` | 修改 | 添加静态缓存和 getInstance/removeInstance/clearCache 方法 |
| `server/services/traffic-manager.js` | 修改 | 2 处 `new XuiService()` → `XuiService.getInstance()` |
| `server/routes/admin/servers.js` | 修改 | 5 处调用 + 修改密码时清除缓存 |
| `server/services/order-service.js` | 修改 | 1 处调用 |
| `server/services/xui-sync.js` | 修改 | 1 处调用 |
| `server/routes/admin/users.js` | 修改 | 1 处调用 |
| `server/jobs/index.js` | 修改 | 1 处调用 |

---

### Task 1: 修改 XuiService 类

**Files:**
- Modify: `server/services/xui-service.js:22-34`

- [ ] **Step 1: 添加静态缓存属性和方法**

在 `class XuiService {` 后添加静态缓存：

```javascript
class XuiService {
  // 静态缓存：存储已创建的实例
  static instanceCache = new Map();

  /**
   * 获取 XuiService 实例（带缓存）
   * @param {string} apiUrl - 面板地址
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @returns {XuiService} 实例
   */
  static getInstance(apiUrl, username, password) {
    const key = `${apiUrl}:${username}`;
    if (!this.instanceCache.has(key)) {
      this.instanceCache.set(key, new XuiService(apiUrl, username, password));
    }
    return this.instanceCache.get(key);
  }

  /**
   * 清除指定服务器的缓存
   * @param {string} apiUrl - 面板地址
   * @param {string} username - 用户名
   */
  static removeInstance(apiUrl, username) {
    this.instanceCache.delete(`${apiUrl}:${username}`);
  }

  /**
   * 清除所有缓存
   */
  static clearCache() {
    this.instanceCache.clear();
  }

  /**
   * 创建 XuiService 实例
   * @param {string} apiUrl - 面板地址
   * @param {string} username - API 用户名
   * @param {string} password - API 密码
   */
  constructor(apiUrl, username, password) {
    // ... 原有构造函数代码
```

- [ ] **Step 2: 验证语法正确**

运行：`node -c server/services/xui-service.js`
Expected: 无输出（语法正确）

- [ ] **Step 3: Commit**

```bash
git add server/services/xui-service.js
git commit -m "feat(xui-service): 添加静态实例缓存和 getInstance/removeInstance 方法"
```

---

### Task 2: 修改 traffic-manager.js

**Files:**
- Modify: `server/services/traffic-manager.js:37`
- Modify: `server/services/traffic-manager.js:346`

- [ ] **Step 1: 修改第一处（第 37 行）**

将：
```javascript
const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
```
改为：
```javascript
const xuiService = XuiService.getInstance(server.api_url, server.api_username, server.api_password);
```

- [ ] **Step 2: 修改第二处（第 346 行附近）**

同样将 `new XuiService()` 改为 `XuiService.getInstance()`

- [ ] **Step 3: 验证语法正确**

运行：`node -c server/services/traffic-manager.js`
Expected: 无输出

- [ ] **Step 4: Commit**

```bash
git add server/services/traffic-manager.js
git commit -m "refactor(traffic-manager): 使用 XuiService.getInstance() 复用 session"
```

---

### Task 3: 修改 order-service.js

**Files:**
- Modify: `server/services/order-service.js:52`

- [ ] **Step 1: 修改调用方式**

将：
```javascript
const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
```
改为：
```javascript
const xuiService = XuiService.getInstance(server.api_url, server.api_username, server.api_password);
```

- [ ] **Step 2: 验证语法正确**

运行：`node -c server/services/order-service.js`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add server/services/order-service.js
git commit -m "refactor(order-service): 使用 XuiService.getInstance() 复用 session"
```

---

### Task 4: 修改 xui-sync.js

**Files:**
- Modify: `server/services/xui-sync.js:21`

- [ ] **Step 1: 修改调用方式**

将：
```javascript
const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
```
改为：
```javascript
const xuiService = XuiService.getInstance(server.api_url, server.api_username, server.api_password);
```

- [ ] **Step 2: 验证语法正确**

运行：`node -c server/services/xui-sync.js`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add server/services/xui-sync.js
git commit -m "refactor(xui-sync): 使用 XuiService.getInstance() 复用 session"
```

---

### Task 5: 修改 routes/admin/users.js

**Files:**
- Modify: `server/routes/admin/users.js:754`

- [ ] **Step 1: 修改调用方式**

将：
```javascript
const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
```
改为：
```javascript
const xuiService = XuiService.getInstance(server.api_url, server.api_username, server.api_password);
```

- [ ] **Step 2: 验证语法正确**

运行：`node -c server/routes/admin/users.js`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add server/routes/admin/users.js
git commit -m "refactor(admin/users): 使用 XuiService.getInstance() 复用 session"
```

---

### Task 6: 修改 jobs/index.js

**Files:**
- Modify: `server/jobs/index.js:172`

- [ ] **Step 1: 修改调用方式**

将：
```javascript
const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
```
改为：
```javascript
const xuiService = XuiService.getInstance(server.api_url, server.api_username, server.api_password);
```

- [ ] **Step 2: 验证语法正确**

运行：`node -c server/jobs/index.js`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add server/jobs/index.js
git commit -m "refactor(jobs): 使用 XuiService.getInstance() 复用 session"
```

---

### Task 7: 修改 routes/admin/servers.js

**Files:**
- Modify: `server/routes/admin/servers.js` - 5 处调用 + 缓存清除

- [ ] **Step 1: 修改 5 处 new XuiService()**

将以下 5 处 `new XuiService()` 改为 `XuiService.getInstance()`：
- 第 387 行
- 第 651 行
- 第 728 行
- 第 768 行
- 第 785 行

- [ ] **Step 2: 在修改密码处添加缓存清除**

找到修改服务器密码的路由处理函数，在更新数据库后添加：

```javascript
// 清除旧的缓存（密码已变更）
XuiService.removeInstance(oldApiUrl, oldUsername);
```

- [ ] **Step 3: 验证语法正确**

运行：`node -c server/routes/admin/servers.js`
Expected: 无输出

- [ ] **Step 4: Commit**

```bash
git add server/routes/admin/servers.js
git commit -m "refactor(admin/servers): 使用 XuiService.getInstance() 并在密码变更时清除缓存"
```

---

### Task 8: 集成验证

- [ ] **Step 1: 检查所有文件语法**

```bash
node -c server/services/xui-service.js
node -c server/services/traffic-manager.js
node -c server/services/order-service.js
node -c server/services/xui-sync.js
node -c server/routes/admin/users.js
node -c server/routes/admin/servers.js
node -c server/jobs/index.js
```

Expected: 所有命令无输出（语法正确）

- [ ] **Step 2: 启动服务验证**

运行：`npm run dev`（在 server 目录）
Expected: 服务正常启动，无报错

- [ ] **Step 3: 最终 Commit（如需要）**

如果有遗漏的修改，补充提交。

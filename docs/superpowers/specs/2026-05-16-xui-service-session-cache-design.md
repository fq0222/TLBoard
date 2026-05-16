# XuiService Session 缓存设计

**日期：** 2026-05-16
**状态：** 已批准

## 背景

当前 `XuiService` 每次使用都创建新实例，导致：
1. 每次 API 调用都重新登录，浪费请求
2. 3xui-api-client 的 session 复用机制无法生效
3. 对于连接不稳定的服务器（如意大利节点），增加连接失败概率

## 设计目标

1. 缓存 `XuiService` 实例，复用 session
2. 支持清除缓存（密码变更场景）
3. 保持现有调用方式兼容

## 方案设计

### 1. XuiService 类修改

在 `server/services/xui-service.js` 中添加静态缓存：

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

  // ... 原有代码保持不变
}
```

### 2. 缓存 Key 设计

使用 `apiUrl:username` 组合作为 key：
- 同一 URL 不同用户名 → 不同缓存
- 同一用户名不同 URL → 不同缓存
- 密码变更 → 需要调用 `removeInstance()` 清除缓存

### 3. 调用方修改

所有 11 处 `new XuiService()` 改为 `XuiService.getInstance()`：

| 文件 | 行号 | 修改 |
|------|------|------|
| `services/traffic-manager.js` | 37 | `new XuiService()` → `XuiService.getInstance()` |
| `services/traffic-manager.js` | 346 | 同上 |
| `routes/admin/servers.js` | 387 | 同上 |
| `routes/admin/servers.js` | 651 | 同上 |
| `routes/admin/servers.js` | 728 | 同上 |
| `routes/admin/servers.js` | 768 | 同上 |
| `routes/admin/servers.js` | 785 | 同上 |
| `services/order-service.js` | 52 | 同上 |
| `services/xui-sync.js` | 21 | 同上 |
| `routes/admin/users.js` | 754 | 同上 |
| `jobs/index.js` | 172 | 同上 |

### 4. 缓存清除场景

在 `routes/admin/servers.js` 中修改服务器密码时，需要清除对应缓存：

```javascript
// 修改服务器密码后
XuiService.removeInstance(oldApiUrl, oldUsername);
```

## 并发安全

`Promise.all` 并行获取多台服务器流量时，每台服务器有独立的 `XuiService` 实例，不存在并发问题。

同一台服务器的并发请求共享同一 cookie，3xui-api-client 内部处理 session 过期自动重新登录，是安全的。

## 影响范围

- `server/services/xui-service.js` - 核心修改
- `server/services/traffic-manager.js` - 2 处调用
- `server/routes/admin/servers.js` - 5 处调用 + 缓存清除
- `server/services/order-service.js` - 1 处调用
- `server/services/xui-sync.js` - 1 处调用
- `server/routes/admin/users.js` - 1 处调用
- `server/jobs/index.js` - 1 处调用

## 验证方式

1. 启动服务，执行流量同步任务，观察日志确认不再每次都重新登录
2. 修改服务器密码，确认缓存被清除，下次使用新密码登录

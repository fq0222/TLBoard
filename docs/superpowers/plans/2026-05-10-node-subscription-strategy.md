# 节点订阅策略功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现节点级别的订阅信息处理策略（cf/direct），为每个用户在每个节点上生成独立的 UUID 和 sub_id

**Architecture:** 在现有代码基础上渐进式改造，新增数据库表存储节点级用户配置，修改订阅生成逻辑支持策略处理

**Tech Stack:** Node.js, Express, PostgreSQL, Vue 3, Element Plus

**Status:** 已实现（2026-05-11）

---

## 已实现的功能

与原始计划相比，实际实现有以下变更：

| 项目 | 原计划 | 实际实现 |
|------|--------|----------|
| user_node_configs 表 | 使用 `node_id` 关联 xui_nodes | 使用 `server_id` + `inbound_id`，不依赖外键 |
| sub_id 格式 | 16 位小写字母数字 | 16 位十六进制（`randomBytes(8).toString('hex')`） |
| direct 节点 | 无特殊处理 | 同步到 3X-UI 时设置 `flow: 'xtls-rprx-vision'` |
| CF 节点 | 为每个用户生成一个 CF 节点 | 为每个 CF 优选 IP 生成独立节点 |
| host 替换 | 有条件替换（原始链接有 host 时） | CF 策略下无条件替换 |
| 订阅获取 | 用第一个节点的 sub_id 获取所有节点 | 每个节点用自己的 sub_id 分别获取 |
| 定时任务 | 未规划 | 每 4 小时检查并同步 sub_id 和 flow |
| 数据库迁移 | 未规划 | 独立迁移脚本 `server/db/migrations/001-node-subscription-strategy.js` |

---

## 文件结构

### 需要修改的文件

| 文件 | 改动内容 |
|------|----------|
| `server/db/init.js` | 新增 `user_node_configs` 和 `user_subscriptions` 表，`xui_servers` 表新增 `sub_url` 字段 |
| `server/routes/admin/servers.js` | 新增 `sub_url` 参数支持，返回字段新增 `sub_url` |
| `server/services/order-service.js` | 修改 `syncUserToXuiServers` 函数，为每个节点生成独立的 uuid/sub_id |
| `server/routes/user/subscription.js` | 修改订阅生成逻辑，支持策略处理和聚合 |
| `client-admin/src/views/Servers.vue` | 新增订阅地址输入框和显示 |
| `client-admin/src/views/ServerDetail.vue` | 显示节点策略标签 |

### 需要创建的文件

| 文件 | 说明 |
|------|------|
| `server/services/subscription-strategy.js` | 策略处理服务（cf/direct 策略逻辑） |
| `server/test/test-subscription-strategy.js` | 策略处理服务的测试脚本 |

---

## Task 1: 数据库表结构更新

**Files:**
- Modify: `server/db/init.js`

- [x] **Step 1: 在 initDatabase 函数中添加新表创建语句**

在 `server/db/init.js` 的 `initDatabase` 函数中，找到创建 `xui_nodes` 表的位置，在其后添加新表创建语句：

```sql
-- 创建 user_node_configs 表
CREATE TABLE IF NOT EXISTS user_node_configs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL,
  inbound_id INTEGER NOT NULL,
  uuid VARCHAR(100) NOT NULL,
  sub_id VARCHAR(50) NOT NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  UNIQUE(user_id, server_id, inbound_id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_user_node_configs_user_id ON user_node_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_node_configs_server_id ON user_node_configs(server_id);
CREATE INDEX IF NOT EXISTS idx_user_node_configs_inbound_id ON user_node_configs(inbound_id);
CREATE INDEX IF NOT EXISTS idx_user_node_configs_sub_id ON user_node_configs(sub_id);

-- 创建 user_subscriptions 表
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sub_id VARCHAR(50) NOT NULL UNIQUE,
  nodes_data TEXT NOT NULL,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_sub_id ON user_subscriptions(sub_id);
```

- [ ] **Step 2: 在 xui_servers 表创建语句中添加 sub_url 字段**

修改 `xui_servers` 表的创建语句，添加 `sub_url` 字段：

```sql
CREATE TABLE IF NOT EXISTS xui_servers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  api_url VARCHAR(500) NOT NULL,
  api_username VARCHAR(255) NOT NULL,
  api_password VARCHAR(255) NOT NULL,
  host VARCHAR(500) DEFAULT '',
  client_port INTEGER DEFAULT 0,
  sub_url VARCHAR(500) DEFAULT '',
  status INTEGER DEFAULT 0,
  last_check_at BIGINT,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
);
```

- [ ] **Step 3: 添加数据库迁移逻辑**

在 `initDatabase` 函数末尾添加迁移逻辑，为已存在的 `xui_servers` 表添加 `sub_url` 字段：

```javascript
// 迁移：为 xui_servers 表添加 sub_url 字段
try {
  await db.exec('ALTER TABLE xui_servers ADD COLUMN IF NOT EXISTS sub_url VARCHAR(500) DEFAULT \'\'');
  console.log('Migration: Added sub_url column to xui_servers table');
} catch (error) {
  // 字段已存在时忽略错误
  if (!error.message.includes('already exists')) {
    console.error('Migration error:', error.message);
  }
}
```

- [ ] **Step 4: 运行数据库初始化脚本验证**

```bash
cd F:\web-project\subscription-manager-v1.0.0\server
npm run init-db
```

预期输出：表创建成功，无错误

- [ ] **Step 5: 提交数据库变更**

```bash
git add server/db/init.js
git commit -m "feat(db): add user_node_configs, user_subscriptions tables and sub_url field"
```

---

## Task 2: 服务器管理 API 更新

**Files:**
- Modify: `server/routes/admin/servers.js`

- [ ] **Step 1: 修改添加服务器接口**

找到 `POST /api/admin/servers` 路由，在参数验证和插入逻辑中添加 `sub_url` 字段：

```javascript
// 在验证逻辑中添加
const { name, api_url, api_username, api_password, host, client_port, sub_url } = req.body;

// 在插入 SQL 中添加 sub_url
const result = await db.prepare(
  'INSERT INTO xui_servers (name, api_url, api_username, api_password, host, client_port, sub_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id'
).run(name, api_url, api_username, api_password, host || '', client_port || 0, sub_url || '');
```

- [ ] **Step 2: 修改编辑服务器接口**

找到 `PUT /api/admin/servers/:id` 路由，在参数验证和更新逻辑中添加 `sub_url` 字段：

```javascript
// 在更新逻辑中添加 sub_url
const updates = [];
const values = [];
let paramIndex = 1;

if (name !== undefined) {
  updates.push(`name = $${paramIndex++}`);
  values.push(name);
}
// ... 其他字段 ...

if (sub_url !== undefined) {
  updates.push(`sub_url = $${paramIndex++}`);
  values.push(sub_url);
}

values.push(id);
const result = await db.prepare(
  `UPDATE xui_servers SET ${updates.join(', ')} WHERE id = $${paramIndex}`
).run(...values);
```

- [ ] **Step 3: 修改服务器列表接口**

找到 `GET /api/admin/servers` 路由，在返回字段中添加 `sub_url`：

```javascript
// 在 SELECT 语句中添加 sub_url
const servers = await db.prepare(
  'SELECT id, name, api_url, host, client_port, sub_url, status, last_check_at, created_at FROM xui_servers ORDER BY created_at DESC'
).all();
```

- [ ] **Step 4: 测试服务器管理 API**

启动服务器并测试：

```bash
cd F:\web-project\subscription-manager-v1.0.0\server
npm run dev
```

使用 Postman 或 curl 测试：
1. 添加服务器时传入 `sub_url` 参数
2. 编辑服务器时更新 `sub_url` 参数
3. 获取服务器列表时检查 `sub_url` 字段

- [ ] **Step 5: 提交服务器 API 变更**

```bash
git add server/routes/admin/servers.js
git commit -m "feat(api): add sub_url field to server management APIs"
```

---

## Task 3: 创建策略处理服务

**Files:**
- Create: `server/services/subscription-strategy.js`
- Create: `server/test/test-subscription-strategy.js`

- [ ] **Step 1: 创建策略处理服务文件**

创建 `server/services/subscription-strategy.js`：

```javascript
/**
 * 订阅策略处理服务
 * 
 * 支持两种策略：
 * - cf: 替换地址为 CF 优选 IP，端口为 client_port，host 为 host
 * - direct: 完全不修改，直接使用原始节点信息
 */

/**
 * 从节点备注中判断策略类型
 * @param {string} remark - 节点备注
 * @returns {string} 'cf' 或 'direct'
 */
function getStrategyFromRemark(remark) {
  if (!remark) return 'direct';
  const lowerRemark = remark.toLowerCase();
  if (lowerRemark.includes('cf')) {
    return 'cf';
  }
  return 'direct';
}

/**
 * 解析节点链接
 * @param {string} link - 节点链接（vless://, vmess://, trojan://）
 * @returns {object} 解析后的节点信息
 */
function parseNodeLink(link) {
  if (!link) return null;
  
  const protocol = link.split('://')[0];
  const rest = link.substring(protocol.length + 3);
  
  // 分离 remark（# 后面的内容）
  const [mainPart, remark] = rest.split('#');
  
  // 分离参数（? 后面的内容）
  const [addressPart, params] = mainPart.split('?');
  
  // 解析地址和端口
  let address, port;
  if (addressPart.includes('@')) {
    const [uuid, hostPort] = addressPart.split('@');
    const [host, portStr] = hostPort.split(':');
    address = host;
    port = parseInt(portStr) || 0;
  }
  
  // 解析参数
  const paramsObj = {};
  if (params) {
    params.split('&').forEach(param => {
      const [key, value] = param.split('=');
      paramsObj[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });
  }
  
  return {
    protocol,
    uuid: addressPart.includes('@') ? addressPart.split('@')[0] : '',
    address: address || '',
    port: port || 0,
    params: paramsObj,
    remark: remark ? decodeURIComponent(remark) : ''
  };
}

/**
 * 构建节点链接
 * @param {object} nodeInfo - 节点信息
 * @returns {string} 节点链接
 */
function buildNodeLink(nodeInfo) {
  const { protocol, uuid, address, port, params, remark } = nodeInfo;
  
  // 构建参数字符串
  const paramsStr = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  
  // 构建主部分
  const mainPart = `${uuid}@${address}:${port}`;
  
  // 构建完整链接
  let link = `${protocol}://${mainPart}`;
  if (paramsStr) {
    link += `?${paramsStr}`;
  }
  if (remark) {
    link += `#${encodeURIComponent(remark)}`;
  }
  
  return link;
}

/**
 * 应用 cf 策略
 * @param {string} originalLink - 原始节点链接
 * @param {object} cfConfig - CF 配置
 * @param {string} cfConfig.cfIp - CF 优选 IP
 * @param {number} cfConfig.clientPort - 客户端端口
 * @param {string} cfConfig.host - 主机名
 * @returns {string} 处理后的节点链接
 */
function applyCfStrategy(originalLink, cfConfig) {
  const nodeInfo = parseNodeLink(originalLink);
  if (!nodeInfo) return originalLink;
  
  // 替换地址
  if (cfConfig.cfIp) {
    nodeInfo.address = cfConfig.cfIp;
  }
  
  // 替换端口
  if (cfConfig.clientPort) {
    nodeInfo.port = cfConfig.clientPort;
  }
  
  // 替换 host（对于 WS 模式）
  if (cfConfig.host && nodeInfo.params.host) {
    nodeInfo.params.host = cfConfig.host;
  }
  
  return buildNodeLink(nodeInfo);
}

/**
 * 应用 direct 策略
 * @param {string} originalLink - 原始节点链接
 * @returns {string} 原始节点链接（不修改）
 */
function applyDirectStrategy(originalLink) {
  return originalLink;
}

/**
 * 处理节点链接
 * @param {string} originalLink - 原始节点链接
 * @param {string} strategy - 策略类型（cf 或 direct）
 * @param {object} cfConfig - CF 配置（仅 cf 策略需要）
 * @returns {string} 处理后的节点链接
 */
function processNodeLink(originalLink, strategy, cfConfig = null) {
  if (strategy === 'cf' && cfConfig) {
    return applyCfStrategy(originalLink, cfConfig);
  }
  return applyDirectStrategy(originalLink);
}

module.exports = {
  getStrategyFromRemark,
  parseNodeLink,
  buildNodeLink,
  applyCfStrategy,
  applyDirectStrategy,
  processNodeLink
};
```

- [ ] **Step 2: 创建测试脚本**

创建 `server/test/test-subscription-strategy.js`：

```javascript
const {
  getStrategyFromRemark,
  parseNodeLink,
  buildNodeLink,
  applyCfStrategy,
  applyDirectStrategy,
  processNodeLink
} = require('../services/subscription-strategy');

// 测试 getStrategyFromRemark
console.log('=== 测试 getStrategyFromRemark ===');
console.log('cf-香港节点:', getStrategyFromRemark('cf-香港节点'));  // 期望: cf
console.log('香港节点-cf:', getStrategyFromRemark('香港节点-cf'));  // 期望: cf
console.log('direct-美国节点:', getStrategyFromRemark('direct-美国节点'));  // 期望: direct
console.log('美国节点:', getStrategyFromRemark('美国节点'));  // 期望: direct
console.log('CF节点:', getStrategyFromRemark('CF节点'));  // 期望: cf
console.log('空字符串:', getStrategyFromRemark(''));  // 期望: direct
console.log('null:', getStrategyFromRemark(null));  // 期望: direct

// 测试 parseNodeLink
console.log('\n=== 测试 parseNodeLink ===');
const vlessLink1 = 'vless://3210bf88-5a18-4114-b521-22c49748023b@hk01.bidding.dpdns.org:14386?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=A3l0DQSQNFeInDCy9tePrgqrzDyfOyUo8qktD2ranCE&sid=cf&spx=%2F&type=tcp&headerType=none#%E7%9B%B4%E8%BF%9E-arqqnxuy';
const parsed1 = parseNodeLink(vlessLink1);
console.log('解析 Reality 模式链接:', JSON.stringify(parsed1, null, 2));

const vlessLink2 = 'vless://cadff911-3f77-429d-858a-25e8970b7d70@104.17.160.0:80?encryption=none&security=none&type=ws&host=chus00.bidding.dpdns.org&path=%2Fz2vvhqxhdxgkdmz4#US-00-testus000';
const parsed2 = parseNodeLink(vlessLink2);
console.log('解析 WS 模式链接:', JSON.stringify(parsed2, null, 2));

// 测试 buildNodeLink
console.log('\n=== 测试 buildNodeLink ===');
const rebuiltLink1 = buildNodeLink(parsed1);
console.log('重建链接1:', rebuiltLink1);
console.log('原始链接1:', vlessLink1);
console.log('匹配:', rebuiltLink1 === vlessLink1);

// 测试 applyCfStrategy
console.log('\n=== 测试 applyCfStrategy ===');
const cfConfig = {
  cfIp: '104.17.160.0',
  clientPort: 443,
  host: 'cf.example.com'
};
const cfResult = applyCfStrategy(vlessLink1, cfConfig);
console.log('CF 策略处理结果:', cfResult);

// 测试 applyDirectStrategy
console.log('\n=== 测试 applyDirectStrategy ===');
const directResult = applyDirectStrategy(vlessLink1);
console.log('Direct 策略处理结果:', directResult);
console.log('与原始链接匹配:', directResult === vlessLink1);

// 测试 processNodeLink
console.log('\n=== 测试 processNodeLink ===');
const processResult1 = processNodeLink(vlessLink1, 'cf', cfConfig);
console.log('CF 策略处理:', processResult1);

const processResult2 = processNodeLink(vlessLink1, 'direct');
console.log('Direct 策略处理:', processResult2);

console.log('\n=== 所有测试完成 ===');
```

- [ ] **Step 3: 运行测试脚本验证**

```bash
cd F:\web-project\subscription-manager-v1.0.0\server
node test/test-subscription-strategy.js
```

预期输出：所有测试通过，解析和重建链接正确

- [ ] **Step 4: 提交策略处理服务**

```bash
git add server/services/subscription-strategy.js server/test/test-subscription-strategy.js
git commit -m "feat(service): add subscription strategy processing service"
```

---

## Task 4: 修改用户同步逻辑

**Files:**
- Modify: `server/services/order-service.js`

- [ ] **Step 1: 添加 crypto 模块导入**

在 `order-service.js` 文件顶部添加：

```javascript
const crypto = require('crypto');
```

- [ ] **Step 2: 创建生成独立 UUID 和 sub_id 的函数**

在 `order-service.js` 中添加：

```javascript
/**
 * 为用户在节点上生成独立的 UUID 和 sub_id
 * @returns {object} { uuid, subId }
 */
function generateNodeCredentials() {
  return {
    uuid: crypto.randomUUID(),
    subId: crypto.randomBytes(8).toString('hex')  // 16 位十六进制
  };
}
```

- [x] **Step 3: 修改 syncUserToXuiServers 函数**

找到 `syncUserToXuiServers` 函数，修改添加用户的逻辑：

```javascript
async function syncUserToXuiServers(db, user, plan) {
  try {
    // 查询所有在线的 3X-UI 服务器
    const servers = await db.prepare(
      'SELECT * FROM xui_servers WHERE status = 1'
    ).all();

    for (const server of servers) {
      try {
        const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
        await xuiService.init();

        // 获取该服务器的所有 inbounds
        const inboundsResult = await xuiService.getInbounds();

        for (const inbound of inboundsResult.data) {
          try {
            // 为每个节点生成唯一的邮箱标识（邮箱-节点备注）
            const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;

            // 检查用户是否已存在
            const existingClient = await xuiService.getClientByEmail(inbound.id, nodeEmail);

            if (existingClient.success) {
              // 用户已存在，检查是否已有配置
              const existingConfig = await db.prepare(
                'SELECT id, uuid, sub_id FROM user_node_configs WHERE user_id = ? AND server_id = ? AND inbound_id = ?'
              ).get(user.id, server.id, inbound.id);

              // ... 更新逻辑（使用数据库中的 sub_id，direct 节点添加 flow）
            } else {
              // 用户不存在，添加新用户
              const credentials = generateNodeCredentials();

              // 保存到 user_node_configs 表（使用 server_id + inbound_id）
              await db.prepare(
                'INSERT INTO user_node_configs (user_id, server_id, inbound_id, uuid, sub_id) VALUES (?, ?, ?, ?, ?)'
              ).run(user.id, server.id, inbound.id, credentials.uuid, credentials.subId);

              // 添加到 3X-UI（direct 节点添加 flow 参数）
              const addOpts = {
                email: nodeEmail,
                id: credentials.uuid,
                enable: true,
                expiryTime: expiryTime,
                totalGB: totalGB,
                limitIp: 0,
                tgId: 0,
                subId: credentials.subId
              };
              if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
                addOpts.flow = 'xtls-rprx-vision';
              }
              await xuiService.addClient(inbound.id, inbound.protocol, addOpts);
            }
          } catch (error) {
            // ...
          }
        }
      } catch (error) {
        // ...
      }
    }
  } catch (error) {
    // ...
  }
}
```

- [ ] **Step 4: 测试用户同步逻辑**

创建测试脚本 `server/test/test-user-sync.js`：

```javascript
const db = require('../db/init');
const { syncUserToXuiServers } = require('../services/order-service');

async function testUserSync() {
  try {
    // 获取一个测试用户
    const user = await db.prepare('SELECT * FROM users WHERE enabled = 1 LIMIT 1').get();
    if (!user) {
      console.log('No enabled user found for testing');
      return;
    }

    // 获取用户的套餐
    const plan = await db.prepare('SELECT * FROM plans WHERE id = $1').get(user.plan_id);
    if (!plan) {
      console.log('No plan found for user');
      return;
    }

    console.log(`Testing sync for user: ${user.email}`);
    console.log(`Plan: ${plan.name}`);

    // 执行同步
    await syncUserToXuiServers(db, user, plan);

    // 检查 user_node_configs 表
    const configs = await db.prepare(
      'SELECT * FROM user_node_configs WHERE user_id = $1'
    ).all(user.id);

    console.log(`User node configs created: ${configs.length}`);
    configs.forEach(config => {
      console.log(`  Node ID: ${config.node_id}, UUID: ${config.uuid}, Sub ID: ${config.subId}`);
    });

    console.log('Test completed');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testUserSync();
```

- [ ] **Step 5: 运行测试脚本验证**

```bash
cd F:\web-project\subscription-manager-v1.0.0\server
node test/test-user-sync.js
```

预期输出：用户同步成功，user_node_configs 表中有记录

- [ ] **Step 6: 提交用户同步逻辑变更**

```bash
git add server/services/order-service.js server/test/test-user-sync.js
git commit -m "feat(sync): generate independent UUID/sub_id for each node"
```

---

## Task 5: 修改订阅生成逻辑

**Files:**
- Modify: `server/routes/user/subscription.js`

- [ ] **Step 1: 添加必要的导入**

在 `subscription.js` 文件顶部添加：

```javascript
const { getStrategyFromRemark, processNodeLink } = require('../../services/subscription-strategy');
const https = require('https');
const http = require('http');
```

- [ ] **Step 2: 创建获取 3X-UI 原始订阅的函数**

在 `subscription.js` 中添加：

```javascript
/**
 * 从 3X-UI 获取原始订阅内容
 * @param {string} subUrl - 订阅地址
 * @param {string} subId - 订阅 token
 * @returns {Promise<string>} 原始订阅内容
 */
async function fetchOriginalSubscription(subUrl, subId) {
  return new Promise((resolve, reject) => {
    const fullUrl = `${subUrl}${subId}`;
    const client = fullUrl.startsWith('https') ? https : http;
    
    client.get(fullUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/**
 * 解析订阅内容为节点链接数组
 * @param {string} content - 订阅内容（Base64 编码）
 * @returns {string[]} 节点链接数组
 */
function parseSubscriptionContent(content) {
  try {
    const decoded = Buffer.from(content, 'base64').toString('utf-8');
    return decoded.split('\n').filter(line => line.trim());
  } catch (error) {
    console.error('Error parsing subscription content:', error);
    return [];
  }
}
```

- [x] **Step 3: 修改 generateSubscription 函数**

找到 `POST /api/user/subscription/generate` 路由，修改生成逻辑：

```javascript
router.post('/generate', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    // 获取用户信息
    const user = await db.prepare('SELECT * FROM users WHERE id = $1').get(userId);
    if (!user) {
      return res.json({ code: 2004, message: '用户不存在', data: null });
    }

    // 检查用户是否启用
    if (!user.enabled) {
      return res.json({ code: 2003, message: '账号已被禁用', data: null });
    }

    // 检查 CF 优选
    const cfIps = await db.prepare(
      'SELECT * FROM user_cf_ips WHERE user_id = $1'
    ).all(userId);

    if (cfIps.length === 0) {
      return res.json({ code: 3001, message: '请先完成 IP 优选', data: null });
    }

    // 同步所有服务器节点信息
    const { syncAllServers } = require('../../services/xui-sync');
    await syncAllServers(db);

    // 获取所有在线服务器
    const servers = await db.prepare(
      'SELECT * FROM xui_servers WHERE status = 1'
    ).all();

    // 聚合所有节点
    const allNodes = [];

    for (const server of servers) {
      try {
        // 获取用户在该服务器的节点配置（使用 server_id + inbound_id 关联）
        const nodeConfigs = await db.prepare(`
          SELECT unc.uuid, unc.sub_id, xn.remark, xn.protocol, xn.inbound_id
          FROM user_node_configs unc
          JOIN xui_nodes xn ON unc.server_id = xn.server_id AND unc.inbound_id = xn.inbound_id
          WHERE unc.user_id = ? AND unc.server_id = ?
        `).all(userId, server.id);

        if (nodeConfigs.length === 0) {
          continue;
        }

        // 为每个节点分别获取原始订阅（每个 inbound 有独立的 sub_id）
        for (const config of nodeConfigs) {
          const strategy = getStrategyFromRemark(config.remark);

          // 从 3X-UI 获取该节点的原始订阅
          const originalContent = await fetchOriginalSubscription(server.sub_url, config.sub_id);
          const links = parseSubscriptionContent(originalContent);
          const originalLink = links[0];

          // 处理节点链接
          let processedLink;
          if (strategy === 'cf') {
            // 为每个 CF 优选 IP 生成一个节点
            for (const cfIpItem of cfIps) {
              processedLink = processNodeLink(originalLink, 'cf', {
                cfIp: cfIpItem.ip,
                clientPort: server.client_port,
                host: server.host
              });
              allNodes.push({
                server_name: server.name,
                node_name: config.remark,
                protocol: config.protocol,
                strategy: strategy,
                link: processedLink,
                original_link: originalLink
              });
            }
          } else {
            processedLink = processNodeLink(originalLink, 'direct');
            allNodes.push({
              server_name: server.name,
              node_name: config.remark,
              protocol: config.protocol,
              strategy: strategy,
              link: processedLink,
              original_link: originalLink
            });
          }
        }
      } catch (error) {
        // ...
      }
    }

    // 存储到 user_subscriptions 表
    // ... 返回订阅链接
  } catch (error) {
    // ...
  }
});
```

- [ ] **Step 4: 修改订阅内容获取接口**

找到 `GET /api/user/sub/:token` 路由，修改为从 `user_subscriptions` 表获取缓存数据：

```javascript
router.get('/sub/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { clash, v2ray } = req.query;

    // 从 user_subscriptions 表获取缓存的节点信息
    const subscription = await db.prepare(
      'SELECT * FROM user_subscriptions WHERE sub_id = $1'
    ).get(token);

    if (!subscription) {
      return res.status(404).send('Subscription not found');
    }

    // 解析节点数据
    const nodes = JSON.parse(subscription.nodes_data);

    // 生成订阅内容
    if (clash === '1') {
      // 返回 Clash 配置
      const clashConfig = generateClashConfig(nodes);
      res.setHeader('Content-Type', 'text/yaml');
      res.send(clashConfig);
    } else {
      // 返回 V2Ray Base64 配置
      const v2rayContent = nodes.map(node => node.link).join('\n');
      const v2rayBase64 = Buffer.from(v2rayContent).toString('base64');
      res.setHeader('Content-Type', 'text/plain');
      res.send(v2rayBase64);
    }
  } catch (error) {
    console.error('Error getting subscription:', error);
    res.status(500).send('Internal Server Error');
  }
});
```

- [ ] **Step 5: 测试订阅生成逻辑**

启动服务器并测试：

```bash
cd F:\web-project\subscription-manager-v1.0.0\server
npm run dev
```

使用 Postman 或 curl 测试：
1. 调用 `POST /api/user/subscription/generate` 生成订阅链接
2. 调用 `GET /api/user/sub/:token` 获取订阅内容

- [ ] **Step 6: 提交订阅生成逻辑变更**

```bash
git add server/routes/user/subscription.js
git commit -m "feat(subscription): implement strategy-based subscription generation"
```

---

## Task 6: 前端服务器管理页面更新

**Files:**
- Modify: `client-admin/src/views/Servers.vue`

- [ ] **Step 1: 在添加/编辑对话框中添加订阅地址字段**

找到添加/编辑对话框的表单，在 `client_port` 字段后添加：

```vue
<el-form-item label="订阅链接地址">
  <el-input 
    v-model="form.sub_url" 
    placeholder="如：https://example.com/sub/aaa333/"
  />
</el-form-item>
```

- [ ] **Step 2: 在服务器卡片中显示订阅地址**

找到服务器卡片的显示区域，添加：

```vue
<div class="info-item">
  <span class="label">订阅地址：</span>
  <span class="value">{{ server.sub_url || '未设置' }}</span>
</div>
```

- [ ] **Step 3: 更新表单数据初始化**

找到表单数据初始化的位置，添加 `sub_url` 字段：

```javascript
const form = ref({
  name: '',
  api_url: '',
  api_username: '',
  api_password: '',
  host: '',
  client_port: 0,
  sub_url: ''
});
```

- [ ] **Step 4: 更新编辑对话框打开逻辑**

找到编辑对话框打开的位置，添加 `sub_url` 字段的赋值：

```javascript
const openEditDialog = (server) => {
  form.value = {
    name: server.name,
    api_url: server.api_url,
    api_username: server.api_username,
    api_password: server.api_password,
    host: server.host,
    client_port: server.client_port,
    sub_url: server.sub_url || ''
  };
  dialogVisible.value = true;
};
```

- [ ] **Step 5: 测试前端页面**

启动前端开发服务器：

```bash
cd F:\web-project\subscription-manager-v1.0.0\client-admin
npm run dev
```

访问服务器管理页面，测试：
1. 添加服务器时输入订阅地址
2. 编辑服务器时修改订阅地址
3. 查看服务器卡片中的订阅地址显示

- [ ] **Step 6: 提交前端变更**

```bash
git add client-admin/src/views/Servers.vue
git commit -m "feat(ui): add sub_url field to server management page"
```

---

## Task 7: 前端服务器详情页面更新

**Files:**
- Modify: `client-admin/src/views/ServerDetail.vue`

- [ ] **Step 1: 添加策略标签显示函数**

在 `ServerDetail.vue` 的 `<script setup>` 中添加：

```javascript
/**
 * 从节点备注中获取策略类型
 */
function getStrategyFromRemark(remark) {
  if (!remark) return 'Direct策略';
  const lowerRemark = remark.toLowerCase();
  if (lowerRemark.includes('cf')) {
    return 'CF策略';
  }
  return 'Direct策略';
}

/**
 * 获取策略标签类型
 */
function getStrategyTagType(remark) {
  if (!remark) return 'success';
  const lowerRemark = remark.toLowerCase();
  if (lowerRemark.includes('cf')) {
    return 'warning';  // 橙色
  }
  return 'success';  // 绿色
}
```

- [ ] **Step 2: 在节点列表中显示策略标签**

找到节点列表的显示区域，修改为：

```vue
<div class="node-card" v-for="node in nodes" :key="node.id">
  <div class="node-header">
    <span class="node-name">{{ node.remark }}</span>
    <el-tag :type="getStrategyTagType(node.remark)" size="small">
      {{ getStrategyFromRemark(node.remark) }}
    </el-tag>
  </div>
  <div class="node-info">
    <span>协议：{{ node.protocol }}</span>
    <span>端口：{{ node.port }}</span>
    <span>用户数：{{ node.user_count }}</span>
    <span>在线：{{ node.online_count }}</span>
  </div>
</div>
```

- [ ] **Step 3: 添加策略标签的样式**

在 `<style>` 中添加：

```css
.node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.node-name {
  font-weight: bold;
  font-size: 16px;
}
```

- [ ] **Step 4: 测试前端页面**

启动前端开发服务器：

```bash
cd F:\web-project\subscription-manager-v1.0.0\client-admin
npm run dev
```

访问服务器详情页面，测试：
1. 查看节点列表中的策略标签显示
2. 验证策略标签颜色是否正确

- [ ] **Step 5: 提交前端变更**

```bash
git add client-admin/src/views/ServerDetail.vue
git commit -m "feat(ui): display node strategy tags in server detail page"
```

---

## Task 8: 集成测试

**Files:**
- Create: `server/test/test-integration-subscription.js`

- [ ] **Step 1: 创建集成测试脚本**

创建 `server/test/test-integration-subscription.js`：

```javascript
/**
 * 订阅策略功能集成测试
 * 
 * 测试流程：
 * 1. 创建测试用户
 * 2. 模拟支付成功后的用户同步
 * 3. 生成订阅链接
 * 4. 获取订阅内容
 * 5. 验证策略处理是否正确
 */

const db = require('../db/init');
const { syncUserToXuiServers } = require('../services/order-service');

async function testIntegration() {
  console.log('=== 开始集成测试 ===\n');

  try {
    // 1. 获取测试用户
    const user = await db.prepare('SELECT * FROM users WHERE enabled = 1 LIMIT 1').get();
    if (!user) {
      console.log('❌ 未找到启用的用户');
      return;
    }
    console.log(`✅ 找到测试用户: ${user.email}`);

    // 2. 获取用户的套餐
    const plan = await db.prepare('SELECT * FROM plans WHERE id = $1').get(user.plan_id);
    if (!plan) {
      console.log('❌ 未找到用户套餐');
      return;
    }
    console.log(`✅ 用户套餐: ${plan.name}`);

    // 3. 检查服务器配置
    const servers = await db.prepare('SELECT * FROM xui_servers WHERE status = 1').all();
    console.log(`✅ 在线服务器数量: ${servers.length}`);

    for (const server of servers) {
      console.log(`  - ${server.name}: ${server.sub_url || '未设置订阅地址'}`);
    }

    // 4. 检查用户节点配置
    const nodeConfigs = await db.prepare(`
      SELECT unc.*, xn.remark, xs.name as server_name
      FROM user_node_configs unc
      JOIN xui_nodes xn ON unc.node_id = xn.id
      JOIN xui_servers xs ON xn.server_id = xs.id
      WHERE unc.user_id = $1
    `).all(user.id);

    console.log(`\n✅ 用户节点配置数量: ${nodeConfigs.length}`);
    for (const config of nodeConfigs) {
      console.log(`  - ${config.server_name} / ${config.remark}`);
      console.log(`    UUID: ${config.uuid}`);
      console.log(`    Sub ID: ${config.sub_id}`);
    }

    // 5. 检查订阅缓存
    const subscription = await db.prepare(
      'SELECT * FROM user_subscriptions WHERE user_id = $1'
    ).get(user.id);

    if (subscription) {
      console.log(`\n✅ 订阅缓存存在`);
      console.log(`  Sub ID: ${subscription.sub_id}`);
      console.log(`  更新时间: ${new Date(subscription.updated_at * 1000).toLocaleString()}`);
      
      const nodes = JSON.parse(subscription.nodes_data);
      console.log(`  节点数量: ${nodes.length}`);
      
      for (const node of nodes) {
        console.log(`  - ${node.server_name} / ${node.node_name}`);
        console.log(`    策略: ${node.strategy}`);
        console.log(`    链接: ${node.link.substring(0, 50)}...`);
      }
    } else {
      console.log(`\n⚠️ 订阅缓存不存在，需要调用生成接口`);
    }

    console.log('\n=== 集成测试完成 ===');
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

testIntegration();
```

- [ ] **Step 2: 运行集成测试**

```bash
cd F:\web-project\subscription-manager-v1.0.0\server
node test/test-integration-subscription.js
```

预期输出：所有检查通过，节点配置正确

- [ ] **Step 3: 手动测试完整流程**

1. 启动服务器：
   ```bash
   cd F:\web-project\subscription-manager-v1.0.0\server
   npm run dev
   ```

2. 启动前端：
   ```bash
   cd F:\web-project\subscription-manager-v1.0.0\client-admin
   npm run dev
   ```

3. 测试流程：
   - 在管理端添加服务器，设置订阅地址
   - 在服务器详情页查看节点策略标签
   - 在用户端生成订阅链接
   - 访问订阅链接获取节点信息

- [ ] **Step 4: 提交集成测试**

```bash
git add server/test/test-integration-subscription.js
git commit -m "test: add integration test for subscription strategy feature"
```

---

## Task 9: 文档更新

**Files:**
- Modify: `docs/requirements.md`
- Modify: `docs/api.md`

- [ ] **Step 1: 更新 requirements.md**

在 `docs/requirements.md` 中添加订阅策略功能的说明：

```markdown
## 9. 订阅策略功能

### 9.1 功能概述

系统支持为每个节点配置订阅信息处理策略，支持两种策略类型：

- **cf 策略**：替换地址为 CF 优选 IP，端口为 `client_port`，host 为 `host`
- **direct 策略**：完全不修改，直接使用 3X-UI 返回的原始节点信息

### 9.2 策略判断规则

通过节点备注（remark）判断策略类型：
- 备注包含 "cf"：使用 cf 策略
- 其他格式：使用 direct 策略

### 9.3 数据库设计

- `user_node_configs` 表：存储每个用户在每个节点上的独立配置（UUID 和 sub_id）
- `user_subscriptions` 表：存储聚合后的订阅信息，用于快速响应订阅请求
- `xui_servers.sub_url` 字段：存储服务器的订阅链接地址

### 9.4 工作流程

1. 用户支付成功后，系统为每个节点生成独立的 UUID 和 sub_id
2. 用户点击"生成订阅链接"时，系统：
   - 同步所有服务器节点信息
   - 从 3X-UI 获取原始订阅内容
   - 根据策略处理节点信息
   - 聚合所有节点并缓存
3. 用户访问订阅链接时，直接返回缓存的节点信息
```

- [ ] **Step 2: 更新 api.md**

在 `docs/api.md` 中添加新的 API 说明：

```markdown
### 2.8 订阅策略相关

#### POST `/api/user/subscription/generate`

生成订阅链接，会根据节点策略处理订阅信息。

**说明**：此接口会：
1. 同步所有服务器节点信息
2. 为每个节点生成独立的 UUID 和 sub_id
3. 根据节点策略处理订阅信息
4. 聚合所有节点并缓存

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "subscription_url": "https://example.com/api/user/sub/abc123",
    "clash_url": "https://example.com/api/user/sub/abc123?clash=1",
    "v2ray_url": "https://example.com/api/user/sub/abc123?v2ray=1"
  }
}
```

#### 节点策略说明

| 策略类型 | 节点备注格式 | 处理逻辑 |
|----------|--------------|----------|
| cf | 备注包含 "cf" | 替换地址为 CF 优选 IP，端口为 client_port，host 为 host |
| direct | 其他格式 | 完全不修改，直接使用原始节点信息 |
```

- [ ] **Step 3: 提交文档更新**

```bash
git add docs/requirements.md docs/api.md
git commit -m "docs: add subscription strategy feature documentation"
```

---

## Task 10: 最终验证

- [ ] **Step 1: 运行所有测试脚本**

```bash
cd F:\web-project\subscription-manager-v1.0.0\server

# 策略处理服务测试
node test/test-subscription-strategy.js

# 用户同步测试
node test/test-user-sync.js

# 集成测试
node test/test-integration-subscription.js
```

- [ ] **Step 2: 执行前端构建**

```bash
cd F:\web-project\subscription-manager-v1.0.0\client-admin
npm run build
```

预期输出：构建成功，无错误

- [ ] **Step 3: 完整功能测试**

1. 启动服务器和前端
2. 在管理端添加服务器，设置订阅地址
3. 在服务器详情页查看节点策略标签
4. 在用户端生成订阅链接
5. 访问订阅链接获取节点信息
6. 验证 cf 策略是否正确替换地址/端口/host
7. 验证 direct 策略是否保持原始节点信息

- [ ] **Step 4: 提交所有变更**

```bash
git add .
git status
```

确认所有变更后，提交：

```bash
git commit -m "feat: implement node subscription strategy feature

- Add user_node_configs and user_subscriptions tables
- Add sub_url field to xui_servers table
- Implement cf and direct strategy processing
- Generate independent UUID/sub_id for each node
- Update frontend to display strategy tags
- Add comprehensive tests"
```

---

## 额外实现的功能（不在原计划中）

### 定时任务：sub_id 和 flow 同步

**文件**：`server/jobs/index.js`

定时任务每 4 小时执行一次，检查并同步：
- sub_id：数据库值覆盖 3X-UI（数据库为主）
- flow：direct 节点如果 3X-UI 中为空，自动补充 `xtls-rprx-vision`

```javascript
// 检查已存在用户的 sub_id 和 flow 是否一致
for (const user of users) {
  const nodeEmail = `${user.email}-${inbound.remark || inbound.id}`;
  const xuiClient = existingClientsMap[nodeEmail];
  if (!xuiClient) continue;

  const dbConfig = await db.prepare(
    'SELECT uuid, sub_id FROM user_node_configs WHERE user_id = ? AND server_id = ? AND inbound_id = ?'
  ).get(user.id, server.id, inbound.id);

  // sub_id 不一致时更新
  if (xuiClient.subId !== dbConfig.sub_id) {
    const updateOpts = { subId: dbConfig.sub_id };
    if (inbound.remark && inbound.remark.toLowerCase().includes('direct')) {
      updateOpts.flow = 'xtls-rprx-vision';
    }
    await xuiService.updateClient(inbound.id, nodeEmail, updateOpts);
  }

  // direct 节点缺少 flow 时补充
  if (inbound.remark && inbound.remark.toLowerCase().includes('direct') && !xuiClient.flow) {
    await xuiService.updateClient(inbound.id, nodeEmail, {
      subId: dbConfig.sub_id,
      flow: 'xtls-rprx-vision'
    });
  }
}
```

### 数据库迁移脚本

**文件**：`server/db/migrations/001-node-subscription-strategy.js`

生产环境部署前运行：
```bash
node server/db/migrations/001-node-subscription-strategy.js
```

迁移内容：
- `xui_servers` 表添加 `sub_url` 字段
- `user_node_configs` 表从 `node_id` 改为 `server_id` + `inbound_id`
- `users` 和 `user_node_configs` 表的 `sub_id` 更新为 16 位

支持幂等运行，已迁移的步骤自动跳过。

---

## 实施计划总结

| 任务 | 说明 | 预计时间 |
|------|------|----------|
| Task 1 | 数据库表结构更新 | 10 分钟 |
| Task 2 | 服务器管理 API 更新 | 15 分钟 |
| Task 3 | 创建策略处理服务 | 20 分钟 |
| Task 4 | 修改用户同步逻辑 | 20 分钟 |
| Task 5 | 修改订阅生成逻辑 | 30 分钟 |
| Task 6 | 前端服务器管理页面更新 | 15 分钟 |
| Task 7 | 前端服务器详情页面更新 | 10 分钟 |
| Task 8 | 集成测试 | 20 分钟 |
| Task 9 | 文档更新 | 10 分钟 |
| Task 10 | 最终验证 | 15 分钟 |
| **总计** | | **约 2.5 小时** |

---

## 执行选项

Plan complete and saved to `docs/superpowers/plans/2026-05-10-node-subscription-strategy.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

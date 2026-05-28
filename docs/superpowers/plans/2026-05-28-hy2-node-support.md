# HY2 节点支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有订阅管理系统新增 `hysteria2 + UDP + TLS` 节点支持，完成独立密码字段落库、3X-UI 客户端同步、原始订阅解析与 Clash 输出，并保留现有 `cf/direct` 流程不回退。

**Architecture:** 以现有“先同步到 3X-UI，再按单节点 `sub_id` 拉取原始订阅，再按策略聚合最终订阅”的架构为基础，新增 `user_node_configs.password` 字段，将 `hy2` 识别为新的策略类型，但在订阅输出阶段与 `direct` 等效。`xui-service` 增加按协议构建 client payload 的适配层，使 `cf/direct` 继续走 `uuid`，`hy2` 单独走 `password`，并通过日志保留 3X-UI 返回结果以便联调。

**Tech Stack:** Node.js, Express, PostgreSQL, 3X-UI API, 现有脚本测试（`node server/test/*.js`）

---

## 文件结构

| 文件 | 类型 | 作用 |
|------|------|------|
| `server/db/migrations/002-user-node-config-password.js` | Create | 为 `user_node_configs` 增加 `password` 字段，保持幂等 |
| `server/services/subscription-strategy.js` | Modify | 新增 `hy2` 策略识别与 `hysteria2://` 解析/重建 |
| `server/services/order-service.js` | Modify | 新增按策略生成节点凭据与同步上下文 |
| `server/services/xui-service.js` | Modify | 新增按协议构建 3X-UI client payload 的适配层 |
| `server/routes/user/subscription.js` | Modify | 新增 `hy2` Clash 输出与订阅聚合兼容 |
| `server/test/test-subscription-strategy.js` | Modify | 补充 `hy2` 策略与链接解析测试 |
| `server/test/test-hy2-client-payload.js` | Create | 验证 `hy2` payload 字段和日志分支 |

---

### Task 1: 先补数据库迁移和失败测试，固定 `password` 字段与 `hy2` 解析目标

**Files:**
- Create: `server/db/migrations/002-user-node-config-password.js`
- Modify: `server/test/test-subscription-strategy.js`
- Test: `server/test/test-subscription-strategy.js`

- [ ] **Step 1: 新建幂等迁移脚本骨架**

使用 `apply_patch` 新建 `server/db/migrations/002-user-node-config-password.js`：

```javascript
/**
 * 为 user_node_configs 增加 password 字段
 * 仅用于 hy2 等基于密码的协议，保持与 uuid 字段职责分离。
 */
module.exports = {
  name: '002-user-node-config-password',

  async up(db) {
    const column = await db.prepare(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'user_node_configs' AND column_name = 'password'
    `).get();

    if (column) {
      console.log('[migration] user_node_configs.password already exists, skip');
      return;
    }

    await db.exec(`ALTER TABLE user_node_configs ADD COLUMN password VARCHAR(100) DEFAULT ''`);
    console.log('[migration] added user_node_configs.password');
  }
};
```

- [ ] **Step 2: 给 `test-subscription-strategy.js` 补 `hy2` 策略识别的失败断言**

在现有策略测试后追加：

```javascript
assert(getStrategyFromRemark('hy2-美国家庭宽带') === 'hy2', 'hy2-美国家庭宽带 -> hy2');
assert(getStrategyFromRemark('HY2-us-node') === 'hy2', 'HY2-us-node -> hy2（大小写不敏感）');
```

- [ ] **Step 3: 给 `test-subscription-strategy.js` 补 `hysteria2://` 解析和重建的失败断言**

继续补充：

```javascript
console.log('\n=== 测试 parseNodeLink (HY2 模式) ===');
const hy2Link = 'hysteria2://zcVWhGaxg6@us00.bidding.dpdns.org:32458?security=tls&fp=chrome&alpn=h3&sni=us00.bidding.dpdns.org#hy2-1y8h7myl';
const parsedHy2 = parseNodeLink(hy2Link);
assert(parsedHy2 !== null, '解析 HY2 链接成功');
assert(parsedHy2.protocol === 'hysteria2', '协议: hysteria2');
assert(parsedHy2.uuid === 'zcVWhGaxg6', 'password 字段先复用解析结果中的 uuid 槽位');
assert(parsedHy2.address === 'us00.bidding.dpdns.org', '地址正确');
assert(parsedHy2.port === 32458, '端口正确');
assert(parsedHy2.params.alpn === 'h3', 'alpn 参数正确');
assert(parsedHy2.remark === 'hy2-1y8h7myl', '备注正确');

const rebuiltHy2Link = buildNodeLink(parsedHy2);
assert(rebuiltHy2Link === hy2Link, '重建 HY2 链接与原始链接匹配');
```

- [ ] **Step 4: 给 `processNodeLink()` 增加 `hy2` 与 `direct` 等效的失败断言**

继续补充：

```javascript
const processResult4 = processNodeLink(hy2Link, 'hy2');
assert(processResult4 === hy2Link, 'processNodeLink hy2 策略与 direct 等效');
```

- [ ] **Step 5: 运行测试，确认当前失败点落在实现缺口上**

Run: `node server/test/test-subscription-strategy.js`
Expected: FAIL，错误集中在 `getStrategyFromRemark` 未识别 `hy2` 或 `parseNodeLink` 不支持 `hysteria2://`

- [ ] **Step 6: Commit**

```bash
git add server/db/migrations/002-user-node-config-password.js server/test/test-subscription-strategy.js
git commit -m "test: 补充hy2节点字段迁移与策略失败测试"
```

---

### Task 2: 实现 `subscription-strategy` 的 `hy2` 识别与链接解析/重建

**Files:**
- Modify: `server/services/subscription-strategy.js`
- Test: `server/test/test-subscription-strategy.js`

- [ ] **Step 1: 扩展协议识别列表，让 `parseNodeLink()` 接受 `hysteria2://`**

把协议匹配由：

```javascript
const protocolMatch = link.match(/^(vless|vmess|trojan):\/\//);
```

改为：

```javascript
const protocolMatch = link.match(/^(vless|vmess|trojan|hysteria2):\/\//);
```

- [ ] **Step 2: 扩展 `getStrategyFromRemark()`，显式识别 `hy2`**

把函数改成：

```javascript
function getStrategyFromRemark(remark) {
  if (!remark) return 'direct';
  const lowerRemark = remark.toLowerCase();
  if (lowerRemark.includes('cf')) {
    return 'cf';
  }
  if (lowerRemark.includes('hy2')) {
    return 'hy2';
  }
  return 'direct';
}
```

- [ ] **Step 3: 保持 `buildNodeLink()` 对 `hysteria2://` 的通用兼容**

确认以下通用逻辑不做协议分叉：

```javascript
const mainPart = `${uuid}@${host}:${port}`;
let link = `${protocol}://${mainPart}`;
```

并只在注释里补充说明：

```javascript
// 对 hysteria2 来说，uuid 槽位承载的是 password；这里保持统一解析结构，
// 由上层同步逻辑决定使用 uuid 还是 password 字段。
```

- [ ] **Step 4: 让 `processNodeLink()` 显式接受 `hy2`，但仍走 direct 路径**

把函数改成：

```javascript
function processNodeLink(originalLink, strategy, cfConfig = null) {
  if (strategy === 'cf' && cfConfig) {
    return applyCfStrategy(originalLink, cfConfig);
  }
  if (strategy === 'hy2') {
    return applyDirectStrategy(originalLink);
  }
  return applyDirectStrategy(originalLink);
}
```

- [ ] **Step 5: 运行策略测试，确认全部通过**

Run: `node server/test/test-subscription-strategy.js`
Expected: PASS，输出包含 `所有测试通过`

- [ ] **Step 6: Commit**

```bash
git add server/services/subscription-strategy.js server/test/test-subscription-strategy.js
git commit -m "feat: 新增hy2策略识别与链接解析支持"
```

---

### Task 3: 在 `xui-service` 中实现按协议构建 client payload，并增加 `hy2` 专项测试

**Files:**
- Modify: `server/services/xui-service.js`
- Create: `server/test/test-hy2-client-payload.js`
- Test: `server/test/test-hy2-client-payload.js`

- [ ] **Step 1: 新建 `hy2` payload 测试脚本骨架**

使用 `apply_patch` 新建 `server/test/test-hy2-client-payload.js`：

```javascript
const assert = require('assert');
const XuiService = require('../services/xui-service');

function createTestService() {
  const service = Object.create(XuiService.prototype);
  service.client = {
    async addClient(payload) {
      return { success: true, payload };
    },
    async updateClient(clientId, payload) {
      return { success: true, clientId, payload };
    }
  };
  return service;
}
```

- [ ] **Step 2: 先写失败测试，固定 `hy2` payload 必须包含的字段**

在同文件追加：

```javascript
function testBuildHy2ClientPayload() {
  const service = createTestService();
  const payload = service.buildClientSettingsPayload({
    protocol: 'hysteria2',
    strategy: 'hy2',
    credential: 'hy2-password',
    email: 'user@test.com-hy2',
    enable: true,
    expiryTime: 1700000000000,
    totalGB: 2147483648,
    subId: 'abc123def456'
  });

  assert.strictEqual(payload.email, 'user@test.com-hy2');
  assert.strictEqual(payload.password, 'hy2-password');
  assert.strictEqual(payload.subId, 'abc123def456');
  assert.strictEqual(payload.expiryTime, 1700000000000);
  assert.strictEqual(payload.totalGB, 2147483648);
  assert.ok(!('id' in payload));
  assert.ok(!('flow' in payload));
}
```

- [ ] **Step 3: 再写失败测试，固定 `direct` 节点继续使用 `uuid + flow`**

继续追加：

```javascript
function testBuildDirectClientPayload() {
  const service = createTestService();
  const payload = service.buildClientSettingsPayload({
    protocol: 'vless',
    strategy: 'direct',
    credential: 'uuid-direct',
    email: 'user@test.com-direct',
    enable: true,
    expiryTime: 1700000000000,
    totalGB: 3221225472,
    subId: 'direct-sub',
    flow: 'xtls-rprx-vision'
  });

  assert.strictEqual(payload.id, 'uuid-direct');
  assert.strictEqual(payload.flow, 'xtls-rprx-vision');
  assert.ok(!('password' in payload));
}
```

- [ ] **Step 4: 在 `xui-service.js` 中新增统一 payload 构建方法**

加入：

```javascript
  buildClientSettingsPayload(options = {}) {
    const {
      protocol = '',
      strategy = 'direct',
      credential = '',
      email = '',
      enable = true,
      expiryTime = 0,
      totalGB = 0,
      limitIp = 0,
      tgId = 0,
      subId = '',
      flow = ''
    } = options;

    const payload = {
      email,
      enable,
      expiryTime,
      totalGB,
      limitIp,
      tgId,
      subId
    };

    if (strategy === 'hy2' || protocol === 'hysteria2') {
      payload.password = credential;
      return payload;
    }

    payload.id = credential;
    if (flow) {
      payload.flow = flow;
    }
    return payload;
  }
```

- [ ] **Step 5: 让 `addClient()` 和 `updateClient()` 改为复用统一 payload**

把 `addClient()` 中原来的 `clientObj` 构建替换为：

```javascript
      const clientObj = this.buildClientSettingsPayload({
        protocol,
        strategy: options.strategy || 'direct',
        credential: options.password || options.id || '',
        email: options.email || '',
        enable: options.enable !== false,
        expiryTime: options.expiryTime || 0,
        totalGB: options.totalGB || 0,
        limitIp: options.limitIp || 0,
        tgId: options.tgId || 0,
        subId: options.subId || '',
        flow: options.flow || ''
      });
```

并把 `updateClient()` 中 `updateClientObj` 构建替换为：

```javascript
      const strategy = options.strategy || clientInfo.strategy || 'direct';
      const protocol = options.protocol || clientInfo.protocol || '';
      const credential = options.password !== undefined
        ? options.password
        : (strategy === 'hy2' || protocol === 'hysteria2' ? clientInfo.password : clientInfo.uuid);

      const updateClientObj = this.buildClientSettingsPayload({
        protocol,
        strategy,
        credential,
        email,
        enable: options.enabled !== undefined ? options.enabled : clientInfo.enable,
        expiryTime: options.expiryTime !== undefined ? options.expiryTime : clientInfo.expiryTime,
        totalGB: options.totalGB !== undefined ? options.totalGB * 1073741824 : clientInfo.totalGB,
        limitIp: 0,
        tgId: 0,
        subId: options.subId !== undefined ? options.subId : (clientInfo.subId || ''),
        flow: options.flow !== undefined ? options.flow : (clientInfo.flow || '')
      });
```

- [ ] **Step 6: 扩展 `getClientsByEmail()` / `getClientByEmail()` 返回 `password`**

在客户端映射结果中补：

```javascript
            password: item.password || '',
```

以及单条读取返回中补：

```javascript
        password: client.password || '',
```

- [ ] **Step 7: 让测试脚本执行并确认通过**

在测试文件末尾加入：

```javascript
function run() {
  testBuildHy2ClientPayload();
  testBuildDirectClientPayload();
  console.log('hy2 client payload tests passed');
}

run();
```

Run: `node server/test/test-hy2-client-payload.js`
Expected: `hy2 client payload tests passed`

- [ ] **Step 8: Commit**

```bash
git add server/services/xui-service.js server/test/test-hy2-client-payload.js
git commit -m "feat: 新增hy2客户端payload适配"
```

---

### Task 4: 改造 `order-service`，按策略生成 `uuid/password` 并传递完整同步上下文

**Files:**
- Modify: `server/services/order-service.js`
- Test: `server/test/test-hy2-client-payload.js`
- Test: `server/test/test-subscription-strategy.js`

- [ ] **Step 1: 提取按策略生成节点凭据的方法**

在 `server/services/order-service.js` 中新增：

```javascript
function generateNodeCredentials(strategy = 'direct') {
  const subId = crypto.randomBytes(8).toString('hex');

  if (strategy === 'hy2') {
    return {
      uuid: '',
      password: crypto.randomBytes(12).toString('base64url'),
      subId
    };
  }

  return {
    uuid: crypto.randomUUID(),
    password: '',
    subId
  };
}
```

- [ ] **Step 2: 让 `ensureNodeConfig()` 查询和写入 `password` 字段**

把查询改成：

```javascript
  const existingConfig = await db.prepare(
    'SELECT id, uuid, password, sub_id FROM user_node_configs WHERE user_id = ? AND server_id = ? AND inbound_id = ?'
  ).get(user.id, server.id, inbound.id);
```

返回值改成：

```javascript
    return {
      uuid: existingConfig.uuid,
      password: existingConfig.password || '',
      subId: existingConfig.sub_id
    };
```

插入改成：

```javascript
  await db.prepare(`
    INSERT INTO user_node_configs (user_id, server_id, inbound_id, uuid, password, sub_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, server_id, inbound_id) DO NOTHING
  `).run(user.id, server.id, inbound.id, uuid, password, subId);
```

- [ ] **Step 3: 在同步循环中根据 remark 推断策略并构建 `desiredClient`**

在 `syncUserToXuiServers()` 的 inbound 循环里加入：

```javascript
            const strategy = inbound.remark && inbound.remark.toLowerCase().includes('hy2')
              ? 'hy2'
              : (inbound.remark && inbound.remark.toLowerCase().includes('direct') ? 'direct' : 'cf');

            const config = await ensureNodeConfig(
              db,
              user,
              server,
              inbound,
              existingClient.success ? existingClient : null,
              strategy
            );

            const desiredClient = {
              id: config.uuid,
              password: config.password,
              email: nodeEmail,
              enable: true,
              expiryTime,
              totalGB: totalBytes,
              subId: config.subId,
              strategy,
              protocol: inbound.protocol
            };
```

- [ ] **Step 4: 只在 `direct` 节点保留 `flow`**

把 flow 处理改成：

```javascript
            if (strategy === 'direct') {
              desiredClient.flow = 'xtls-rprx-vision';
            }
```

- [ ] **Step 5: 调整 `upsertUniqueClient()` 调用参数，让 `xui-service` 能判断 `hy2`**

确保传参包含：

```javascript
            const syncResult = await xuiService.upsertUniqueClient(db, {
              userId: user.id,
              serverId: server.id,
              inbound,
              email: nodeEmail,
              desiredClient
            });
```

且 `desiredClient` 内保留：

```javascript
{
  strategy,
  protocol: inbound.protocol,
  password: config.password
}
```

- [ ] **Step 6: 做语法检查**

Run: `node -c server/services/order-service.js`
Expected: 无输出

- [ ] **Step 7: Commit**

```bash
git add server/services/order-service.js
git commit -m "feat: 按策略生成hy2节点密码并接入同步上下文"
```

---

### Task 5: 扩展订阅输出，支持 `hysteria2://` 聚合与 Clash 配置

**Files:**
- Modify: `server/routes/user/subscription.js`
- Modify: `server/services/subscription-service.js`
- Modify: `server/test/test-subscription-strategy.js`

- [ ] **Step 1: 确认原始订阅挑选逻辑允许 `hysteria2`**

检查 `pickSingleNodeLink()` 的协议匹配正则，无需额外改动时只补一条说明性注释：

```javascript
// expectedProtocol 允许 hysteria2，协议名直接按 URI scheme 匹配
```

- [ ] **Step 2: 让 `composeSubscriptionNodes()` 对 `hy2` 走 direct 分支**

保持现有：

```javascript
    if (strategy === 'cf') {
      // ...
    } else {
      const processedLink = replaceNodeRemark(processNodeLink(source.original_link, strategy), nodeName);
    }
```

确保这里传入的是 `strategy` 而不是硬编码 `'direct'`。

- [ ] **Step 3: 在 `generateClashConfig()` 中新增 `hysteria2` 分支**

在 `trojan` 分支后追加：

```javascript
    } else if (protocol === 'hysteria2') {
      const sni = params.sni || serverAddress;
      const alpnValues = (params.alpn || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

      let config = `  - name: ${node_name}
    type: hysteria2
    server: ${serverAddress}
    port: ${port}
    password: ${uuid}
    sni: ${sni}
    udp: true`;

      if (alpnValues.length > 0) {
        config += `\n    alpn:`;
        for (const alpn of alpnValues) {
          config += `\n      - ${alpn}`;
        }
      }
      if (params.fp) {
        config += `\n    client-fingerprint: ${params.fp}`;
      }
      if (params.insecure === '1' || params.insecure === 'true') {
        config += `\n    skip-cert-verify: true`;
      }

      return config;
```

- [ ] **Step 4: 给 `test-subscription-strategy.js` 补一条 `alpn` 保真断言**

追加：

```javascript
assert(rebuiltHy2Link.includes('alpn=h3'), 'HY2 重建后保留 alpn 参数');
```

- [ ] **Step 5: 做语法检查**

Run: `node -c server/routes/user/subscription.js`
Expected: 无输出

- [ ] **Step 6: 运行策略测试再次确认通过**

Run: `node server/test/test-subscription-strategy.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/routes/user/subscription.js server/services/subscription-service.js server/test/test-subscription-strategy.js
git commit -m "feat: 新增hy2订阅聚合与clash输出支持"
```

---

### Task 6: 回归验证、日志检查与联调准备

**Files:**
- Modify: `server/services/xui-service.js`
- Test: `server/test/test-subscription-strategy.js`
- Test: `server/test/test-hy2-client-payload.js`

- [ ] **Step 1: 在 `xui-service.js` 中补 `hy2` 关键日志**

在 `addClient()` 和 `updateClient()` 的日志中明确打印：

```javascript
      logger.info(`构建客户端配置: protocol=${protocol}, strategy=${options.strategy || 'direct'}, email=${options.email}, hasPassword=${Boolean(options.password)}, hasId=${Boolean(options.id)}`);
```

以及失败时保留 3X-UI 返回原文：

```javascript
      logger.warn(`添加客户端失败: ${result.msg}`);
```

和：

```javascript
      logger.warn(`更新客户端失败: ${result.msg}`);
```

- [ ] **Step 2: 运行 `hy2` payload 测试**

Run: `node server/test/test-hy2-client-payload.js`
Expected: `hy2 client payload tests passed`

- [ ] **Step 3: 运行策略测试**

Run: `node server/test/test-subscription-strategy.js`
Expected: `所有测试通过`

- [ ] **Step 4: 做语法检查**

Run: `node -c server/services/xui-service.js`
Expected: 无输出

Run: `node -c server/routes/user/subscription.js`
Expected: 无输出

Run: `node -c server/services/order-service.js`
Expected: 无输出

- [ ] **Step 5: 查看最终 diff，确认没有误改无关逻辑**

Run: `git diff -- server/db/migrations/002-user-node-config-password.js server/services/subscription-strategy.js server/services/xui-service.js server/services/order-service.js server/routes/user/subscription.js server/test/test-subscription-strategy.js server/test/test-hy2-client-payload.js`
Expected: diff 只包含 `hy2` 支持、`password` 字段、Clash 输出和日志增强

- [ ] **Step 6: 整理联调注意事项**

在实现完成后的交付说明中明确：

```text
1. 先运行数据库迁移
2. 修改 server/**/*.js 后提醒用户重启服务
3. 首次联调 hy2 时，优先查看本项目日志和 3X-UI 返回日志
4. 如果 3X-UI 拒绝当前 payload，以返回错误为准微调 password/id 等字段
```

- [ ] **Step 7: Commit**

```bash
git add server/services/xui-service.js server/services/order-service.js server/routes/user/subscription.js server/services/subscription-strategy.js server/test/test-subscription-strategy.js server/test/test-hy2-client-payload.js server/db/migrations/002-user-node-config-password.js
git commit -m "test: 完成hy2节点支持实现与回归验证"
```

---

## 覆盖检查

- Spec 要求“新增 `password` 字段并区分语义”：由 Task 1 + Task 4 覆盖
- Spec 要求“`hy2` 同步带过期时间和总流量”：由 Task 3 + Task 4 覆盖
- Spec 要求“订阅阶段 `hy2` 与 `direct` 一致”：由 Task 2 + Task 5 覆盖
- Spec 要求“Clash 输出支持 `hysteria2`”：由 Task 5 覆盖
- Spec 要求“联调时重点看 3X-UI 返回日志”：由 Task 6 覆盖
- Spec 要求“现有 `cf/direct` 不回退”：由 Task 2 + Task 3 + Task 6 覆盖

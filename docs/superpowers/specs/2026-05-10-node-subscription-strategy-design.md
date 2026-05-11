# 节点订阅策略功能设计文档

> 版本：V1.1  
> 更新日期：2026-05-11  
> 状态：已实现

---

## 1. 需求概述

### 1.1 功能目标

在管理端服务器管理中添加以下功能：

1. **服务器卡片添加订阅链接地址字段**：可在卡片中修改，添加服务器时可设置
2. **节点订阅信息处理策略**：通过节点备注标识策略类型（cf 或 direct）
3. **每个节点独立的 UUID 和 sub_id**：为每个用户在每个节点上生成独立的认证信息
4. **策略工作流程**：用户生成订阅链接时，根据策略处理节点信息并聚合

### 1.2 策略说明

| 策略类型 | 说明 | 节点备注格式 |
|----------|------|--------------|
| **cf** | 替换地址为 CF 优选 IP，端口为 `client_port`，host 为 `host` | 备注包含 "cf"（如 "cf-香港节点"） |
| **direct** | 完全不修改，直接使用 3X-UI 返回的原始节点信息 | 备注包含 "direct" 或其他格式 |

---

## 2. 数据库设计

### 2.1 xui_servers 表新增字段

```sql
ALTER TABLE xui_servers ADD COLUMN sub_url VARCHAR(500) DEFAULT '';
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `sub_url` | VARCHAR(500) | `''` | 订阅链接地址（如 `https://example.com/sub/aaa333/`） |

### 2.2 新建 user_node_configs 表

存储每个用户在每个节点上的独立配置（UUID 和 sub_id）。

```sql
CREATE TABLE user_node_configs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL,
  inbound_id INTEGER NOT NULL,
  uuid VARCHAR(100) NOT NULL,
  sub_id VARCHAR(50) NOT NULL,
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  UNIQUE(user_id, server_id, inbound_id)
);

CREATE INDEX idx_user_node_configs_user_id ON user_node_configs(user_id);
CREATE INDEX idx_user_node_configs_server_id ON user_node_configs(server_id);
CREATE INDEX idx_user_node_configs_inbound_id ON user_node_configs(inbound_id);
CREATE INDEX idx_user_node_configs_sub_id ON user_node_configs(sub_id);
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | SERIAL | 主键 |
| `user_id` | INTEGER | 用户 ID（关联 users 表，级联删除） |
| `server_id` | INTEGER | 服务器 ID（不依赖 xui_nodes 外键） |
| `inbound_id` | INTEGER | 3X-UI 的 inbound ID |
| `uuid` | VARCHAR(100) | 该节点的独立 UUID |
| `sub_id` | VARCHAR(50) | 该节点的独立订阅 token（16 位十六进制） |
| `created_at` | BIGINT | 创建时间戳 |

**约束说明**：
- `user_id + server_id + inbound_id` 唯一索引：确保每个用户在每个节点上只有一条配置
- `sub_id` 索引：用于通过订阅 token 快速查找用户
- 不使用 `xui_nodes` 表外键：避免节点同步时级联删除用户配置

### 2.3 新建 user_subscriptions 表

存储聚合后的订阅信息，用于快速响应订阅请求。

```sql
CREATE TABLE user_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sub_id VARCHAR(50) NOT NULL UNIQUE,
  nodes_data TEXT NOT NULL,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
);

CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_sub_id ON user_subscriptions(sub_id);
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | SERIAL | 主键 |
| `user_id` | INTEGER | 用户 ID（关联 users 表，级联删除） |
| `sub_id` | VARCHAR(50) | 订阅 token（对应 users.sub_id） |
| `nodes_data` | TEXT | JSON 格式的聚合节点信息 |
| `updated_at` | BIGINT | 最后更新时间戳 |

### 2.4 nodes_data 数据结构

```json
[
  {
    "server_name": "服务器A",
    "node_name": "cf-香港节点",
    "protocol": "vless",
    "strategy": "cf",
    "link": "vless://uuid@cf-ip:443?encryption=none&...",
    "original_link": "vless://uuid@原始地址:14386?encryption=none&..."
  },
  {
    "server_name": "服务器A",
    "node_name": "direct-美国节点",
    "protocol": "vless",
    "strategy": "direct",
    "link": "vless://uuid@原始地址:14386?encryption=none&...",
    "original_link": "vless://uuid@原始地址:14386?encryption=none&..."
  }
]
```

| 字段 | 说明 |
|------|------|
| `server_name` | 服务器名称 |
| `node_name` | 节点名称（包含策略标识） |
| `protocol` | 协议类型（vless/vmess/trojan） |
| `strategy` | 处理策略（cf/direct） |
| `link` | 最终的节点链接（经过策略处理） |
| `original_link` | 原始的节点链接（从 3X-UI 获取） |

---

## 3. 后端 API 设计

### 3.1 服务器管理 API 修改

**文件**：`server/routes/admin/servers.js`

#### 3.1.1 添加服务器（POST /api/admin/servers）

新增参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sub_url` | string | 否 | 订阅链接地址 |

#### 3.1.2 编辑服务器（PUT /api/admin/servers/:id）

新增参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sub_url` | string | 否 | 订阅链接地址 |

#### 3.1.3 服务器列表（GET /api/admin/servers）

返回字段新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `sub_url` | string | 订阅链接地址 |

### 3.2 用户同步逻辑修改

**文件**：`server/services/order-service.js`

修改 `syncUserToXuiServers` 函数：

**原逻辑**：
- 所有节点使用同一个 `subscription_token` 作为 UUID
- `subId` 为空字符串

**新逻辑**：
- 为每个节点生成独立的 `uuid`（`crypto.randomUUID()`）
- 为每个节点生成独立的 `sub_id`（`crypto.randomBytes(8).toString('hex')`，16 位十六进制）
- 存储到 `user_node_configs` 表（使用 `server_id` + `inbound_id` 关联）
- 如果已存在配置则跳过（续费场景）
- **direct 节点**：同步到 3X-UI 时自动设置 `flow: 'xtls-rprx-vision'`

### 3.3 订阅生成逻辑修改

**文件**：`server/routes/user/subscription.js`

#### 3.3.1 生成订阅链接（POST /api/user/subscription/generate）

**流程**：
1. 同步所有服务器节点信息（调用 `syncAllServers`）
2. 遍历每个服务器
   - 获取服务器的 `sub_url`
   - 获取用户在该服务器的节点配置（从 `user_node_configs` 表，使用 `server_id` + `inbound_id` 关联）
   - 为每个节点独立从 3X-UI 获取原始订阅（使用各自的 sub_id）
3. 遍历每个节点
   - 解析节点备注，判断策略（cf 或 direct）
   - 根据策略处理节点信息：
     - **direct 策略**：直接使用原始节点信息
     - **cf 策略**：为每个 CF 优选 IP 生成独立节点，替换 address/port/host
   - 生成节点链接
4. 聚合所有节点信息
5. 存储到 `user_subscriptions` 表
6. 返回订阅链接

**返回数据**：
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

#### 3.3.2 策略判断逻辑

```javascript
function getStrategyFromRemark(remark) {
  const lowerRemark = remark.toLowerCase();
  if (lowerRemark.includes('cf')) {
    return 'cf';
  }
  return 'direct';  // 默认 direct 策略
}
```

#### 3.3.3 cf 策略处理逻辑

**原始节点信息**（从 3X-UI 订阅链接获取）：
- `address`: 原始地址
- `port`: 原始端口
- `host`: 从 stream_settings 获取

**cf 策略替换**（无条件替换）：
- `address` → 用户的 CF 优选 IP（每个 IP 生成独立节点）
- `port` → 服务器卡片的 `client_port`
- `host` → 服务器卡片的 `host` 字段（无条件设置，无论原始链接是否有 host 参数）
- 其他参数保持不变

**示例**：

原始链接：
```
vless://uuid@原始地址:14386?encryption=none&flow=xtls-rprx-vision&security=reality&sni=xxx&fp=chrome&pbk=xxx&sid=cf&spx=%2F&type=tcp&headerType=none#remark
```

cf 策略处理后：
```
vless://uuid@CF优选IP:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=xxx&fp=chrome&pbk=xxx&sid=cf&spx=%2F&type=tcp&headerType=none#remark
```

#### 3.3.4 访问订阅内容（GET /api/user/sub/:token）

**流程**：
1. 通过 `sub_id` 查找用户
2. 从 `user_subscriptions` 表获取缓存的节点信息
3. 直接返回订阅内容（快速响应）

---

## 4. 前端设计

### 4.1 服务器管理页面（Servers.vue）

#### 4.1.1 添加/编辑对话框新增字段

```vue
<el-form-item label="订阅链接地址">
  <el-input 
    v-model="form.sub_url" 
    placeholder="如：https://example.com/sub/aaa333/"
  />
</el-form-item>
```

#### 4.1.2 服务器卡片显示

```vue
<div class="info-item">
  <span class="label">订阅地址：</span>
  <span class="value">{{ server.sub_url || '未设置' }}</span>
</div>
```

### 4.2 服务器详情页面（ServerDetail.vue）

#### 4.2.1 节点列表显示策略

```vue
<div class="node-card" v-for="node in nodes" :key="node.id">
  <div class="node-header">
    <span class="node-name">{{ node.remark }}</span>
    <el-tag :type="getStrategyTagType(node.remark)">
      {{ getStrategyFromRemark(node.remark) }}
    </el-tag>
  </div>
  <!-- 其他节点信息 -->
</div>
```

#### 4.2.2 策略标签显示逻辑

```javascript
function getStrategyFromRemark(remark) {
  const lowerRemark = remark.toLowerCase();
  if (lowerRemark.includes('cf')) {
    return 'CF策略';
  }
  return 'Direct策略';
}

function getStrategyTagType(remark) {
  const lowerRemark = remark.toLowerCase();
  if (lowerRemark.includes('cf')) {
    return 'warning';  // 橙色
  }
  return 'success';  // 绿色
}
```

---

## 5. 策略工作流程

### 5.1 完整流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    用户支付成功                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  syncUserToXuiServers()                                     │
│  ├─ 遍历所有在线服务器                                       │
│  └─ 遍历每个服务器的所有节点                                 │
│      ├─ 生成独立的 uuid（crypto.randomUUID()）              │
│      ├─ 生成独立的 sub_id（crypto.randomBytes(8).toString('hex')）│
│      ├─ 调用 addClient() 添加用户到 3X-UI                   │
│      └─ 存储到 user_node_configs 表                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    用户点击"生成订阅链接"                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  POST /api/user/subscription/generate                       │
│  ├─ 1. 同步所有服务器节点信息（syncAllServers）              │
│  ├─ 2. 遍历每个服务器                                        │
│  │   ├─ 获取服务器的 sub_url                                 │
│  │   ├─ 获取用户在该服务器的 sub_id（从 user_node_configs）  │
│  │   ├─ 拼接订阅链接：sub_url + sub_id                      │
│  │   └─ 调用 3X-UI 订阅接口获取原始节点信息                  │
│  ├─ 3. 遍历每个节点                                          │
│  │   ├─ 解析节点备注，判断策略（cf 或 direct）               │
│  │   ├─ 根据策略处理节点信息：                               │
│  │   │   ├─ direct：直接使用原始节点信息                     │
│  │   │   └─ cf：替换 address/port/host                      │
│  │   └─ 生成节点链接                                         │
│  ├─ 4. 聚合所有节点信息                                      │
│  ├─ 5. 存储到 user_subscriptions 表                         │
│  └─ 6. 返回订阅链接                                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    用户访问订阅链接                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  GET /api/user/sub/:token                                   │
│  ├─ 1. 通过 sub_id 查找用户                                  │
│  ├─ 2. 从 user_subscriptions 表获取缓存的节点信息           │
│  └─ 3. 直接返回订阅内容（快速响应）                          │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 关键节点说明

| 阶段 | 说明 | 耗时 |
|------|------|------|
| 支付成功 | 异步同步用户到 3X-UI，创建独立 uuid/sub_id | 不阻塞 |
| 生成订阅链接 | 同步节点信息、调用 3X-UI 订阅接口、处理策略 | 5-10 秒（可接受） |
| 访问订阅链接 | 直接返回缓存数据 | 快速响应 |

### 5.3 数据流转

```
users 表
  ├─ subscription_token (UUID) - 不再使用
  ├─ sub_id - 用于统一订阅链接（16 位十六进制）
  └─ ...

user_node_configs 表
  ├─ user_id
  ├─ server_id（不依赖 xui_nodes 外键）
  ├─ inbound_id
  ├─ uuid (该节点的独立 UUID)
  ├─ sub_id (该节点的独立订阅 token，16 位十六进制)
  └─ ...

user_subscriptions 表
  ├─ user_id
  ├─ sub_id (统一订阅链接的 token)
  ├─ nodes_data (聚合后的节点信息 JSON)
  └─ ...
```

---

## 6. 节点链接格式说明

### 6.1 VLESS 链接格式

**Reality 模式**：
```
vless://uuid@address:port?encryption=none&flow=xtls-rprx-vision&security=reality&sni=xxx&fp=chrome&pbk=xxx&sid=cf&spx=%2F&type=tcp&headerType=none#remark
```

**WebSocket + TLS 模式**：
```
vless://uuid@address:port?encryption=none&security=none&type=ws&host=xxx&path=xxx#remark
```

### 6.2 VMess 链接格式

```
vmess://base64(json)
```

### 6.3 Trojan 链接格式

```
trojan://uuid@address:port?security=tls&type=ws&host=xxx&path=xxx#remark
```

---

## 7. 实现方案

采用**方案 A：渐进式改造**，在现有代码基础上最小化改动，保持向后兼容。

### 7.1 改动范围

| 文件 | 改动内容 |
|------|----------|
| `server/db/init.js` | 新增表结构、新增字段 |
| `server/routes/admin/servers.js` | 新增 `sub_url` 参数、返回字段 |
| `server/services/order-service.js` | 修改 `syncUserToXuiServers` 函数 |
| `server/routes/user/subscription.js` | 修改订阅生成和访问逻辑 |
| `client-admin/src/views/Servers.vue` | 新增订阅地址输入框和显示 |
| `client-admin/src/views/ServerDetail.vue` | 显示节点策略标签 |

### 7.2 向后兼容

- 现有用户的 `subscription_token` 保持不变
- 现有订阅链接继续有效
- 新功能需要用户重新生成订阅链接才能生效

---

## 8. 待确认事项

无

---

## 9. 变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-05-10 | V1.0 | 初始设计文档 |
| 2026-05-11 | V1.1 | 更新实现细节：user_node_configs 改用 server_id+inbound_id；direct 节点添加 flow 参数；CF 策略无条件替换 host；每个节点独立获取订阅；添加定时任务同步机制 |

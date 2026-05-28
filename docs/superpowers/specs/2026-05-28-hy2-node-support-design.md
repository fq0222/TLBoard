# HY2 节点支持设计文档

> 版本：V1.0
> 更新日期：2026-05-28
> 状态：设计已确认，待实现

---

## 1. 需求概述

### 1.1 目标

在现有仅支持 `vless+ws` 和 `vless+tcp+reality` 的节点同步与订阅体系中，新增对 `hysteria2 + UDP + TLS` 协议的支持，并约定：

1. inbound 的 `remark` 包含 `hy2` 时，识别为新的策略类型 `hy2`
2. `hy2` 节点在订阅处理阶段与 `direct` 一致，不做 CF 改写
3. `hy2` 节点同步到 3X-UI 时，使用独立的密码字段，不复用现有 `uuid` 字段
4. 为后续继续扩展更多协议，节点本地凭据存储要显式区分字段职责

### 1.2 现状

当前系统中：

1. `server/services/subscription-strategy.js` 只识别 `cf` 和 `direct`
2. `server/services/xui-service.js` 默认按 `id/email/subId/expiryTime/totalGB` 一套结构写入 3X-UI 客户端
3. `server/services/order-service.js` 使用 `user_node_configs.uuid + sub_id` 作为所有协议的本地节点凭据
4. 订阅缓存和订阅聚合链路依赖“先同步到 3X-UI，再从 3X-UI 原始订阅取回链接模板”

### 1.3 新增协议样例

样例节点：

```text
hysteria2://zcVWhGaxg6@us00.bidding.dpdns.org:32458?security=tls&fp=chrome&alpn=h3&sni=us00.bidding.dpdns.org#hy2-1y8h7myl
```

从样例和 3X-UI 面板截图推断，`hy2` 客户端的关键可编辑字段至少包括：

1. `email`
2. `password`
3. `subId`
4. `enable`
5. `expiryTime`
6. `totalGB`
7. `limitIp`
8. `tgId`

不应继续沿用 `flow`，也不应把 `password` 和 `uuid` 混成同一个语义字段。

---

## 2. 设计原则

### 2.1 最小破坏

尽量不改动现有 `cf/direct` 节点行为，避免影响已稳定的 vless/reality 订阅和同步流程。

### 2.2 字段语义清晰

`uuid` 继续表示“基于 UUID 的协议凭据”；`password` 单独表示“基于密码的协议凭据”。即使当前只有 `hy2` 使用该字段，也先把数据模型区分开，方便后续继续扩协议。

### 2.3 以 3X-UI 实际返回为准

由于 `hy2` 的 3X-UI 写入格式存在不确定性，实现和联调时必须优先观察：

1. 3X-UI API 返回体
2. 本项目服务端日志
3. 如可获取，则同步关注 3X-UI 服务器端日志

如果字段命名或类型与推断不一致，以真实日志和返回错误为准微调实现。

---

## 3. 数据库设计

### 3.1 修改 `user_node_configs`

在现有 `user_node_configs` 表中新增 `password` 字段：

```sql
ALTER TABLE user_node_configs ADD COLUMN password VARCHAR(100) DEFAULT '';
```

### 3.2 字段职责

| 字段 | 说明 |
|------|------|
| `uuid` | vless / vmess / trojan 等基于 UUID 的协议凭据 |
| `password` | hysteria2 等基于密码的协议凭据 |
| `sub_id` | 单节点订阅标识 |

### 3.3 迁移要求

迁移脚本必须幂等：

1. 如果 `password` 已存在则跳过
2. 不修改现有 `uuid/sub_id` 数据
3. 不影响历史节点配置读取

---

## 4. 后端架构调整

### 4.1 策略识别层

文件：

- `server/services/subscription-strategy.js`

将策略识别从当前的 `cf/direct` 扩展为：

1. `remark` 包含 `cf` -> `cf`
2. `remark` 包含 `hy2` -> `hy2`
3. 其他 -> `direct`

其中：

1. `cf`：继续按现有规则改写地址、端口、host
2. `direct`：原样输出
3. `hy2`：在订阅阶段与 `direct` 一致，原样输出

### 4.2 节点凭据生成层

文件：

- `server/services/order-service.js`

新增“按策略生成节点凭据”的分支：

1. `cf/direct` 节点生成并保存 `uuid + subId`
2. `hy2` 节点生成并保存 `password + subId`

推荐保持如下规则：

1. `uuid` 继续使用 `crypto.randomUUID()`
2. `password` 先使用高熵随机字符串生成，可沿用随机字节转十六进制或 Base62 方案
3. `subId` 继续使用 `crypto.randomBytes(8).toString('hex')`

### 4.3 3X-UI 客户端 Payload 适配层

文件：

- `server/services/xui-service.js`

新增一个按 inbound 类型或策略构建客户端对象的适配入口，统一由：

1. `addClient`
2. `updateClient`
3. `upsertUniqueClient`

调用。

#### 4.3.1 现有 `cf/direct` 节点

继续写入：

```json
{
  "id": "<uuid>",
  "email": "<email>",
  "enable": true,
  "expiryTime": 0,
  "totalGB": 0,
  "limitIp": 0,
  "tgId": 0,
  "subId": "<subId>"
}
```

如果是 `direct` 节点，继续附带：

```json
{
  "flow": "xtls-rprx-vision"
}
```

#### 4.3.2 `hy2` 节点

先按以下结构尝试写入：

```json
{
  "email": "<email>",
  "password": "<password>",
  "enable": true,
  "expiryTime": 0,
  "totalGB": 0,
  "limitIp": 0,
  "tgId": 0,
  "subId": "<subId>"
}
```

明确不写：

1. `id`
2. `flow`

### 4.4 同步逻辑

文件：

- `server/services/order-service.js`

`syncUserToXuiServers()` 构建 `desiredClient` 时，要附带足够上下文让 `xui-service` 判断：

1. 当前 inbound 协议
2. 当前 inbound remark
3. 当前策略类型
4. 应使用 `uuid` 还是 `password`

本地 `user_node_configs` 保存时也要同步处理：

1. `cf/direct` 写 `uuid`
2. `hy2` 写 `password`
3. `sub_id` 两者都写

### 4.5 订阅抓取与聚合

文件：

- `server/routes/user/subscription.js`
- `server/services/subscription-service.js`

现有链路继续保留：

1. 用户同步到 3X-UI
2. 通过每个节点自己的 `sub_id` 拉取 3X-UI 原始订阅
3. 从原始订阅中提取单节点链接
4. 根据策略生成最终订阅

对 `hy2` 的处理要求：

1. 能正确从 3X-UI 原始订阅中识别 `hysteria2://` 链接
2. 在本地缓存原始链接时保留完整查询参数
3. 最终订阅输出时仅替换节点名，不篡改 `hy2` 的 TLS/ALPN/SNI 等参数

---

## 5. 订阅与配置输出

### 5.1 通用订阅

`/api/user/sub/:token` 默认和 `?v2ray=1` 输出中，`hy2` 节点继续按原始 URI 输出：

```text
hysteria2://password@host:port?security=tls&fp=chrome&alpn=h3&sni=example.com#节点名
```

### 5.2 Clash 订阅

文件：

- `server/services/subscription-strategy.js`
- `server/routes/user/subscription.js`

需要新增：

1. `parseNodeLink()` 对 `hysteria2://` 的支持
2. `buildNodeLink()` 对 `hysteria2://` 的支持
3. `generateClashConfig()` 对 `hy2` 节点的输出支持

预期 Clash 片段结构类似：

```yaml
  - name: 节点名
    type: hysteria2
    server: us00.bidding.dpdns.org
    port: 32458
    password: zcVWhGaxg6
    sni: us00.bidding.dpdns.org
    alpn:
      - h3
    udp: true
```

如解析到 `fp`、`insecure` 等附加参数，则一并映射；若 Clash 当前格式要求与预期不同，以实际测试通过的配置为准。

---

## 6. 错误处理与日志策略

### 6.1 必加日志点

在以下位置增加或细化日志：

1. `hy2` 客户端新增前的 payload 摘要日志
2. `hy2` 客户端更新前的 payload 摘要日志
3. 3X-UI API 返回失败时的完整错误消息
4. 原始订阅抓取成功后识别到的协议类型
5. `hysteria2://` 解析失败时的原始链接和异常原因

### 6.2 联调规则

实现完成后，若 `hy2` 同步失败，排查顺序固定为：

1. 查看本项目服务端日志中发给 3X-UI 的关键字段
2. 查看 3X-UI API 返回体中的错误信息
3. 查看 3X-UI 服务器日志，确认是否为字段名、字段类型或协议限制问题
4. 根据返回结果调整 `hy2` 客户端字段映射

这条规则是本次功能的重要组成部分，不是附加建议。

---

## 7. 测试设计

### 7.1 单元/脚本测试

文件：

- `server/test/test-subscription-strategy.js`
- 新增 `server/test/test-hy2-client-payload.js` 或在现有 xui 相关测试中补充

至少覆盖：

1. `remark=hy2-xxx` 时策略识别为 `hy2`
2. `hysteria2://` 链接可被正确解析
3. `hysteria2://` 解析后重建结果与原始链接一致
4. `hy2` 在订阅策略处理时与 `direct` 等效
5. `hy2` client payload 包含 `password/email/subId/expiryTime/totalGB`
6. `hy2` client payload 不包含 `id/flow`

### 7.2 回归测试

必须确认以下旧能力不回退：

1. `cf` 节点仍会改写地址、端口、host
2. `direct` 节点仍会写入 `flow: xtls-rprx-vision`
3. `vless reality` 原有 Clash 输出保持可用
4. 普通订阅缓存和节点聚合流程不受影响

### 7.3 联调验证

联调时重点验证：

1. 3X-UI 是否接受 `hy2` 的 `password` 字段
2. 保存后的客户端在 3X-UI 面板中是否能看到过期时间、总流量和订阅信息
3. 通过对应 `sub_id` 抓取到的原始订阅里，是否返回正确的 `hysteria2://` 链接
4. 生成的 Clash 订阅能否被目标客户端正确导入

---

## 8. 实现范围

### 8.1 预计修改文件

| 文件 | 变更内容 |
|------|----------|
| `server/db/migrations/*` | 新增 `user_node_configs.password` 迁移 |
| `server/services/subscription-strategy.js` | 新增 `hy2` 策略和 `hysteria2://` 解析/重建 |
| `server/services/order-service.js` | 新增 `hy2` 凭据生成与同步上下文 |
| `server/services/xui-service.js` | 新增按协议构建 client payload 的适配 |
| `server/routes/user/subscription.js` | 新增 `hy2` Clash 输出支持 |
| `server/test/test-subscription-strategy.js` | 补 `hy2` 相关测试 |
| `server/test/*` | 补 `hy2` payload 测试 |

### 8.2 明确不在本次范围内

本次不做：

1. 管理端界面新增 `hy2` 专门展示字段
2. 为更多新协议预建完整通用凭据模型
3. 更新项目文档站点或对外 API 文档

---

## 9. 风险与应对

| 风险 | 说明 | 应对方式 |
|------|------|----------|
| 3X-UI `hy2` 字段要求与推断不一致 | 可能仍要求 `id` 或其他隐藏字段 | 以 3X-UI API 返回和服务器日志为准快速调整 |
| Clash 的 `hysteria2` 字段格式存在客户端差异 | 不同核心版本字段名可能不同 | 先按主流格式实现，再用真实客户端验证 |
| 本地凭据字段扩展影响旧逻辑 | `uuid/password` 混用可能引发更新判断错误 | 明确分支处理，并补回归测试 |

---

## 10. 待确认事项

当前已确认：

1. `hy2` 要像 `direct` 一样参与订阅输出
2. `hy2` 使用独立 `password` 字段，不复用 `uuid`
3. `hy2` 客户端要带 `email/password/subId/enable/expiryTime/totalGB/limitIp/tgId`
4. 联调时必须重点关注 3X-UI 返回日志和服务器日志

仍保留的实现期观察项：

1. 3X-UI 是否接受当前推断的 `hy2` payload
2. Clash 对 `hysteria2` 的最终字段兼容情况

---

## 11. 变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-05-28 | V1.0 | 初始设计，定义 `hy2` 策略、独立密码字段和 3X-UI 联调日志要求 |

# 3X-UI 3.2.5 API 中文整理与项目适配说明

## 文档说明

- 参考来源：
  - 3X-UI 官方 Postman 文档（对应 3.2.5 面板）
  - 3X-UI 官方 Wiki 的 API 概览
  - 3X-UI 官方源码中的 API 路由注册代码
  - 3X-UI 官方仓库 issue 中公开展示的接口返回示例
- 本文目标：
  - 把 3.2.5 的主要 API 以中文形式沉淀到仓库
  - 给出请求体示例、返回体示例
  - 解释当前项目已经使用到的接口
  - 标出我建议优先考虑的替代接口
- 重要说明：
  - 本项目当前默认接入版本仍然是 `3.0.2`
  - 本次只完成“版本适配层骨架 + 3.2.5 文档整理”
  - 面板版本识别逻辑、3.2.5 差异实现后续再补
  - 文中示例分为两类：
    - `官方可见示例`：能从官方文档、官方 Wiki、官方仓库 issue 中直接核对到的示例
    - `等价整理示例`：我根据 3.2.5 路由、官方字段命名和当前项目已验证用法整理出的示例，字段名与结构可直接用于后续适配设计，但不等同于 Postman 页面逐字抄录

## 1. 认证与基础规则

### 1.1 基础路径

- API 根路径：`/panel/api`
- Inbounds 路径前缀：`/panel/api/inbounds`
- Server 路径前缀：`/panel/api/server`

### 1.2 鉴权方式

- `3.2.5` 支持 `Authorization: Bearer <token>` 的 API Token 鉴权。
- 官方源码显示，服务端会先尝试读取 Bearer Token；如果 Token 匹配，则把本次请求视为 API 已认证请求。
- 如果没有有效 Token，则会回退到面板登录态校验。

### 1.3 当前项目已经依赖的请求习惯

- Header 使用：`Authorization: Bearer <token>`
- Header 使用：`X-Requested-With: XMLHttpRequest`
- 请求体默认：`Content-Type: application/json`

### 1.4 通用响应结构

大部分 JSON 接口都遵循下面这个结构：

```json
{
  "success": true,
  "msg": "",
  "obj": {}
}
```

说明：

- `success`：是否成功
- `msg`：错误信息或提示信息
- `obj`：真正的业务数据

但也有例外：

- `getDb` 这类下载接口返回的是二进制文件，不是 JSON
- 某些历史版本或异常分支可能返回空字符串，这一点在官方 issue 中能看到

## 2. Inbounds API 总表

### 2.1 查询类接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/panel/api/inbounds/list` | 获取全部入站 |
| `GET` | `/panel/api/inbounds/get/:id` | 按入站 ID 获取详情 |
| `GET` | `/panel/api/inbounds/getClientTraffics/:email` | 按邮箱获取客户端流量 |
| `GET` | `/panel/api/inbounds/getClientTrafficsById/:id` | 按入站 ID 获取客户端流量数据 |

### 2.2 入站管理接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/panel/api/inbounds/add` | 新增入站 |
| `POST` | `/panel/api/inbounds/del/:id` | 删除入站 |
| `POST` | `/panel/api/inbounds/update/:id` | 更新入站 |
| `POST` | `/panel/api/inbounds/import` | 导入入站配置 |

### 2.3 客户端管理接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/panel/api/inbounds/addClient` | 向指定入站新增客户端 |
| `POST` | `/panel/api/inbounds/:id/delClient/:clientId` | 按 `clientId` 删除客户端 |
| `POST` | `/panel/api/inbounds/:id/delClientByEmail/:email` | 按邮箱删除客户端 |
| `POST` | `/panel/api/inbounds/updateClient/:clientId` | 按 `clientId` 更新客户端 |
| `POST` | `/panel/api/inbounds/:id/resetClientTraffic/:email` | 重置单个客户端流量 |
| `POST` | `/panel/api/inbounds/updateClientTraffic/:email` | 更新指定客户端流量 |

### 2.4 状态与批量操作接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/panel/api/inbounds/clientIps/:email` | 获取客户端 IP 列表 |
| `POST` | `/panel/api/inbounds/clearClientIps/:email` | 清空客户端 IP 记录 |
| `POST` | `/panel/api/inbounds/onlines` | 获取当前在线客户端邮箱列表 |
| `POST` | `/panel/api/inbounds/lastOnline` | 获取客户端最近在线状态 |
| `POST` | `/panel/api/inbounds/resetAllTraffics` | 重置所有入站流量 |
| `POST` | `/panel/api/inbounds/resetAllClientTraffics/:id` | 重置某个入站全部客户端流量 |
| `POST` | `/panel/api/inbounds/delDepletedClients/:id` | 删除流量耗尽客户端，`-1` 表示全部入站 |

### 2.5 `clientId` 映射规则

官方 Wiki 对 `clientId` 的映射说明如下：

| 协议/场景 | `clientId` 对应字段 |
| --- | --- |
| VMESS / VLESS | `client.id` |
| TROJAN | `client.password` |
| Shadowsocks | `client.email` |

这条规则对当前项目非常重要，因为“更新客户端 / 删除客户端”是否能命中目标，取决于这里传的是否是对应协议的正确标识。

## 3. Server API 总表

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/panel/api/server/status` | 获取服务器状态 |
| `GET` | `/panel/api/server/getXrayVersion` | 获取可用 Xray 版本 |
| `GET` | `/panel/api/server/getConfigJson` | 下载当前 `config.json` |
| `GET` | `/panel/api/server/getDb` | 下载面板数据库文件 |
| `GET` | `/panel/api/server/getNewUUID` | 生成新的 UUID |
| `GET` | `/panel/api/server/getNewX25519Cert` | 生成新的 X25519 证书 |
| `GET` | `/panel/api/server/getNewmldsa65` | 生成新的 ML-DSA-65 证书 |
| `GET` | `/panel/api/server/getNewmlkem768` | 生成新的 ML-KEM-768 密钥对 |
| `GET` | `/panel/api/server/getNewVlessEnc` | 生成新的 VLESS 加密密钥 |
| `POST` | `/panel/api/server/stopXrayService` | 停止 Xray 服务 |
| `POST` | `/panel/api/server/restartXrayService` | 重启 Xray 服务 |
| `POST` | `/panel/api/server/installXray/:version` | 安装或升级指定版本 Xray |
| `POST` | `/panel/api/server/updateGeofile` | 更新 Geo 文件 |
| `POST` | `/panel/api/server/updateGeofile/:fileName` | 更新指定 Geo 文件 |
| `POST` | `/panel/api/server/logs/:count` | 获取系统日志 |
| `POST` | `/panel/api/server/xraylogs/:count` | 获取 Xray 日志 |
| `POST` | `/panel/api/server/importDB` | 导入数据库 |
| `POST` | `/panel/api/server/getNewEchCert` | 生成 ECH 证书 |

## 4. Extra API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/panel/api/backuptotgbot` | 备份数据库与配置并发送到 Telegram Bot |

## 5. 官方源码中还能看到的路由组

根据官方源码 `web/controller/api.go` 的路由注册逻辑，3.2.5 除了 `inbounds`、`server` 之外，还存在这些分组：

- `/panel/api/clients`
- `/panel/api/nodes`
- `/panel/api/custom-geo`

说明：

- 这是从官方源码里能确认的分组能力
- 但官方公开概览页没有完整展开这些分组的全部子接口
- 所以本次文档只把它们列为“后续核对范围”，暂不写成已适配接口

## 6. 关键接口示例与解释

这一节是本文最重要的部分。它既包含示例，也包含“当前项目是怎么用的”和“是否有更推荐的替代接口”。

### 6.1 `GET /panel/api/inbounds/list`

用途：

- 获取所有入站
- 当前项目用它做连接测试、拉取节点列表、同步服务器状态

#### 返回体示例

`官方可见示例`：

下面这个结构来自官方仓库公开的 Postman Collection 示例与 issue 中展示的返回体，`obj` 是一个入站数组：

```json
{
  "success": true,
  "msg": "",
  "obj": [
    {
      "id": 1,
      "up": 0,
      "down": 0,
      "total": 0,
      "remark": "New inbound",
      "enable": true,
      "expiryTime": 0,
      "clientStats": [
        {
          "id": 2,
          "inboundId": 1,
          "enable": true,
          "email": "xn1aaiwm",
          "up": 0,
          "down": 0,
          "expiryTime": 0,
          "total": 0
        }
      ],
      "listen": "",
      "port": 48965,
      "protocol": "vmess",
      "settings": "{...}",
      "streamSettings": "{...}",
      "tag": "inbound-48965",
      "sniffing": "{...}"
    }
  ]
}
```

#### 我对当前项目的解释

- 当前项目的 `syncServerStatus()` 主要依赖它来拿：
  - `id`
  - `remark`
  - `port`
  - `protocol`
  - `settings`
  - `streamSettings`
  - `clientStats`
- 但是 `clientStats` 在官方 issue 中已经有人明确提到“并不总是稳定填充”，有时可能是 `null`
- 所以它适合做“节点总览”和“粗粒度状态”，不适合做“每个用户精确流量”的唯一来源

#### 推荐的替代接口

- 如果你要拿“单个用户的精确流量”，优先改用：
  - `GET /panel/api/inbounds/getClientTraffics/:email`
- 如果你要拿“用户配置元数据”，继续从：
  - `settings.clients`
  中解析

结论：

- `list` 继续保留
- 但不要把 `clientStats` 当成强一致数据源

### 6.2 `GET /panel/api/inbounds/get/:id`

用途：

- 获取单个入站详情
- 当前项目用它解析 `settings.clients`，查某个入站下有哪些客户端，以及客户端的 UUID / subId / flow / auth 等信息

#### 返回体示例

`官方可见示例`：

官方 issue 中公开展示过这类响应，结构如下：

```json
{
  "success": true,
  "msg": "",
  "obj": {
    "id": 1,
    "up": 20930403009,
    "down": 282122465782,
    "total": 0,
    "remark": "saeed",
    "enable": true,
    "expiryTime": 0,
    "clientStats": null,
    "listen": "",
    "port": 12827,
    "protocol": "vless",
    "settings": "{\n  \"clients\": [\n    {\n      \"email\": \"ialc5fk1\",\n      \"enable\": true,\n      \"expiryTime\": 0,\n      \"flow\": \"\",\n      \"id\": \"0c0d65a1-3353-42a6-8534-8ae0fb8d42b9\",\n      \"limitIp\": 0,\n      \"reset\": 0,\n      \"subId\": \"xpwqdshdkuhdb64b\",\n      \"tgId\": \"\",\n      \"totalGB\": 0\n    }\n  ],\n  \"decryption\": \"none\",\n  \"fallbacks\": []\n}",
    "streamSettings": "{\n  \"network\": \"tcp\",\n  \"security\": \"none\"\n}",
    "tag": "inbound-12827",
    "sniffing": "{...}",
    "allocate": "{...}"
  }
}
```

#### 我对当前项目的解释

- 当前项目依赖这个接口做：
  - `getInboundDetail()`
  - `getClientsByEmail()`
  - `getClientByEmail()`
- 实际上，当前项目真正关心的不是 `obj` 顶层的统计，而是 `obj.settings` 里面的 `clients`
- 因为用户的：
  - `id`
  - `email`
  - `enable`
  - `expiryTime`
  - `totalGB`
  - `subId`
  - `flow`
  - `auth`
  基本都在这里

#### 推荐的替代接口

- 如果只是为了找“某个邮箱对应的客户端配置”，目前没有更明确的单用户配置查询接口比它更稳定
- 所以：
  - 配置元数据：继续用 `get/:id + settings.clients`
  - 流量数据：配合 `getClientTraffics/:email`

### 6.3 `POST /panel/api/inbounds/addClient`

用途：

- 向指定入站新增客户端
- 当前项目的新增订阅用户、节点同步、补齐唯一客户端记录，都会用到它

#### 请求体示例

`官方可见示例`：

官方公开 issue 中可以核对到两种写法。历史上有人直接把 `settings` 传成 JSON 字符串：

```json
{
  "id": 1,
  "settings": "{\"clients\":[{\"id\":\"95e4e7bb-7796-47e7-e8a7-f4055194f776\",\"alterId\":0,\"email\":\"New Client\",\"limitIp\":2,\"totalGB\":42949672960,\"expiryTime\":1682864675944,\"enable\":true,\"tgId\":\"\",\"subId\":\"\"}]}"
}
```

也有人在请求里传对象形态的 `settings`：

```json
{
  "id": 38,
  "settings": {
    "clients": [
      {
        "id": "717c9fff-f49a-4613-86ea-7d1263a3a0af",
        "flow": "xtls-rprx-vision",
        "email": "cgmzcloo",
        "limitIp": 0,
        "totalGB": 0,
        "expiryTime": 0,
        "enable": true,
        "tgId": "",
        "subId": "jn25gjs56gvw1b7d"
      }
    ]
  }
}
```

#### 等价整理示例

这是更贴近当前项目代码的 VLESS / VMESS 写法：

```json
{
  "id": 38,
  "settings": "{\"clients\":[{\"id\":\"717c9fff-f49a-4613-86ea-7d1263a3a0af\",\"email\":\"demo@example.com\",\"enable\":true,\"expiryTime\":0,\"totalGB\":10737418240,\"limitIp\":0,\"tgId\":0,\"subId\":\"jn25gjs56gvw1b7d\",\"flow\":\"xtls-rprx-vision\"}]}"
}
```

这是当前项目已经兼容的 `hy2 / hysteria2` 风格示例：

```json
{
  "id": 52,
  "settings": "{\"clients\":[{\"auth\":\"hy2-secret-token\",\"email\":\"demo@example.com\",\"enable\":true,\"expiryTime\":0,\"totalGB\":10737418240,\"limitIp\":0,\"tgId\":0,\"subId\":\"ab12cd34ef56gh78\"}]}"
}
```

#### 返回体示例

`等价整理示例`：

```json
{
  "success": true,
  "msg": "Client added successfully",
  "obj": null
}
```

失败时常见结构：

```json
{
  "success": false,
  "msg": "Something went wrong!Fail: unexpected end of JSON input",
  "obj": null
}
```

#### 我对当前项目的解释

- 当前项目在新增客户端时，会把 `settings` 明确序列化成 JSON 字符串
- 这点是稳妥的，因为现有项目就是这样跑通的
- 当前项目还会根据协议和策略拆分两条分支：
  - 普通协议使用 `id`
  - `hy2 / hysteria2` 使用 `auth`

#### 推荐的替代接口

- 没有更合适的“新增客户端”替代接口
- 但我建议保留“构建 payload 的独立方法”，不要在业务代码里手拼 JSON
- 如果后续 3.2.5 对对象形式的 `settings` 支持更稳定，可以再考虑是否从字符串改为对象

### 6.4 `POST /panel/api/inbounds/updateClient/:clientId`

用途：

- 更新指定客户端
- 当前项目在续费、流量调整、禁用/启用同步时会用到它

#### 请求体示例

`等价整理示例`：

```json
{
  "id": 38,
  "settings": "{\"clients\":[{\"id\":\"717c9fff-f49a-4613-86ea-7d1263a3a0af\",\"email\":\"demo@example.com\",\"enable\":false,\"expiryTime\":1750000000000,\"totalGB\":21474836480,\"limitIp\":0,\"tgId\":0,\"subId\":\"jn25gjs56gvw1b7d\",\"flow\":\"xtls-rprx-vision\"}]}"
}
```

对于 `hy2 / hysteria2`，核心差异是客户端凭证字段要换成 `auth`：

```json
{
  "id": 52,
  "settings": "{\"clients\":[{\"auth\":\"hy2-secret-token\",\"email\":\"demo@example.com\",\"enable\":true,\"expiryTime\":1750000000000,\"totalGB\":21474836480,\"limitIp\":0,\"tgId\":0,\"subId\":\"ab12cd34ef56gh78\"}]}"
}
```

#### 返回体示例

`等价整理示例`：

```json
{
  "success": true,
  "msg": "Client updated successfully",
  "obj": null
}
```

#### 我对当前项目的解释

- 这是当前项目最敏感的接口之一
- 因为你传给 `:clientId` 的值必须跟协议匹配：
  - VMESS / VLESS：传 UUID
  - TROJAN：传 password
  - SS：传 email
- 当前项目已经在 `updateClientByContext()` 中做了这层语义转换，这个设计是对的

#### 推荐的替代接口

- 没有直接替代接口
- 但如果后续要减少“先查再改”的请求次数，可以考虑：
  - 本地缓存 `uuid/auth/subId`
  - 只在命中失败时回查 `get/:id`

### 6.5 `GET /panel/api/inbounds/getClientTraffics/:email`

用途：

- 查询单个客户端的流量
- 当前项目拿它做用户流量显示和节点详情补充

#### 返回体示例

`官方可见示例`：

```json
{
  "success": true,
  "msg": "",
  "obj": {
    "id": 3,
    "inboundId": 1,
    "enable": true,
    "email": "mehdikhody",
    "up": 0,
    "down": 0,
    "expiryTime": 1682864675944,
    "total": 42949672960
  }
}
```

失败时，历史示例里也出现过空响应：

```text
HTTP 500
body: ""
```

#### 我对当前项目的解释

- 这是当前项目里比 `clientStats` 更可靠的流量来源
- 如果 `list` 或 `get/:id` 里的 `clientStats` 是 `null`，当前项目就应该继续以这个接口为准
- 它的优点是“针对单用户稳定”
- 它的缺点是“高并发逐个查会多很多请求”

#### 推荐的替代接口

- 对“单个用户流量”来说，我推荐继续把它作为主数据源
- 对“全量批量汇总”来说，没有明显更好的官方替代接口，所以仍需要你们自己在服务层做聚合和缓存

### 6.6 `POST /panel/api/inbounds/onlines`

用途：

- 获取当前在线用户邮箱列表
- 当前项目用它来统计在线人数，并和 `clientStats` / `settings.clients` 结合

#### 返回体示例

`等价整理示例`：

```json
{
  "success": true,
  "msg": "",
  "obj": [
    "user1@example.com",
    "user2@example.com"
  ]
}
```

#### 我对当前项目的解释

- 这个接口只返回“邮箱列表”
- 它不告诉你“在哪个 inbound 在线”
- 所以当前项目现在的做法是合理的：
  - 先拿在线邮箱列表
  - 再和每个 inbound 的客户端集合做对比

#### 推荐的替代接口

- 如果你只关心“是否在线”，它已经足够
- 如果你关心“用户在线在哪个节点上”，仍然需要配合 `get/:id` 或 `list`

### 6.7 `POST /panel/api/inbounds/lastOnline`

用途：

- 查询最近在线状态
- 当前项目目前暴露了客户端方法，但业务层还没有重度依赖

#### 返回体示例

`等价整理示例`：

```json
{
  "success": true,
  "msg": "",
  "obj": {
    "demo@example.com": 1717000000000
  }
}
```

#### 我对当前项目的解释

- 如果后续你们要做“最近活跃时间”或“自动关闭工单前的活跃判断”，它会比单纯的 `onlines` 更有信息量
- 但目前项目中还没有把它作为核心业务接口

#### 推荐的替代接口

- 没有明显替代接口
- 可以作为 `onlines` 的补充，而不是替代

### 6.8 `POST /panel/api/inbounds/:id/resetClientTraffic/:email`

用途：

- 重置指定客户端流量
- 当前项目在流量恢复、续费后重置时可能会用到

#### 请求体示例

这个接口主要靠路径参数，通常无需请求体：

```http
POST /panel/api/inbounds/38/resetClientTraffic/demo@example.com
Authorization: Bearer <token>
X-Requested-With: XMLHttpRequest
```

#### 返回体示例

`等价整理示例`：

```json
{
  "success": true,
  "msg": "Traffic reset successfully",
  "obj": null
}
```

#### 推荐的替代接口

- 如果你要重置一个用户，用它
- 如果你要重置整个入站，用 `resetAllClientTraffics/:id`
- 如果你要重置全局全部入站，用 `resetAllTraffics`

### 6.9 `GET /panel/api/server/getDb`

用途：

- 下载 3X-UI 面板数据库
- 当前项目已经在客户端里封装成 `download()`，返回二进制数据

#### 返回体示例

这是二进制下载接口，不是 JSON：

```http
GET /panel/api/server/getDb
Authorization: Bearer <token>
Accept: application/octet-stream
```

返回结果通常是数据库文件内容，例如：

- `Content-Type: application/octet-stream`
- body：SQLite 数据库二进制内容

#### 我对当前项目的解释

- 当前项目已经正确地把它单独走 `responseType: 'arraybuffer'`
- 这点需要继续保留，不能按 JSON 解析

#### 推荐的替代接口

- 没有等价替代接口
- 如果只是要查状态或配置，不要滥用这个接口

## 7. 当前项目已使用接口清单

结合当前项目 `server/integrations/xui/xui-service.js` 与客户端实现，已经明确使用到的接口有：

- `GET /panel/api/inbounds/list`
- `GET /panel/api/inbounds/get/:id`
- `POST /panel/api/inbounds/addClient`
- `POST /panel/api/inbounds/:id/delClient/:clientId`
- `POST /panel/api/inbounds/:id/delClientByEmail/:email`
- `POST /panel/api/inbounds/updateClient/:clientId`
- `GET /panel/api/inbounds/getClientTraffics/:email`
- `POST /panel/api/inbounds/onlines`
- `POST /panel/api/inbounds/lastOnline`
- `POST /panel/api/inbounds/:id/resetClientTraffic/:email`
- `GET /panel/api/server/getDb`

## 8. 我对当前项目接口策略的建议

### 8.1 应继续保留的接口

- `list`
  - 用于拉入站总览、节点同步、基础连通性测试
- `get/:id`
  - 用于解析 `settings.clients`
- `addClient`
  - 当前没有更好的替代方案
- `updateClient`
  - 当前没有更好的替代方案
- `getClientTraffics/:email`
  - 建议继续作为单用户流量主来源
- `onlines`
  - 建议继续作为在线邮箱列表来源
- `getDb`
  - 继续保留下载实现

### 8.2 我建议优先考虑替代或调整用法的接口

- `list` / `get/:id` 中的 `clientStats`
  - 不建议作为单用户流量主来源
  - 推荐替代：`getClientTraffics/:email`

- “先 `get/:id` 再 `delClient/:clientId` 删除”
  - 如果后续确认 `delClientByEmail` 在 3.2.5 稳定，某些删除场景可以直接优先用：
    - `POST /panel/api/inbounds/:id/delClientByEmail/:email`
  - 这样可以少一次查详情

- `lastOnline`
  - 当前不是核心接口
  - 如果以后要做“最近活跃时间”功能，它可以从边缘接口升级为主要状态接口

## 9. 后续适配 3.2.5 时的核对清单

1. Bearer Token 在所有目标接口上是否都稳定可用。
2. `addClient` 与 `updateClient` 的 `settings`，到底是“字符串更稳”还是“对象更稳”。
3. `hy2 / hysteria2` 下是否始终使用 `auth`，是否存在额外字段。
4. `clientId` 在不同协议下的映射规则是否完全不变。
5. `clientStats` 在 3.2.5 中是否仍然存在为空的情况。
6. `/panel/api/clients` 是否提供更适合当前项目的单用户查询能力。
7. `/panel/api/nodes` 是否能替代当前项目部分自定义节点同步逻辑。
8. `getDb`、日志接口、Geo 文件接口在 Token 模式下是否有额外权限或响应头差异。

## 10. 本次结论

- 3.2.5 的主干 API 仍然围绕 `inbounds` 和 `server` 两组展开。
- 当前项目已经先把“按版本选择客户端实现”的适配层骨架补齐，默认仍然走 `3.0.2`。
- 真正开始接 3.2.5 时，最值得优先验证的是：
  - `addClient`
  - `updateClient`
  - `get/:id`
  - `getClientTraffics/:email`
  - `delClientByEmail`
- 在当前项目语境下，我最推荐继续坚持的一条策略是：
  - “配置信息看 `settings.clients`，单用户流量看 `getClientTraffics/:email`，不要把 `clientStats` 当成强一致来源。”

## 11. 3.0.2 与 3.2.5 的真实差异点

这一节不是只根据文档推测，而是结合了三部分证据：

- 官方 Postman 文档（3.2.5）
- 官方源码中的 `api.go` 和 `client.go`
- 本项目在真实 `3.2.5` 面板上的 live 测试结果

### 11.1 最重要的变化：客户端接口从 `inbounds` 分组迁到了 `clients` 分组

这是本次适配里最核心、也是影响最大的变化。

`3.0.2` 的当前项目调用方式：

| 能力 | 3.0.2 路径 |
| --- | --- |
| 获取在线用户 | `POST /panel/api/inbounds/onlines` |
| 获取最近在线状态 | `POST /panel/api/inbounds/lastOnline` |
| 获取单用户流量 | `GET /panel/api/inbounds/getClientTraffics/:email` |
| 新增客户端 | `POST /panel/api/inbounds/addClient` |
| 更新客户端 | `POST /panel/api/inbounds/updateClient/:clientId` |
| 删除客户端 | `POST /panel/api/inbounds/:id/delClient/:clientId` |
| 按邮箱删除客户端 | `POST /panel/api/inbounds/:id/delClientByEmail/:email` |
| 重置单用户流量 | `POST /panel/api/inbounds/:id/resetClientTraffic/:email` |

`3.2.5` 在真实环境中已经变成：

| 能力 | 3.2.5 路径 |
| --- | --- |
| 获取在线用户 | `POST /panel/api/clients/onlines` |
| 获取最近在线状态 | `POST /panel/api/clients/lastOnline` |
| 获取单用户流量 | `GET /panel/api/clients/traffic/:email` |
| 获取单用户详情 | `GET /panel/api/clients/get/:email` |
| 获取客户端列表 | `GET /panel/api/clients/list` |
| 新增客户端 | `POST /panel/api/clients/add` |
| 更新客户端 | `POST /panel/api/clients/update/:email` |
| 删除客户端 | `POST /panel/api/clients/del/:email` |
| 重置单用户流量 | `POST /panel/api/clients/resetTraffic/:email` |

结论：

- `3.2.5` 不再把“客户端管理”严格看成“某个 inbound 的子操作”。
- 面板开始把“客户端”抽象成独立资源。
- 这就是为什么 `3.0.2` 的客户端接口在真实 `3.2.5` 面板上会直接 `404`。

### 11.2 请求体从“以 inbound 为中心”转成“以 client 为中心”

`3.0.2` 的新增/更新客户端，当前项目依赖的是这种结构：

```json
{
  "id": 38,
  "settings": "{\"clients\":[{\"id\":\"uuid\",\"email\":\"demo@example.com\",\"enable\":true}]}"
}
```

它的特点是：

- 顶层 `id` 表示 inbound ID
- 真正的客户端数据被包在 `settings.clients[0]`
- 本质上是在“修改 inbound 的 clients 配置片段”

`3.2.5` 的真实可用新增结构，当前项目实测跑通的是：

```json
{
  "client": {
    "id": "uuid",
    "email": "demo@example.com",
    "enable": true,
    "expiryTime": 0,
    "totalGB": 1073741824,
    "limitIp": 0,
    "tgId": 0,
    "subId": "sub-id"
  },
  "inboundIds": [38]
}
```

而更新则变成：

```json
{
  "id": "uuid",
  "email": "demo@example.com",
  "enable": true,
  "expiryTime": 0,
  "totalGB": 1073741824,
  "limitIp": 0,
  "tgId": 0,
  "subId": "sub-id"
}
```

路径是：

- `POST /panel/api/clients/add`
- `POST /panel/api/clients/update/:email`

这说明 `3.2.5` 的设计方向已经很明显：

- 新增客户端时，先定义“一个 client 对象”，再附带它属于哪些 inbound
- 更新客户端时，以邮箱为主键来更新这个 client 资源
- 不再要求调用方手工拼接 `settings.clients` 这类 inbound 内部配置结构

### 11.3 “按邮箱”成为更中心的定位方式

在 `3.0.2` 的旧接口里，项目一直要处理这些复杂规则：

- `updateClient/:clientId` 的 `clientId` 在不同协议下含义不同
- VMESS / VLESS 用 `id`
- Trojan 用 `password`
- Shadowsocks 用 `email`

这会带来两个问题：

- 服务层必须知道协议差异
- 删除/更新前常常要先查一次 inbound 详情，才能知道该传哪个标识

`3.2.5` 的新接口明显在弱化这种复杂度：

- `GET /panel/api/clients/get/:email`
- `GET /panel/api/clients/traffic/:email`
- `POST /panel/api/clients/update/:email`
- `POST /panel/api/clients/del/:email`
- `POST /panel/api/clients/resetTraffic/:email`

这说明面板接口的方向是：

- 优先用 `email` 作为客户端的业务主键
- 把协议内部的 UUID / auth / password 细节，尽量藏到服务端内部

对项目的意义是：

- 以后服务层会更轻松
- 统一按邮箱增删改查会比旧版 `clientId` 兼容规则更稳
- 多协议场景下，调用端不需要再那么深地理解底层协议映射

### 11.4 读取能力开始从“节点快照”转向“客户端资源视图”

`3.0.2` 下，当前项目很多时候是：

1. 先拿 `getInbound`
2. 再解析 `settings.clients`
3. 再结合 `clientStats` 或 `getClientTraffics/:email`

这是一种“从节点快照里把用户信息抠出来”的用法。

`3.2.5` 则已经有了更明确的客户端资源接口：

- `GET /panel/api/clients/list`
- `GET /panel/api/clients/get/:email`
- `GET /panel/api/clients/traffic/:email`

说明接口设计在往下面这个方向走：

- inbound 负责节点配置、端口、协议、传输层参数
- client 负责用户级资源、流量、状态、归属关系

这比旧版更清晰，也更接近标准 REST 资源划分。

### 11.5 inbound 与 server 这两组接口整体仍保持稳定

不是所有东西都变了。

本次真实测试说明，下面这类能力在 `3.2.5` 仍然兼容当前项目旧调用：

- `GET /panel/api/inbounds/list`
- `GET /panel/api/inbounds/get/:id`
- `GET /panel/api/server/getDb`

所以可以看出 `3.2.5` 的改动不是“整套 API 推倒重来”，而是：

- 优先重构“客户端资源管理”这一块
- `inbounds` 和 `server` 继续保留原有主干能力

这是一种比较典型的演进方式：

- 底层节点与服务端能力先保持兼容
- 把最容易产生耦合和历史包袱的“客户端管理”单独抽出来重做

### 11.6 当前项目最应该如何理解这次改动方向

如果只看当前项目的适配工作，可以把 3X-UI 的演进方向概括成三句话：

1. 从“以 inbound 为中心管理 client”改成“以 client 为中心管理 inbound 归属”。
2. 从“调用方理解协议差异”改成“调用方尽量只关心 email 和业务字段”。
3. 从“解析 `settings.clients` 这种内部配置文本”逐步转向“读取明确的 clients API 资源视图”。

### 11.7 对后续适配策略的建议

基于这次真实测试，我建议后续按下面的思路继续收敛：

- `3.0.2` 继续保留旧接口实现，不要硬改
- `3.2.5` 及以后版本，优先围绕 `/panel/api/clients/*` 继续扩展
- 服务层尽量保持统一输入输出，不把版本差异泄漏到业务层
- 对“读配置元数据”保留 `getInbound + settings.clients`
- 对“读单用户状态/流量/删除/更新/重置”优先使用 `clients` 分组接口

一句话总结：

- `3.0.2` 更像“节点配置 API 顺便带客户端操作”
- `3.2.5` 更像“节点资源 API + 客户端资源 API 分层”

这就是我认为最值得你重点把握的改动方向。

# 3X-UI 3.3.1 API 中文整理与适配说明

## 文档说明

- 来源页面：`https://us00.bidding.dpdns.org:8788/EjUBTWEtmaGOimWBud/panel/api-docs`
- 实际 OpenAPI JSON：`https://us00.bidding.dpdns.org:8788/EjUBTWEtmaGOimWBud/panel/api/openapi.json`
- 面板版本：`3.3.1`
- 整理时间：`2026-06-16`
- 本文目标：
  - 用中文沉淀 3X-UI `3.3.1` 的 API 分组、路径、字段和适配注意事项。
  - 请求示例统一使用 `curl`。
  - 鉴权示例统一使用 `api-token`，即 `Authorization: Bearer <token>`。

## 1. 基础约定

### 1.1 基础地址

本文示例使用下面两个变量：

```bash
PANEL_BASE="https://us00.bidding.dpdns.org:8788/EjUBTWEtmaGOimWBud"
API_TOKEN="替换为面板 Settings -> Security -> API Token 中生成的 token"
```

面板 API 根路径：

```text
${PANEL_BASE}/panel/api
```

注意：示例地址里的 `/EjUBTWEtmaGOimWBud` 是该面板当前配置的 `webBasePath`。实际接入时需要用目标 3X-UI 面板自己的 base path。

### 1.2 API Token 鉴权

3X-UI 3.3.1 支持两种鉴权：

| 鉴权方式 | 用途 | 说明 |
| --- | --- | --- |
| `Authorization: Bearer <token>` | 程序化调用 | 推荐用于本项目适配、节点同步、脚本和后端服务调用 |
| `3x-ui` Cookie | 浏览器 UI | 面板登录后由 `/login` 设置，不建议本项目后端依赖 |

API Token 获取位置：

```text
Settings -> Security -> API Token
```

通用请求头：

```bash
-H "Authorization: Bearer ${API_TOKEN}"
-H "Content-Type: application/json"
```

通用示例：

```bash
curl -k -sS \
  -H "Authorization: Bearer ${API_TOKEN}" \
  "${PANEL_BASE}/panel/api/inbounds/list"
```

### 1.3 通用响应结构

大多数 JSON API 返回：

```json
{
  "success": true,
  "msg": "",
  "obj": {}
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `success` | boolean | 是否成功 |
| `msg` | string | 提示或错误信息 |
| `obj` | any | 实际业务数据 |

例外：

- `/panel/api/server/getDb`、`/panel/api/server/getMigration` 返回文件流。
- 订阅服务接口返回 Base64、JSON 数组或 Clash/Mihomo YAML，不一定是上面的 JSON 包装。
- WebSocket 使用 Cookie 登录态，不支持 Bearer token。

### 1.4 字段命名

3X-UI API 使用驼峰字段，适配时不要改成下划线：

| 正确字段 | 常见错误 |
| --- | --- |
| `streamSettings` | `stream_settings` |
| `clientStats` | `client_stats` |
| `expiryTime` | `expiry_time` |
| `totalGB` | `total_gb` |
| `limitIp` | `limit_ip` |
| `subId` | `sub_id` |

### 1.5 3.3.1 对适配最重要的变化

- `Clients` 已经是一级资源：`/panel/api/clients/*` 可以直接按邮箱管理客户端，并自动同步到关联入站。
- `Inbounds` 的 `settings`、`streamSettings`、`sniffing` 推荐用嵌套 JSON 对象；旧版 JSON 字符串形式仍兼容。
- 新增轻量接口：
  - `/panel/api/inbounds/list/slim`
  - `/panel/api/inbounds/options`
  - `/panel/api/inbounds/setEnable/{id}`
- 批量客户端操作更完整：
  - `bulkCreate`
  - `bulkDel`
  - `bulkAttach`
  - `bulkDetach`
  - `bulkResetTraffic`
  - `bulkAdjust`
- API Token 本身也可以通过 `/panel/api/setting/apiTokens/*` 管理，但 token 明文只在创建时返回一次。

## 2. Authentication

这组接口主要给浏览器登录使用。本项目后端适配优先使用 API Token，一般不需要依赖 Cookie 登录。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/login` | 用户名密码登录，返回面板 Cookie |
| `POST` | `/logout` | 清除面板 Cookie |
| `GET` | `/csrf-token` | 为浏览器会话生成 CSRF token；Bearer API 调用可跳过 |
| `POST` | `/getTwoFactorEnable` | 查询面板是否启用 2FA |

Cookie 登录示例，仅用于排查，不作为本项目推荐适配方式：

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin","twoFactorCode":"123456"}'
```

## 3. Inbounds API

### 3.1 接口总表

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/panel/api/inbounds/list` | 获取全部入站，包含 `clientStats`；3.3.1 返回嵌套 JSON 对象 |
| `GET` | `/panel/api/inbounds/list/slim` | 获取轻量入站列表，适合列表页，不返回完整客户端敏感字段 |
| `GET` | `/panel/api/inbounds/options` | 获取下拉选择所需的轻量入站信息 |
| `GET` | `/panel/api/inbounds/get/{id}` | 按入站 ID 获取详情 |
| `POST` | `/panel/api/inbounds/add` | 新增入站 |
| `POST` | `/panel/api/inbounds/del/{id}` | 删除入站 |
| `POST` | `/panel/api/inbounds/bulkDel` | 批量删除入站 |
| `POST` | `/panel/api/inbounds/update/{id}` | 替换入站配置 |
| `POST` | `/panel/api/inbounds/setEnable/{id}` | 只切换入站启用状态 |
| `POST` | `/panel/api/inbounds/{id}/resetTraffic` | 重置单个入站总流量 |
| `POST` | `/panel/api/inbounds/{id}/delAllClients` | 删除某个入站下的全部客户端 |
| `POST` | `/panel/api/inbounds/resetAllTraffics` | 重置所有入站总流量 |
| `POST` | `/panel/api/inbounds/import` | 从 JSON 导入入站配置，表单字段为 `data` |
| `POST` | `/panel/api/inbounds/pushClientTraffics` | 接收主面板推送的客户端聚合流量 |
| `GET` | `/panel/api/inbounds/{id}/fallbacks` | 查询 master 入站 fallback 规则 |
| `POST` | `/panel/api/inbounds/{id}/fallbacks` | 替换 master 入站 fallback 规则 |

### 3.2 查询入站列表

```bash
curl -k -sS \
  -H "Authorization: Bearer ${API_TOKEN}" \
  "${PANEL_BASE}/panel/api/inbounds/list"
```

适配建议：

- 本项目同步节点信息仍可使用 `list` 或 `get/{id}`。
- 如果只是展示入站选择框，优先使用 `options`，返回更小。
- 如果只做列表展示，优先使用 `list/slim`。
- 需要解析客户端 UUID、`subId`、`flow` 等完整字段时，使用 `get/{id}`。

### 3.3 新增入站

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/inbounds/add" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "enable": true,
    "remark": "VLESS-443",
    "listen": "",
    "port": 443,
    "protocol": "vless",
    "expiryTime": 0,
    "total": 0,
    "settings": {
      "clients": [
        {
          "id": "用户UUID",
          "email": "alice@example.com",
          "enable": true,
          "flow": "xtls-rprx-vision",
          "limitIp": 0,
          "totalGB": 0,
          "expiryTime": 0,
          "subId": "16位订阅ID"
        }
      ],
      "decryption": "none",
      "fallbacks": []
    },
    "streamSettings": {
      "network": "tcp",
      "security": "reality",
      "realitySettings": {
        "show": false,
        "dest": "www.microsoft.com:443"
      }
    },
    "sniffing": {
      "enabled": true,
      "destOverride": ["http", "tls"]
    }
  }'
```

### 3.4 只切换入站启用状态

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/inbounds/setEnable/1" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"enable":false}'
```

适配建议：只改开关时不要走 `update/{id}`，否则大入站会重复序列化完整 `settings.clients`。

## 4. Clients API

3.3.1 的 `Clients` API 对本项目最有价值。它把客户端作为一级资源管理，一个客户端可以挂载到多个入站；购买、续费、禁用、重置流量等逻辑可以优先考虑迁移到这组接口。

### 4.1 接口总表

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/panel/api/clients/list` | 获取全部客户端及其关联入站和流量记录 |
| `GET` | `/panel/api/clients/list/paged` | 服务端分页、筛选、排序获取客户端轻量列表 |
| `GET` | `/panel/api/clients/get/{email}` | 按邮箱获取单个客户端详情 |
| `POST` | `/panel/api/clients/add` | 新增客户端并绑定一个或多个入站 |
| `POST` | `/panel/api/clients/update/{email}` | 按邮箱更新客户端，变更同步到所有关联入站 |
| `POST` | `/panel/api/clients/del/{email}` | 删除客户端，可用 `keepTraffic=1` 保留流量记录 |
| `POST` | `/panel/api/clients/{email}/attach` | 将已有客户端绑定到更多入站 |
| `POST` | `/panel/api/clients/{email}/detach` | 从指定入站解绑客户端，不删除客户端 |
| `POST` | `/panel/api/clients/resetAllTraffics` | 重置全部客户端流量 |
| `POST` | `/panel/api/clients/delDepleted` | 删除流量用尽或过期客户端 |
| `POST` | `/panel/api/clients/bulkAdjust` | 批量调整到期时间或流量额度 |
| `POST` | `/panel/api/clients/bulkDel` | 批量删除客户端 |
| `POST` | `/panel/api/clients/bulkCreate` | 批量创建客户端 |
| `POST` | `/panel/api/clients/groups/bulkAdd` | 批量加入客户端分组 |
| `POST` | `/panel/api/clients/groups/bulkRemove` | 批量移除客户端分组 |
| `POST` | `/panel/api/clients/bulkAttach` | 批量绑定客户端到多个入站 |
| `POST` | `/panel/api/clients/bulkDetach` | 批量从多个入站解绑客户端 |
| `POST` | `/panel/api/clients/bulkResetTraffic` | 批量重置客户端流量 |
| `GET` | `/panel/api/clients/groups` | 获取客户端分组和成员数量 |
| `GET` | `/panel/api/clients/groups/{name}/emails` | 获取某分组下的邮箱列表 |
| `POST` | `/panel/api/clients/groups/create` | 创建空客户端分组 |
| `POST` | `/panel/api/clients/groups/rename` | 重命名客户端分组 |
| `POST` | `/panel/api/clients/groups/delete` | 删除分组并清空客户端分组标签 |
| `POST` | `/panel/api/clients/resetTraffic/{email}` | 重置单个客户端流量，并重新启用其关联入站中的客户端 |
| `POST` | `/panel/api/clients/updateTraffic/{email}` | 手动调整单个客户端上下行流量 |
| `POST` | `/panel/api/clients/ips/{email}` | 查询客户端连接过的来源 IP |
| `POST` | `/panel/api/clients/clearIps/{email}` | 清空客户端 IP 记录 |
| `POST` | `/panel/api/clients/onlines` | 查询当前在线客户端邮箱 |
| `POST` | `/panel/api/clients/onlinesByGuid` | 按节点 `panelGuid` 查询在线客户端 |
| `POST` | `/panel/api/clients/activeInbounds` | 查询最近有流量的入站标签 |
| `POST` | `/panel/api/clients/lastOnline` | 查询客户端最后在线时间 |
| `GET` | `/panel/api/clients/traffic/{email}` | 查询单个客户端流量 |
| `GET` | `/panel/api/clients/subLinks/{subId}` | 按订阅 ID 返回协议链接数组，不做 Base64 |
| `GET` | `/panel/api/clients/links/{email}` | 按邮箱返回客户端所有协议链接 |

### 4.2 新增客户端并绑定入站

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/clients/add" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "client": {
      "email": "alice@example.com",
      "totalGB": 53687091200,
      "expiryTime": 1735689600000,
      "tgId": 0,
      "limitIp": 0,
      "enable": true,
      "subId": "0123456789abcdef",
      "flow": "xtls-rprx-vision"
    },
    "inboundIds": [3, 5]
  }'
```

说明：

- `totalGB` 在该接口示例中使用字节值，不是 GB 数字。
- `expiryTime` 使用毫秒时间戳；`0` 表示不过期。
- 协议密钥可省略，由服务端根据协议生成：
  - VLESS / VMess：UUID
  - Trojan / Shadowsocks：password
  - Hysteria：auth

### 4.3 更新客户端

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/clients/update/alice@example.com" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "totalGB": 107374182400,
    "expiryTime": 1767225600000,
    "tgId": 123456789,
    "limitIp": 0,
    "enable": true,
    "flow": "xtls-rprx-vision",
    "subId": "0123456789abcdef"
  }'
```

适配注意：

- 官方说明此接口是替换式更新，不是局部 patch。
- 调用前建议先 `GET /panel/api/clients/get/{email}`，保留已有 `uuid/password/auth/security/reverse` 等字段，再改目标字段。

### 4.4 删除客户端

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/clients/del/alice@example.com?keepTraffic=1" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

### 4.5 重置单个客户端流量

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/clients/resetTraffic/alice@example.com" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

适配建议：续费后如果用户因流量耗尽被禁用，可优先用这个接口重置并重新启用。

### 4.6 查询订阅链接数组

```bash
curl -k -sS \
  -H "Authorization: Bearer ${API_TOKEN}" \
  "${PANEL_BASE}/panel/api/clients/subLinks/0123456789abcdef"
```

适配价值：

- 返回 `vless://`、`vmess://`、`trojan://`、`ss://` 等链接数组。
- 与订阅服务 `/sub/<subId>` 的结果集类似，但不做 Base64 编码，更适合后端调试和适配。

## 5. Server API

### 5.1 接口总表

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/panel/api/server/status` | 获取 CPU、内存、磁盘、网络、负载、Xray 状态等实时信息 |
| `GET` | `/panel/api/server/cpuHistory/{bucket}` | 旧版 CPU 历史接口，建议使用 `/history/cpu/{bucket}` |
| `GET` | `/panel/api/server/history/{metric}/{bucket}` | 获取指定指标约 6 小时历史序列 |
| `GET` | `/panel/api/server/xrayMetricsState` | 获取 Xray runtime metrics 当前状态 |
| `GET` | `/panel/api/server/xrayMetricsHistory/{metric}/{bucket}` | 获取 Xray 指标历史序列 |
| `GET` | `/panel/api/server/xrayObservatory` | 获取 Xray observatory 出站探测快照 |
| `GET` | `/panel/api/server/xrayObservatoryHistory/{tag}/{bucket}` | 获取指定出站 observatory 历史 |
| `GET` | `/panel/api/server/getXrayVersion` | 获取可安装的 Xray 版本 |
| `GET` | `/panel/api/server/getPanelUpdateInfo` | 检查面板是否有新版本 |
| `GET` | `/panel/api/server/getConfigJson` | 获取当前运行的 Xray 配置 |
| `GET` | `/panel/api/server/getDb` | 下载面板数据库备份文件 |
| `GET` | `/panel/api/server/getMigration` | 下载跨数据库迁移文件 |
| `GET` | `/panel/api/server/getNewUUID` | 生成 UUID v4 |
| `GET` | `/panel/api/server/getWebCertFiles` | 获取面板自身 Web TLS 证书路径 |
| `GET` | `/panel/api/server/descendants` | 获取当前面板管理的子节点摘要 |
| `GET` | `/panel/api/server/getNewX25519Cert` | 生成 Reality X25519 密钥对 |
| `GET` | `/panel/api/server/getNewmldsa65` | 生成 ML-DSA-65 密钥对 |
| `GET` | `/panel/api/server/getNewmlkem768` | 生成 ML-KEM-768 密钥对 |
| `GET` | `/panel/api/server/getNewVlessEnc` | 生成 VLESS encryption auth 选项 |
| `POST` | `/panel/api/server/stopXrayService` | 停止 Xray |
| `POST` | `/panel/api/server/restartXrayService` | 重启 Xray |
| `POST` | `/panel/api/server/installXray/{version}` | 安装指定 Xray 版本，`latest` 表示最新版 |
| `POST` | `/panel/api/server/updatePanel` | 更新 3X-UI 面板自身 |
| `POST` | `/panel/api/server/updateGeofile` | 更新默认 GeoIP / GeoSite 文件 |
| `POST` | `/panel/api/server/updateGeofile/{fileName}` | 更新指定 Geo 文件 |
| `POST` | `/panel/api/server/logs/{count}` | 获取面板日志最后 N 行 |
| `POST` | `/panel/api/server/xraylogs/{count}` | 获取 Xray 日志最后 N 行 |
| `POST` | `/panel/api/server/importDB` | 上传并恢复数据库，破坏性操作 |
| `POST` | `/panel/api/server/getNewEchCert` | 按 SNI 生成 ECH 配置 |
| `GET` | `/panel/api/server/clientIps` | 获取聚合后的客户端 IP 表 |
| `POST` | `/panel/api/server/clientIps` | 提交客户端 IP 活跃时间，用于集群同步 |

### 5.2 查询服务器状态

```bash
curl -k -sS \
  -H "Authorization: Bearer ${API_TOKEN}" \
  "${PANEL_BASE}/panel/api/server/status"
```

### 5.3 重启 Xray

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/server/restartXrayService" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

### 5.4 下载数据库备份

```bash
curl -k -L \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -o "3x-ui-backup.db" \
  "${PANEL_BASE}/panel/api/server/getDb"
```

## 6. Nodes API

`Nodes` 用于中心面板管理远程 3X-UI 节点。当前项目如果直接管理多台 3X-UI，通常仍可以沿用自己的 `xui_servers` 表；如果未来希望复用 3X-UI 原生节点管理能力，需要重点评估这组接口。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/panel/api/nodes/list` | 获取所有远程节点及健康状态 |
| `GET` | `/panel/api/nodes/get/{id}` | 按 ID 获取节点详情 |
| `GET` | `/panel/api/nodes/webCert/{id}` | 获取节点自身 Web TLS 证书路径 |
| `POST` | `/panel/api/nodes/add` | 新增远程节点 |
| `POST` | `/panel/api/nodes/update/{id}` | 更新远程节点连接信息 |
| `POST` | `/panel/api/nodes/del/{id}` | 删除远程节点 |
| `POST` | `/panel/api/nodes/setEnable/{id}` | 启用或暂停节点同步 |
| `POST` | `/panel/api/nodes/test` | 不保存，测试节点连接 |
| `POST` | `/panel/api/nodes/certFingerprint` | 获取自签证书指纹，用于证书固定 |
| `POST` | `/panel/api/nodes/inbounds` | 使用未保存节点信息拉取远程入站 |
| `POST` | `/panel/api/nodes/probe/{id}` | 探测已有节点并更新缓存状态 |
| `POST` | `/panel/api/nodes/updatePanel` | 批量触发节点面板自更新 |
| `GET` | `/panel/api/nodes/history/{id}/{metric}/{bucket}` | 获取某节点指标历史 |

新增节点示例：

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/nodes/add" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "de-fra-1",
    "remark": "",
    "scheme": "https",
    "address": "node1.example.com",
    "port": 2053,
    "basePath": "/",
    "apiToken": "远程节点API_TOKEN",
    "enable": true,
    "allowPrivateAddress": false
  }'
```

测试节点示例：

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/nodes/test" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "scheme": "https",
    "address": "node1.example.com",
    "port": 2053,
    "basePath": "/",
    "apiToken": "远程节点API_TOKEN"
  }'
```

## 7. Settings API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/panel/api/setting/all` | 获取全部面板设置 |
| `POST` | `/panel/api/setting/defaultSettings` | 获取按当前请求 host 计算出的默认设置 |
| `POST` | `/panel/api/setting/update` | 一次性保存全部设置 |
| `POST` | `/panel/api/setting/updateUser` | 修改面板管理员用户名密码 |
| `POST` | `/panel/api/setting/restartPanel` | 重启整个 3X-UI 面板进程 |
| `GET` | `/panel/api/setting/getDefaultJsonConfig` | 获取内置默认 Xray JSON 配置模板 |

获取全部设置：

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/setting/all" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

修改管理员账号：

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/setting/updateUser" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "oldUsername": "admin",
    "oldPassword": "旧密码",
    "newUsername": "newadmin",
    "newPassword": "新密码"
  }'
```

## 8. API Tokens API

API Token 是全管理员权限凭据。创建后明文只返回一次，后续只能看到元数据，不能找回明文。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/panel/api/setting/apiTokens` | 获取 token 列表，不返回明文 |
| `POST` | `/panel/api/setting/apiTokens/create` | 创建 token，明文只在本次响应返回 |
| `POST` | `/panel/api/setting/apiTokens/delete/{id}` | 永久删除 token |
| `POST` | `/panel/api/setting/apiTokens/setEnabled/{id}` | 启用或禁用 token |

创建 token：

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/setting/apiTokens/create" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"subscription-manager"}'
```

禁用 token：

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/setting/apiTokens/setEnabled/2" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}'
```

## 9. Xray Settings API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/panel/api/xray/` | 获取 Xray 配置模板、入站标签、客户端 reverse 标签和出站测试 URL |
| `GET` | `/panel/api/xray/getDefaultJsonConfig` | 获取内置默认 Xray 配置，与 setting 接口等价 |
| `GET` | `/panel/api/xray/getOutboundsTraffic` | 获取所有出站流量统计 |
| `GET` | `/panel/api/xray/getXrayResult` | 获取最近一次 Xray stdout/stderr 输出 |
| `POST` | `/panel/api/xray/update` | 保存 Xray JSON 配置模板和出站测试 URL |
| `POST` | `/panel/api/xray/warp/{action}` | 管理 Cloudflare Warp 集成 |
| `POST` | `/panel/api/xray/nord/{action}` | 管理 NordVPN 集成 |
| `POST` | `/panel/api/xray/resetOutboundsTraffic` | 按 tag 重置出站流量 |
| `POST` | `/panel/api/xray/testOutbound` | 测试单个出站配置 |
| `POST` | `/panel/api/xray/testOutbounds` | 批量测试出站配置，最多 50 个 |
| `POST` | `/panel/api/xray/balancerStatus` | 获取运行中 balancer 状态 |
| `POST` | `/panel/api/xray/balancerOverride` | 临时强制 balancer 选择某个出站 |
| `POST` | `/panel/api/xray/routeTest` | 测试路由规则会选择哪个出站，不发送真实流量 |
| `GET` | `/panel/api/xray/outbound-subs` | 获取出站订阅列表 |
| `POST` | `/panel/api/xray/outbound-subs` | 新增出站订阅 |
| `POST` | `/panel/api/xray/outbound-subs/{id}` | 更新出站订阅 |
| `DELETE` | `/panel/api/xray/outbound-subs/{id}` | 删除出站订阅 |
| `POST` | `/panel/api/xray/outbound-subs/{id}/del` | 删除出站订阅，POST 别名 |
| `POST` | `/panel/api/xray/outbound-subs/{id}/refresh` | 立即刷新出站订阅 |
| `POST` | `/panel/api/xray/outbound-subs/{id}/move` | 调整出站订阅顺序 |
| `POST` | `/panel/api/xray/outbound-subs/parse` | 只解析订阅 URL，不保存 |

获取 Xray 配置模板：

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/xray/" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

查询出站流量：

```bash
curl -k -sS \
  -H "Authorization: Bearer ${API_TOKEN}" \
  "${PANEL_BASE}/panel/api/xray/getOutboundsTraffic"
```

## 10. Backup API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/panel/api/backuptotgbot` | 生成数据库备份并发送给 Telegram Bot 管理员 |

```bash
curl -k -sS \
  -X POST "${PANEL_BASE}/panel/api/backuptotgbot" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

## 11. Subscription Server

订阅服务是单独的 HTTP/HTTPS 服务，端口和路径由 Settings -> Subscription 配置。OpenAPI 中默认路径如下：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/{subPath}{subid}` | 返回 Base64 编码的标准订阅链接，默认 `/sub/:subid` |
| `GET` | `/{jsonPath}{subid}` | 返回 JSON 数组订阅，默认 `/json/:subid` |
| `GET` | `/{clashPath}{subid}` | 返回 Clash/Mihomo YAML，默认 `/clash/:subid` |

标准订阅示例：

```bash
curl -k -sS \
  "https://订阅服务域名:10882/sub/0123456789abcdef"
```

JSON 订阅示例：

```bash
curl -k -sS \
  "https://订阅服务域名:10882/json/0123456789abcdef"
```

Clash/Mihomo 订阅示例：

```bash
curl -k -sS \
  "https://订阅服务域名:10882/clash/0123456789abcdef"
```

适配注意：

- 订阅服务不一定和 Web 面板同端口。
- 订阅响应会带流量、过期时间等客户端可读 headers。
- 如果只需要在后端获取协议链接数组，可优先用 `/panel/api/clients/subLinks/{subId}`，它走面板 API Token 鉴权。

## 12. WebSocket

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/ws` | 建立 WebSocket 连接，要求 Cookie 登录态，不支持 Bearer token |
| `WS` | `type: status` | 每 2 秒推送服务器健康状态 |
| `WS` | `type: xrayState` | 推送 Xray 运行状态变化 |
| `WS` | `type: notification` | 推送面板通知 |
| `WS` | `type: invalidate` | 通知 UI 重新拉取资源 |

适配建议：本项目后端目前不建议依赖 WebSocket；服务端轮询 REST API 更容易控制鉴权、超时和错误恢复。

## 13. 本项目适配优先级建议

### 13.1 优先保留或迁移的接口

| 场景 | 建议接口 |
| --- | --- |
| 测试面板连通性 | `GET /panel/api/server/status` 或 `GET /panel/api/inbounds/options` |
| 同步节点入站详情 | `GET /panel/api/inbounds/list`、`GET /panel/api/inbounds/get/{id}` |
| 只展示节点选择 | `GET /panel/api/inbounds/options` |
| 新用户同步到 3X-UI | `POST /panel/api/clients/add` |
| 续费、改流量、改过期时间 | `POST /panel/api/clients/update/{email}` |
| 流量用尽后续费恢复 | `POST /panel/api/clients/resetTraffic/{email}` |
| 禁用或启用用户 | `POST /panel/api/clients/update/{email}`，保留原字段后修改 `enable` |
| 查询单用户流量 | `GET /panel/api/clients/traffic/{email}` |
| 查询订阅协议链接 | `GET /panel/api/clients/subLinks/{subId}` |

### 13.2 仍需谨慎的接口

- `/panel/api/inbounds/update/{id}`：替换完整入站配置，大入站客户端多时成本高，且容易覆盖并发变更。
- `/panel/api/setting/update`：一次性保存全部设置，调用前必须完整读回并保留未知字段。
- `/panel/api/server/importDB`：破坏性恢复数据库，不应用于常规业务逻辑。
- `/panel/api/server/updatePanel`、`/panel/api/server/installXray/{version}`：会改变运行环境，必须由管理员明确触发。

### 13.3 当前项目字段映射提示

| 本项目语义 | 3X-UI 字段 |
| --- | --- |
| 用户邮箱 / 客户端唯一标识 | `email` |
| UUID | `id` 或 `uuid`，取决于客户端详情来源 |
| 订阅 ID | `subId` |
| 客户端启用状态 | `enable` |
| 到期时间 | `expiryTime`，毫秒时间戳，`0` 表示不过期 |
| 流量上限 | `totalGB`，官方示例使用字节值 |
| IP 限制 | `limitIp` |
| VLESS Vision flow | `flow: "xtls-rprx-vision"` |

## 14. 最小接入验证清单

1. 用 API Token 调用 `/panel/api/server/status`，确认鉴权和 base path 正确。
2. 调用 `/panel/api/inbounds/options`，确认能读取入站 ID、协议、端口和 tag。
3. 调用 `/panel/api/clients/add` 创建测试邮箱，并绑定一个测试入站。
4. 调用 `/panel/api/clients/get/{email}`，确认 `subId`、UUID、流量和入站绑定关系。
5. 调用 `/panel/api/clients/subLinks/{subId}`，确认协议链接可生成。
6. 调用 `/panel/api/clients/update/{email}` 切换 `enable`，确认 3X-UI 中客户端状态同步。
7. 调用 `/panel/api/clients/resetTraffic/{email}`，确认流量清零和客户端恢复逻辑。


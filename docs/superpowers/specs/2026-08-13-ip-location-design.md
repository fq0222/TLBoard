# 用户 IP 归属地记录设计

## 背景

用户端访问日志中已经能看到登录和订阅获取请求的客户端 IP。现在需要在用户登录、获取订阅时尝试定位 IP 归属地，并在管理端用户列表展示省、市、区信息。用户主要来自中国大陆；如果用户通过代理访问导致 IP 定位到国外，则不写入和不覆盖已有国内归属地。

## 目标

- 登录成功后记录登录 IP 的国内归属地。
- 获取订阅内容成功后记录订阅访问 IP 的国内归属地。
- 只在定位结果属于中国大陆时更新 `users` 表。
- 管理端用户列表展示归属地文本；没有国内定位结果时展示“暂未获取”。
- 保持 `users` 表字段数量少，使用一个 JSON 字符串字段承载定位详情。

## 非目标

- 不实现 GPS、基站、Wi-Fi 等高精度定位。
- 不在每次定位失败时阻断登录或订阅响应。
- 不记录国外 IP 的归属地。
- 不在本阶段扩展用户端个人中心展示。

## 数据库设计

在 `users` 表新增一个字段：

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS ip_location TEXT DEFAULT '{}';
```

`ip_location` 存 JSON 字符串，结构如下：

```json
{
  "login": {
    "ip": "39.144.238.254",
    "country": "中国",
    "province": "河南省",
    "city": "郑州市",
    "district": "",
    "isp": "中国移动",
    "updated_at": 1786592707
  },
  "subscription": {
    "ip": "2409:8931:a91:1598:41a8:2084:ab64:7a63",
    "country": "中国",
    "province": "广东省",
    "city": "广州市",
    "district": "",
    "isp": "中国移动",
    "updated_at": 1786592808
  }
}
```

字段语义：

- `login`：最近一次成功登录时的国内 IP 归属地。
- `subscription`：最近一次成功获取订阅内容时的国内 IP 归属地。

## IP 定位来源

推荐优先使用离线库 `ip2region-ts` 或官方 `ip2region` xdb 方案：

- 离线查询，不依赖第三方 API 可用性。
- 不把用户 IP 发送给外部服务。
- 当前落地版本记录 IPv4；`ip2region-ts` 自带 xdb 对 IPv6 查询会报无效 IP，因此 IPv6 会安全跳过，不影响登录和订阅响应。
- 国内返回中文国家、省、市、运营商信息，适合当前管理端展示。

如果后续需要更高区县精度，可以替换为 IPIP.net 商业库或其他商业离线库，但本阶段不引入付费 API。

## 后端设计

新增独立服务 `server/services/shared/ip-location-service.js`：

- 负责规范化请求 IP。
- 过滤空 IP、内网 IP、回环 IP、保留地址。
- 调用 IP 定位库查询归属地。
- 判断是否中国大陆。
- 返回统一结构：

```js
{
  ip: '39.144.238.254',
  country: '中国',
  province: '河南省',
  city: '郑州市',
  district: '',
  isp: '中国移动',
  updated_at: 1786592707
}
```

新增仓储方法：

- `updateUserIpLocation(db, userId, source, location)`

更新逻辑：

1. 读取当前 `users.ip_location`。
2. JSON 解析失败时按 `{}` 处理。
3. 将 `source` 对应的键更新为本次定位结果。
4. 写回 `ip_location`。

登录接入点：

- `server/controllers/user/auth-controller.js` 登录成功后，使用本次请求 IP 尝试记录 `login` 归属地。
- 定位或写入失败只记录警告日志，不影响登录成功响应。

订阅接入点：

- `server/controllers/user/subscription-controller.js` 获取订阅内容成功后，从服务结果中拿到用户 ID，再使用本次请求 IP 尝试记录 `subscription` 归属地。
- 定位或写入失败只记录警告日志，不影响订阅内容返回。

为了让订阅控制器能更新用户，需要 `subscriptionService.getSubscriptionContent()` 的返回结果包含 `userId`，但不输出给客户端。

## 国内判断规则

本阶段只记录中国大陆：

- `country` 为 `中国` 或 `China`。
- `province` 不属于 `香港`、`澳门`、`台湾`。

以下情况不更新：

- 国外 IP。
- 香港、澳门、台湾 IP。
- 内网、回环、保留 IP。
- 定位库无结果。
- 定位结果无法解析。
- 定位结果没有省、市、区任一可展示字段。

## 管理端展示设计

管理端用户列表接口新增返回字段：

- `ip_location_text`

格式化规则：

1. 优先读取 `ip_location.login`。
2. 如果没有 `login`，读取 `ip_location.subscription`。
3. 拼接 `province city district`，自动忽略空字段。
4. 如果拼接结果为空，返回“暂未获取”。

示例：

- `河南省 郑州市`
- `广东省 广州市 天河区`
- `暂未获取`

管理端 `client-admin/src/views/Users.vue` 的用户列表新增列：

- 标题：`IP归属地`
- 内容：接口返回的 `ip_location_text`

## 错误处理

- IP 定位失败不影响主业务。
- JSON 解析失败时按空对象重建。
- 数据库写入失败只打警告日志。
- 管理端格式化失败时返回“暂未获取”。

## 测试策略

后端测试：

- 国内 IPv4 定位成功时更新 `login`。
- 国外 IP 定位结果不更新。
- `ip_location` 原值非法 JSON 时能恢复写入。
- 管理端用户列表能返回 `ip_location_text`。
- 订阅内容结果包含内部 `userId` 供控制器使用。

前端验证：

- 管理端用户列表构建通过。
- 有归属地时显示省市区。
- 无归属地时显示“暂未获取”。

## 验收标准

- 登录和订阅成功请求不会因为 IP 定位失败而失败。
- 中国大陆 IP 能写入 `users.ip_location`。
- 非中国大陆 IP 不覆盖已有国内定位信息。
- 管理端用户列表展示 `IP归属地` 列。
- 无定位数据展示“暂未获取”。

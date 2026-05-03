# API 接口文档

> 基础地址  
> 用户端：`http://localhost:30000`  
> 管理端：`http://localhost:30001`

> 认证方式  
> 需要登录的接口使用请求头：`Authorization: Bearer <token>`

> 通用返回格式

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

失败示例：

```json
{
  "code": 1001,
  "message": "参数校验失败",
  "data": null
}
```

---

## 1. 通用错误码

| code | 说明 |
|------|------|
| 0 | 成功 |
| 1001 | 参数校验失败 |
| 1002 | 未登录或 Token 无效 |
| 1003 | Token 已过期 |
| 1004 | 无权限 |
| 2001 | 账号已存在或不允许重复注册 |
| 2002 | 邮箱或密码错误 |
| 2003 | 账号已被禁用 |
| 2004 | 用户、订单或订阅不存在 |
| 4002 | IP ID 无效或已禁用 |
| 500 | 服务器内部错误 |
| 5002 | VMQ 创建订单失败 |
| 5003 | VMQ 通道要求手输金额，已拒绝下单 |

说明：

- `1001` 在注册和登录场景下会优先返回第一条具体校验信息，而不是固定的“参数校验失败”
- `5003` 用于拦截 `isAuto=1` 的危险支付通道

---

## 2. 用户端 API

所有用户端接口前缀：`/api/user`

### 2.1 认证相关

#### POST `/api/user/register-and-pay`

注册并创建支付订单。

请求体：

```json
{
  "email": "user@example.com",
  "password": "Abc12345",
  "plan_id": 1,
  "pay_type": 2
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱 |
| password | string | 是 | 至少 8 位，且必须同时包含字母和数字 |
| plan_id | number | 是 | 套餐 ID |
| pay_type | number | 否 | 支付方式，`1=微信`，`2=支付宝`，默认按后端配置 |

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "order_id": 10001,
    "user_id": 88,
    "out_trade_no": "ORD1746260000000abc123",
    "vmq_order_id": "202605030001",
    "pay_type": 2,
    "really_price": "19.90",
    "payment_url": "https://qr.alipay.com/fkxxxxx",
    "expire_in": 300
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| order_id | number | 本地订单 ID |
| user_id | number | 本地用户 ID |
| out_trade_no | string | 商户订单号 |
| vmq_order_id | string | VMQ 订单号 |
| pay_type | number | VMQ 实际使用的支付方式 |
| really_price | string | VMQ 返回的订单金额 |
| payment_url | string | 支付链接，前端用于生成二维码 |
| expire_in | number | 订单过期时间，单位秒 |

常见失败响应：

```json
{
  "code": 2001,
  "message": "该邮箱已注册，如需续费请先登录",
  "data": null
}
```

```json
{
  "code": 1001,
  "message": "密码需至少8位，并同时包含字母和数字",
  "data": {
    "errors": [
      {
        "msg": "密码需至少8位，并同时包含字母和数字",
        "path": "password"
      }
    ]
  }
}
```

```json
{
  "code": 5003,
  "message": "当前支付通道需要用户手动输入金额，存在少付风险，请更换VMQ监控通道配置后再试",
  "data": null
}
```

#### POST `/api/user/login`

用户登录。

请求体：

```json
{
  "email": "user@example.com",
  "password": "Abc12345"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "jwt-token",
    "expires_in": 604800,
    "user": {
      "id": 1,
      "email": "user@example.com",
      "plan_name": "基础套餐",
      "expire_at": 1770000000,
      "enabled": true
    }
  }
}
```

#### GET `/api/user/profile`

获取当前登录用户信息。

---

### 2.2 套餐与公告

#### GET `/api/user/plans`

获取已启用套餐列表。

#### GET `/api/user/announcements`

获取公告列表，支持分页参数：

- `page`
- `limit`

---

### 2.3 订单相关

#### GET `/api/user/orders`

获取当前登录用户的订单列表。

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认 `1` |
| limit | number | 否 | 每页条数，默认 `20` |
| status | string | 否 | `pending` / `paid` / `expired` |

成功响应中的金额字段以“分”为单位，`amount_text` 为格式化金额字符串。

#### GET `/api/user/orders/status/:id`

公共查单接口。

用途：

- 支付等待页在未登录状态下轮询订单状态
- 支持使用商户订单号 `out_trade_no` 查询

规则：

- 如果 `:id` 是纯数字，本接口要求已登录，且只能查询自己的订单
- 如果 `:id` 是商户订单号，则允许未登录查询

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "order_id": 10001,
    "out_trade_no": "ORD1746260000000abc123",
    "vmq_order_id": "202605030001",
    "status": "pending",
    "payment_url": "https://qr.alipay.com/fkxxxxx"
  }
}
```

#### GET `/api/user/orders/:id/status`

登录态查单接口。

用途：

- 已登录用户查询自己的订单状态
- 支持本地订单 ID 或商户订单号

成功响应结构与公共查单接口一致。

说明：

- 两个查单接口都会在本地订单仍为 `pending` 且存在 `trade_no` 时，主动调用 VMQ 查单
- 如果 VMQ 已确认支付，后端会立即完成订单激活
- 如果 VMQ 订单已关闭，后端会将本地订单更新为 `expired`

---

### 2.4 订阅相关

#### GET `/api/user/subscription`

获取当前登录用户的订阅信息与节点列表。

#### GET `/api/user/sub/:token`

通过订阅 token 获取订阅内容。

支持参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| clash | string | 否 | `1` 时返回 Clash YAML |
| v2ray | string | 否 | `1` 时返回 V2Ray Base64 |

默认返回 `text/plain` 格式的 Base64 订阅内容，并带有 `Subscription-Userinfo` 响应头。

---

### 2.5 Cloudflare IP 优选

#### GET `/api/user/cf-ips`

获取当前可用的 CF IP 池与用户当前生效的 IP。

说明：

- 当前后端会随机返回最多 20 个可选 IP
- 返回结果中尽量包含 IPv6

#### POST `/api/user/cf-ips/apply`

应用用户选择的 IP。

请求体：

```json
{
  "ip_ids": [1, 2, 3]
}
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "applied_count": 3,
    "subscription_url": "https://example.com/api/user/sub/abc123",
    "nodes": [
      {
        "server_name": "CF优选",
        "address": "104.16.132.229",
        "port": 443,
        "protocol": "vmess",
        "remark": "CF-104.16.132.229"
      }
    ],
    "message": "已成功应用 3 个优选 IP，请重新获取订阅"
  }
}
```

注意：

- 当前用户端后端没有 `/api/user/cf-ips/test` 接口
- 如前端存在延迟测试，应视为本地浏览器能力而非服务端 API

---

### 2.6 支付回调

#### GET `/api/user/payment/notify`
#### POST `/api/user/payment/notify`

VMQ 支付异步通知接口。

VMQ 可能使用 GET 或表单 POST 回调，因此后端同时支持两种方式。

常见参数：

| 参数 | 说明 |
|------|------|
| payId | 商户订单号，对应本地 `out_trade_no` |
| orderId | VMQ 订单号 |
| param | 透传参数 |
| type | 支付方式 |
| price | 订单金额 |
| reallyPrice | 实付金额 |
| sign | 签名 |

签名规则：

```text
md5(payId + param + type + price + reallyPrice + key)
```

回调处理规则：

1. 校验 `payId` 和 `sign`
2. 验证 VMQ 签名
3. 根据 `payId` 查找本地订单
4. 同时比对本地应付金额、`price`、`reallyPrice`
5. 金额一致才允许激活订单

响应文本：

| 返回内容 | 说明 |
|----------|------|
| `success` | 处理成功或订单不存在但无需重试 |
| `error_sign` | 缺少签名或验签失败 |
| `error_amount` | 金额不一致 |

#### GET `/api/user/payment/return`

支付完成后的同步回跳接口。

行为：

- 读取 `payId` 或 `order_id`
- 重定向到前端支付结果页：`/payment/callback?order_id=...`

---

## 3. 管理端 API

所有管理端接口前缀：`/api/admin`

当前已实现接口如下。

### 3.1 认证与管理员

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/login` | 管理员登录 |
| PUT | `/password` | 修改当前管理员密码 |
| GET | `/admins` | 管理员列表，仅超级管理员 |
| POST | `/admins` | 新增管理员，仅超级管理员 |
| DELETE | `/admins/:id` | 删除管理员，仅超级管理员 |

### 3.2 服务端管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/servers` | 获取服务端列表 |
| POST | `/servers` | 新增服务端 |
| PUT | `/servers/:id` | 编辑服务端 |
| DELETE | `/servers/:id` | 删除服务端 |
| GET | `/servers/:id/detail` | 服务端详情 |
| POST | `/servers/:id/sync` | 同步节点和用户信息 |
| PUT | `/servers/:id/users` | 更新 3X-UI 用户 |
| DELETE | `/servers/:id/users` | 删除 3X-UI 用户 |

### 3.3 用户管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/users` | 用户列表 |
| GET | `/users/:id` | 用户详情 |
| PUT | `/users/:id` | 更新用户 |

### 3.4 套餐管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/plans` | 套餐列表 |
| POST | `/plans` | 新增套餐 |
| PUT | `/plans/:id` | 编辑套餐 |
| DELETE | `/plans/:id` | 删除套餐 |

### 3.5 公告管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/announcements` | 公告列表 |
| POST | `/announcements` | 新增公告 |
| PUT | `/announcements/:id` | 编辑公告 |
| DELETE | `/announcements/:id` | 删除公告 |

### 3.6 订单管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/orders` | 订单列表 |

### 3.7 CF IP 池管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/cf-ips` | IP 池列表 |
| POST | `/cf-ips` | 新增 IP |
| PUT | `/cf-ips/:id` | 编辑 IP |
| DELETE | `/cf-ips/:id` | 删除 IP |
| POST | `/cf-ips/import` | 批量导入 IP |

---

## 4. 本次与代码对齐的修正点

本次文档已根据当前代码实现修正以下不一致内容：

- 将旧支付网关描述统一替换为 VMQ
- 将注册流程更新为 `/api/user/register-and-pay`
- 补充 `pay_type`、`vmq_order_id`、`really_price`、`payment_url`、`expire_in`
- 补充公共查单 `/api/user/orders/status/:id`
- 补充支付回跳 `/api/user/payment/return`
- 修正支付通知为同时支持 GET 和 POST
- 增加 `5002`、`5003` 错误码说明
- 删除当前代码中不存在的 `/api/user/cf-ips/test` 描述
- 补充“金额校验”和“拒绝手输金额通道”的当前实现规则

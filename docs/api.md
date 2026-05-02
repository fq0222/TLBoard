# API 接口文档

> 基础地址：用户端 `http://localhost:30000`，管理端 `http://localhost:30001`
>
> 认证方式：Header `Authorization: Bearer <token>`
>
> 通用响应格式：`{ "code": 0, "message": "ok", "data": {} }`
> 失败响应：`{ "code": <错误码>, "message": "<错误信息>", "data": null }`

---

## 通用错误码

| code | 说明 |
|------|------|
| 0 | 成功 |
| 1001 | 参数校验失败 |
| 1002 | 未登录 / Token 无效 |
| 1003 | Token 过期 |
| 1004 | 无权限 |
| 2001 | 邮箱已被注册 |
| 2002 | 邮箱或密码错误 |
| 2003 | 账号已被禁用 |
| 2004 | 订单不存在 |
| 2005 | 订单已过期 |
| 2006 | 支付失败 |
| 3001 | 服务器连接失败 |
| 3002 | 3X-UI API 错误 |
| 4001 | 优选 IP 数量超限（最多5个） |
| 4002 | IP 不在可用池中 |

---

# 一、用户端 API（端口 30000）

所有用户端接口前缀：`/api/user`

---

## 1.1 认证相关

### POST /api/user/register-and-pay

注册并发起支付（用户不单独注册，通过支付完成注册）

**请求体：**
```json
{
  "email": "user@example.com",
  "password": "Abc12345",
  "plan_id": 1
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | ✅ | 邮箱，兼做用户名 |
| password | string | ✅ | 密码，最少8位，包含字母和数字 |
| plan_id | number | ✅ | 套餐 ID |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "order_id": 10001,
    "out_trade_no": "ORD20260429140100001",
    "payment_url": "https://pay.example.com/submit?out_trade_no=ORD20260429140100001&...",
    "expire_in": 1800
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| order_id | number | 订单 ID |
| out_trade_no | string | 商户订单号 |
| payment_url | string | 易支付收银台跳转 URL |
| expire_in | number | 订单有效期（秒），超时自动关闭 |

**错误响应：**
```json
// 邮箱已注册且有未过期套餐
{ "code": 2001, "message": "该邮箱已注册，如需续费请先登录", "data": null }

// 参数校验失败
{ "code": 1001, "message": "密码强度不足，需至少8位且包含字母和数字", "data": null }
```

---

### POST /api/user/login

用户登录

**请求体：**
```json
{
  "email": "user@example.com",
  "password": "Abc12345"
}
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_in": 604800,
    "user": {
      "id": 1,
      "email": "user@example.com",
      "plan_name": "基础套餐",
      "expire_at": 1717000000,
      "enabled": true
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| token | string | JWT Token |
| expires_in | number | 有效期（秒），默认 7 天 = 604800 |
| user | object | 用户基本信息 |

**错误响应：**
```json
{ "code": 2002, "message": "邮箱或密码错误", "data": null }
{ "code": 2003, "message": "账号已被禁用，请联系管理员", "data": null }
```

---

### GET /api/user/profile

获取当前登录用户个人信息（需登录）

**请求头：**
```
Authorization: Bearer <token>
```

**请求参数：** 无

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 1,
    "email": "user@example.com",
    "plan_id": 1,
    "plan_name": "基础套餐",
    "subscription_url": "https://example.com/api/user/sub/abc123def456",
    "traffic_used": 1073741824,
    "traffic_limit": 107374182400,
    "traffic_used_text": "1.00 GB",
    "traffic_limit_text": "100.00 GB",
    "traffic_percent": 1.0,
    "expire_at": 1717000000,
    "expire_text": "2026-05-30 00:00:00",
    "enabled": true,
    "created_at": 1714400000
  }
}
```

---

## 1.2 套餐相关

### GET /api/user/plans

获取已上架套餐列表（无需登录）

**请求参数：** 无

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "plans": [
      {
        "id": 1,
        "name": "基础套餐",
        "description": "适合轻度使用，每月100GB流量",
        "price": 1990,
        "price_text": "19.90",
        "duration_days": 30,
        "traffic_limit": 107374182400,
        "traffic_text": "100 GB",
        "sort_order": 1
      },
      {
        "id": 2,
        "name": "高级套餐",
        "description": "适合重度使用，每月500GB流量",
        "price": 4990,
        "price_text": "49.90",
        "duration_days": 30,
        "traffic_limit": 536870912000,
        "traffic_text": "500 GB",
        "sort_order": 2
      }
    ]
  }
}
```

---

## 1.3 公告相关

### GET /api/user/announcements

获取公告列表（无需登录）

**请求参数：**

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| page | query | number | 否 | 页码，默认 1 |
| limit | query | number | 否 | 每页条数，默认 10 |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 5,
    "page": 1,
    "limit": 10,
    "list": [
      {
        "id": 1,
        "title": "系统维护通知",
        "content": "## 维护通知\n\n服务器将于今晚 22:00 进行例行维护...",
        "pinned": true,
        "created_at": 1714400000,
        "updated_at": 1714400000
      },
      {
        "id": 2,
        "title": "新节点上线",
        "content": "日本东京节点已上线，欢迎使用。",
        "pinned": false,
        "created_at": 1714300000,
        "updated_at": 1714300000
      }
    ]
  }
}
```

---

## 1.4 订单相关

### GET /api/user/orders

获取当前用户的订单列表（需登录）

**请求头：**
```
Authorization: Bearer <token>
```

**请求参数：**

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| page | query | number | 否 | 页码，默认 1 |
| limit | query | number | 否 | 每页条数，默认 20 |
| status | query | string | 否 | 筛选状态：pending / paid / expired |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 3,
    "page": 1,
    "limit": 20,
    "list": [
      {
        "id": 10001,
        "out_trade_no": "ORD20260429140100001",
        "plan_name": "基础套餐",
        "amount": 1990,
        "amount_text": "19.90",
        "status": "paid",
        "status_text": "已支付",
        "paid_at": 1714400100,
        "created_at": 1714400000
      },
      {
        "id": 10002,
        "out_trade_no": "ORD20260429140200002",
        "plan_name": "高级套餐",
        "amount": 4990,
        "amount_text": "49.90",
        "status": "pending",
        "status_text": "待支付",
        "paid_at": null,
        "created_at": 1714400200
      }
    ]
  }
}
```

---

### GET /api/user/orders/:id/status

轮询订单支付状态（需登录，前端用于支付后轮询确认）

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "order_id": 10001,
    "status": "paid",
    "payment_url": "https://pay.example.com/submit?..."
  }
}
```

---

## 1.5 订阅相关

### GET /api/user/subscription

获取订阅链接及节点信息（需登录）

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "subscription_url": "https://example.com/api/user/sub/abc123def456",
    "clash_url": "https://example.com/api/user/sub/abc123def456?clash=1",
    "v2ray_url": "https://example.com/api/user/sub/abc123def456?v2ray=1",
    "expire_at": 1717000000,
    "expire_text": "2026-05-30 00:00:00",
    "traffic_used": 1073741824,
    "traffic_limit": 107374182400,
    "traffic_used_text": "1.00 GB",
    "traffic_limit_text": "100.00 GB",
    "traffic_percent": 1.0,
    "nodes": [
      {
        "server_name": "东京-01",
        "address": "103.1.2.3",
        "port": 443,
        "protocol": "vmess",
        "remark": "Tokyo-01"
      },
      {
        "server_name": "东京-01",
        "address": "103.1.2.3",
        "port": 8443,
        "protocol": "trojan",
        "remark": "Tokyo-01-Trojan"
      }
    ]
  }
}
```

---

### GET /api/user/sub/:token

通过 token 直接获取订阅内容（无需登录，供客户端拉取）

**请求参数：**

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| token | path | string | ✅ | 订阅 token |
| clash | query | number | 否 | 1 返回 Clash 格式 |
| v2ray | query | number | 否 | 1 返回 V2Ray base64 格式 |

**成功响应（默认 / V2Ray 格式）：**
```
Content-Type: text/plain; charset=utf-8
Subscription-Userinfo: upload=0; download=1073741824; total=107374182400; expire=1717000000

vmess://eyJ2IjoiMiIsInBzIjoiVG9reW8tMDEiLCJhZGQiOiIxMDMuMS4yLjMiLCJwb3J0IjoiNDQzIiwiaWQiOi...
trojan://password@103.1.2.3:8443?security=tls&type=tcp#Tokyo-01-Trojan
```

**成功响应（Clash 格式）：**
```yaml
Content-Type: text/yaml; charset=utf-8

proxies:
  - name: Tokyo-01
    type: vmess
    server: 103.1.2.3
    port: 443
    uuid: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    alterId: 0
    cipher: auto
    tls: true
```

**错误响应：**
```json
{ "code": 2004, "message": "订阅链接无效", "data": null }
{ "code": 2003, "message": "账号已被禁用", "data": null }
```

---

## 1.6 Cloudflare IP 优选

### GET /api/user/cf-ips

获取可用的 CF 优选 IP 池（需登录）

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "ips": [
      {
        "id": 1,
        "ip": "104.16.132.229",
        "port": 443,
        "location": "美国-旧金山"
      },
      {
        "id": 2,
        "ip": "104.16.133.229",
        "port": 443,
        "location": "美国-旧金山"
      },
      {
        "id": 3,
        "ip": "172.64.32.1",
        "port": 443,
        "location": "日本-东京"
      },
      {
        "id": 4,
        "ip": "104.18.0.1",
        "port": 8443,
        "location": "新加坡"
      },
      {
        "id": 5,
        "ip": "162.159.36.2",
        "port": 2053,
        "location": "韩国-首尔"
      },
      {
        "id": 6,
        "ip": "162.159.46.1",
        "port": 2083,
        "location": "中国香港"
      }
    ],
    "current_ips": [
      {
        "ip": "103.1.2.3",
        "port": 443,
        "source": "default"
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| ips | array | 可用 IP 池列表 |
| current_ips | array | 用户当前正在使用的优选 IP（source: "default" 表示使用默认 IP） |

---

### POST /api/user/cf-ips/test

前端调用，后端透传测试结果（需登录）

> 实际延迟测试在前端完成（fetch + AbortController），此接口用于前端将测试结果回传统计。
> 也可以设计为前端纯本地测试，此接口仅做健康检查。

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "ips": [
    { "ip": "104.16.132.229", "port": 443 },
    { "ip": "104.16.133.229", "port": 443 },
    { "ip": "172.64.32.1", "port": 443 }
  ]
}
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "results": [
      { "ip": "104.16.132.229", "port": 443, "latency": 120, "available": true },
      { "ip": "104.16.133.229", "port": 443, "latency": 85, "available": true },
      { "ip": "172.64.32.1", "port": 443, "latency": -1, "available": false }
    ]
  }
}
```

---

### POST /api/user/cf-ips/apply

应用用户选择的优选 IP（需登录）

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "ip_ids": [1, 2, 3]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ip_ids | number[] | ✅ | 从 IP 池中选择的 IP ID 列表，最多 5 个 |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "applied_count": 3,
    "subscription_url": "https://example.com/api/user/sub/abc123def456",
    "nodes": [
      {
        "server_name": "东京-01",
        "address": "104.16.132.229",
        "port": 443,
        "protocol": "vmess",
        "remark": "Tokyo-01"
      },
      {
        "server_name": "东京-01",
        "address": "104.16.133.229",
        "port": 443,
        "protocol": "vmess",
        "remark": "Tokyo-01"
      },
      {
        "server_name": "东京-01",
        "address": "172.64.32.1",
        "port": 443,
        "protocol": "vmess",
        "remark": "Tokyo-01"
      }
    ],
    "message": "已成功应用 3 个优选 IP，请重新获取订阅"
  }
}
```

**错误响应：**
```json
{ "code": 4001, "message": "最多只能选择 5 个 IP", "data": null }
{ "code": 4002, "message": "IP ID 无效或已禁用", "data": null }
```

---

# 二、管理端 API（端口 30001）

所有管理端接口前缀：`/api/admin`

---

## 2.1 管理员认证

### POST /api/admin/login

管理员登录

**请求体：**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_in": 7200,
    "admin": {
      "id": 1,
      "username": "admin",
      "is_super": true
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| token | string | JWT Token |
| expires_in | number | 有效期（秒），默认 2 小时 = 7200 |
| admin | object | 管理员信息 |

**错误响应：**
```json
{ "code": 2002, "message": "用户名或密码错误", "data": null }
// 登录失败 5 次后
{ "code": 2003, "message": "登录失败次数过多，请15分钟后重试", "data": null }
```

---

### PUT /api/admin/password

修改当前管理员密码（需登录）

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "old_password": "admin123",
  "new_password": "NewSecure@Pass1"
}
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "message": "密码修改成功，请重新登录"
  }
}
```

**错误响应：**
```json
{ "code": 2002, "message": "原密码错误", "data": null }
{ "code": 1001, "message": "新密码强度不足", "data": null }
```

---

## 2.2 管理员管理

### GET /api/admin/admins

获取管理员列表（需超级管理员权限）

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": 1,
        "username": "admin",
        "is_super": true,
        "created_at": 1714400000
      },
      {
        "id": 2,
        "username": "operator01",
        "is_super": false,
        "created_at": 1714500000
      }
    ]
  }
}
```

---

### POST /api/admin/admins

添加管理员（需超级管理员权限）

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "username": "operator02",
  "password": "Op@Secure123",
  "is_super": false
}
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 3,
    "username": "operator02",
    "is_super": false,
    "created_at": 1714600000
  }
}
```

**错误响应：**
```json
{ "code": 1004, "message": "仅超级管理员可添加管理员", "data": null }
{ "code": 2001, "message": "用户名已存在", "data": null }
```

---

### DELETE /api/admin/admins/:id

删除管理员（需超级管理员权限，不可删除自己）

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "message": "管理员已删除"
  }
}
```

**错误响应：**
```json
{ "code": 1004, "message": "不能删除自己的账号", "data": null }
{ "code": 1004, "message": "仅超级管理员可删除管理员", "data": null }
```

---

## 2.3 3X-UI 服务器管理

### GET /api/admin/servers

获取所有 3X-UI 服务器列表（含状态摘要）

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "servers": [
      {
        "id": 1,
        "name": "东京-01",
        "api_url": "http://45.76.100.1:2053",
        "status": 1,
        "status_text": "在线",
        "node_count": 3,
        "user_count": 15,
        "online_count": 8,
        "last_check_at": 1714400000,
        "created_at": 1714300000
      },
      {
        "id": 2,
        "name": "新加坡-01",
        "api_url": "http://139.59.100.1:2053",
        "status": 0,
        "status_text": "离线",
        "node_count": 0,
        "user_count": 0,
        "online_count": 0,
        "last_check_at": 1714400000,
        "created_at": 1714350000
      }
    ]
  }
}
```

---

### POST /api/admin/servers

添加 3X-UI 服务器

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "name": "东京-02",
  "api_url": "http://45.76.100.2:2053",
  "api_username": "admin",
  "api_password": "panel_password_123"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ | 服务器名称 |
| api_url | string | ✅ | 3X-UI 面板地址（含端口） |
| api_username | string | ✅ | API 用户名 |
| api_password | string | ✅ | API 密码 |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 3,
    "name": "东京-02",
    "api_url": "http://45.76.100.2:2053",
    "status": 1,
    "message": "服务器添加成功，连接测试通过"
  }
}
```

**错误响应：**
```json
{ "code": 3001, "message": "连接 3X-UI 面板失败，请检查地址和凭据", "data": null }
```

---

### PUT /api/admin/servers/:id

修改 3X-UI 服务器信息

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "name": "东京-02（已更新）",
  "api_url": "http://45.76.100.2:2053",
  "api_username": "admin",
  "api_password": "new_password_456"
}
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 3,
    "name": "东京-02（已更新）",
    "api_url": "http://45.76.100.2:2053",
    "status": 1,
    "message": "服务器信息更新成功"
  }
}
```

---

### DELETE /api/admin/servers/:id

删除 3X-UI 服务器

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "message": "服务器已删除"
  }
}
```

---

### GET /api/admin/servers/:id/detail

获取服务器详细信息（节点列表 + 用户详情）

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "server": {
      "id": 1,
      "name": "东京-01",
      "api_url": "http://45.76.100.1:2053",
      "status": 1,
      "last_check_at": 1714400000
    },
    "nodes": [
      {
        "inbound_id": 1,
        "remark": "Tokyo-01-VMess",
        "port": 443,
        "protocol": "vmess",
        "user_count": 10,
        "online_count": 5,
        "users": [
          {
            "email": "user1@example.com",
            "user_id": 1,
            "enabled": true,
            "expire_at": 1717000000,
            "expire_text": "2026-05-30",
            "traffic_used": 1073741824,
            "traffic_limit": 107374182400,
            "traffic_used_text": "1.00 GB",
            "traffic_limit_text": "100.00 GB"
          },
          {
            "email": "user2@example.com",
            "user_id": 2,
            "enabled": false,
            "expire_at": 1714400000,
            "expire_text": "2026-04-29",
            "traffic_used": 53687091200,
            "traffic_limit": 53687091200,
            "traffic_used_text": "50.00 GB",
            "traffic_limit_text": "50.00 GB"
          }
        ]
      },
      {
        "inbound_id": 2,
        "remark": "Tokyo-01-Trojan",
        "port": 8443,
        "protocol": "trojan",
        "user_count": 10,
        "online_count": 3,
        "users": [
          {
            "email": "user1@example.com",
            "user_id": 1,
            "enabled": true,
            "expire_at": 1717000000,
            "expire_text": "2026-05-30",
            "traffic_used": 1073741824,
            "traffic_limit": 107374182400,
            "traffic_used_text": "1.00 GB",
            "traffic_limit_text": "100.00 GB"
          }
        ]
      }
    ]
  }
}
```

---

### POST /api/admin/servers/:id/sync

手动同步服务器状态（从 3X-UI 拉取最新节点和用户信息）

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "synced_at": 1714400100,
    "node_count": 3,
    "user_count": 15,
    "online_count": 8,
    "message": "同步完成"
  }
}
```

**错误响应：**
```json
{ "code": 3002, "message": "3X-UI API 返回错误: unauthorized", "data": null }
```

---

### PUT /api/admin/servers/:id/users

更新 3X-UI 用户信息（到期时间、流量上限、启用/禁用）

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "inboundId": 1,
  "email": "user1@example.com",
  "expiryTime": 1719600000000,
  "totalGB": 100,
  "enabled": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| inboundId | number | ✅ | 入站 ID |
| email | string | ✅ | 用户标识（邮箱） |
| expiryTime | number | 否 | 到期时间戳（毫秒），0 表示永不过期 |
| totalGB | number | 否 | 流量上限（GB），0 表示无限制 |
| enabled | boolean | 否 | 是否启用 |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "message": "用户更新成功"
  }
}
```

**错误响应：**
```json
{ "code": 1001, "message": "参数校验失败", "data": null }
{ "code": 3001, "message": "未找到用户: user1@example.com", "data": null }
```

---

### DELETE /api/admin/servers/:id/users

删除 3X-UI 用户

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "inboundId": 1,
  "email": "user1@example.com"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| inboundId | number | ✅ | 入站 ID |
| email | string | ✅ | 用户标识（邮箱） |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "message": "用户删除成功"
  }
}
```

**错误响应：**
```json
{ "code": 1001, "message": "参数校验失败", "data": null }
{ "code": 3001, "message": "未找到用户: user1@example.com", "data": null }
```

---

## 2.4 套餐管理

### GET /api/admin/plans

获取所有套餐（含未上架）

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": 1,
        "name": "基础套餐",
        "description": "适合轻度使用",
        "price": 1990,
        "price_text": "19.90",
        "duration_days": 30,
        "traffic_limit": 107374182400,
        "traffic_text": "100 GB",
        "sort_order": 1,
        "enabled": true,
        "created_at": 1714300000
      },
      {
        "id": 3,
        "name": "体验套餐（已下架）",
        "description": "测试用",
        "price": 990,
        "price_text": "9.90",
        "duration_days": 7,
        "traffic_limit": 10737418240,
        "traffic_text": "10 GB",
        "sort_order": 3,
        "enabled": false,
        "created_at": 1714350000
      }
    ]
  }
}
```

---

### POST /api/admin/plans

添加套餐

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "name": "年付套餐",
  "description": "年付优惠，每月500GB流量",
  "price": 39900,
  "duration_days": 365,
  "traffic_limit": 644245094400,
  "sort_order": 4,
  "enabled": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ | 套餐名称 |
| description | string | 否 | 描述 |
| price | number | ✅ | 价格（分） |
| duration_days | number | ✅ | 有效天数 |
| traffic_limit | number | ✅ | 流量上限（bytes） |
| sort_order | number | 否 | 排序权重，默认 0 |
| enabled | boolean | 否 | 是否上架，默认 true |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 4,
    "name": "年付套餐",
    "description": "年付优惠，每月500GB流量",
    "price": 39900,
    "price_text": "399.00",
    "duration_days": 365,
    "traffic_limit": 644245094400,
    "traffic_text": "600 GB",
    "sort_order": 4,
    "enabled": true,
    "created_at": 1714600000
  }
}
```

---

### PUT /api/admin/plans/:id

修改套餐

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "name": "年付套餐（限时优惠）",
  "price": 29900,
  "enabled": true
}
```

> 请求体仅需包含要修改的字段，未传字段保持不变。

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 4,
    "name": "年付套餐（限时优惠）",
    "description": "年付优惠，每月500GB流量",
    "price": 29900,
    "price_text": "299.00",
    "duration_days": 365,
    "traffic_limit": 644245094400,
    "traffic_text": "600 GB",
    "sort_order": 4,
    "enabled": true,
    "created_at": 1714600000
  }
}
```

---

### DELETE /api/admin/plans/:id

删除套餐

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "message": "套餐已删除"
  }
}
```

**错误响应：**
```json
// 有用户正在使用该套餐
{ "code": 1001, "message": "该套餐下仍有活跃用户，无法删除", "data": null }
```

---

## 2.5 用户管理

### GET /api/admin/users

获取用户列表（支持搜索和筛选）

**请求头：**
```
Authorization: Bearer <token>
```

**请求参数：**

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| page | query | number | 否 | 页码，默认 1 |
| limit | query | number | 否 | 每页条数，默认 20 |
| keyword | query | string | 否 | 搜索关键词（邮箱模糊匹配） |
| status | query | string | 否 | active / expired / disabled |
| plan_id | query | number | 否 | 按套餐筛选 |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 50,
    "page": 1,
    "limit": 20,
    "list": [
      {
        "id": 1,
        "email": "user1@example.com",
        "plan_id": 1,
        "plan_name": "基础套餐",
        "traffic_used": 1073741824,
        "traffic_limit": 107374182400,
        "traffic_used_text": "1.00 GB",
        "traffic_limit_text": "100.00 GB",
        "expire_at": 1717000000,
        "expire_text": "2026-05-30",
        "enabled": true,
        "status": "active",
        "status_text": "正常",
        "created_at": 1714400000
      },
      {
        "id": 2,
        "email": "user2@example.com",
        "plan_id": 2,
        "plan_name": "高级套餐",
        "traffic_used": 53687091200,
        "traffic_limit": 53687091200,
        "traffic_used_text": "50.00 GB",
        "traffic_limit_text": "50.00 GB",
        "expire_at": 1714400000,
        "expire_text": "2026-04-29",
        "enabled": false,
        "status": "expired",
        "status_text": "已过期",
        "created_at": 1714350000
      }
    ]
  }
}
```

---

### GET /api/admin/users/:id

获取用户详情

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "user": {
      "id": 1,
      "email": "user1@example.com",
      "plan_id": 1,
      "plan_name": "基础套餐",
      "subscription_url": "https://example.com/api/user/sub/abc123def456",
      "traffic_used": 1073741824,
      "traffic_limit": 107374182400,
      "traffic_used_text": "1.00 GB",
      "traffic_limit_text": "100.00 GB",
      "expire_at": 1717000000,
      "expire_text": "2026-05-30",
      "enabled": true,
      "created_at": 1714400000
    },
    "orders": [
      {
        "id": 10001,
        "out_trade_no": "ORD20260429140100001",
        "plan_name": "基础套餐",
        "amount": 1990,
        "amount_text": "19.90",
        "status": "paid",
        "paid_at": 1714400100,
        "created_at": 1714400000
      }
    ],
    "cf_ips": [
      { "ip": "104.16.132.229", "port": 443, "location": "美国-旧金山" },
      { "ip": "104.16.133.229", "port": 443, "location": "美国-旧金山" }
    ]
  }
}
```

---

### PUT /api/admin/users/:id

修改用户信息

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "enabled": true,
  "plan_id": 2,
  "traffic_limit": 214748364800,
  "expire_at": 1719600000
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| enabled | boolean | 否 | 启用/禁用 |
| plan_id | number | 否 | 修改套餐 |
| traffic_limit | number | 否 | 修改流量上限（bytes） |
| expire_at | number | 否 | 修改到期时间（unix timestamp） |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 1,
    "email": "user1@example.com",
    "plan_id": 2,
    "plan_name": "高级套餐",
    "traffic_limit": 214748364800,
    "traffic_limit_text": "200.00 GB",
    "expire_at": 1719600000,
    "expire_text": "2026-06-29",
    "enabled": true,
    "message": "用户信息已更新，已同步到 2 台 3X-UI 服务器"
  }
}
```

---

## 2.6 公告管理

### GET /api/admin/announcements

获取所有公告

**请求头：**
```
Authorization: Bearer <token>
```

**请求参数：**

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| page | query | number | 否 | 页码 |
| limit | query | number | 否 | 每页条数 |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 3,
    "page": 1,
    "limit": 10,
    "list": [
      {
        "id": 1,
        "title": "系统维护通知",
        "content": "## 维护通知\n\n服务器将于今晚 22:00 进行例行维护...",
        "pinned": true,
        "enabled": true,
        "created_at": 1714400000,
        "updated_at": 1714400000
      }
    ]
  }
}
```

---

### POST /api/admin/announcements

添加公告

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "title": "新功能上线",
  "content": "## 新功能\n\nCF IP 优选工具已上线！\n\n- 支持在线测试延迟\n- 最多可选择 5 个 IP\n- 自动替换到订阅节点",
  "pinned": false,
  "enabled": true
}
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 4,
    "title": "新功能上线",
    "content": "## 新功能\n\nCF IP 优选工具已上线！...",
    "pinned": false,
    "enabled": true,
    "created_at": 1714600000,
    "updated_at": 1714600000
  }
}
```

---

### PUT /api/admin/announcements/:id

修改公告

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "title": "系统维护通知（已延期）",
  "pinned": true
}
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 1,
    "title": "系统维护通知（已延期）",
    "content": "## 维护通知\n\n服务器将于今晚 22:00 进行例行维护...",
    "pinned": true,
    "enabled": true,
    "created_at": 1714400000,
    "updated_at": 1714600100
  }
}
```

---

### DELETE /api/admin/announcements/:id

删除公告

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "message": "公告已删除"
  }
}
```

---

## 2.7 订单管理

### GET /api/admin/orders

获取订单列表

**请求头：**
```
Authorization: Bearer <token>
```

**请求参数：**

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| page | query | number | 否 | 页码 |
| limit | query | number | 否 | 每页条数 |
| status | query | string | 否 | pending / paid / expired |
| email | query | string | 否 | 按邮箱筛选 |
| start_date | query | string | 否 | 开始日期 YYYY-MM-DD |
| end_date | query | string | 否 | 结束日期 YYYY-MM-DD |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "list": [
      {
        "id": 10001,
        "out_trade_no": "ORD20260429140100001",
        "email": "user1@example.com",
        "user_id": 1,
        "plan_name": "基础套餐",
        "amount": 1990,
        "amount_text": "19.90",
        "status": "paid",
        "status_text": "已支付",
        "paid_at": 1714400100,
        "created_at": 1714400000
      }
    ]
  }
}
```

---

## 2.8 Cloudflare 优选 IP 池管理

### GET /api/admin/cf-ips

获取 IP 池列表

**请求头：**
```
Authorization: Bearer <token>
```

**请求参数：**

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| page | query | number | 否 | 页码 |
| limit | query | number | 否 | 每页条数 |
| enabled | query | number | 否 | 0/1 筛选 |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 50,
    "page": 1,
    "limit": 20,
    "list": [
      {
        "id": 1,
        "ip": "104.16.132.229",
        "port": 443,
        "location": "美国-旧金山",
        "enabled": true,
        "created_at": 1714300000
      },
      {
        "id": 2,
        "ip": "104.16.133.229",
        "port": 443,
        "location": "美国-旧金山",
        "enabled": true,
        "created_at": 1714300000
      },
      {
        "id": 3,
        "ip": "172.64.32.1",
        "port": 443,
        "location": "日本-东京",
        "enabled": false,
        "created_at": 1714350000
      }
    ]
  }
}
```

---

### POST /api/admin/cf-ips

添加 IP

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "ip": "162.159.36.2",
  "port": 443,
  "location": "韩国-首尔",
  "enabled": true
}
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 7,
    "ip": "162.159.36.2",
    "port": 443,
    "location": "韩国-首尔",
    "enabled": true,
    "created_at": 1714600000
  }
}
```

---

### PUT /api/admin/cf-ips/:id

修改 IP

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "location": "韩国-首尔（优化线路）",
  "enabled": false
}
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 7,
    "ip": "162.159.36.2",
    "port": 443,
    "location": "韩国-首尔（优化线路）",
    "enabled": false,
    "created_at": 1714600000
  }
}
```

---

### DELETE /api/admin/cf-ips/:id

删除 IP

**请求头：**
```
Authorization: Bearer <token>
```

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "message": "IP 已删除"
  }
}
```

---

### POST /api/admin/cf-ips/import

批量导入 IP

**请求头：**
```
Authorization: Bearer <token>
```

**请求体：**
```json
{
  "ips": [
    { "ip": "104.16.132.229", "port": 443, "location": "美国-旧金山" },
    { "ip": "104.16.133.229", "port": 443, "location": "美国-旧金山" },
    { "ip": "172.64.32.1", "port": 443, "location": "日本-东京" },
    { "ip": "104.18.0.1", "port": 8443, "location": "新加坡" },
    { "ip": "162.159.36.2", "port": 2053, "location": "韩国-首尔" }
  ],
  "enabled": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ips | array | ✅ | IP 列表，每项包含 ip、port、location |
| enabled | boolean | 否 | 批量设置是否启用，默认 true |

**成功响应：**
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "imported": 5,
    "skipped": 0,
    "message": "成功导入 5 个 IP"
  }
}
```

**错误响应：**
```json
// 部分 IP 重复
{
  "code": 0,
  "message": "ok",
  "data": {
    "imported": 3,
    "skipped": 2,
    "message": "成功导入 3 个 IP，跳过 2 个重复 IP"
  }
}
```

---

## 2.9 易支付回调（无需认证）

### POST /api/user/payment/notify

易支付异步回调接口（由易支付服务器调用，非前端调用）

**请求参数（form-urlencoded）：**

| 参数 | 类型 | 说明 |
|------|------|------|
| pid | string | 商户 ID |
| trade_no | string | 易支付交易号 |
| out_trade_no | string | 商户订单号 |
| type | string | 支付方式 |
| name | string | 商品名称 |
| money | string | 金额 |
| trade_status | string | 交易状态（TRADE_SUCCESS） |
| sign | string | 签名 |
| sign_type | string | 签名方式 |

**响应（纯文本）：**
```
success
```

> 此接口验签成功后执行：
> 1. 更新订单状态为 `paid`
> 2. 激活用户账号
> 3. 设置套餐、流量、到期时间
> 4. 同步到所有 3X-UI 服务器
> 5. 返回 `success` 字符串通知易支付不再重试

---

# 三、接口汇总表

## 用户端（:30000）

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | /api/user/register-and-pay | ❌ | 注册并发起支付 |
| POST | /api/user/login | ❌ | 登录 |
| GET | /api/user/profile | ✅ | 获取个人信息 |
| GET | /api/user/plans | ❌ | 获取套餐列表 |
| GET | /api/user/announcements | ❌ | 获取公告列表 |
| GET | /api/user/orders | ✅ | 订单列表 |
| GET | /api/user/orders/:id/status | ✅ | 轮询订单状态 |
| GET | /api/user/subscription | ✅ | 获取订阅信息 |
| GET | /api/user/sub/:token | ❌ | 通过 token 获取订阅内容 |
| GET | /api/user/cf-ips | ✅ | 获取 CF 优选 IP 池 |
| POST | /api/user/cf-ips/test | ✅ | CF IP 延迟测试 |
| POST | /api/user/cf-ips/apply | ✅ | 应用优选 IP |
| POST | /api/user/payment/notify | ❌ | 易支付回调 |

## 管理端（:30001）

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | /api/admin/login | ❌ | 管理员登录 |
| PUT | /api/admin/password | ✅ | 修改密码 |
| GET | /api/admin/admins | ✅ | 管理员列表 |
| POST | /api/admin/admins | ✅ | 添加管理员 |
| DELETE | /api/admin/admins/:id | ✅ | 删除管理员 |
| GET | /api/admin/servers | ✅ | 服务器列表 |
| POST | /api/admin/servers | ✅ | 添加服务器 |
| PUT | /api/admin/servers/:id | ✅ | 修改服务器 |
| DELETE | /api/admin/servers/:id | ✅ | 删除服务器 |
| GET | /api/admin/servers/:id/detail | ✅ | 服务器详情 |
| POST | /api/admin/servers/:id/sync | ✅ | 同步服务器 |
| PUT | /api/admin/servers/:id/users | ✅ | 更新3X-UI用户 |
| DELETE | /api/admin/servers/:id/users | ✅ | 删除3X-UI用户 |
| GET | /api/admin/users | ✅ | 用户列表 |
| GET | /api/admin/users/:id | ✅ | 用户详情 |
| PUT | /api/admin/users/:id | ✅ | 修改用户 |
| GET | /api/admin/plans | ✅ | 套餐列表 |
| POST | /api/admin/plans | ✅ | 添加套餐 |
| PUT | /api/admin/plans/:id | ✅ | 修改套餐 |
| DELETE | /api/admin/plans/:id | ✅ | 删除套餐 |
| GET | /api/admin/announcements | ✅ | 公告列表 |
| POST | /api/admin/announcements | ✅ | 添加公告 |
| PUT | /api/admin/announcements/:id | ✅ | 修改公告 |
| DELETE | /api/admin/announcements/:id | ✅ | 删除公告 |
| GET | /api/admin/orders | ✅ | 订单列表 |
| GET | /api/admin/cf-ips | ✅ | CF IP 池列表 |
| POST | /api/admin/cf-ips | ✅ | 添加 IP |
| PUT | /api/admin/cf-ips/:id | ✅ | 修改 IP |
| DELETE | /api/admin/cf-ips/:id | ✅ | 删除 IP |
| POST | /api/admin/cf-ips/import | ✅ | 批量导入 IP |

> **共计：用户端 13 个接口，管理端 24 个接口，合计 37 个接口。**

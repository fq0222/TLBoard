# 推广系统设计

## 背景

当前系统已经具备用户注册购买、续费、流量统计、3X-UI 同步、用户端个人中心和管理端系统设置能力。推广系统需要在现有购买链路上增加“首单付款成功后给推广人发放独立推广流量”的能力，并在用户端与管理端提供可见、可管理的推广数据。

## 目标

- 用户可以在“我的”页面获取自己的推广链接。
- 其他用户通过推广链接进入并首次付款成功后，推广链接持有人获得推广流量奖励。
- 推广流量与套餐流量分开存储和展示，但超量判断与 3X-UI 同步使用两者之和。
- 用户端首页展示总可用流量，并标明套餐流量与推广流量拆分。
- 用户端提供推广详情页，展示点击量、奖励总量、奖励明细。
- 管理端系统设置支持配置推广奖励流量。
- 管理端新增推广管理页，支持查看用户推广链接、推广明细、启用或禁用推广功能、重置推广链接地址。

## 非目标

- 不做多级推广。
- 不按续费重复发放奖励。
- 不做不同套餐不同奖励。
- 不做现金佣金、提现或积分系统。

## 核心规则

推广奖励只在被推广用户首次付款成功时发放。续费订单不发放推广奖励。

付款回调可能重复触发，奖励发放必须幂等。同一被推广用户、同一首单订单只能生成一条奖励记录。

推广人不能推广自己。推广链接被禁用后，后续点击和注册不再产生有效归因，历史奖励保留。

推广链接重置后，新链接生效，旧链接失效。历史点击和奖励明细保留。

## 数据模型

### users

新增字段：

- `referral_traffic_limit BIGINT DEFAULT 0`：推广奖励流量，单位字节。

现有 `traffic_limit` 继续表示套餐流量。总流量上限为：

```text
total_traffic_limit = traffic_limit + referral_traffic_limit
```

### referral_codes

用户推广链接状态表。

- `id SERIAL PRIMARY KEY`
- `user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE`
- `code VARCHAR(64) NOT NULL UNIQUE`
- `enabled INTEGER DEFAULT 1`
- `created_at BIGINT`
- `updated_at BIGINT`

职责：保存每个用户当前有效推广码和启用状态。重置链接时更新 `code` 和 `updated_at`。

### referral_clicks

推广点击记录表。

- `id SERIAL PRIMARY KEY`
- `referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `code VARCHAR(64) NOT NULL`
- `ip VARCHAR(64)`
- `user_agent TEXT`
- `created_at BIGINT`

职责：记录有效推广码点击量。管理端和用户端点击量从该表统计。

### referral_rewards

推广奖励明细表。

- `id SERIAL PRIMARY KEY`
- `referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `referred_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE`
- `reward_traffic BIGINT NOT NULL`
- `created_at BIGINT`
- `UNIQUE(referred_user_id)`
- `UNIQUE(order_id)`

职责：记录谁通过谁的推广链接首付成功、奖励多少流量。唯一约束保证重复回调不会重复发放。

### orders

新增字段：

- `referrer_user_id INTEGER`

职责：待支付订单创建时记录推广人 ID。付款成功时以订单上的 `referrer_user_id` 发奖，避免后续 Cookie 或链接变化影响已创建订单。

## 后端设计

### 分层

新增：

- `server/repositories/referral-repository.js`：封装推广码、点击、奖励、统计 SQL。
- `server/services/referral-service.js`：封装推广码生成、点击记录、归因校验、首单奖励发放、管理操作。
- `server/routes/user/referral.js`：用户端推广接口。
- `server/routes/admin/referrals.js`：管理端推广接口。

已有支付完成逻辑仍由 `server/services/shared/order-service.js` 统一编排，只在付款成功事务中调用推广奖励服务。

### 用户端接口

- `GET /api/user/referral`：获取当前用户推广信息、推广链接、点击量、奖励总量。
- `POST /api/user/referral/click`：记录推广链接点击，参数为 `code`。
- `GET /api/user/referral/rewards`：分页查询当前用户推广奖励明细。

### 管理端接口

- `GET /api/admin/referrals`：分页查询用户推广概览。
- `GET /api/admin/referrals/:userId`：查看某用户推广详情。
- `PUT /api/admin/referrals/:userId/enabled`：启用或禁用该用户推广链接。
- `POST /api/admin/referrals/:userId/reset-code`：重置推广链接地址。

### 系统设置接口

在 `server/routes/admin/system-settings.js` 增加推广设置：

- `GET /api/admin/system-settings/referral`
- `PUT /api/admin/system-settings/referral`

配置键：

- `referral_reward_traffic`：每次首单成功奖励的推广流量，单位字节。

默认值建议为 `0`，管理员未配置时不发放奖励，避免上线后意外赠送。

### 注册归因

用户点击推广链接后，前端调用点击接口并把推广码保存到本地。注册购买时把 `referral_code` 传给 `registerAndPay()`。

后端注册下单时校验：

- 推广码存在且启用。
- 推广人不是当前注册邮箱对应的用户。
- 推广人账号存在。

校验通过后，把推广人 ID 写入订单 `referrer_user_id`。校验失败时继续正常注册下单，但不写入推广人。

### 奖励发放

付款成功进入 `completePaidOrder()` 后，在同一数据库事务中处理：

1. 标记订单 paid。
2. 更新被推广用户套餐权益。
3. 如果订单是首次购买订单且存在 `referrer_user_id`，读取 `referral_reward_traffic`。
4. 奖励流量大于 0 时，写入 `referral_rewards`。
5. 写入成功后增加推广人 `users.referral_traffic_limit`。

如果奖励记录已存在，视为重复回调，跳过加流量。

### 流量口径

以下位置使用总流量上限：

- 数据库存储中，`users.traffic_limit` 始终只表示套餐流量，`users.referral_traffic_limit` 只表示推广流量。
- 用户资料接口保留旧字段 `traffic_limit` 用于兼容现有页面，返回值调整为总流量上限。
- 3X-UI 同步使用 `traffic_limit + referral_traffic_limit`。
- 流量超限判断使用 `traffic_limit + referral_traffic_limit`。

新增返回字段：

- `plan_traffic_limit`
- `plan_traffic_limit_text`
- `referral_traffic_limit`
- `referral_traffic_limit_text`
- `total_traffic_limit`
- `total_traffic_limit_text`

前端展示优先使用新增字段，旧字段保留兼容。

## 用户端设计

### 首页

账户概览中流量展示改为：

```text
17.45 GB / 550 GB
套餐：550 GB + 推广：0 B
```

进度条按总可用流量计算。

### 我的页面

在“我的服务”上方新增“推广”卡片，包含：

- 推广链接输入框和复制按钮。
- 点击量。
- 已奖励推广流量。
- “查看详情”入口。

### 推广详情页

新增 `/user/referral` 页面，展示：

- 推广链接。
- 点击量。
- 奖励总量。
- 奖励明细表：被推广用户邮箱、订单号、奖励流量、付款时间。

## 管理端设计

### 系统设置

在系统设置页新增“推广配置”页签，配置推广奖励流量。表单以 GB 输入，后端保存为字节。

### 推广管理

新增 `/admin/referrals` 页面和左侧导航入口“推广管理”。

列表展示：

- 用户邮箱。
- 推广链接。
- 启用状态。
- 点击量。
- 奖励次数。
- 奖励总流量。
- 操作：查看详情、启用/禁用、重置链接。

详情展示该用户奖励明细。

## 错误处理

- 推广码无效或禁用：点击接口返回业务错误；注册接口忽略归因并继续正常下单。
- 奖励配置为 0：不写奖励，不影响支付完成。
- 重复支付回调：唯一约束拦截重复奖励，订单完成逻辑保持成功。
- 数据库错误：支付事务回滚，避免订单已支付但奖励或权益部分写入。

## 测试计划

后端新增测试脚本：

- `server/test/test-referral-service.js`

覆盖：

- 创建和获取推广码。
- 点击量统计。
- 注册下单写入推广人。
- 首单付款成功发放奖励。
- 重复回调不重复奖励。
- 续费不发放奖励。
- 禁用推广码后不再归因。
- 重置推广码后旧码失效。

前端验证：

- `client-user` 执行构建。
- `client-admin` 执行构建。

后端修改 `server/**/*.js` 后，完成时提醒用户重启服务器。

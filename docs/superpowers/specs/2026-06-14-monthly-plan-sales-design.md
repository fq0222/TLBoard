# 月卡套餐销售与不限时套餐隔离设计

## 目标

在不影响现有流量不限时套餐的前提下，新增可销售的月卡套餐能力。月卡属于限时套餐，用户可用性同时受流量和时间约束；现有不限时套餐继续保持当前购买、续费、禁用和同步语义。

## 硬性约束

- 现有不限时套餐逻辑不修改：不限时套餐仍以 `duration_days = 0` 表示，续费继续沿用当前“流量累加、到期时间不限期”的逻辑。
- 不限时套餐只新增“是否展示在未登录首页”的展示控制，不改变老用户登录后的续费能力。
- 限时套餐新增逻辑必须通过明确的套餐类型分支进入，不能让现有不限时套餐意外走限时重置逻辑。
- 读取和修改文件均使用 UTF-8，避免中文乱码。
- 生产敏感配置不写入 `ecosystem.config.js`。

## 当前实现背景

当前 `plans.duration_days = 0` 表示不限期套餐。用户端首页和续费弹窗都调用 `GET /api/user/plans`，因此只要套餐启用，就会同时出现在未登录首页和续费弹窗。

当前续费支付成功后，`server/services/shared/order-service.js` 对续费订单执行流量累加：

```text
newTrafficLimit = currentTrafficLimit + planTrafficLimit
```

到期时间按当前未过期时间顺延；不限时套餐保持 `expire_at = 0`。自动禁用当前只覆盖流量超限，时间到期主要用于状态展示，还没有独立的自动禁用原因和 3X-UI 禁用同步。

## 数据模型

在 `plans` 表新增两个字段：

```sql
plan_type VARCHAR(20) DEFAULT 'lifetime'
show_on_home INTEGER DEFAULT 1
```

字段语义：

- `plan_type = 'lifetime'`：不限时流量套餐。历史不限时套餐默认属于该类型。
- `plan_type = 'timed'`：限时套餐，例如 30 天月卡。
- `show_on_home = 1`：允许展示在未登录首页。
- `show_on_home = 0`：不展示在未登录首页，但仍可在符合续费条件时展示给老用户。

迁移策略：

- 新增幂等迁移脚本，使用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`。
- 现有历史套餐默认回填为 `plan_type = 'lifetime'`，避免误改当前不限时套餐语义。
- 月卡套餐由管理端创建或编辑时设置为 `timed`，并设置 `duration_days = 30`。

## 套餐展示

首页套餐列表继续使用 `GET /api/user/plans`，但查询条件改为：

```sql
enabled = 1 AND show_on_home = 1
```

续费新增专用接口：

```http
GET /api/user/renew/plans
```

续费套餐根据当前用户已购套餐类型过滤：

- 当前套餐为 `timed`：只展示启用的 `timed` 套餐。
- 当前套餐为 `lifetime`：只展示启用的 `lifetime` 套餐。

这样可以隐藏未登录首页的不限时套餐，同时保留不限时套餐用户的原有续费入口。

## 管理端套餐配置

`client-admin/src/views/Plans.vue` 增加：

- 套餐类型：不限时套餐 / 限时套餐。
- 首页展示：开关。

校验规则：

- `lifetime` 套餐必须保持 `duration_days = 0`。
- `timed` 套餐必须满足 `duration_days > 0`。
- 月卡套餐使用 `plan_type = 'timed'` 且 `duration_days = 30`。

管理端列表展示套餐类型和首页展示状态，方便运营确认哪些套餐会出现在首页。

## 续费规则

续费资格继续复用 `server/services/shared/renew-policy.js`，但增加套餐类型兼容校验：

- 当前套餐和目标套餐的 `plan_type` 必须一致。
- 管理员禁用用户仍不允许续费。
- 因流量用完或时间到期暂停的用户允许续费。

支付成功后的权益更新按套餐类型分支。

### 不限时套餐

不限时套餐保持现有逻辑：

- 流量上限继续累加。
- `expire_at` 继续为 `0`。
- 流量用完 3 天内续费当前套餐时，继续保持当前名额检查豁免语义。
- 解禁和 3X-UI 同步继续走现有续费流程。

本次实现不得修改不限时套餐的权益计算公式。

### 限时套餐

限时套餐续费采用重置语义：

- `traffic_used = 0`
- `traffic_limit = 目标套餐流量`
- `expire_at = 支付成功时间 + duration_days`
- `enabled = 1`
- `traffic_used_at = NULL`
- `disable_reason = NULL`

对于流量用完的用户，续费后从支付成功时间重新计算到期时间。

对于时间到期的用户，续费后重置流量并从支付成功时间重新计算到期时间。

对于流量和时间都未到期的用户，下单前必须提示剩余权益将被重置。后端要求前端提交 `confirm_reset = true` 才允许创建续费订单。

提示数据由后端返回，至少包含：

- 当前剩余流量。
- 当前剩余时间。
- 重置后的流量。
- 重置后的新到期时间。

## 到期与禁用

扩展禁用原因：

```js
EXPIRED: 'expired'
```

限时套餐禁用规则：

- 流量达到上限：沿用现有 `traffic_limit` 禁用路径。
- 当前时间达到 `expire_at`：新增到期禁用路径，将用户设置为 `enabled = 0`、`disable_reason = 'expired'`。

到期禁用应复用现有 `enqueueUserStatusSync()` / `xui_sync_tasks` 补偿机制，把 3X-UI 客户端同步为禁用。到期检查可以作为独立函数挂入现有流量同步定时任务，或新增轻量定时任务；实现时优先选择对现有流量同步影响最小的方式。

用户状态展示：

- `disable_reason = 'traffic_limit'`：显示“续费”或“流量用完”。
- `disable_reason = 'expired'`：显示“已到期”或“续费”。
- `disable_reason = 'admin'`：显示“禁用”，不允许续费。

订阅访问也需要校验 `expire_at`。如果限时套餐已到期，即使定时任务尚未执行，也不应继续返回可用节点内容。

## 3X-UI 同步

不限时套餐同步保持原逻辑：

- `expiryTime = 0`
- 流量上限使用累加后的总额度。

限时套餐同步使用重置后的用户状态：

- `expiryTime = expire_at * 1000`
- `totalGB` 使用重置后的套餐流量。
- `enabled` 根据本地 `users.enabled` 同步。

续费成功后仍使用持久化同步队列，避免 3X-UI 临时失败影响支付落账。

## 前端交互

首页：

- 只展示 `show_on_home = 1` 的启用套餐。
- 首页不需要知道被隐藏套餐的存在。

续费弹窗：

- 改为调用 `GET /api/user/renew/plans`。
- 根据后端返回的套餐类型展示文案。
- 不限时套餐继续说明“续费会累加流量”。
- 限时套餐说明“续费会重置流量和到期时间”。
- 当用户未用完限时套餐时，展示确认弹窗，列出剩余流量和剩余时间，确认后再提交 `confirm_reset = true`。

## 测试计划

后端：

- 套餐迁移脚本幂等执行。
- 首页套餐列表只返回 `show_on_home = 1` 的套餐。
- 续费套餐列表按当前用户 `plan_type` 过滤。
- 当前套餐和目标套餐类型不一致时拒绝续费。
- 不限时套餐续费仍然累加流量，`expire_at` 保持 `0`。
- 限时套餐续费重置 `traffic_used`、`traffic_limit` 和 `expire_at`。
- 未用完限时套餐续费时，缺少 `confirm_reset` 应返回确认提示。
- 时间到期用户会被设置为 `disable_reason = 'expired'` 并进入 3X-UI 禁用同步。
- `expired` 用户允许续费，`admin` 禁用用户仍不允许续费。
- 订阅接口对已到期限时用户拒绝返回节点内容。

前端：

- `client-user` 构建通过。
- `client-admin` 构建通过。
- 首页隐藏不限时套餐时不影响登录后续费弹窗展示。
- 限时套餐未用完续费时，确认弹窗正确展示剩余流量和剩余时间。

建议命令：

```bash
node server/test/test-traffic-manager.js
node server/test/test-user-onboarding.js
cd client-user && npx vite build --minify esbuild
cd client-admin && npx vite build --minify esbuild
```

如果实现新增专门测试脚本，应在完成时一并展示测试日志。

## 非目标

- 不迁移现有用户到月卡套餐。
- 不改变不限时套餐的计费、续费、流量累加和不限期语义。
- 不在每次订阅访问时同步 3X-UI 节点信息。
- 不修改生产敏感配置。

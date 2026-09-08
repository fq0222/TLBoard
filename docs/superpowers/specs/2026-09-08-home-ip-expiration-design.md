# 家宽 IP 套餐到期清理设计

## 目标

在现有“流量同步与禁用检查任务”中增加家宽 IP 套餐到期清理能力。家宽 IP 到期不禁用用户账号，也不检查 3X-UI 客户端是否存在；系统只根据 `users.home_expire_at` 判断权益是否到期，清理用户已配置的家宽 routing，清理成功后标记家宽状态为过期，并发送一次邮件提醒。

## 状态模型

在 `users` 表新增两个家宽专用字段：

- `home_status VARCHAR(20) DEFAULT 'normal'`：家宽权益状态，取值为 `normal` 或 `expired`。
- `home_expired_notice_sent_at BIGINT`：家宽过期提醒邮件发送时间，空值表示当前家宽权益周期尚未发送过过期邮件。

这两个字段独立于现有账号级 `enabled`、`disable_reason`、`renewal_notice_attempted_at` 和 `renewal_notice_reason`。流量套餐的超量/到期禁用继续使用现有字段；家宽 IP 到期只影响家宽 routing 和用户端家宽状态展示。

家宽套餐支付或续费成功后，`updateUserHomePlanAfterPaidOrder` 同步恢复：

- `home_plan_id = 新家宽套餐 ID`
- `home_expire_at = 新到期时间`
- `home_status = 'normal'`
- `home_expired_notice_sent_at = NULL`

这样新权益周期可以在下次过期时再次发送一封提醒邮件。

## 到期清理流程

新增 `server/services/shared/home-ip-expiration-service.js` 封装家宽 IP 到期清理。`server/services/shared/traffic-manager.js` 只在 `syncTrafficAndHandleDisable()` 末尾，紧跟现有 `checkAndDisableExpiredUsers(db)` 后调用该服务：

```javascript
await checkAndDisableExpiredUsers(db);
await homeIpExpirationService.cleanupExpiredHomeIpPlans(db);
```

独立服务执行以下流程：

1. 查询 `users.home_plan_id IS NOT NULL`、`home_expire_at <= now`、`home_status != 'expired'` 且存在 `user_home_proxy_routes` 的用户。
2. 对每个用户复用 `withUserStatusLock` 获取用户状态锁，避免与支付、手动修改 routing 并发冲突。
3. 不调用 3X-UI 用户查询接口，不判断用户客户端是否存在。
4. 使用家宽 IP 控制模块现有的 Xray 配置读写能力，按 `user_home_proxy_routes.server_ids` 到对应在线服务器的 routing 里删除当前用户邮箱。
5. 所有相关服务器删除成功后，删除 `user_home_proxy_routes` 本地绑定记录，并将 `users.home_status` 更新为 `expired`。
6. 删除失败时不标记过期，保留本地 route，下一轮任务继续重试。

远端清理语义与用户端“删除”按钮保持一致：共享 rule 中还有其他用户时只移除当前用户；当前用户是最后一个用户时删除整条 rule。远端原本已经没有对应用户时视为清理成功，因为目标状态已经达成。

## 邮件提醒

复用现有 `server/services/shared/renewal-required-email-service.js` 的发送结构、配额检查、超时控制和 email_logs 审计。新增家宽专用 reason，例如 `home_ip_expired`，并为该 reason 生成家宽套餐文案：

- 主题沿用“天澜大陆消息”风格。
- 正文展示账号、家宽套餐名、家宽到期时间。
- 不展示已用流量和流量上限，避免把家宽 IP 套餐误描述成流量套餐。

邮件只在 `home_expired_notice_sent_at IS NULL` 时发送一次。为了不让邮件失败导致定时任务无限发信，清理成功并标记过期后领取发送资格；无论发送成功、失败、超时或配额满，都写入 `home_expired_notice_sent_at = now`，表示本周期已经尝试提醒。

## 用户端展示

`GET /api/user/subscription/home-routing/options` 在家宽权益存在但已过期时仍返回家宽区域可展示所需的状态数据：

- `available` 用于控制是否展示家宽 IP 控制卡片；购买过家宽套餐时应能看到状态提示。
- `home_status` 返回 `normal` 或 `expired`。
- `home_status_text` 返回 `正常` 或 `过期`。
- `route` 在清理成功后为空；清理失败且本地绑定仍存在时继续返回 route，并显示过期状态，提醒用户当前套餐已过期。

用户端订阅页“家宽 IP 控制”列表的 PC 表格和移动端卡片都增加状态标记。状态为过期时，添加、修改、删除按钮禁用，并提示用户先续费家宽 IP 套餐。

## 测试策略

后端增加针对家宽到期清理的服务测试：

- 未到期用户不会被处理。
- 到期且 routing 删除成功时，删除本地 route，写入 `home_status='expired'`，并触发一次邮件。
- 删除失败时不标记过期、不发送邮件，保留 route 等待下轮重试。
- 已经标记过期或已经尝试过提醒的用户不会重复发送邮件。
- 家宽套餐支付成功后恢复 `home_status='normal'` 并清空 `home_expired_notice_sent_at`。

前端执行用户端构建验证状态字段渲染不会破坏订阅页。

## 非目标

- 不禁用整个账号。
- 不修改流量套餐的超量禁用、限时套餐到期禁用和续费提醒逻辑。
- 不新增管理端页面。
- 不在每次访问订阅接口时执行远端清理，只通过现有定时任务处理。

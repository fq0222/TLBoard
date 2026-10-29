# 支付订单并发完结修复设计

> 日期：2026-10-29
> 状态：按用户确认的最小范围收缩
> 范围：VMQ 回调与主动查单同时调用 completePaidOrder 的竞态

## 目标与根因

保留两个支付确认入口。当两个调用都读到同一订单的 pending 快照时，只允许一个调用更新套餐权益、支付次数和推广奖励，并继续原有邮件发送与 3X-UI 入队流程。

原实现先在事务外读取状态，事务内无条件把订单改为 paid。两个调用可先后完成更新，导致同一次支付被重复处理。

## 实现

订单仓储返回实际影响行数：

```sql
UPDATE orders
SET status = 'paid', trade_no = ?, paid_at = ?
WHERE out_trade_no = ? AND status = 'pending'
RETURNING id
```

普通套餐与家宽套餐事务都先执行该更新：

- changes 为 1：取得处理权，继续原有套餐落库、奖励和提交后流程。
- changes 为 0：不更新用户、不发奖励、不登记提交后回调；事务结束后回读订单，返回 `{ handled: false, reason: 'order_not_pending', order }`。

既有已支付状态的提前返回保持不变。余额支付继续使用原有外层事务与 deferEffects，不修改扣款或权益计算规则。

查单入口只在 handled=true 时直接报告 paid；handled=false 时使用回读状态，可能是 paid 或 expired。VMQ 回调仍确认收到有效通知并返回 success；handled=false 时记录原因，不误报为已完成处理。

邮件服务、原 enqueueTask、同步重试、任务清理及数据库表结构保持修复前行为。本方案无需数据库迁移。

## 验证

保留一个直接并发调用 completePaidOrder 的确定性回归：用屏障让两个调用先取得 pending 快照，再执行真实仓储 SQL；旧无条件更新必须导致两次权益更新，条件更新后只能有一次权益更新、支付计数、奖励、邮件发送和同步入队。

另验证查单与回调正确处理 handled=false；运行既有订单、推广奖励、月套餐、XUI 和邮件脚本。月套餐已有的 3 个订阅失败单独报告，不改变其断言。

不创建分支或 worktree，不启动服务器，不执行真实数据库操作，不 push。交付完整测试日志；部署后由用户重启后端。

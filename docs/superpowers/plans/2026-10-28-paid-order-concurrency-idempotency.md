# 支付订单并发完结修复实施计划

> 日期：2026-10-29
> 实施依据：[最小设计](../specs/2026-10-28-paid-order-concurrency-idempotency-design.md)

目标：只解决 VMQ 回调与主动查单并发处理同一 pending 订单时的重复落库及重复副作用。

## 改动范围

- server/repositories/order-repository.js：订单条件更新并返回 changes。
- server/services/shared/order-service.js：两类套餐事务先取得处理权，失败则回读退出。
- server/services/user/orders-service.js：根据完结结果返回实际状态。
- server/services/user/payment-service.js：根据 handled 记录准确日志。
- server/test/test-paid-order-concurrency.js：并发调用及查单状态回归。
- 既有月套餐、推广奖励、支付测试：仅适配返回值并覆盖入口结果。

## 步骤

1. 编写直接并发回归，使用真实订单仓储 SQL、可控读取屏障和事务替身；外部依赖只记录调用。对旧无条件更新运行，观察权益更新次数为 2 的失败。
2. 在订单更新中加入 status='pending' 条件并返回影响行数。普通套餐与家宽套餐事务仅在 changes=1 时继续。
3. 未取得处理权的调用返回 handled=false、order_not_pending 和回读订单，不执行或登记副作用；保留原有套餐、奖励、邮件和 enqueueTask 流程。
4. 查单按回读状态响应；VMQ 有效通知继续返回 success，并对未处理结果记录原因。
5. 运行以下脚本并保存完整日志；月套餐只允许原有 3 项订阅失败。

```powershell
node server/test/test-paid-order-concurrency.js
node server/test/test-user-payment-service.js
node server/test/test-user-orders-privacy.js
node server/test/test-referral-service.js
node server/test/test-monthly-plan-sales.js
node server/test/test-order-xui-sync.js
node server/test/test-xui-sync-task-service.js
node server/test/test-xui-sync-task-job.js
node server/test/test-xui-sync-task-cleanup.js
node server/test/test-clean-xui-sync-tasks-job.js
node server/test/test-email-service-retry.js
node server/test/test-renewal-required-email.js
git diff --check
```

6. 核对最终差异只包含上述范围与本设计/计划；本地家宽和用户状态测试不纳入 Git，但磁盘文件保留。
7. 以中文提交本地修改，展示测试日志并提醒用户重启后端。无需新增数据库迁移，不启动服务器、不 push、不创建分支或 worktree。

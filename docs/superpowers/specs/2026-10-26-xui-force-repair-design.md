# 3X-UI 巡检强制修复设计

## 意图

修复 3X-UI 3.4.2 在编辑 Reality 入站后，`inbounds.settings` 中客户端 `password` 被清空，而六小时巡检虽然报告同步成功却未实际调用 `/clients/update/:email` 的问题。

## 目标与约束

- 六小时巡检仅在 inbound 快照与本地期望不一致时强制重写服务器级客户端。
- `upsertServerClient()` 继续在服务器客户端锁内调用 `/clients/get/:email`，保留新增、更新、关联和写后核验能力。
- 购买、续费、管理端编辑、禁用/解禁及凭证轮换等其他调用方不传强制参数，保持现有按差异更新行为。
- 不记录 UUID、password、auth、subId 等凭证明文。
- 不改变 3X-UI 3.4.2 以下版本的同步路径。
- canonical 原本一致的强制修复如果写结果未知，必须返回可重试失败；再次查询 canonical 不能证明 inbound 投影已被重写。

## 方案

考虑过三种方式：外层改用 clients API 比较、增加无读取的直接 update 方法、为现有 upsert 增加强制更新语义。前两者分别无法恢复 inbound 投影、以及会绕过锁内权威读取并带来并发覆盖风险。

采用第三种方式：`upsertServerClient(payload)` 新增默认关闭的 `forceUpdate` 参数。当客户端已存在时，更新条件为 `forceUpdate || shouldUpdateClient(...)`；六小时巡检在已经确认 inbound 快照不一致后传入 `forceUpdate: true`。不存在的客户端仍走 add，缺失的 inbound 仍走 attach。

## 成功标准

- canonical client 已与期望一致时，普通 upsert 不调用 update。
- 同一场景传入 `forceUpdate: true` 时必须调用 update，并返回可识别的修复动作。
- 强制修复的 update 抛出网络异常时不能依据修复前已一致的 canonical 状态误报成功。
- 六小时巡检的一致用户不调用 upsert；不一致用户调用时携带 `forceUpdate: true`。
- 相关后端测试全部通过。

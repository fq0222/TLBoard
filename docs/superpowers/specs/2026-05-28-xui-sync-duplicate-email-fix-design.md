# 3X-UI 同一 Inbound 重复 Email 修复设计

> 日期：2026-05-28
> 状态：待评审
> 范围：只修复“同一 inbound 出现重复 email 导致 xray 异常”的 bug，不包含差异更新优化

## 一、问题定义

### 1.1 Bug 现象

某些情况下，系统向 3X-UI 同步用户时，会在**同一个 inbound** 下写入两条 `email` 相同的客户端记录。

3X-UI / xray 对同一 inbound 下的重复 email 容忍度很差，出现重复后可能导致：

- 节点配置解析异常
- xray 无法正常加载该 inbound
- 用户订阅可见但部分节点不可用

### 1.2 本次设计的目标

本设计只解决以下问题：

1. 防止系统后续继续写入同一 inbound 的重复 email
2. 当 3X-UI 中已经存在重复 email 脏数据时，能够自动修复
3. 覆盖所有现有同步入口，避免只修一条路径

本设计**不包含**以下内容：

- 不做“无差异跳过更新”优化
- 不调整订阅策略、CF/direct 策略逻辑
- 不改动前端页面或用户交互

---

## 二、现状与根因

### 2.1 当前同步入口

当前至少存在两类会写入 3X-UI 客户端的入口：

1. `server/services/order-service.js`
   - `syncUserToXuiServers()`
   - 用于支付成功、续费后立即同步用户

2. `server/jobs/index.js`
   - `syncUsersToServer()`
   - 用于定时巡检、补齐缺失用户、修正 `sub_id` / `flow` 等字段

此外，`xui_sync_tasks` 重试队列也会再次触发用户同步逻辑。

### 2.2 当前实现的关键事实

现有 `syncUserToXuiServers()` 并不是“直接 add 不做检查”，它已经会先调用 `getClientByEmail()`，存在则 `updateClient()`，不存在则 `addClient()`。

因此，原来的“缺少存在性检查”并不是完整根因。

### 2.3 更接近真实情况的根因

结合现有代码，重复 email 更可能来自以下几类问题叠加：

1. **写入路径分散**
   - 支付同步、定时同步、失败重试分散在不同入口
   - 入口之间没有统一的“唯一化写入”约束

2. **互斥范围不足**
   - 如果仅使用进程内 `Set` 锁，只能防单 Node 进程内的并发
   - 无法覆盖定时任务、队列重试、未来多实例部署

3. **脏数据没有自愈**
   - 一旦某个 inbound 已经出现两条相同 email
   - `getClientByEmail()` 只会命中其中一条
   - 后续 `updateClient()` 只更新其中一条，另一条重复记录仍然保留
   - 结果是 bug 已经发生后，普通同步流程无法把它修掉

4. **唯一约束不在写入层**
   - 当前调用方自己决定“查存在还是新增”
   - 但真正了解 3X-UI 当前 inbound 内有哪些客户端的，是服务层
   - 唯一性校验放在调用方，容易遗漏，也难统一修复重复数据

### 2.4 关键结论

要真正修掉这个 bug，必须把“同一 inbound 下 email 唯一”的约束**收口到统一写入层**，并在写入前先做**重复检测与清理**。

---

## 三、设计目标

### 3.1 目标

1. 所有新增/更新 3X-UI 客户端的逻辑，都走同一个统一入口
2. 写入前先检查目标 inbound 下该 email 是否：
   - 不存在
   - 只存在一条
   - 存在多条重复
3. 如果存在多条重复，先修复重复，再执行最终写入
4. 修复逻辑以本地数据库 `user_node_configs` 为主，尽量保留正确 UUID / `sub_id`
5. 任何同步入口都不再直接自己判断后调用 `addClient()` / `updateClient()`

### 3.2 非目标

1. 不做跨 inbound 的 email 去重
   - 因为“不同 inbound 下同 email 共存”本来就是合法业务场景

2. 不尝试修复“email 命名规则本身改变”导致的历史兼容问题
   - 例如以前 remark 改名造成旧 email 残留
   - 这属于另一个迁移问题，本设计不扩散范围

---

## 四、推荐方案

### 4.1 核心思路

新增一个统一的 3X-UI 客户端“唯一化写入”入口，例如：

- 位置建议：`server/services/xui-service.js`
- 入口形态建议：新增高层方法，由它内部协调“查重、去重、创建、更新”

建议新增的方法职责如下：

1. 根据 `inboundId + email` 读取该 inbound 当前所有匹配客户端
2. 根据本地 `user_node_configs` 判断哪一条才是“应该保留的目标客户端”
3. 如果发现重复：
   - 删除多余重复项
   - 仅保留目标客户端
4. 若保留项存在，则执行更新
5. 若一条都不存在，则执行新增

这个入口对调用方表现为“幂等同步”：

- 调用方不需要关心目标用户是否已存在
- 调用方不需要关心是否有重复脏数据
- 调用方只提供“我希望最终在 3X-UI 里看到的用户状态”

### 4.2 为什么不选“只加锁”

只加锁无法解决两个核心问题：

1. 已经存在的重复记录不会消失
2. 多入口、多任务、多实例场景下锁的覆盖不完整

所以锁最多只能作为辅助保护，不能作为主方案。

### 4.3 为什么不选“只在调用方补判断”

因为调用方只能看到“我要同步谁”，看不到 3X-UI inbound 内完整状态，也不知道现在是不是已经有 2 条、3 条重复记录。

调用方适合表达业务意图，不适合承担最终唯一性收敛职责。

---

## 五、详细设计

### 5.1 新增统一查询方法

**文件：** `server/services/xui-service.js`

新增一个专门的方法，用于读取某个 inbound 下指定 email 的**全部匹配客户端**，而不是只返回第一条：

建议新增：

- `getClientsByEmail(inboundId, email)`

返回结构建议：

```javascript
{
  success: true,
  clients: [
    {
      uuid: '...',
      email: '...',
      enable: true,
      expiryTime: 0,
      totalGB: 0,
      subId: '...',
      flow: '...'
    }
  ]
}
```

保留现有 `getClientByEmail()`，但内部可以基于 `getClientsByEmail()` 实现，继续兼容旧调用。

### 5.2 新增统一写入方法

**文件：** `server/services/xui-service.js`

建议新增一个更高层的入口，例如：

- `upsertUniqueClient(inbound, email, desiredClient, options = {})`

它的职责不是简单“add 或 update”，而是：

1. 查询该 inbound 下 `email` 的全部匹配客户端
2. 判断是否存在重复
3. 选定保留项
4. 删除重复项
5. 最后执行新增或更新

### 5.3 保留项选择规则

**文件：**

- `server/services/xui-service.js`
- `server/services/order-service.js`
- `server/jobs/index.js`

为了避免误删正确 UUID，本地数据库要参与“保留哪条”的决策。

规则建议如下：

1. 如果 `user_node_configs` 中存在 `(user_id, server_id, inbound_id)` 对应记录：
   - 优先保留 UUID 与 `user_node_configs.uuid` 相同的那条

2. 如果本地没有配置，但重复客户端中存在唯一一条带有合理 `subId` / `flow` / 非空字段：
   - 暂不依赖复杂启发式判断
   - 默认保留第一条，删除其余条目
   - 同时把保留项 UUID / `subId` 写回本地 `user_node_configs`

3. 如果本地有配置，但 3X-UI 中没有 UUID 匹配项：
   - 保留第一条重复项
   - 用保留项 UUID 回填/修正本地 `user_node_configs`
   - 再对其执行更新，使数据库和 3X-UI 重新对齐

这一原则的核心是：

- **优先以本地映射为准**
- 如果本地映射失效，就以“保留一条并重新对齐本地”作为降级策略

### 5.4 去重修复流程

统一写入前，如果 `getClientsByEmail()` 返回多条：

1. 选定保留客户端
2. 对其余重复项逐条调用删除接口
3. 删除完成后再次读取一次，确认只剩 1 条
4. 若仍大于 1 条，则本次同步失败，进入重试队列

这样做的原因：

- 去重必须是显式步骤
- 不能假设一次删成功
- 不能边删边更新后直接认为系统已修复

### 5.5 支付同步入口改造

**文件：** `server/services/order-service.js`

`syncUserToXuiServers()` 不再自己写：

- `getClientByEmail()`
- `addClient()`
- `updateClient()`

而是统一改为：

1. 准备目标客户端配置
2. 调用 `upsertUniqueClient(...)`

这样支付成功、续费后的同步会自动带上“查重 + 去重 + 最终写入”能力。

### 5.6 定时同步入口改造

**文件：** `server/jobs/index.js`

`syncUsersToServer()` 当前既会补新增，也会修正 `sub_id`、`flow`、流量和到期时间。

这一入口也必须改为统一调用 `upsertUniqueClient(...)`，否则会出现：

- 支付同步走新逻辑
- 定时同步还走旧逻辑
- 结果仍然可能重新写出重复数据

这一步是本设计和旧方案最大的区别之一：**覆盖所有写入入口，而不是只修一个函数。**

### 5.7 本地配置修复策略

**文件：** `server/services/order-service.js` 或提取公共辅助函数

当检测到 3X-UI 中存在重复，或发现本地 `user_node_configs` 与 3X-UI 现状不一致时，需要允许同步逻辑修正本地配置。

原则如下：

1. 本地配置存在且匹配到保留项：
   - 不改 UUID
   - 只在必要时补 `sub_id`

2. 本地配置不存在：
   - 以保留项 UUID 为准新建 `user_node_configs`

3. 本地配置存在但 UUID 已失效：
   - 更新为保留项 UUID
   - 记录日志，说明发生了一次“本地映射重对齐”

### 5.8 失败与重试

重复去重流程不能“部分成功就算成功”。

以下情况应视为失败并进入现有重试队列：

1. 查询 inbound 失败
2. 删除重复项有任意一步失败
3. 删除后再次查询仍发现多条重复
4. 最终新增/更新失败

这样可以复用现有 `xui_sync_tasks` 的补偿机制，不需要额外引入新的后台任务体系。

---

## 六、流程图

```text
调用方（支付同步 / 定时同步 / 重试任务）
  -> 构建目标客户端配置
  -> upsertUniqueClient(inbound, email, desiredClient, context)
     -> getClientsByEmail(inboundId, email)
     -> 匹配数量 = 0
        -> addClient
     -> 匹配数量 = 1
        -> updateClient
     -> 匹配数量 > 1
        -> 结合 user_node_configs 选择保留项
        -> 删除其他重复项
        -> 再次查询确认只剩 1 条
        -> updateClient
     -> 若本地映射缺失或失效
        -> 修正 user_node_configs
  -> 返回成功/失败
```

---

## 七、改动文件建议

### 7.1 必改文件

1. `server/services/xui-service.js`
   - 新增 `getClientsByEmail()`
   - 新增 `upsertUniqueClient()`
   - 保留兼容 `getClientByEmail()`

2. `server/services/order-service.js`
   - `syncUserToXuiServers()` 改为调用统一写入入口
   - 提取或复用本地节点配置对齐逻辑

3. `server/jobs/index.js`
   - `syncUsersToServer()` 改为调用统一写入入口

### 7.2 建议新增测试文件

1. `server/test/test-xui-unique-client-sync.js`
   - 覆盖统一写入入口的核心分支

2. 如需更细粒度，也可补：
   - `server/test/test-xui-service.js`
   - `server/test/test-xui-sync-task-service.js`

---

## 八、测试设计

### 8.1 必测场景

1. **不存在目标 email**
   - 期望：创建 1 条新客户端

2. **仅存在 1 条目标 email**
   - 期望：更新该客户端，不新增第二条

3. **同一 inbound 存在 2 条重复 email，且本地 UUID 能匹配其中一条**
   - 期望：保留匹配 UUID 的那条，删除另一条，最终只剩 1 条

4. **同一 inbound 存在 2 条重复 email，但本地 UUID 已失效**
   - 期望：保留 1 条，删除其余条目，并回写本地 `user_node_configs`

5. **删除重复项失败**
   - 期望：本次同步返回失败，交给 `xui_sync_tasks` 重试

6. **支付同步入口**
   - 期望：走统一写入入口，不再自己分支 add/update

7. **定时同步入口**
   - 期望：也走统一写入入口，避免旧逻辑绕过修复

### 8.2 可接受的验证方式

优先使用“假 3X-UI 响应 + 内存态客户端列表”做单元/脚本测试，验证：

- 查询结果
- 删除调用顺序
- 最终剩余客户端数量
- 本地 `user_node_configs` 的更新结果

这样比依赖真实 3X-UI 面板更稳定，也更适合复现重复脏数据场景。

---

## 九、风险与边界

### 9.1 风险

1. 如果误判保留项，可能导致用户 UUID 被切换
2. 删除重复项属于真实外部副作用，必须严格记录日志
3. 若 3X-UI 接口在删除后存在短暂延迟，二次查询可能读到旧数据，需要考虑重试或短轮询

### 9.2 风险控制

1. 优先使用 `user_node_configs.uuid` 选保留项
2. 删除前后都打印结构化日志：
   - server
   - inbound
   - email
   - 保留 UUID
   - 删除 UUID 列表
3. 删除后增加一次确认查询
4. 只有确认唯一化完成后，才执行最终更新

---

## 十、预期结果

实施完成后，系统应达到以下效果：

1. 同一 inbound 下不会再被系统正常流程写出重复 email
2. 已存在的重复 email 脏数据，在后续同步时可被自动修复
3. 支付同步、定时同步、失败重试使用同一套唯一化写入逻辑
4. 即使 bug 再次被外部因素触发，系统也具备自愈能力

---

## 十一、与旧方案的区别

相较于旧版“同步锁 + 差异更新”文档，本方案的差异如下：

1. 不再把重点放在“减少无意义更新请求”
2. 不假设根因只是“没有 exists-check”
3. 不只修改 `order-service.js`
4. 把“重复检测与清理”视为必须的修复步骤
5. 明确要求覆盖支付同步、定时同步和重试队列三类入口

这更符合当前代码现状，也更有机会真正修掉 bug。

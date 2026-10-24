# 用户订阅凭证轮换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户更换公开订阅链接时，原子轮换每台 3X-UI 3.4.2+ 服务器的客户端凭证，并通过按服务器渐进更新和持久化重试保持订阅持续可用。

**Architecture:** 新增 `SubscriptionCredentialRotationService` 负责本地事务、服务器级远端同步及任务编排；新增专用仓储集中处理 PostgreSQL 行锁、advisory lock 和事务 SQL。轮换任务与新 token/凭证同事务写入，提交后立即执行；成功服务器刷新并替换自己的缓存节点，失败服务器保留旧节点并由独立任务读取最新本地凭证继续重试。

**Tech Stack:** Node.js 20、Express、PostgreSQL、现有 3X-UI service、Vue 3、Element Plus、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-24-subscription-credential-rotation-design.md`

## Global Constraints

- 使用简体中文编写新增注释、用户提示和提交信息。
- 仅支持 3X-UI 3.4.2 及以上版本；不扩展旧版轮换行为。
- 公开 token 与 `uuid/auth/password` 更新、本地缓存基线迁移和任务创建必须使用同一专用 PostgreSQL 事务连接。
- `user_node_configs.sub_id` 作为 3X-UI 3.4.2+ 服务器级 client 属性：同服务器已有一致值时保持不变，补行 canonical 优先选择 active inbound 配置，只有 active 全无时才回退历史配置、整台服务器无配置时才生成内部 `sub_id`；历史不一致值不得静默覆盖远端。
- 远端失败不能让接口整体失败，不能删除或改写该服务器的旧最终节点缓存。
- 任务 payload 和日志禁止包含公开 token、`sub_id`、`uuid`、`auth`、`password` 或带凭证的完整 URL。
- 不创建或切换分支、不创建 worktree；直接使用当前分支。
- 未得到用户明确提交授权前，不执行 `git add`/`git commit`；各任务给出的中文提交信息仅作为获授权后的建议。
- 修改 `server/**/*.js` 后不自行启动服务器，交付时提醒用户重启。

## Review Focus

- 同一用户并发请求：只有第一个事务通过，第二个得到 HTTP 429 和准确 `Retry-After`；Task 2、Task 5 覆盖。
- 进程在本地事务提交后退出：pending 轮换任务已经存在，不会丢失远端补偿；Task 2 覆盖。
- 某台服务器无本地 inbound 快照或配置不完整：旧缓存保留，补齐配置仍遵循本地先于远端；Task 2、Task 3 覆盖。
- 两个历史轮换任务处理不同服务器且执行顺序交错：缓存不会丢失更新或复活旧 token；Task 3、Task 4 覆盖。
- 原始订阅刷新在远端更新成功后失败：该服务器仍按失败处理并保留旧最终节点，下一轮可安全重复同步；Task 3 覆盖。

---

## 文件结构

- Create: `server/db/migrations/035-subscription-credential-rotation.js` — 幂等增加用户轮换时间字段。
- Modify: `server/db/schema/tables.js` — 新数据库初始化时包含相同字段。
- Create: `server/repositories/subscription-credential-rotation-repository.js` — 轮换事务、锁、凭证碰撞检查、配置补齐、缓存基线和任务写入。
- Create: `server/services/shared/xui-server-credential-service.js` — 供轮换和普通首次同步共同使用的服务器级唯一凭证生成类。
- Create: `server/services/user/subscription-credential-rotation-service.js` — 轮换编排类及服务器级同步处理。
- Modify: `server/services/shared/order-service.js` — 普通 3X-UI 3.4.2+ 客户端首次建档复用同一服务器锁和唯一凭证生成规则。
- Modify: `server/services/user/subscription-service.js` — 提供成功服务器来源刷新和按 `server_id` 合并缓存的公开接口；旧 `replaceSubscriptionLink` 改为委托新服务。
- Modify: `server/integrations/xui/xui-sync-task-service.js` — 新任务类型及轮换任务失败服务器 payload 收缩。
- Modify: `server/jobs/handlers/sync-xui-tasks.js` — worker 分发轮换任务。
- Modify: `server/controllers/user/subscription-controller.js` — 新结果结构、部分失败信息和冷却响应头。
- Modify: `client-user/src/views/user/Profile.vue` — 风险文案、处理中说明、部分同步提示。
- Create: `server/test/test-subscription-credential-rotation-migration.js` — 迁移契约测试。
- Create: `server/test/test-subscription-credential-rotation-service.js` — 本地事务、远端隔离、缓存合并和幂等测试。
- Modify: `server/test/test-xui-server-client-order-sync.js` — 普通首次同步与轮换并发时的唯一性回归测试。
- Modify: `server/test/test-user-subscription-service.js` — 入口委托及缓存渐进替换回归测试。
- Modify: `server/test/test-xui-sync-task-service.js` — 专用任务不被取代及 payload 收缩测试。
- Modify: `server/test/test-xui-sync-task-job.js` — worker 分发测试。
- Create: `server/test/test-user-subscription-controller.js` — HTTP 429、成功响应和 pending 元数据测试。
- Create: `client-user/component-tests/profile-subscription-replacement.component.spec.js` — 用户提示与响应处理测试。

---

### Task 1: 数据库字段与轮换仓储骨架

**Files:**
- Create: `server/db/migrations/035-subscription-credential-rotation.js`
- Modify: `server/db/schema/tables.js`
- Create: `server/repositories/subscription-credential-rotation-repository.js`
- Create: `server/test/test-subscription-credential-rotation-migration.js`

**Interfaces:**
- Produces: `up(dbOrPool)` 幂等迁移入口。
- Produces: `withRotationTransaction(db, userId, handler)`，向 handler 传入同一 `pg` client 与锁定后的用户。
- Produces: `listRotationTargets(client, userId)`、`findCredentialCollision(client, serverId, userId, credentials)`、`upsertServerConfigs(client, payload)`、`replacePublicTokenAndBaseline(client, payload)`、`insertRotationTask(client, payload)`。
- Consumes: `db.pool.connect()`；所有事务内查询只使用 `client.query()`。

- [ ] **Step 1: 写迁移失败测试**

  在 `test-subscription-credential-rotation-migration.js` 断言 `up()` 使用 `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_credentials_rotated_at BIGINT`，重复执行不会失败；同时读取 `schema/tables.js` 并断言新建 `users` 表包含该字段。

- [ ] **Step 2: 运行迁移测试确认失败**

  Run: `node server/test/test-subscription-credential-rotation-migration.js`
  Expected: FAIL，提示迁移文件或字段不存在。

- [ ] **Step 3: 实现迁移与初始化字段**

  新迁移导出 `up`、`upWithDbProxy`、`upWithPool`，遵循现有迁移的 BEGIN/COMMIT/ROLLBACK/release 模式；在 `users` 建表 SQL 加入 nullable BIGINT 字段。

- [ ] **Step 4: 写仓储事务测试替身并定义精确 SQL 契约**

  覆盖：用户行使用 `FOR UPDATE`；冷却检查和所有更新共享同一 client；服务器 advisory xact lock 按 ID 升序获取；碰撞查询只匹配相同 `server_id`、排除当前 `user_id`、分别检查三个非空字段；任务插入发生在 COMMIT 前；异常执行 ROLLBACK。

- [ ] **Step 5: 实现轮换仓储方法**

  `withRotationTransaction(db, userId, handler)` 负责连接生命周期；其他方法只接受该 client，不得退回 `db.prepare()`。`upsertServerConfigs` 保持已有 `sub_id`，补行时接收调用方给定的 canonical `subId`。

- [ ] **Step 6: 运行 Task 1 测试**

  Run: `node server/test/test-subscription-credential-rotation-migration.js`
  Expected: PASS，并打印迁移和事务仓储断言通过。

- [ ] **Step 7: 提交（仅在用户明确授权时）**

  Suggested: `git commit -m "新增订阅凭证轮换数据基础"`

---

### Task 2: 本地原子轮换与一小时限制

**Files:**
- Create: `server/services/user/subscription-credential-rotation-service.js`
- Create: `server/services/shared/xui-server-credential-service.js`
- Modify: `server/services/shared/order-service.js`
- Create: `server/test/test-subscription-credential-rotation-service.js`
- Modify: `server/test/test-xui-server-client-order-sync.js`
- Modify: `server/repositories/subscription-credential-rotation-repository.js`

**Interfaces:**
- Produces: `class SubscriptionCredentialRotationService`。
- Produces: `class XuiServerCredentialService`，其中 `generateUniqueCredentials(client, serverId, userId)` 是轮换与普通首次同步的唯一生成入口。
- Produces: `prepareRotation(db, userId): Promise<{taskId:number, subId:string, user:Object, serverIds:number[], serverNames:string[]}>`。
- Produces: `generateUniqueServerCredentials(client, serverId, userId): Promise<{uuid:string,password:string,auth:string}>`。
- Produces: 冷却业务错误 `{isLegacyBusinessError:true,statusCode:429,code:429,retryAfter:number}`。
- Consumes: Task 1 仓储接口、`generatePublicSubscriptionId()`、`generateXuiAuth()`。

- [ ] **Step 1: 写本地轮换失败测试**

  测试名称和核心断言：
  - `testPrepareRotationUpdatesTokenCredentialsBaselineAndTaskAtomically`：COMMIT 前已写新 token、每服务器统一三字段、旧节点基线和包含全部 `serverIds` 的任务，已有 `sub_id` 未变。
  - `testMissingInboundConfigsAreFilledFromSnapshots`：部分缺行复用 canonical `sub_id`；整台无配置生成一个内部 `sub_id`。
  - `testMissingSnapshotKeepsServerInTaskWithoutInventingConfigs`：无快照服务器仍在任务目标中，但不插入虚构 inbound。
  - `testCredentialCollisionRegeneratesWholeTriple`：同服务器任一字段碰撞便整组重生；其他服务器相同值不冲突。
  - `testLegacyCacheWithoutServerIdRejectsBeforeCooldownIsConsumed`：真实节点缺少有效 `server_id` 时回滚并给出“先重新生成订阅”错误。

- [ ] **Step 2: 运行服务测试确认失败**

  Run: `node server/test/test-subscription-credential-rotation-service.js`
  Expected: FAIL，提示 service 或方法不存在。

- [ ] **Step 3: 实现 `prepareRotation` 最小闭环**

  构造函数显式接收 repository、随机生成器和 `nowSeconds` 便于测试。方法在 Task 1 事务中依次完成缓存校验、冷却校验、固定顺序服务器锁、唯一凭证生成、缺行补齐、token/时间/基线更新、`credential_rotation_sync` 任务插入，然后返回提交后的任务信息。

- [ ] **Step 4: 写并发与失败测试**

  - `testConcurrentRotationOnlyFirstPassesCooldown`：模拟两个请求锁等待后，第二个读取最新时间并返回 429。
  - `testCooldownReturnsRemainingSeconds`：3599 秒时 `retryAfter === 1`，未满整小时按剩余秒数返回。
  - `testTransactionFailureDoesNotConsumeCooldownOrCreateTask`：任一写入失败后 ROLLBACK，无远端调用。
  - `testPublicTokenCollisionRetriesOnlyTokenGeneration`：唯一冲突重新生成 token，不重复改变已选服务器凭证。

- [ ] **Step 5: 实现冷却、冲突重试和安全日志**

  冷却时间从事务成功时记录；捕获 PostgreSQL token 唯一冲突时有限重试；日志只使用 user/server/task 标识，不打印凭证值。将服务器锁内的三字段生成与碰撞重试放入 `XuiServerCredentialService`，轮换服务调用该类而不复制算法。

- [ ] **Step 6: 写并运行普通首次同步唯一性回归测试**

  在 `test-xui-server-client-order-sync.js` 增加 `testInitialSyncAndRotationShareServerCredentialLock`：模拟普通首次建档与轮换并发，断言二者串行检查且最终不同用户的三个字段均不重复；已有本地配置路径仍原样复用，不意外轮换。

  修改 `ensureServerNodeConfigs()` 的“本地无配置且需要生成/收编远端凭证”分支，使其通过共享服务和相同服务器级锁完成碰撞检查与本地写入；已有配置的普通续费路径不进入生成流程。

  Run: `node server/test/test-xui-server-client-order-sync.js`
  Expected: PASS。

- [ ] **Step 7: 运行 Task 2 测试**

  Run: `node server/test/test-subscription-credential-rotation-service.js`
  Expected: PASS，本地轮换、并发和回滚用例全部通过。

- [ ] **Step 8: 提交（仅在用户明确授权时）**

  Suggested: `git commit -m "实现订阅凭证本地原子轮换"`

---

### Task 3: 服务器隔离同步与渐进缓存替换

**Files:**
- Modify: `server/services/user/subscription-credential-rotation-service.js`
- Modify: `server/services/user/subscription-service.js`
- Modify: `server/repositories/subscription-credential-rotation-repository.js`
- Modify: `server/test/test-subscription-credential-rotation-service.js`
- Modify: `server/test/test-user-subscription-service.js`

**Interfaces:**
- Produces: `processRotationTask(db, task, logger): Promise<{success:boolean,message:string,successfulServerIds:number[],failedServerIds:number[]}>`。
- Produces: `syncServerWithLatestCredentials(db, userId, serverId, logger): Promise<{success:boolean,message:string}>`，每次调用重新读本地凭证。
- Produces: `refreshAndMergeRotatedServers(db, userId, serverIds, logger, options={}): Promise<{successfulServerIds:number[],failedServerIds:number[]}>`（从 `subscription-service.js` 导出）。
- Consumes: 现有 `XuiService.upsertServerClient()`、`refreshSubscriptionSources()`、`composeSubscriptionNodes()`、CF 优选与节点命名规则。

- [ ] **Step 1: 写服务器隔离失败测试**

  - `testRotationTaskReadsLatestCredentialsOnEveryRun`：任务 payload 无凭证，第二次执行使用测试期间更新后的数据库值。
  - `testOneServerFailureDoesNotStopOtherServers`：服务器 1 超时、服务器 2 成功，结果分别进入 failed/successful。
  - `testMissingLocalSnapshotBootstrapsLocallyBeforeRemoteWrite`：重试从远端只读获取 inbound 后，先提交本地配置，再调用 upsert。
  - `testRemoteFailurePreservesSourceAndFinalNodes`：远端失败不调用来源覆盖或删除函数。
  - `testSourceRefreshFailureDowngradesServerToFailed`：远端成功但来源拉取失败时保留旧最终节点并返回失败服务器。

- [ ] **Step 2: 运行服务测试确认失败**

  Run: `node server/test/test-subscription-credential-rotation-service.js`
  Expected: FAIL，提示远端处理方法不存在。

- [ ] **Step 3: 实现每服务器同步**

  只调用 3.4.2+ server client API；使用 canonical email 和数据库最新 `uuid/password/auth/sub_id`，同时带上最新启用状态、到期时间、总流量及 inbound IDs。3.4.2+ client 的 `subId/flow` 是服务器级属性，因此每台服务器只做一次全量 inbound upsert：本地 sub_id 不一致时安全失败；已有远端 client 保留其全局 flow；远端缺失时仅统一策略可推导 flow，混合 direct/CF 安全失败。通过现有 `(server_id,email)` 锁保护远端 upsert。网络或业务错误转换为单服务器结果，循环/并发聚合使用现有 `runWithConcurrency()`。

- [ ] **Step 4: 写渐进缓存失败测试**

  - `testMergeReplacesOnlySuccessfulServerNodes`：成功服务器全部旧节点被新节点替换，失败服务器节点对象深度相等地保留。
  - `testAllServersFailKeepsWholeBaselineUnderNewToken`：新 token 可访问且节点数组完全不变。
  - `testCacheMergeAlwaysUsesLatestUserToken`：任务带旧上下文时只写当前 `users.sub_id`。
  - `testInterleavedTasksDoNotLosePreviouslyMergedServer`：两任务交错更新服务器 1/2 后最终缓存同时为新版本。
  - `testAnnouncementsAndUnknownNonServerVirtualNodesArePreserved`：公告等明确的虚拟节点不被当成非法历史真实节点删除。

- [ ] **Step 5: 实现来源刷新和用户级锁内合并**

  先为远端成功服务器刷新来源并生成候选节点；只有来源和节点生成均成功的服务器进入替换集合。获得用户级 advisory lock 后重新读取当前 token 与当前缓存，按 `server_id` 删除替换集合的旧节点并加入新节点；其他节点保持原对象，最后写回当前 token。不得调用会预先清空失败服务器来源的通用路径。

- [ ] **Step 6: 运行 Task 3 与订阅回归测试**

  Run: `node server/test/test-subscription-credential-rotation-service.js`
  Expected: PASS。

  Run: `node server/test/test-user-subscription-service.js`
  Expected: PASS，现有生成、来源重试和订阅输出行为不回归。

- [ ] **Step 7: 提交（仅在用户明确授权时）**

  Suggested: `git commit -m "实现凭证同步与订阅缓存渐进更新"`

---

### Task 4: 持久化任务队列与 worker 接入

**Files:**
- Modify: `server/integrations/xui/xui-sync-task-service.js`
- Modify: `server/jobs/handlers/sync-xui-tasks.js`
- Modify: `server/test/test-xui-sync-task-service.js`
- Modify: `server/test/test-xui-sync-task-job.js`

**Interfaces:**
- Produces: `TASK_TYPES.CREDENTIAL_ROTATION_SYNC === 'credential_rotation_sync'`。
- Produces: 轮换任务重试 payload `{user_id:number,serverIds:number[]}`。
- Consumes: `SubscriptionCredentialRotationService.processRotationTask(db, task, logger)`。

- [ ] **Step 1: 写任务服务失败测试**

  - `testCredentialRotationTaskIsNotSupersededByUserSync`：创建普通 user sync 不改变 pending 轮换任务，反向亦然。
  - `testCredentialRotationRetryNarrowsTopLevelServerIds`：handler 返回 `[2,3]` 后 payload 只保留去重的 `[2,3]`，且没有凭证字段。
  - `testCredentialRotationFinalFailureKeepsTaskFailedWithoutCacheCleanup`：第十次失败仅标记 failed。

- [ ] **Step 2: 运行任务服务测试确认失败**

  Run: `node server/test/test-xui-sync-task-service.js`
  Expected: FAIL，缺少任务类型或 payload 仍按 `plan.serverIds` 处理。

- [ ] **Step 3: 实现任务类型和专用 payload 收缩**

  保持 `USER_SYNC_TASK_TYPES` 不包含轮换类型；将 `buildPartialRetryPayload()` 扩展为按任务类型选择顶层 `serverIds` 或原有 `plan.serverIds`，保持其他任务格式不变。

- [ ] **Step 4: 写 worker 分发失败测试**

  断言轮换任务调用 `processRotationTask`；用户不存在时安全结束；部分失败由 `processTask` 写回缩小后的服务器集合；处理器异常不阻断同批其他任务。

- [ ] **Step 5: 实现 worker 分发**

  在 `runXuiSyncTasks()` 增加独立分支，传入完整 task，使处理器可以读取 `task.user_id` 与 `payload_data.serverIds`；不走 `buildRetrySyncPlan()`。

- [ ] **Step 6: 运行 Task 4 测试**

  Run: `node server/test/test-xui-sync-task-service.js`
  Expected: PASS。

  Run: `node server/test/test-xui-sync-task-job.js`
  Expected: PASS。

- [ ] **Step 7: 提交（仅在用户明确授权时）**

  Suggested: `git commit -m "接入订阅凭证轮换重试任务"`

---

### Task 5: API 结果与用户端提示

**Files:**
- Modify: `server/services/user/subscription-service.js`
- Modify: `server/controllers/user/subscription-controller.js`
- Create: `server/test/test-user-subscription-controller.js`
- Modify: `server/test/test-user-subscription-service.js`
- Modify: `client-user/src/views/user/Profile.vue`
- Create: `client-user/component-tests/profile-subscription-replacement.component.spec.js`

**Interfaces:**
- Produces: `replaceSubscriptionLink(db,userId,logger,options={}): Promise<{subId:string,pendingServerIds:number[],pendingServerNames:string[],retryScheduled:boolean}>`。
- Produces: 成功响应继续含三个 URL，并新增 `pending_server_ids`、`pending_server_names`、`retry_scheduled`。
- Produces: 冷却响应 HTTP 429 + `Retry-After`。
- Consumes: Tasks 2–4 的编排和任务处理接口。

- [ ] **Step 1: 更新服务入口失败测试**

  将旧“只换 token 并复用缓存”用例改为断言：入口委托 rotation service、等待首次 `processTask`、返回结构化结果；部分失败仍 resolve 而不是 throw；任务持久化失败导致本地事务回滚并 reject。

- [ ] **Step 2: 写控制器失败测试**

  - `testReplaceReturnsUrlsAndPendingServers`：HTTP 200/legacy code 0，三个 URL 使用新 token，pending 元数据原样返回。
  - `testReplaceCooldownSetsRetryAfter`：业务错误得到 HTTP 429、整数 `Retry-After` 和中文提示。
  - `testPartialRemoteFailureStillReturnsSuccess`：不得转为 500。

- [ ] **Step 3: 实现服务入口与控制器适配**

  `subscription-service.replaceSubscriptionLink` 委托单例 rotation service；控制器从 `result.subId` 生成 URL 并合并 pending 字段。`handleControllerError` 对带 `retryAfter` 的错误先设置响应头，其他接口行为不变。

- [ ] **Step 4: 运行后端入口测试**

  Run: `node server/test/test-user-subscription-controller.js`
  Expected: PASS。

  Run: `node server/test/test-user-subscription-service.js`
  Expected: PASS。

- [ ] **Step 5: 写前端失败测试**

  覆盖：确认文案明确节点凭证也会失效；处理中说明包含同步节点；无 pending 时显示“请重新导入”；有 pending 时显示“部分节点后台更新，新链接已可用”；429 展示服务端冷却提示且保留页面现有链接。

- [ ] **Step 6: 实现 Profile 提示与 pending 分支**

  保持按钮互斥状态和 120 秒 API timeout；只更新响应给出的新 URL，不因 pending 服务器恢复旧 URL。新增方法必须补充职责、关键参数和分支注释。

- [ ] **Step 7: 运行前端组件测试**

  Run from `client-user`: `npm run test:component -- component-tests/profile-subscription-replacement.component.spec.js`
  Expected: PASS。

- [ ] **Step 8: 提交（仅在用户明确授权时）**

  Suggested: `git commit -m "完善订阅凭证更换接口与用户提示"`

---

### Task 6: 全量回归与交付检查

**Files:**
- Verify only;发现问题时只修改前述所属文件和测试。

**Interfaces:**
- Consumes: Tasks 1–5 全部接口。
- Produces: 可审阅的测试日志和变更摘要。

- [ ] **Step 1: 运行凭证轮换专项测试**

  Run:
  ```powershell
  node server/test/test-subscription-credential-rotation-migration.js
  node server/test/test-subscription-credential-rotation-service.js
  node server/test/test-user-subscription-controller.js
  node server/test/test-xui-sync-task-service.js
  node server/test/test-xui-sync-task-job.js
  node server/test/test-user-subscription-service.js
  ```
  Expected: 所有脚本退出码 0，并输出 PASS。

- [ ] **Step 2: 运行 3X-UI 3.4.2+ 同步回归**

  Run:
  ```powershell
  node server/test/test-xui-server-client-order-sync.js
  node server/test/test-xui-unique-client-sync.js
  node server/test/test-xui-sync-repository.js
  node server/test/test-xui-service-v325.js
  ```
  Expected: 所有脚本退出码 0；现有购买/续费、唯一客户端和重试行为不回归。

- [ ] **Step 3: 运行用户端测试与生产构建**

  Run from `client-user`:
  ```powershell
  npm run test:component
  npm run build
  ```
  Expected: Vitest 全部通过；Vite 生产构建成功且无 error。若本地 terser 依赖异常，再按项目约定补跑 `npx vite build --minify esbuild` 作为诊断，不能用它掩盖真实代码错误。

- [ ] **Step 4: 检查安全和差异**

  Run:
  ```powershell
  rg -n "uuid|password|auth|sub_id|subscription_url" server/services/user/subscription-credential-rotation-service.js server/integrations/xui/xui-sync-task-service.js
  git diff --check
  git status --short
  git diff --stat
  ```
  Expected: 任务 payload/日志无敏感值；无空白错误；变更只覆盖计划文件。

- [ ] **Step 5: 展示测试日志并提醒部署步骤**

  向用户展示各验证命令的实际输出摘要，说明需要先运行迁移 `node server/db/migrations/035-subscription-credential-rotation.js`，再重启后端服务器；不要自行启动服务器。

- [ ] **Step 6: 整理提交（仅在用户明确授权时）**

  按项目约束压缩为少量可追溯提交：设计/计划文档一笔，功能实现与测试一笔。Suggested:
  - `git commit -m "补充订阅凭证轮换设计与计划"`
  - `git commit -m "实现订阅凭证轮换与失败重试"`


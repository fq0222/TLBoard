# 订阅原始模板缓存 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改数据库结构的前提下，使订阅生成只刷新真实发生变化的服务器或节点，并让状态不变时的重复生成不产生远程请求。

**Architecture:** 使用现有 `node_fingerprint` 与 `server_fingerprint` 字段保存带 `v2:` 前缀的精简指纹。缓存层只判断本地服务器连接配置、inbound 连接配置和当前用户凭据是否变化；生成服务先汇总模板失效原因，再仅对本地快照不可信的服务器执行 inbound 同步，并按 `server_id + sub_id` 合并原始订阅请求。

**Tech Stack:** Node.js、CommonJS、Express 服务层、PostgreSQL 仓储接口、Node.js `assert` 脚本测试

**Spec:** `docs/superpowers/specs/2026-10-14-subscription-source-cache-v2-design.md`

## Global Constraints

- 使用简体中文注释、日志和提交信息。
- 不修改数据库表结构，不新增迁移脚本，不清空或批量更新 `user_subscription_sources`。
- 不改变订阅 URL、订阅输出格式、UUID、`sub_id`、Hysteria2 凭据生成规则或定时巡检周期。
- 新增方法必须补充职责、关键参数和核心分支语义注释。
- 保留当前单次生成最多一轮用户补偿和验证同步的限制。
- 日志不得包含 API Token、完整 UUID、完整 `sub_id`、订阅 URL 或订阅内容。
- 不自行启动服务器；修改 `server/**/*.js` 后在交付中提醒用户重启。
- 未经用户明确同意不得 `git push`；实现文件在用户确认前不执行 `git add`。
- 设计、规格、计划作为一笔文档提交；功能实现与测试作为一笔实现提交，避免零碎提交。

## Review Focus

- 旧版无前缀指纹：必须只触发一次渐进刷新，刷新成功后的下一次生成完全复用。
- 其他用户客户端变化：不得改变当前用户节点指纹或触发当前用户模板刷新。
- `stream_settings`、当前用户凭据或服务器连接字段变化：必须准确失效，不能错误复用旧模板。
- 部分服务器刷新失败：不得污染成功服务器的 v2 缓存，也不得进入无限补偿循环。
- 日志与汇总：必须区分模板缓存失效、模板远程拉取和 inbound 远程同步，并保持敏感值脱敏。

---

### Task 0: 固定现有测试基线

**Files:**
- Inspect: `server/test/test-subscription-snapshot-reuse.js`
- Inspect: `server/test/test-subscription-generation-performance.js`
- Modify only when confirmed stale: the same two test files
- Modify only when confirmed production defect and approved in scope: the directly responsible service file

**Interfaces:**
- Consumes: 当前未修改业务代码的测试结果。
- Produces: 能区分既有失败与本次新增失败的绿色基线，或一份明确的独立缺陷记录。

- [ ] **Step 1: 复现并记录当前两个既有失败**

当前基线已观察到：

- `test-subscription-snapshot-reuse.js` 在 `testSourceRefreshStageLogsUseEmail()` 中期待 `errorType=ECONNABORTED`，但当前错误分类可能输出 `NetworkTimeout`；
- `test-subscription-generation-performance.js` 在缺失快照场景进入真实 `syncUserToXuiServers()`，测试桩缺少 `db.prepare()`，导致 `TypeError`；测试中还存在期望 5000ms、实现常量为 15000ms 的历史差异，需要在执行到该断言后确认。

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
node server/test/test-subscription-generation-performance.js
```

Expected: 稳定复现并保存失败位置；不得把这些失败归因于尚未实施的 v2 改动。

- [ ] **Step 2: 按 `systematic-debugging` 逐项判定测试过期还是生产缺陷**

- 对照 `buildSourceRefreshErrorDetails()` 的当前稳定错误类型语义，确认日志测试应断言错误类别还是底层错误码；
- 跟踪缺失快照测试为何触发补偿分支，确认测试应注入 `syncUserToXuiServers`，还是生成服务错误地进入了补偿；
- 对照当前产品要求确认原始订阅请求超时应为 15000ms 还是历史设计中的 5000ms；本次缓存优化不得顺带擅自改变超时产品语义。

- [ ] **Step 3: 用最小改动恢复绿色基线，或暂停并报告范围扩张**

如果确认只是测试替身/断言过期，只修正测试：

- 日志断言匹配当前稳定分类，同时继续验证脱敏；
- 为生成性能场景注入明确的 `syncUserToXuiServers` 测试替身，禁止意外访问真实仓储；
- 超时断言与经确认的当前产品值一致。

如果确认是生产缺陷，不在测试中掩盖；先向用户说明缺陷和所需范围，再决定是否并入本次实现。

- [ ] **Step 4: 运行基线测试并确认通过**

Run:

```bash
node server/test/test-subscription-cache-service.js
node server/test/test-subscription-snapshot-reuse.js
node server/test/test-subscription-generation-performance.js
```

Expected: 三个脚本退出码均为 0，之后才开始 Task 1。

## File Structure

- Modify: `server/services/shared/subscription-cache-service.js` — v2 指纹生成、版本识别和缓存有效性判定。
- Modify: `server/services/user/subscription-service.js` — 缓存状态汇总、定向刷新编排和可观测日志。
- Modify: `server/test/test-subscription-cache-service.js` — v2 指纹及无时间过期的纯函数测试。
- Modify: `server/test/test-subscription-snapshot-reuse.js` — 快照可信度、局部刷新和日志边界测试。
- Modify: `server/test/test-subscription-generation-performance.js` — 公共生成链的零请求、服务器级增量请求及请求去重回归测试。
- No change: `server/repositories/subscription-repository.js` — 现有查询已返回 `uuid/password/auth/sub_id/settings/stream_settings`，现有写入字段足以保存 v2 指纹。
- No change: `server/db/migrations/`、`server/db/schema/tables.js` — 不进行数据库迁移。

### Task 1: 建立 v2 指纹与缓存有效性契约

**Files:**
- Modify: `server/test/test-subscription-cache-service.js`
- Modify: `server/services/shared/subscription-cache-service.js`

**Interfaces:**
- Consumes: 当前节点对象中的 `server_id`、`inbound_id`、`remark`、`protocol`、`port`、`stream_settings`、`sub_id`、`uuid`、`auth`、`password`、`flow`；当前服务器对象中的 `id/server_id`、`sub_url`、`host`、`client_port`。
- Produces: `SOURCE_FINGERPRINT_VERSION: 'v2'`、`computeNodeFingerprint(node, silent?) -> string`、`computeServerFingerprint(server) -> string`、`isSourceCacheUsable(params) -> {usable:boolean, reason:string}`。

- [ ] **Step 1: 在缓存服务测试中写入 v2 指纹失败用例**

新增以下测试并注册到 `run()`：

- `testFingerprintsUseV2Prefix()`：节点和服务器指纹均匹配 `/^v2:[0-9a-f]{64}$/`。
- `testOtherClientsDoNotChangeNodeFingerprint()`：只修改或重排 `settings.clients` 中其他用户，节点指纹保持一致。
- `testCurrentCredentialChangesInvalidateNodeFingerprint()`：分别修改 `sub_id`、`uuid`、`auth/password`、`flow`，断言节点指纹变化。
- `testInboundConnectionChangesInvalidateNodeFingerprint()`：分别修改端口、协议、remark 和 `stream_settings`，断言节点指纹变化。
- `testServerConnectionChangesInvalidateServerFingerprint()`：分别修改 `sub_url`、host 和 `client_port`，断言服务器指纹变化。
- `testLegacyFingerprintIsRejectedByVersion()`：缓存使用无前缀旧指纹时返回 `fingerprint_version_mismatch`。
- `testOldFetchedAtDoesNotExpireMatchingCache()`：`fetched_at` 超过 24 小时但 v2 指纹和链接条件一致时返回 `{usable:true, reason:'ok'}`。

- [ ] **Step 2: 运行缓存服务测试并确认失败**

Run:

```bash
node server/test/test-subscription-cache-service.js
```

Expected: FAIL，至少显示指纹缺少 `v2:` 前缀、旧指纹没有返回 `fingerprint_version_mismatch` 或过期缓存仍返回 `cache_expired`。

- [ ] **Step 3: 实现版本化指纹辅助方法**

在 `server/services/shared/subscription-cache-service.js`：

- 定义并导出 `SOURCE_FINGERPRINT_VERSION = 'v2'`；
- 新增 `versionFingerprint(payload, silent?) -> string`，返回 `v2:${hashPayload(stableJson(payload, silent))}`；
- 保留 `stableJson()`、`normalizeValue()` 和 `normalizeNumber()` 的稳定化语义；
- 为新方法补充中文职责、参数和返回值注释。

- [ ] **Step 4: 将节点指纹改为精简投影**

保持公开签名 `computeNodeFingerprint(node = {}, silent = false)` 不变，哈希输入限定为：

```javascript
{
  inbound: {
    server_id,
    inbound_id,
    remark,
    protocol,
    port,
    stream_settings
  },
  credential: {
    sub_id,
    uuid,
    auth,
    password,
    flow
  }
}
```

不得读取或哈希 `settings`。`stream_settings` 继续经过稳定 JSON 处理。

- [ ] **Step 5: 更新服务器指纹和版本识别**

- `computeServerFingerprint(server)` 保留现有字段投影，但改为返回 v2 指纹；
- `isSourceCacheUsable()` 在 `sub_id` 检查后、普通指纹比较前检查两个缓存指纹是否均以 `v2:` 开头；
- 任一指纹缺少前缀时返回 `{usable:false, reason:'fingerprint_version_mismatch'}`；
- 移除 `fetched_at/maxAgeSeconds` 导致 `cache_expired` 的同步失效分支；为兼容现有调用方，可以暂时保留参数但在注释中标明不再参与同步有效性判断。

- [ ] **Step 6: 运行缓存服务测试并确认通过**

Run:

```bash
node server/test/test-subscription-cache-service.js
```

Expected: 输出 `subscription cache service tests passed`，进程退出码为 0。

### Task 2: 汇总模板失效原因并生成精确刷新计划

**Files:**
- Modify: `server/test/test-subscription-snapshot-reuse.js`
- Modify: `server/services/user/subscription-service.js`

**Interfaces:**
- Consumes: Task 1 的 v2 `computeNodeFingerprint()`、`computeServerFingerprint()` 和 `isSourceCacheUsable()`。
- Produces: `collectSourceCacheStatus(...) -> {usable,validPairs,invalidPairs,invalidPairKeys,invalidServerIds,reasonCounts,reasonsByServer}`；扩展后的安全日志与刷新汇总字段。

- [ ] **Step 1: 为缓存评估汇总编写失败测试**

通过 `subscriptionService.__testables` 暴露 `collectSourceCacheStatus`，新增：

- `testCollectSourceCacheStatusGroupsReasons()`：构造有效、旧版指纹、节点指纹不匹配、服务器指纹不匹配和链接不匹配的 pair，断言 `validPairs`、`invalidPairs`、`reasonCounts` 与 `reasonsByServer` 精确匹配。
- `testCollectSourceCacheStatusKeepsInputOrder()`：断言 valid/invalid pair 均保持输入顺序。
- `testCacheReasonSummaryDoesNotContainSecrets()`：汇总对象和格式化日志不包含完整 UUID、`sub_id`、Token 或原始链接。

- [ ] **Step 2: 运行快照复用测试并确认失败**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected: FAIL，显示 `collectSourceCacheStatus` 未导出或缺少 `validPairs/reasonCounts/reasonsByServer`。

- [ ] **Step 3: 扩展 `collectSourceCacheStatus()` 返回值**

在 `server/services/user/subscription-service.js`：

- 对有效 pair 写入 `validPairs`；
- 对失效 pair 继续保留 `{key, config, reason}`；
- 按稳定原因枚举累计 `reasonCounts`；
- 按 `server_id` 累计 `reasonsByServer`，只保存原因和计数，不保存凭据；
- 保留 `invalidPairKeys` 与 `invalidServerIds`，避免破坏既有调用方；
- 删除 `shouldRepairServerForCacheReason()` 或停止使用其“指纹变化等于快照需修复”的语义，因为是否拉 inbound 只由 `inspectUserInNodeSnapshot()` 决定。

- [ ] **Step 4: 增加模板缓存评估日志**

在非首次生成缓存评估后输出一条：

```text
原始订阅模板缓存评估: user=<email>, totalPairs=<n>, validPairs=<n>, invalidPairs=<n>, reasons=<JSON>
```

将现有 inbound 日志字段 `reasons=` 改为 `snapshotReasons=`。原因对象只含固定枚举与计数。

- [ ] **Step 5: 增加模板刷新计划及汇总计数**

在调用 `refreshSubscriptionSources()` 前，根据最终 `repairConfigs` 计算：

- `sourceFetchServers`：去重后的服务器数量；
- `sourceFetchPairs`：实际待刷新 pair 数量；
- `sourceFetchGroups`：按 `server_id + sub_id` 去重后的远程请求组数量；
- `cacheReusedPairs`：首次评估直接有效的 pair 数量；
- `cacheInvalidPairs`：首次评估失效的 pair 数量；
- `inboundRemoteServers`：本次实际执行 inbound 同步的服务器数量。

刷新计划日志列出服务器备注名，不输出服务器订阅地址或用户凭据。最终汇总继续保留现有字段，并追加以上字段。

- [ ] **Step 6: 更新旧测试中的原因和日志断言**

- 将以 `cache_expired` 构造可信快照的测试数据改为 `fingerprint_version_mismatch` 或明确的节点指纹失效；
- 更新 `reasons={}` 断言为 `snapshotReasons={}`；
- 保留快照缺失、用户缺失、UUID/subId/auth 不匹配时的原有远程同步断言；
- 断言 `node_fingerprint_mismatch` 且快照可信时不会调用 `syncSelectedServers()`。

- [ ] **Step 7: 运行快照复用测试并确认通过**

Run:

```bash
node server/test/test-subscription-snapshot-reuse.js
```

Expected: 输出 `subscription snapshot reuse tests passed`，进程退出码为 0。

### Task 3: 验证公共生成链的零请求与服务器级增量刷新

**Files:**
- Modify: `server/test/test-subscription-generation-performance.js`
- Modify if tests reveal orchestration gaps: `server/services/user/subscription-service.js`

**Interfaces:**
- Consumes: Task 1 的 v2 指纹和 Task 2 的缓存评估/刷新计划。
- Produces: 公共 `generateSubscription()` 在无变化、单服务器变化、旧缓存升级和部分失败场景中的稳定行为。

- [ ] **Step 1: 编写“状态不变时零远程请求”的失败测试**

新增 `testRepeatedGenerationWithUnchangedStateMakesNoRemoteRequests()`：

- 构造非首次生成、完整可信快照和全部有效 v2 来源缓存；
- `syncSelectedServers()` 与 `fetchOriginalSubscription()` 被调用时直接使测试失败；
- 连续调用两次 `generateSubscription()`；
- 断言两次均成功保存相同节点，且两类远程依赖调用次数均为 0。

- [ ] **Step 2: 编写服务器级局部刷新失败测试**

新增 `testOnlyChangedServerSourcesAreFetched()`：

- 构造三台服务器，每台至少一个可信节点；
- 只破坏第二台服务器的 `server_fingerprint` 或 inbound 连接指纹；
- 断言不调用 `syncSelectedServers()`；
- 断言 `fetchOriginalSubscription()` 只收到第二台服务器的 `sub_url` 和对应 `sub_id`；
- 断言第一、第三台服务器缓存继续复用。

- [ ] **Step 3: 编写其他用户变化不刷新当前用户的测试**

新增 `testOtherClientChangesDoNotFetchCurrentUserSources()`：

- 两次配置只有 `settings.clients` 中其他用户的内容和顺序不同；
- 来源缓存使用第一次配置生成的 v2 指纹；
- 以第二次配置执行生成；
- 断言 inbound 同步与模板拉取均为 0。

- [ ] **Step 4: 编写旧指纹仅升级一次的测试**

新增 `testLegacyFingerprintsUpgradeOnce()`：

- 第一次生成使用无 `v2:` 前缀的来源缓存，断言不拉 inbound、只拉取对应模板并写入 v2 指纹；
- 第二次生成复用第一次写入结果；
- 断言第二次模板请求数为 0。

- [ ] **Step 5: 编写同服务器同 subId 请求去重测试**

新增 `testChangedPairsSharingServerAndSubIdFetchOnce()`：

- 同一服务器构造两个失效 inbound，使用相同 `sub_id`；
- 原始订阅返回同时包含两个可匹配链接；
- 断言 `fetchOriginalSubscription()` 仅调用一次，两条缓存均成功更新。

- [ ] **Step 6: 运行性能测试并确认失败**

Run:

```bash
node server/test/test-subscription-generation-performance.js
```

Expected: 新增测试至少有一项因旧过期逻辑、旧指纹或缺少新汇总行为失败。

- [ ] **Step 7: 完成最小编排修正**

只在新增测试揭示缺口时修改 `server/services/user/subscription-service.js`：

- 有效 v2 缓存必须完全跳过 `refreshSubscriptionSources()`；
- 模板失效但快照可信时不得调用 `syncSelectedServers()`；
- `repairConfigs` 只能包含最初失效且最终快照可信的 pair；
- `refreshSubscriptionSources()` 继续使用已有 `sourceFetchCache` 按 `server_id + sub_id` 去重；
- 刷新失败不得把旧指纹改写为 v2，也不得循环补偿。

- [ ] **Step 8: 运行性能测试并确认通过**

Run:

```bash
node server/test/test-subscription-generation-performance.js
```

Expected: 输出该脚本现有成功消息，进程退出码为 0。

### Task 4: 完整回归验证与交付检查

**Files:**
- Verify: `server/services/shared/subscription-cache-service.js`
- Verify: `server/services/user/subscription-service.js`
- Verify: `server/test/test-subscription-cache-service.js`
- Verify: `server/test/test-subscription-snapshot-reuse.js`
- Verify: `server/test/test-subscription-generation-performance.js`
- Verify: `docs/superpowers/specs/2026-10-14-subscription-source-cache-v2-design.md`
- Verify: `docs/superpowers/plans/2026-10-14-subscription-source-cache-v2.md`

**Interfaces:**
- Consumes: Tasks 1–3 的完整实现。
- Produces: 可审阅的差异、完整测试日志和两笔以内的可追溯本地提交。

- [ ] **Step 1: 运行三项核心测试**

Run:

```bash
node server/test/test-subscription-cache-service.js
node server/test/test-subscription-snapshot-reuse.js
node server/test/test-subscription-generation-performance.js
```

Expected: 三个脚本均输出各自成功消息，退出码均为 0。

- [ ] **Step 2: 运行相关订阅服务回归测试**

Run:

```bash
node server/test/test-user-subscription-service.js
node server/test/test-xui-node-snapshot-service.js
node server/test/test-xui-sync-users-job.js
node server/test/test-batch-subscription-service.js
```

Expected: 所有脚本退出码为 0；如脚本有成功消息，应完整保留日志。

- [ ] **Step 3: 检查数据库零变更与敏感信息**

Run:

```bash
git diff -- server/db server/repositories/subscription-repository.js
git diff --check
rg -n "sub_url=|original_link=|uuid=|sub_id=" server/services/shared/subscription-cache-service.js server/services/user/subscription-service.js
```

Expected:

- 数据库和仓储无差异；
- `git diff --check` 无输出；
- 新增日志不拼接敏感字段，`rg` 命中只能是既有安全代码或非日志业务字段。

- [ ] **Step 4: 审阅最终差异**

Run:

```bash
git diff --stat
git diff -- server/services/shared/subscription-cache-service.js server/services/user/subscription-service.js server/test/test-subscription-cache-service.js server/test/test-subscription-snapshot-reuse.js server/test/test-subscription-generation-performance.js
```

Expected: 差异只涉及已批准范围；没有数据库迁移、无关重构或订阅格式变化。

- [ ] **Step 5: 按项目规则整理本地提交**

在用户确认差异后，将设计和计划合并为一笔中文提交，将实现和测试合并为另一笔中文提交：

```bash
git add docs/superpowers/specs/2026-10-14-subscription-source-cache-v2-design.md docs/superpowers/plans/2026-10-14-subscription-source-cache-v2.md
git commit -m "文档：设计订阅模板缓存增量刷新方案"

git add server/services/shared/subscription-cache-service.js server/services/user/subscription-service.js server/test/test-subscription-cache-service.js server/test/test-subscription-snapshot-reuse.js server/test/test-subscription-generation-performance.js
git commit -m "优化：按服务器增量刷新订阅模板缓存"
```

Expected: 最多两笔功能相关提交；未经用户明确同意不执行 `git push`。

- [ ] **Step 6: 交付结果**

交付内容必须包含：

- 实际修改文件；
- 核心行为变化；
- 每条测试命令及完整结果摘要；
- `git diff --check` 结果；
- 是否产生本地提交；
- 明确提醒用户重启后端服务。

# 3X-UI 巡检强制修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让六小时巡检在 inbound 投影不一致时实际触发 3X-UI 服务器级客户端更新，同时保持其他业务的幂等判断。

**Architecture:** 在现有锁内 upsert 流程中加入默认关闭的 `forceUpdate` 语义，不新增绕过查询和锁的写入口。巡检仅在已有 mismatch 时显式开启该参数，并通过动作值区分修复与无操作。

**Tech Stack:** Node.js 20、CommonJS、Node `assert` 测试脚本、3X-UI clients API

**Spec:** `docs/superpowers/specs/2026-10-26-xui-force-repair-design.md`

## Global Constraints

- 仅 3X-UI 3.4.2+ 六小时巡检的不一致分支传入 `forceUpdate: true`。
- 其他 `upsertServerClient()` 调用方保持默认 `forceUpdate: false`。
- 保留服务器+邮箱 advisory lock、锁内 `/clients/get/:email` 和写后核验。
- 不输出凭证明文，不自行启动服务器，不创建分支或 worktree。
- 未经用户明确要求，不执行 `git add`、`git commit` 或 `git push`。

## Review Focus

- `forceUpdate` 缺省时，canonical client 一致必须保持零写入。
- `forceUpdate: true` 且 canonical client 一致时，必须调用一次 update。
- 客户端不存在时即使强制更新也必须走 add，不能先 update。
- 仅 inbound 关联缺失时，巡检修复后仍必须完成 attach。
- 写响应丢失时仍必须通过只读核验维持原有可重试语义。

---

### Task 1: 为 upsert 增加强制更新语义

**Files:**
- Modify: `server/integrations/xui/xui-service.js`
- Test: `server/test/test-xui-service-v325.js`

**Interfaces:**
- Consumes: `upsertServerClient({ db, serverId, email, inboundIds, client, forceUpdate? })`
- Produces: `forceUpdate?: boolean`，强制写入成功时返回 `action: 'repair'`

- [ ] **Step 1: 写失败测试**

新增测试：远端 canonical client 与 desired 完全一致时，默认调用不 update；传入 `forceUpdate: true` 时调用一次 update 并返回 `repair`。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node server/test/test-xui-service-v325.js`

Expected: 新增断言因没有执行 update 或动作不是 `repair` 而失败。

- [ ] **Step 3: 实现最小修改**

在 `upsertServerClientUnlocked(payload = {})` 中缓存 `clientChanged`、`forceUpdate` 和实际动作；保留锁内 GET、not_found/add、missingIds/attach 与写后核验。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `node server/test/test-xui-service-v325.js`

Expected: `test-xui-service-v325: PASS`

### Task 2: 六小时巡检仅对已发现的不一致启用强制修复

**Files:**
- Modify: `server/jobs/handlers/sync-xui-users.js`
- Test: `server/test/test-managed-server-counts.js`

**Interfaces:**
- Consumes: Task 1 的 `forceUpdate?: boolean`
- Produces: mismatch 分支调用 `upsertServerClient({...payload, forceUpdate: true})`

- [ ] **Step 1: 写失败测试**

扩展受版本控制的巡检测试：inbound 快照缺少本地已有 password 时，捕获的 upsert payload 必须包含 `forceUpdate: true`；现有一致快照测试仍保证不调用 upsert。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node server/test/test-managed-server-counts.js`

Expected: `forceUpdate` 断言得到 `undefined` 而失败。

- [ ] **Step 3: 实现最小修改**

只在 `mismatches.length > 0` 后现有 upsert 调用中加入 `forceUpdate: true`，成功日志附带返回的 action，且不输出凭证明文。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `node server/test/test-managed-server-counts.js`

Expected: 6 项测试全部通过，fail 为 0。

- [ ] **Step 5: 运行相关后端回归测试**

Run: `node server/test/test-xui-service-v325.js; node server/test/test-xui-sync-users-job.js; node server/test/test-managed-server-counts.js; node server/test/test-order-xui-sync.js; node server/test/test-xui-server-client-order-sync.js; node server/test/test-subscription-credential-rotation-service.js`

Expected: 所有脚本退出码为 0 并输出 PASS。

## 交付

展示 `git diff` 和测试日志；保持文件未暂存，提醒修改 `server/**/*.js` 后重启服务器。

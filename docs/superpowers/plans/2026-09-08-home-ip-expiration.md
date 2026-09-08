# Home IP Expiration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic expiration cleanup for home IP packages without disabling the user's main account.

**Architecture:** Add a focused `home-ip-expiration-service` that is invoked by the existing traffic sync job. Keep account traffic disabling in `traffic-manager`, and keep user-triggered routing operations in `home-routing-service` while reusing its routing cleanup primitives.

**Tech Stack:** Node.js CommonJS services, PostgreSQL via the existing db proxy, Vue 3 + Element Plus user client.

**Spec:** `docs/superpowers/specs/2026-09-08-home-ip-expiration-design.md`

## Global Constraints

- 使用简体中文回答所有问题。
- 未经用户明确指示，禁止创建或切换新分支、禁止创建 Git worktree。
- 新建文件和新增方法必须保持与当前项目一致的代码风格，并补充职责、关键参数和核心分支语义注释。
- 后端修改后运行 `server/test/` 下相关脚本验证。
- 前端修改后执行构建验证。
- 修改 `server/**/*.js` 后完成时提醒用户重启服务器，不自行启动服务。

---

### Task 1: Database State and Payment Reset

**Files:**
- Create: `server/db/migrations/030-home-ip-expiration-state.js`
- Modify: `server/db/schema/tables.js`
- Modify: `server/repositories/order-repository.js`
- Test: `server/test/test-home-ip-expiration.js`

**Interfaces:**
- Produces: `users.home_status`, `users.home_expired_notice_sent_at`.
- Produces: `orderRepository.updateUserHomePlanAfterPaidOrder(db, payload)` resets home status on paid home IP orders.

- [ ] **Step 1: Write failing migration and payment reset tests**

Add assertions that the migration source declares `home_status` and `home_expired_notice_sent_at`, and that `updateUserHomePlanAfterPaidOrder` SQL sets `home_status = 'normal'` and `home_expired_notice_sent_at = NULL`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/test/test-home-ip-expiration.js`
Expected: FAIL because migration file or SQL fields do not exist yet.

- [ ] **Step 3: Implement migration and schema defaults**

Create migration `030-home-ip-expiration-state.js` with `columnExists(client, columnName)` and `up(pool)`. Add `home_status VARCHAR(20) DEFAULT 'normal'` and `home_expired_notice_sent_at BIGINT` to schema initialization.

- [ ] **Step 4: Reset home status on paid home IP orders**

Update `updateUserHomePlanAfterPaidOrder` to set `home_status = 'normal'` and `home_expired_notice_sent_at = NULL` together with `home_plan_id` and `home_expire_at`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node server/test/test-home-ip-expiration.js`
Expected: PASS for migration and payment reset assertions.

### Task 2: Home IP Expiration Cleanup Service

**Files:**
- Create: `server/services/shared/home-ip-expiration-service.js`
- Modify: `server/repositories/traffic-repository.js`
- Modify: `server/services/user/home-routing-service.js`
- Modify: `server/services/shared/traffic-manager.js`
- Test: `server/test/test-home-ip-expiration.js`

**Interfaces:**
- Produces: `homeIpExpirationService.cleanupExpiredHomeIpPlans(db, now)`.
- Produces: `trafficRepository.listExpiredHomeIpUsers(db, now)`.
- Produces: `trafficRepository.markHomeIpExpired(db, userId, now)`.
- Produces: reusable `homeRoutingService.cleanupHomeRoutingForUser(db, userId, options)`.

- [ ] **Step 1: Write failing cleanup tests**

Add tests for successful cleanup, remote cleanup failure, already expired skip, and task integration by stubbing repository and XUI factory dependencies.

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/test/test-home-ip-expiration.js`
Expected: FAIL because `home-ip-expiration-service.js` and repository methods do not exist.

- [ ] **Step 3: Expose reusable routing cleanup**

Refactor `home-routing-service` so user manual delete and expiration cleanup both call `cleanupHomeRoutingForUser(db, userId, options)`. Manual delete keeps cooldown validation; expiration cleanup bypasses cooldown and returns a success/failure result instead of user-facing options.

- [ ] **Step 4: Implement expiration repository methods**

Add SQL for selecting users whose `home_plan_id` exists, `home_expire_at <= now`, `home_status != 'expired'`, and who have a route. Add SQL to mark successful cleanup as expired.

- [ ] **Step 5: Implement cleanup service**

Loop expired users, lock each user with `withUserStatusLock`, call routing cleanup, mark expired only after cleanup succeeds, then trigger the one-time email attempt.

- [ ] **Step 6: Wire traffic job**

Import the new service in `traffic-manager.js` and call `cleanupExpiredHomeIpPlans(db)` after `checkAndDisableExpiredUsers(db)`.

- [ ] **Step 7: Run test to verify it passes**

Run: `node server/test/test-home-ip-expiration.js`
Expected: PASS for cleanup and integration assertions.

### Task 3: Home IP Expired Email Reason

**Files:**
- Modify: `server/services/shared/renewal-required-email-service.js`
- Modify: `server/repositories/email-repository.js`
- Modify: `server/test/test-renewal-required-email.js`
- Test: `server/test/test-home-ip-expiration.js`

**Interfaces:**
- Produces: `renewalRequiredEmailService.sendRenewalRequiredEmail(db, { userId, reason: 'home_ip_expired' })`.
- Produces: profile fields for home plan name and home expiration time.

- [ ] **Step 1: Write failing email tests**

Assert `home_ip_expired` is accepted, renders家宽套餐文案, includes account/home plan/home expiration, and omits traffic rows.

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/test/test-renewal-required-email.js`
Expected: FAIL with `invalid_reason` or unsupported reason.

- [ ] **Step 3: Implement home IP email content**

Add `home_ip_expired` to supported reasons and branch content rows so traffic reasons keep traffic fields while home IP reason uses home plan fields.

- [ ] **Step 4: Add profile data**

Extend `findEmailUserProfileById` to include `home_plan_name` and `home_expire_at`.

- [ ] **Step 5: Run email tests**

Run: `node server/test/test-renewal-required-email.js`
Expected: PASS.

### Task 4: User API and Subscription Page Status

**Files:**
- Modify: `server/repositories/user-home-routing-repository.js`
- Modify: `server/services/user/home-routing-service.js`
- Modify: `client-user/src/views/user/Subscription.vue`
- Test: `server/test/test-home-ip-expiration.js`
- Build: `client-user`

**Interfaces:**
- Produces API fields: `home_status`, `home_status_text`.
- User page consumes `homeRoutingOptions.home_status` and disables home routing controls when expired.

- [ ] **Step 1: Write failing API formatting tests**

Assert an expired home IP entitlement still returns visible status data with `home_status='expired'`, `home_status_text='过期'`, and does not allow route editing.

- [ ] **Step 2: Run test to verify it fails**

Run: `node server/test/test-home-ip-expiration.js`
Expected: FAIL because API formatting does not return status fields.

- [ ] **Step 3: Return status fields from service**

Add `home_status` to entitlement query and format `normal/expired` into `正常/过期`. For expired entitlements, return `available: true` when the user has a home plan, but do not expose selectable servers for editing.

- [ ] **Step 4: Render status tags in Vue**

Add an `el-tag` column and mobile field. Disable add/modify/delete when `home_status === 'expired'`; show a short renewal tip.

- [ ] **Step 5: Run backend test and frontend build**

Run: `node server/test/test-home-ip-expiration.js`
Run: `cd client-user; npm run build`
Expected: backend tests pass and user client build exits 0.

### Task 5: Final Regression Verification

**Files:**
- Test only.

**Interfaces:**
- Confirms touched backend and frontend behavior together.

- [ ] **Step 1: Run focused backend tests**

Run:
`node server/test/test-home-ip-expiration.js`
`node server/test/test-renewal-required-email.js`
`node server/test/test-renewal-notice-state.js`

- [ ] **Step 2: Run user client build**

Run: `cd client-user; npm run build`

- [ ] **Step 3: Inspect diff**

Run: `git diff -- server client-user docs`

- [ ] **Step 4: Report logs and restart reminder**

Summarize test command outputs and remind the user to restart the server because `server/**/*.js` changed.

# Referral System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-payment-only referral system with separated package traffic and referral reward traffic across backend, user frontend, and admin frontend.

**Architecture:** Add a focused referral repository/service pair and keep payment completion orchestration in the existing shared order service. Store package traffic in `users.traffic_limit`, referral traffic in `users.referral_traffic_limit`, and calculate total entitlement at API, traffic-manager, and 3X-UI sync boundaries.

**Tech Stack:** Node.js Express, PostgreSQL through the existing db proxy, Vue 3, Vite, Element Plus.

---

## File Structure

- Create `server/db/migrations/011-referral-system.js`: idempotent production migration for referral fields and tables.
- Modify `server/db/schema/tables.js`: add referral fields/tables for fresh installs.
- Create `server/repositories/referral-repository.js`: SQL-only access for referral codes, clicks, rewards, and settings.
- Create `server/services/referral-service.js`: referral business rules, code generation, attribution, click logging, reward issuing, admin operations.
- Create `server/routes/user/referral.js`: user referral API.
- Create `server/routes/admin/referrals.js`: admin referral API.
- Modify `server/bootstrap/register-user-routes.js` and `server/bootstrap/register-admin-routes.js`: mount new routes.
- Modify `server/services/user/auth-service.js` and `server/repositories/user-repository.js`: accept `referral_code` on registration and persist `orders.referrer_user_id`.
- Modify `server/repositories/order-repository.js` and `server/services/shared/order-service.js`: include referral order context and issue rewards in the paid-order transaction.
- Modify `server/repositories/traffic-repository.js`, `server/services/shared/traffic-manager.js`, and `server/jobs/handlers/sync-xui-users.js`: use total entitlement for over-limit checks and XUI sync.
- Modify `server/controllers/user/auth-controller.js`, `server/controllers/user/subscription-controller.js`, and `server/services/user/auth-service.js`: return package/referral/total traffic split.
- Modify `server/routes/admin/system-settings.js`: add referral reward traffic settings.
- Create `server/test/test-referral-service.js`: focused backend referral tests.
- Modify `client-user/src/api/index.js`: add referral APIs and pass `referral_code` when registering.
- Modify `client-user/src/views/Home.vue` or registration source if referral capture lives there: read `?ref=` and store it.
- Modify `client-user/src/views/user/Profile.vue`: show total traffic with package/referral split.
- Modify `client-user/src/views/user/My.vue`: add referral card above “我的服务”.
- Create `client-user/src/views/user/Referral.vue`: user referral detail page.
- Modify `client-user/src/router/index.js`: add `/user/referral`.
- Modify `client-admin/src/api/index.js`: add referral and referral-setting APIs.
- Modify `client-admin/src/views/Settings.vue`: add “推广配置” tab.
- Create `client-admin/src/views/Referrals.vue`: admin referral management page.
- Modify `client-admin/src/router/index.js` and `client-admin/src/views/Layout.vue`: add promotion management route and nav item.

## Task 1: Database Schema

**Files:**
- Create: `server/db/migrations/011-referral-system.js`
- Modify: `server/db/schema/tables.js`

- [ ] **Step 1: Write migration script**

Create an idempotent migration that:

```sql
ALTER TABLE users ADD COLUMN referral_traffic_limit BIGINT DEFAULT 0;
ALTER TABLE orders ADD COLUMN referrer_user_id INTEGER;
CREATE TABLE referral_codes (...);
CREATE TABLE referral_clicks (...);
CREATE TABLE referral_rewards (...);
CREATE INDEX idx_referral_clicks_referrer_user_id ON referral_clicks(referrer_user_id);
CREATE INDEX idx_referral_rewards_referrer_user_id ON referral_rewards(referrer_user_id);
```

Use `information_schema.columns` checks before `ALTER TABLE`, and `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.

- [ ] **Step 2: Update fresh-install schema**

Add `referral_traffic_limit BIGINT DEFAULT 0` to `users`, `referrer_user_id INTEGER` to `orders`, and append `referral_codes`, `referral_clicks`, `referral_rewards` table definitions.

- [ ] **Step 3: Verify syntax**

Run:

```bash
node --check server/db/migrations/011-referral-system.js
node --check server/db/schema/tables.js
```

Expected: both commands exit with code 0.

## Task 2: Referral Repository And Service

**Files:**
- Create: `server/repositories/referral-repository.js`
- Create: `server/services/referral-service.js`
- Test: `server/test/test-referral-service.js`

- [ ] **Step 1: Write failing repository/service tests**

Cover:

```javascript
assert.strictEqual(await referralService.resolveReferrerByCode(db, code, email), referrerId);
assert.strictEqual(await referralService.resolveReferrerByCode(db, disabledCode, email), null);
assert.strictEqual(await referralService.resolveReferrerByCode(db, ownCode, ownerEmail), null);
assert.strictEqual(await referralService.issueFirstPaymentReward(db, order), true);
assert.strictEqual(await referralService.issueFirstPaymentReward(db, sameOrderAgain), false);
```

Use a small in-memory fake db object matching the project test style, with `prepare().get/all/run()` and `pool.query()` where needed.

- [ ] **Step 2: Run failing test**

Run:

```bash
node server/test/test-referral-service.js
```

Expected: fail because files/functions do not exist.

- [ ] **Step 3: Implement repository**

Implement functions:

```javascript
findReferralCodeByUserId(db, userId)
findEnabledReferralCode(db, code)
upsertReferralCode(db, payload)
recordReferralClick(db, payload)
countReferralClicks(db, userId)
sumReferralRewards(db, userId)
listReferralRewards(db, payload)
insertReferralReward(db, payload)
incrementUserReferralTraffic(db, userId, rewardTraffic)
findReferralRewardSetting(db)
listAdminReferralSummaries(db, payload)
countAdminReferralSummaries(db, filters)
setReferralCodeEnabled(db, userId, enabled)
```

Every new function gets a short comment explaining responsibility and key parameters.

- [ ] **Step 4: Implement service**

Implement functions:

```javascript
getOrCreateReferralCode(db, userId)
buildReferralLink(req, code)
getUserReferralSummary(db, req, userId)
recordClick(db, payload)
resolveReferrerByCode(db, code, registeringEmail)
issueFirstPaymentReward(db, order)
listUserRewards(db, userId, query)
listAdminReferrals(db, query)
getAdminReferralDetail(db, userId, query)
setUserReferralEnabled(db, userId, enabled)
resetUserReferralCode(db, userId)
```

`issueFirstPaymentReward()` reads `referral_reward_traffic`, skips when reward is `0`, inserts a unique reward, then increments `users.referral_traffic_limit`.

- [ ] **Step 5: Run test**

Run:

```bash
node server/test/test-referral-service.js
```

Expected: `referral service tests passed`.

## Task 3: User And Admin Referral APIs

**Files:**
- Create: `server/routes/user/referral.js`
- Create: `server/routes/admin/referrals.js`
- Modify: `server/bootstrap/register-user-routes.js`
- Modify: `server/bootstrap/register-admin-routes.js`

- [ ] **Step 1: Implement user routes**

Routes:

```javascript
GET /api/user/referral
POST /api/user/referral/click
GET /api/user/referral/rewards
```

Use `authenticateUser`, `express-validator`, and the existing `{ code, message, data }` response style.

- [ ] **Step 2: Implement admin routes**

Routes:

```javascript
GET /api/admin/referrals
GET /api/admin/referrals/:userId
PUT /api/admin/referrals/:userId/enabled
POST /api/admin/referrals/:userId/reset-code
```

Use `authenticateAdmin`, integer validation for `userId`, boolean conversion with `!!`.

- [ ] **Step 3: Register routes**

Mount user route as `/api/user/referral` and admin route as `/api/admin/referrals`.

- [ ] **Step 4: Verify syntax**

Run:

```bash
node --check server/routes/user/referral.js
node --check server/routes/admin/referrals.js
node --check server/bootstrap/register-user-routes.js
node --check server/bootstrap/register-admin-routes.js
```

Expected: all pass.

## Task 4: Registration Attribution And Payment Reward

**Files:**
- Modify: `server/services/user/auth-service.js`
- Modify: `server/repositories/user-repository.js`
- Modify: `server/repositories/order-repository.js`
- Modify: `server/services/shared/order-service.js`
- Test: `server/test/test-referral-service.js`

- [ ] **Step 1: Extend registration order creation**

In `registerAndPay()`, read `payload.referral_code`, resolve it through `referralService.resolveReferrerByCode()`, then pass `referrerUserId` into `createPendingOrder()`.

- [ ] **Step 2: Persist referrer on orders**

Update `createPendingOrder()` to insert `referrer_user_id`. Use `null` when no valid referrer exists.

- [ ] **Step 3: Load referrer in paid-order context**

Update `findPaidOrderContextByOutTradeNo()` to select `o.referrer_user_id`, `u.referral_traffic_limit`, and enough fields to detect first-payment order.

- [ ] **Step 4: Issue reward in transaction**

In `completePaidOrder()` transaction, after user/order updates and sales count changes, call `referralService.issueFirstPaymentReward(transactionDb, { ...order, id: order.id, referrer_user_id: order.referrer_user_id })` only when:

```javascript
!isRenewOrder && Number(order.current_payment_count || 0) === 0 && order.referrer_user_id
```

- [ ] **Step 5: Verify reward idempotency**

Extend `test-referral-service.js` to assert duplicate rewards do not increment traffic twice.

- [ ] **Step 6: Run tests**

Run:

```bash
node server/test/test-referral-service.js
node server/test/test-user-payment-service.js
```

Expected: both pass.

## Task 5: Total Traffic Entitlement

**Files:**
- Modify: `server/services/user/auth-service.js`
- Modify: `server/controllers/user/auth-controller.js`
- Modify: `server/controllers/user/subscription-controller.js`
- Modify: `server/repositories/traffic-repository.js`
- Modify: `server/services/shared/traffic-manager.js`
- Modify: `server/jobs/handlers/sync-xui-users.js`
- Modify: `server/services/shared/order-service.js`
- Test: `server/test/test-traffic-multiplier.js`

- [ ] **Step 1: Return traffic split in profile**

Calculate:

```javascript
const planTrafficLimit = Number(user.traffic_limit) || 0;
const referralTrafficLimit = Number(user.referral_traffic_limit) || 0;
const totalTrafficLimit = planTrafficLimit + referralTrafficLimit;
```

Return `plan_traffic_limit`, `referral_traffic_limit`, `total_traffic_limit` and their text fields. Keep legacy `traffic_limit` equal to total for compatibility.

- [ ] **Step 2: Update controllers**

Expose the new split fields in auth and subscription responses.

- [ ] **Step 3: Update traffic sync queries**

Include `referral_traffic_limit` in enabled-user and latest-disable-state queries.

- [ ] **Step 4: Update over-limit logic**

Use:

```javascript
const trafficLimit = (Number(user.traffic_limit) || 0) + (Number(user.referral_traffic_limit) || 0);
```

in `calculateUserTotalTraffic()` and second-check disable logic.

- [ ] **Step 5: Update XUI sync total**

Use total entitlement when syncing users to 3X-UI from order service and scheduled sync jobs.

- [ ] **Step 6: Run traffic tests**

Run:

```bash
node server/test/test-traffic-multiplier.js
node server/test/test-traffic-manager.js
```

Expected: both pass.

## Task 6: Referral Settings

**Files:**
- Modify: `server/routes/admin/system-settings.js`
- Modify: `client-admin/src/api/index.js`
- Modify: `client-admin/src/views/Settings.vue`

- [ ] **Step 1: Add backend setting routes**

Add:

```javascript
GET /api/admin/system-settings/referral
PUT /api/admin/system-settings/referral
```

Accept `referral_reward_traffic_gb` from admin UI, validate `0 <= value <= 10240`, convert to bytes, save `referral_reward_traffic`.

- [ ] **Step 2: Add admin API wrappers**

Add `getReferralConfig()` and `saveReferralConfig(data)`.

- [ ] **Step 3: Add settings tab**

Add “推广配置” tab with an `el-input-number` labeled “首单奖励流量”, unit GB, and save button.

- [ ] **Step 4: Verify**

Run:

```bash
node --check server/routes/admin/system-settings.js
```

Expected: pass.

## Task 7: User Frontend

**Files:**
- Modify: `client-user/src/api/index.js`
- Modify: `client-user/src/router/index.js`
- Modify: `client-user/src/views/Home.vue`
- Modify: `client-user/src/views/user/Profile.vue`
- Modify: `client-user/src/views/user/My.vue`
- Create: `client-user/src/views/user/Referral.vue`

- [ ] **Step 1: Add user API wrappers**

Add:

```javascript
getReferral()
recordReferralClick(code)
getReferralRewards(params)
```

Include `referral_code` in registration payload by reading `localStorage.getItem('referral_code')`.

- [ ] **Step 2: Capture referral code**

On public home/register entry, read `route.query.ref`, call `recordReferralClick()`, then store valid code in `localStorage`.

- [ ] **Step 3: Update homepage traffic display**

Use `total_traffic_limit_text`, `plan_traffic_limit_text`, `referral_traffic_limit_text`.

- [ ] **Step 4: Add referral card in My.vue**

Place above “我的服务”. Show link, clicks, reward total, copy button, detail link.

- [ ] **Step 5: Add Referral.vue**

Build a page with summary and `el-table` columns: 被推广用户、订单号、奖励流量、付款时间.

- [ ] **Step 6: Add route**

Add `/user/referral` route with title “推广详情”.

- [ ] **Step 7: Build user frontend**

Run in `client-user/`:

```bash
npm run build
```

Expected: production build succeeds.

## Task 8: Admin Frontend

**Files:**
- Modify: `client-admin/src/api/index.js`
- Modify: `client-admin/src/router/index.js`
- Modify: `client-admin/src/views/Layout.vue`
- Create: `client-admin/src/views/Referrals.vue`

- [ ] **Step 1: Add admin API wrappers**

Add:

```javascript
getReferrals(params)
getReferralDetail(userId, params)
setReferralEnabled(userId, enabled)
resetReferralCode(userId)
```

- [ ] **Step 2: Add route and nav**

Add `/admin/referrals` route titled “推广管理” and sidebar item with an Element Plus icon.

- [ ] **Step 3: Build management page**

List users with columns: 邮箱、推广链接、状态、点击量、奖励次数、奖励流量、操作. Add detail dialog/table and confirm dialogs with Chinese button text for disable/reset.

- [ ] **Step 4: Build admin frontend**

Run in `client-admin/`:

```bash
npm run build
```

Expected: production build succeeds.

## Task 9: Final Verification

**Files:**
- All touched files.

- [ ] **Step 1: Backend syntax checks**

Run:

```bash
node --check server/services/referral-service.js
node --check server/repositories/referral-repository.js
node --check server/services/user/auth-service.js
node --check server/services/shared/order-service.js
node --check server/services/shared/traffic-manager.js
```

Expected: all pass.

- [ ] **Step 2: Backend tests**

Run:

```bash
node server/test/test-referral-service.js
node server/test/test-user-payment-service.js
node server/test/test-traffic-multiplier.js
node server/test/test-traffic-manager.js
```

Expected: all pass.

- [ ] **Step 3: Frontend builds**

Run:

```bash
npm run build
```

in both `client-user/` and `client-admin/`.

Expected: both builds pass.

- [ ] **Step 4: Review diff**

Run:

```bash
git diff --stat
git diff -- server client-user client-admin docs
```

Expected: only referral-system related changes.

## Self-Review

- Spec coverage: database model, user link/detail, admin management, settings, first-payment reward, separated traffic, total entitlement, and tests are covered.
- Placeholder scan: no TBD/TODO/later placeholders are present.
- Type consistency: `referral_traffic_limit`, `referral_reward_traffic`, `referrer_user_id`, `referral_code`, and route names are consistent across tasks.
- Project rule adjustment: plan intentionally omits automatic `git add` and `git commit` steps because project instructions say not to stage newly written files unless explicitly requested.

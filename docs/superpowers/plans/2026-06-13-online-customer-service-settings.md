# Online Customer Service Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-managed online customer service URL and expose it as a login-page "联系我们" link while extracting system settings into a focused backend module.

**Architecture:** Move `system_settings` database access into a repository and admin setting business rules into a service. Keep existing admin API paths unchanged, add one public user API for safe public settings, and wire both frontends through their existing API layers.

**Tech Stack:** Node.js, Express, PostgreSQL repository proxy, Vue 3, Vite, Element Plus.

---

### Task 1: Backend System Settings Module

**Files:**
- Create: `server/repositories/system-settings-repository.js`
- Create: `server/services/admin/system-settings-service.js`
- Create: `server/controllers/admin/system-settings-controller.js`
- Modify: `server/routes/admin/system-settings.js`
- Modify: `server/test/test-system-settings-subscription-config.js`

- [ ] Add tests for subscription defaults, saving `online_customer_service_url`, and trimming blank values.
- [ ] Extract single-key and multi-key system setting reads/writes into the repository.
- [ ] Move traffic and subscription config defaults into the service.
- [ ] Keep route exports for existing tests during migration.
- [ ] Run `node server/test/test-system-settings-subscription-config.js`.

### Task 2: Public User Settings API

**Files:**
- Create: `server/services/user/public-settings-service.js`
- Create: `server/controllers/user/public-settings-controller.js`
- Create: `server/routes/user/public-settings.js`
- Modify: `server/bootstrap/register-user-routes.js`
- Create: `server/test/test-user-public-settings.js`

- [ ] Add a test proving only `online_customer_service_url` is exposed.
- [ ] Add the public route without authentication.
- [ ] Run `node server/test/test-user-public-settings.js`.

### Task 3: Frontend Wiring

**Files:**
- Modify: `client-admin/src/api/index.js`
- Modify: `client-admin/src/views/Settings.vue`
- Modify: `client-user/src/api/index.js`
- Modify: `client-user/src/views/Login.vue`

- [ ] Add admin API typings/comments for the new subscription field.
- [ ] Add the admin form input and save/load normalization.
- [ ] Add user API call and render the contact link only when configured.
- [ ] Build admin and user clients with `npx vite build --minify esbuild`.

### Task 4: Final Verification

- [ ] Run relevant server tests.
- [ ] Run both frontend builds.
- [ ] Review `git diff --stat` and changed files.
- [ ] Remind the user to restart the backend because `server/**/*.js` changed.

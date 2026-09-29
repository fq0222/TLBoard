# 住宅 IP 首页展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已上架且开启首页展示的 `home_ip` 套餐出现在公开首页，并可通过“住宅IP”分类筛选，同时禁止购买按钮。

**Architecture:** 后端用户套餐仓储继续以 `enabled` 和 `show_on_home` 作为公开首页唯一可见性条件。前端纯函数按 `plan_type` 划分 `timed`、`lifetime` 和 `home_ip`，首页卡片对 `home_ip` 仅展示不购买。

**Tech Stack:** Node.js、Express/PostgreSQL 仓储层、Vue 3 Composition API、Node.js `node:test`、Vite

**Spec:** 2026-09-29 用户在当前对话中确认的短设计

## Global Constraints

- 仅 `enabled = 1` 且 `show_on_home = 1` 的套餐可出现在公开首页。
- 分类文案固定为“全部 / 限时 / 不限时 / 住宅IP”。
- `timed` 只归入限时，`lifetime` 及历史空类型只归入不限时，`home_ip` 只归入住宅 IP。
- `home_ip` 套餐显示“不限制流量”，购买按钮禁用且不执行跳转。
- 不修改数据库结构，不改变登录后家宽套餐购买流程。
- 不创建或切换 Git 分支，不创建 worktree，不自行启动服务器。

## Review Focus

- `home_ip` 不得被“限时”因其 `duration_days > 0` 而误选中。
- 历史空 `plan_type` 仍须在“不限时”中显示。
- “全部”需保留原始顺序并包含住宅 IP。
- 首页隐藏或已下架的住宅 IP 不得由 API 返回。
- 住宅 IP 按钮的禁用不得改变普通套餐的购买行为。

---

### Task 1: 首页套餐查询包含住宅 IP

**Files:**
- Modify: `server/repositories/plan-repository.js`
- Test: `server/test/test-monthly-plan-sales.js`

**Interfaces:**
- Consumes: `findEnabledPlans(db)` 现有仓储接口。
- Produces: 保持原接口不变，SQL 仅按 `enabled = 1` 和 `show_on_home = 1` 限制。

- [ ] **Step 1: 先在仓储契约测试中断言查询不再排除 `home_ip`**
- [ ] **Step 2: 运行 `node server/test/test-monthly-plan-sales.js`，确认新断言先失败**
- [ ] **Step 3: 删除 `findEnabledPlans(db)` 中的 `home_ip` 排除条件**
- [ ] **Step 4: 重跑脚本，确认全部测试通过**

### Task 2: 首页住宅 IP 筛选与仅展示卡片

**Files:**
- Modify: `client-user/src/utils/plan-filter.js`
- Modify: `client-user/src/views/Home.vue`
- Test: `client-user/test/plan-filter.test.js`
- Test: `client-user/test/home-plan-display.test.js`

**Interfaces:**
- Consumes: 后端返回的 `plan.plan_type`、`traffic_text` 及现有 `filterPlansByDurationType(plans, durationType)` 调用点。
- Produces: `filterPlansByDurationType(plans, durationType)` 支持 `'all'|'limited'|'unlimited'|'home_ip'`；首页增加“住宅IP”选项并禁用 `home_ip` 购买按钮。

- [ ] **Step 1: 扩充筛选单测，覆盖四类选项、历史空类型和 `home_ip` 隔离**
- [ ] **Step 2: 新增首页静态契约测试，断言“住宅IP”文案、`home_ip` 按钮禁用和不触发购买**
- [ ] **Step 3: 运行 `node --test client-user/test/plan-filter.test.js client-user/test/home-plan-display.test.js`，确认新测试先失败**
- [ ] **Step 4: 最小修改筛选函数和首页模板，对 `home_ip` 显示“不限制流量”并禁用购买**
- [ ] **Step 5: 重跑前端单测，确认通过**
- [ ] **Step 6: 运行 `npx vite build --minify esbuild`，确认生产构建通过**


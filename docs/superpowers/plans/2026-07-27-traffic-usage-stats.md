# Traffic Usage Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理端展示最近一轮 30 分钟流量同步的服务器使用统计。

**Architecture:** 复用 `traffic-manager` 的本轮倍率后增量，写入一张只保留当前快照的表；管理端接口读取快照，前端用 CSS 柱状图展示。

**Tech Stack:** Node.js Express, PostgreSQL, Vue 3, Vite, Element Plus.

---

### Task 1: 后端快照计算与存储

**Files:**
- Create: `server/services/admin/traffic-usage-stats-service.js`
- Create: `server/repositories/traffic-usage-stats-repository.js`
- Modify: `server/services/shared/traffic-manager.js`
- Modify: `server/db/schema/tables.js`
- Test: `server/test/test-traffic-usage-stats.js`

- [ ] 写失败测试：给定用户、服务器和倍率后增量，生成服务器汇总和用户明细。
- [ ] 实现快照构建函数，过滤 0 增量，按服务器汇总。
- [ ] 实现覆盖写入和读取快照。
- [ ] 在 `calculateUserTotalTraffic()` 事务内保存快照。

### Task 2: 管理端接口

**Files:**
- Modify: `server/routes/admin/dashboard.js`
- Modify: `server/controllers/admin/dashboard-controller.js`
- Modify: `server/services/admin/dashboard-service.js`
- Modify: `server/repositories/dashboard-repository.js`

- [ ] 写失败测试确认接口 service 返回 `syncAt`、`unit`、`servers`。
- [ ] 新增 `GET /api/admin/dashboard/traffic-usage`。
- [ ] 统一返回旧接口格式 `{ code, message, data }`。

### Task 3: 管理端页面

**Files:**
- Create: `client-admin/src/views/TrafficStats.vue`
- Modify: `client-admin/src/api/index.js`
- Modify: `client-admin/src/router/index.js`
- Modify: `client-admin/src/views/Layout.vue`
- Test: `client-admin/test/traffic-stats-page.test.js`

- [ ] 写失败测试确认路由、导航、API 方法、页面弹窗结构存在。
- [ ] 新增 API 方法 `getTrafficUsageStats()`。
- [ ] 新增路由 `/admin/traffic-stats`。
- [ ] 新增导航项并实现页面。
- [ ] 构建验证。

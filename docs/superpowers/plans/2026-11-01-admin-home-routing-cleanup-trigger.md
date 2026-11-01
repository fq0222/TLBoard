# 管理端家宽 routing 残留清理手动入口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理端家宽 IP 管理页面增加一个按钮，将既有家宽 routing 残留清理任务提交到现有 XUI 串行队列。

**Architecture:** 从现有清理 job handler 中提取并导出统一入队函数，cron 与管理员接口共同调用该函数。管理端接口放在 home-proxies 领域内，只返回入队或同名任务合并结果；Vue 页面沿用服务器管理页面手动同步按钮的交互方式。

**Tech Stack:** Node.js、Express、node-cron、Node.js test runner、Vue 3、Element Plus、Vitest、Vite

**Spec:** `docs/superpowers/specs/2026-11-01-admin-home-routing-cleanup-trigger-design.md`

## Global Constraints

- 接口固定为 `POST /api/admin/home-proxies/cleanup-routes/run`，必须经过管理员认证。
- 队列任务名固定为 `home-routing-pending-cleanup`。
- 定时任务和手动接口必须复用同一个入队方法，不允许手动接口直接执行清理。
- 同名任务存在时由队列合并，并返回成功响应而非错误。
- 不增加任务进度、历史记录、取消任务、确认弹窗，不改变清理业务和每天 12:00 的 cron 配置。
- 新增方法必须补充符合项目风格的职责、参数和核心分支注释。

## Review Focus

- 同名清理任务已经运行或等待时，只返回合并提示，不重复执行清理；由 Task 1 和 Task 2 的合并用例覆盖。
- cron 触发和手动触发必须使用相同任务名与相同入队函数；由 Task 1 的复用用例覆盖。
- 未认证请求不能提交后台任务；由 Task 2 的 HTTP 鉴权用例覆盖。
- 管理端请求失败后按钮不能永久停留在 loading；由 Task 3 的拒绝请求用例覆盖。
- 移动端工具栏仍沿用既有纵向布局，新增按钮不得破坏页面构建；由 Task 3 的组件断言和生产构建覆盖。

---

### Task 1: 提取家宽 routing 清理统一入队入口

**Files:**
- Modify: `server/jobs/handlers/clean-pending-home-routes.js`
- Test: `server/test/test-clean-pending-home-routes-job.js`

**Interfaces:**
- Consumes: `xuiJobScheduler.schedule(name, handler): boolean`、`runPendingHomeRouteCleanup(db): Promise<Object>`
- Produces: `schedulePendingHomeRouteCleanup(db): boolean`

- [ ] **Step 1: 扩展失败测试，要求直接调用统一入口时提交固定任务名且不立即清理**

在 `server/test/test-clean-pending-home-routes-job.js` 增加断言：`schedulePendingHomeRouteCleanup(db)` 返回调度器布尔结果、提交 `home-routing-pending-cleanup`，且只有执行队列 handler 后才调用清理服务。

- [ ] **Step 2: 扩展失败测试，要求 cron 回调复用统一入口并保留合并语义**

通过 fixture 观察同一调度器调用，断言 cron 到点只产生一次同名任务提交；调度器返回 `false` 时清理服务调用次数仍为 0。

- [ ] **Step 3: 运行 job 测试并确认失败**

Run: `node server/test/test-clean-pending-home-routes-job.js`

Expected: FAIL，提示 `schedulePendingHomeRouteCleanup` 未定义或未导出。

- [ ] **Step 4: 实现并导出 `schedulePendingHomeRouteCleanup(db): boolean`**

在 `server/jobs/handlers/clean-pending-home-routes.js` 中封装现有 `xuiJobScheduler.schedule('home-routing-pending-cleanup', handler)`；cron 回调只调用该方法，执行时间、时区和清理实现保持不变。

- [ ] **Step 5: 运行 job 测试并确认通过**

Run: `node server/test/test-clean-pending-home-routes-job.js`

Expected: 所有用例 PASS，退出码为 0。

### Task 2: 增加管理员认证的手动入队接口

**Files:**
- Modify: `server/services/admin/home-proxies-service.js`
- Modify: `server/controllers/admin/home-proxies-controller.js`
- Modify: `server/routes/admin/home-proxies.js`
- Create: `server/test/test-admin-home-routing-cleanup.js`

**Interfaces:**
- Consumes: `schedulePendingHomeRouteCleanup(db): boolean`
- Produces: `homeProxiesService.runPendingHomeRouteCleanupTask(db): {queued: boolean, merged: boolean, message: string}`、`homeProxiesController.runPendingHomeRouteCleanupTask(req, res): Promise<Response>`、`POST /api/admin/home-proxies/cleanup-routes/run`

- [ ] **Step 1: 编写服务层入队和合并失败测试**

隔离加载 `home-proxies-service` 并替换 job handler：调度器结果为 `true` 时断言返回 `{ queued: true, merged: false, message: '残留路由清理任务已加入队列' }`；结果为 `false` 时断言返回 `{ queued: false, merged: true, message: '已有残留路由清理任务正在执行或等待，已自动合并' }`。

- [ ] **Step 2: 编写 HTTP 鉴权和响应失败测试**

在临时 Express 应用挂载真实 home-proxies 路由，断言未认证请求返回 401；合法管理员 JWT 请求返回 200、`code: 0` 和完整入队结果。同时断言静态路径 `/cleanup-routes/run` 没有被 `/:id` 动态路由误匹配。

- [ ] **Step 3: 运行管理端清理接口测试并确认失败**

Run: `node server/test/test-admin-home-routing-cleanup.js`

Expected: FAIL，提示服务方法或路由不存在。

- [ ] **Step 4: 实现服务方法 `runPendingHomeRouteCleanupTask(db)`**

在 `server/services/admin/home-proxies-service.js` 引入 Task 1 的入队函数，按布尔返回值生成固定的 `queued`、`merged` 和中文提示，并导出该方法。

- [ ] **Step 5: 实现控制器方法 `runPendingHomeRouteCleanupTask(req, res)`**

调用 service 并通过 `legacySuccess` 返回结果；异常使用现有 `handleControllerError`，同时记录不含敏感数据的提交日志。

- [ ] **Step 6: 注册管理员路由**

在 `server/routes/admin/home-proxies.js` 中将 `router.post('/cleanup-routes/run', authenticateAdmin, ...)` 放在所有 `/:id` 路由之前。

- [ ] **Step 7: 运行后端相关测试并确认通过**

Run: `node server/test/test-admin-home-routing-cleanup.js`

Run: `node server/test/test-clean-pending-home-routes-job.js`

Expected: 两个脚本全部 PASS，退出码均为 0。

### Task 3: 增加管理端按钮和请求交互

**Files:**
- Modify: `client-admin/src/api/index.js`
- Modify: `client-admin/src/views/HomeProxies.vue`
- Create: `client-admin/component-tests/home-proxies-routing-cleanup.component.spec.js`

**Interfaces:**
- Consumes: `POST /api/admin/home-proxies/cleanup-routes/run` 的 legacy 响应结构
- Produces: `api.admin.runPendingHomeRouteCleanupTask(): Promise<Object>`、页面方法 `runPendingHomeRouteCleanupTask(): Promise<void>`

- [ ] **Step 1: 编写按钮提交成功的组件失败测试**

挂载 `HomeProxies.vue`，模拟列表请求和 `runPendingHomeRouteCleanupTask`；断言“清理残留路由”按钮位于“添加家宽 IP”按钮之后，点击一次只调用一次 API，并显示响应中的成功提示。

- [ ] **Step 2: 编写 loading 和失败恢复的组件失败测试**

使用可控 Promise 断言请求未完成时按钮处于 loading 且显示“提交中”；分别 resolve 和 reject 后断言按钮恢复为“清理残留路由”，失败分支不会残留 loading 状态。

- [ ] **Step 3: 运行目标组件测试并确认失败**

Run: `npm run test:component -- home-proxies-routing-cleanup.component.spec.js`

Working directory: `client-admin`

Expected: FAIL，提示 API mock 或按钮不存在。

- [ ] **Step 4: 增加 API 方法 `runPendingHomeRouteCleanupTask()`**

在 `client-admin/src/api/index.js` 调用 `apiClient.post('/home-proxies/cleanup-routes/run', {}, { timeout: 10000 })`，并补充方法职责与返回值注释。

- [ ] **Step 5: 增加页面按钮及提交状态**

在“添加家宽 IP”右侧增加 `type="primary" plain` 的按钮，复用 `Refresh` 图标；增加 `pendingCleanupSubmitting` 状态和页面方法，`try/finally` 保证状态恢复，成功时展示 `response.data.message`。不增加确认弹窗或列表刷新。

- [ ] **Step 6: 运行组件测试并确认通过**

Run: `npm run test:component -- home-proxies-routing-cleanup.component.spec.js`

Working directory: `client-admin`

Expected: 目标组件测试全部 PASS。

- [ ] **Step 7: 执行管理端生产构建**

Run: `npm run build`

Working directory: `client-admin`

Expected: Vite 构建成功，退出码为 0；如环境缺少 terser，则执行 `npx vite build --minify esbuild` 并记录原因。

### Task 4: 回归验证与提交整理

**Files:**
- Verify only: 本计划涉及的全部文件及既有家宽 routing 清理测试

**Interfaces:**
- Consumes: Tasks 1-3 的全部实现
- Produces: 可复核的测试日志和按项目规范整理的提交

- [ ] **Step 1: 运行家宽 routing 后端回归测试**

Run: `node server/test/test-clean-pending-home-routes-job.js`

Run: `node server/test/test-admin-home-routing-cleanup.js`

Run: `node server/test/test-user-home-routing-service.js`

Run: `node server/test/test-home-routing-pending-cleanup-repository.js`

Expected: 全部 PASS，退出码均为 0。

- [ ] **Step 2: 运行管理端组件测试与生产构建**

Run: `npm run test:component -- home-proxies-routing-cleanup.component.spec.js`

Run: `npm run build`

Working directory: `client-admin`

Expected: 测试和构建均成功。

- [ ] **Step 3: 检查差异与敏感信息**

Run: `git diff --check`

Run: `git status --short`

Expected: 无空白错误；变更只包含已确认设计及此前同功能未提交文件，不包含真实 token、密码或无关改动。

- [ ] **Step 4: 按当前项目规范整理提交（仅在用户已授权提交时执行）**

设计、规格和计划文档合并为一笔中文提交；功能实现与测试合并为一笔中文提交。`server/test/` 若被 `.gitignore` 忽略，使用 `git add -f` 精确添加本功能测试文件，不扩大暂存范围。

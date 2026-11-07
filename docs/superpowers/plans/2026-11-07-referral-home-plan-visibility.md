# 推广首页套餐展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为套餐增加“推广首页展示”开关，并仅在当前首页 URL 携带有效、已启用推广码时额外展示这些套餐。

**Architecture:** `plans` 表新增独立布尔字段，管理端沿用现有套餐 CRUD 写入。用户首页把当前 `ref` 传给套餐接口，后端通过现有推广码仓储校验后选择普通或推广可见性 SQL；点击统计和续费套餐查询保持独立、行为不变。

**Tech Stack:** Node.js 20、Express、express-validator、PostgreSQL、Vue 3、Vite、Element Plus、Node test runner

**Spec:** `docs/superpowers/specs/2026-11-07-referral-home-plan-visibility-design.md`

## Global Constraints

- 使用简体中文编写新增注释、测试说明和提交信息。
- 不创建或切换分支，不创建 Git worktree，直接在当前分支实施。
- 新字段名固定为 `show_on_referral_home`，数据库使用 `0/1`，历史数据与新建套餐默认值均为 `0`。
- “首页展示”保持所有首页可见；“推广首页展示”只在当前 URL 的 `ref` 对应 `referral_codes.enabled = 1` 时生效。
- 缺少、空白、无效、已禁用或超过 64 字符的 `ref` 均按普通首页处理，不让套餐接口报业务错误。
- 续费页查询、推广点击统计、推广奖励、套餐排序和售罄逻辑不得改变。
- 修改 `server/**/*.js` 后只提醒用户重启服务器，不自行启动服务。
- 文档合并为一笔中文提交，全部功能实现与测试合并为另一笔中文提交；未获用户同意不得推送。

## Review Focus

- `ref` 只有空白字符或超过 64 字符时，应跳过推广码查询并按普通首页返回套餐；Task 3 的服务测试固定此行为。
- 推广码存在但 `enabled = 0` 时，不得返回仅推广展示套餐；Task 3 的服务测试覆盖该分支。
- 两个展示开关同时开启时，有效和普通访问都只能返回一份套餐记录；Task 3 的仓储 SQL 测试固定使用单个 `OR` 条件而非结果拼接。
- 旧管理端未提交新字段时，创建默认 `0`、更新保持旧值；Task 2 的服务测试覆盖缺省字段。
- 当前 URL 不含 `ref`、但 `sessionStorage` 中留有历史推广码时，不得展示推广套餐；Task 5 的首页契约测试要求套餐请求只读取 `route.query.ref`。

---

### Task 1: 数据库字段与幂等迁移

**Files:**
- Create: `server/db/migrations/037-plan-referral-home-visibility.js`
- Create: `server/test/test-plan-referral-home-visibility-migration.js`
- Modify: `server/db/schema/tables.js`（`plans` 建表字段）

**Interfaces:**
- Consumes: 项目现有 PostgreSQL `Pool` 和 `031-plans-updated-at.js` 的事务式迁移模式。
- Produces: `async function up(pool): Promise<void>`、`async function migrate(): Promise<void>`，以及 `plans.show_on_referral_home INTEGER NOT NULL DEFAULT 0`。

- [ ] **Step 1: 写迁移失败测试**

在 `server/test/test-plan-referral-home-visibility-migration.js` 中用假连接池断言：`up(pool)` 依次执行 `BEGIN`、`ADD COLUMN IF NOT EXISTS show_on_referral_home ... DEFAULT 0`、设置默认值、把 `NULL` 回填为 `0`、设置 `NOT NULL`、`COMMIT`；任一 DDL 失败时执行 `ROLLBACK`，两条路径都释放连接。

- [ ] **Step 2: 运行迁移测试并确认失败**

Run: `node server/test/test-plan-referral-home-visibility-migration.js`

Expected: FAIL，提示找不到 `037-plan-referral-home-visibility` 模块。

- [ ] **Step 3: 实现迁移脚本**

在 `server/db/migrations/037-plan-referral-home-visibility.js` 实现并导出 `up`、`migrate`；使用专用连接和 `BEGIN/COMMIT/ROLLBACK/finally release`，直接执行 PostgreSQL DDL，不使用 `db.prepare().run()`。文件头和两个导出方法补充职责、参数及失败回滚语义注释。

- [ ] **Step 4: 同步全新数据库 schema**

在 `server/db/schema/tables.js` 的 `plans` 定义中，将新字段放在 `show_on_home` 后：`show_on_referral_home INTEGER NOT NULL DEFAULT 0`。

- [ ] **Step 5: 运行迁移测试并确认通过**

Run: `node server/test/test-plan-referral-home-visibility-migration.js`

Expected: 输出 `plan referral home visibility migration tests passed`，退出码为 0。

### Task 2: 管理端套餐 API 读写新开关

**Files:**
- Modify: `server/routes/admin/plans.js`（创建、更新参数校验）
- Modify: `server/repositories/plans-repository.js`（创建字段和值）
- Modify: `server/services/admin/plans-service.js`（格式化、默认值、动态更新）
- Modify: `server/test/test-monthly-plan-sales.js`（管理套餐服务测试）

**Interfaces:**
- Consumes: Task 1 产生的 `plans.show_on_referral_home`。
- Produces: 管理端套餐对象字段 `show_on_referral_home: 0 | 1`；创建 payload 缺省时写入 `0`，更新 payload 缺省时不修改。

- [ ] **Step 1: 写管理服务失败测试**

扩展 `server/test/test-monthly-plan-sales.js`：列表格式化应返回 `show_on_referral_home`；创建传 `true` 应把对应 INSERT 参数写成 `1`，不传时写成 `0`；更新传字符串 `'0'` 应生成 `show_on_referral_home = ?` 并写入 `0`，不传时 SQL 不包含该字段。

- [ ] **Step 2: 运行管理套餐测试并确认失败**

Run: `node --test server/test/test-monthly-plan-sales.js`

Expected: 新增断言 FAIL，显示缺少 `show_on_referral_home` 或 INSERT/UPDATE 参数不匹配。

- [ ] **Step 3: 扩展路由校验与仓储写入**

在两个管理端路由校验数组中加入可选布尔字段 `show_on_referral_home`；扩展 `plansRepository.createPlan(db, payload)` 的 `showOnReferralHome` 解构、INSERT 列和值，保持参数顺序在 `showOnHome` 后。

- [ ] **Step 4: 扩展管理套餐服务**

在 `formatPlan(plan)` 返回 `show_on_referral_home`；`createPlan(db, payload)` 用 `payload.show_on_referral_home === undefined ? 0 : normalizeBooleanFlag(...)`；`updatePlan(db, planId, payload)` 仅在字段存在时追加 `show_on_referral_home = ?`。

- [ ] **Step 5: 运行管理套餐测试并确认通过**

Run: `node --test server/test/test-monthly-plan-sales.js`

Expected: 全部子测试 PASS，退出码为 0。

### Task 3: 后端校验推广码并筛选首页套餐

**Files:**
- Create: `server/test/test-referral-home-plan-visibility.js`
- Modify: `server/repositories/plan-repository.js`（普通/推广首页 SQL）
- Modify: `server/services/user/plans-service.js`（推广码有效性与输出）
- Modify: `server/controllers/user/plans-controller.js`（传入查询参数）

**Interfaces:**
- Consumes: `referralRepository.findEnabledReferralCode(db, code): Promise<Object|undefined>` 和 Task 1 的新字段。
- Produces: `planRepository.findEnabledPlans(db, includeReferralHome = false): Promise<Array<Object>>`；`plansService.listAvailablePlans(db, referralCode = ''): Promise<Array<Object>>`。

- [ ] **Step 1: 写仓储和服务失败测试**

在新测试文件中覆盖：普通模式 SQL 只允许 `show_on_home = 1`；推广模式 SQL 使用 `(show_on_home = 1 OR show_on_referral_home = 1)`；有效启用码传 `true` 给仓储；不存在或禁用码传 `false`；空白和长度 65 的码不调用推广仓储；格式化结果包含 `show_on_referral_home` 且不改变排序、销量和售罄计算。

- [ ] **Step 2: 写控制器失败测试**

同一文件替换 `plansService.listAvailablePlans`，调用 `getPlans` 时断言第二个参数严格等于 `req.query.ref`；缺少查询参数时为 `undefined`，并保持原 `legacySuccess` 响应结构 `{ plans }`。

- [ ] **Step 3: 运行首页套餐后端测试并确认失败**

Run: `node --test server/test/test-referral-home-plan-visibility.js`

Expected: FAIL，显示当前仓储不接受推广模式，服务和控制器未传递 `ref`。

- [ ] **Step 4: 实现仓储条件切换**

把 `findEnabledPlans` 签名改为 `async function findEnabledPlans(db, includeReferralHome = false)`；两个分支共用相同 SELECT 字段、`enabled = 1` 和排序，仅可见性条件不同，并把 `show_on_referral_home` 加入 SELECT。不得通过合并两次查询结果实现，避免重复套餐。

- [ ] **Step 5: 实现服务端推广码校验**

把 `listAvailablePlans` 签名改为 `async function listAvailablePlans(db, referralCode = '')`：将输入转为去首尾空白的字符串；空值或长度超过 64 时不查库；其他值调用 `findEnabledReferralCode`，仅查询到记录时启用推广模式。格式化对象补充 `show_on_referral_home: 0 | 1`，并为新分支添加职责和核心语义注释。

- [ ] **Step 6: 让控制器传递当前查询参数**

在 `getPlans(req, res)` 中调用 `plansService.listAvailablePlans(req.app.locals.db, req.query.ref)`；无效推广码仍由服务降级为普通首页，不新增错误响应。

- [ ] **Step 7: 运行后端相关测试并确认通过**

Run: `node --test server/test/test-referral-home-plan-visibility.js server/test/test-monthly-plan-sales.js server/test/test-referral-service.js`

Expected: 全部子测试 PASS，退出码为 0。

### Task 4: 管理端增加推广首页展示开关

**Files:**
- Create: `client-admin/test/plan-referral-home-visibility.test.js`
- Modify: `client-admin/src/views/Plans.vue`（列表、移动卡片和编辑表单）

**Interfaces:**
- Consumes: Task 2 的 `show_on_referral_home: 0 | 1` 管理 API 字段。
- Produces: `planForm.show_on_referral_home: boolean`，新增/重置默认为 `false`，编辑时通过 `!!plan.show_on_referral_home` 归一化，提交时随现有 `planForm` 发送。

- [ ] **Step 1: 写管理端静态契约失败测试**

在新测试中读取 `Plans.vue` 并断言：表单标签为“推广首页展示”且位于“首页展示”和“是否上架”之间；绑定 `planForm.show_on_referral_home`；初始值与 `resetForm()` 为 `false`；`showEditDialog()` 使用双重取反；桌面列表与移动卡片都显示推广首页状态。

- [ ] **Step 2: 运行管理端测试并确认失败**

Run: `node --test client-admin/test/plan-referral-home-visibility.test.js`

Expected: FAIL，提示缺少推广首页字段或界面文案。

- [ ] **Step 3: 修改套餐管理页面**

在 `Plans.vue` 增加桌面“推广展示”列、移动卡片“首页展示/推广展示”字段和弹窗开关；更新 `planForm`、`showEditDialog(plan)`、`resetForm()`。沿用 Element Plus `el-switch`，不改变对话框宽度和其他字段顺序。

- [ ] **Step 4: 运行管理端契约测试和构建**

Run: `node --test client-admin/test/plan-referral-home-visibility.test.js client-admin/test/admin-secondary-mobile-cards.test.js`

Expected: 全部子测试 PASS。

Run: `npm run build`（工作目录：`client-admin`）

Expected: Vite 构建完成，退出码为 0。

### Task 5: 用户首页透传当前 URL 的推广码

**Files:**
- Create: `client-user/test/referral-home-plans.test.js`
- Modify: `client-user/src/api/index.js`（套餐接口可选参数）
- Modify: `client-user/src/views/Home.vue`（当前路由 `ref` 透传）

**Interfaces:**
- Consumes: Task 3 的 `GET /api/user/plans?ref=<code>`。
- Produces: `api.user.getPlans(referralCode = ''): Promise<Object>`；`Home.vue` 的每轮套餐加载只传 `String(route.query.ref || '').trim()`，不读取 `sessionStorage` 决定套餐可见性。

- [ ] **Step 1: 写用户端静态契约失败测试**

在新测试中读取 API 与首页源码并断言：`getPlans(referralCode = '')` 仅在去空白后非空时发送 `{ params: { ref } }`；`fetchPlans()` 把 `route.query.ref` 传入 `api.user.getPlans`；套餐请求路径不读取 `sessionStorage.getItem('referral_code')`；现有 `initializeReferralTracking()` 仍负责缓存和点击上报。

- [ ] **Step 2: 运行用户端测试并确认失败**

Run: `node --test client-user/test/referral-home-plans.test.js`

Expected: FAIL，提示 `getPlans` 没有参数或首页未透传 `ref`。

- [ ] **Step 3: 修改用户 API 与首页加载**

把 `getPlans` 改为接收可选推广码并构造 Axios 查询参数；在 `fetchPlans()` 开始时从当前 `route.query.ref` 归一化一次，并传给 `loadPlansWithRetry(() => api.user.getPlans(referralCode))`。不要等待点击上报完成后才请求套餐。

- [ ] **Step 4: 运行用户端相关测试和构建**

Run: `node --test client-user/test/referral-home-plans.test.js client-user/test/plan-loader.test.js client-user/test/home-plan-display.test.js`

Expected: 全部子测试 PASS。

Run: `npm run build`（工作目录：`client-user`）

Expected: Vite 构建完成，退出码为 0。

### Task 6: 全量验证与整理提交

**Files:**
- Verify: 本计划列出的全部新增与修改文件
- Commit: 功能实现和测试文件，不包含用户工作区的其他改动

**Interfaces:**
- Consumes: Tasks 1–5 的完整实现。
- Produces: 一笔可追溯的中文功能提交；不会执行 `git push`。

- [ ] **Step 1: 运行全部相关后端脚本**

Run: `node server/test/test-plan-referral-home-visibility-migration.js`

Run: `node --test server/test/test-referral-home-plan-visibility.js server/test/test-monthly-plan-sales.js server/test/test-referral-service.js`

Expected: 所有脚本退出码为 0，无 FAIL。

- [ ] **Step 2: 运行两个前端相关测试集**

Run: `node --test client-admin/test/plan-referral-home-visibility.test.js client-admin/test/admin-secondary-mobile-cards.test.js`

Run: `node --test client-user/test/referral-home-plans.test.js client-user/test/plan-loader.test.js client-user/test/home-plan-display.test.js`

Expected: 所有子测试 PASS。

- [ ] **Step 3: 执行两个生产构建**

Run: `npm run build`（工作目录：`client-admin`）

Run: `npm run build`（工作目录：`client-user`）

Expected: 两次 Vite 构建均成功，退出码为 0。

- [ ] **Step 4: 检查差异和格式**

Run: `git diff --check`

Run: `git status --short`

Expected: 无空白错误；只列出本功能文件和已知用户改动，不暂存无关文件。

- [ ] **Step 5: 合并为一笔功能提交**

只暂存 Tasks 1–5 的业务与测试文件，提交信息：

```bash
git commit -m "新增推广首页套餐展示开关"
```

- [ ] **Step 6: 向用户交付验证证据和部署提示**

展示后端测试、两个前端测试及构建日志摘要；说明新增迁移脚本 `037-plan-referral-home-visibility.js` 需要在生产部署时先执行；提醒修改了 `server/**/*.js`，部署后需由用户重启服务器；不得自行启动或推送。

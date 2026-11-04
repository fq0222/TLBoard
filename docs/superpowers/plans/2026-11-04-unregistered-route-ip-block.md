# 未注册路由 IP 临时封禁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一 IP 在 10 分钟内第二次访问未注册路由后封禁 30 分钟，同时确保所有已注册动态 token 路由不会被计数。

**Architecture:** 使用一个进程内共享的 `UnregisteredRouteBlocker` 实例维护尝试窗口和封禁截止时间。两个 Express 应用在业务路由前挂载封禁检查中间件，并且仅在各自最终兜底 404 中调用记录方法，因此业务控制器返回的 404、参数错误和无效 token 都不会进入扫描计数。

**Tech Stack:** Node.js 20、Express 4、CommonJS、`ipaddr.js`、Node.js `assert`/`http`

**Spec:** `docs/superpowers/specs/2026-11-04-unregistered-route-ip-block-design.md`

## Global Constraints

- 直接在当前 `main` 分支修改，不创建或切换分支，不创建 worktree。
- 默认统计窗口为 `600000` 毫秒、阈值为 `2` 次、封禁时长为 `1800000` 毫秒。
- IPv4 按单地址统计，IPv4-mapped IPv6 还原为 IPv4，原生 IPv6 按 `/64` 统计。
- 第二次未注册请求保持原有 404；从下一次请求开始返回 429，并设置向上取整秒数的 `Retry-After`。
- 已注册路由中的 400、401、403、404 或 429 响应不得增加未注册路由计数。
- 新增的有状态模块使用 `class`；新文件和新增方法必须包含职责、关键参数及核心分支注释。
- 不新增依赖，不写 PostgreSQL，不改变现有 token 限流器和 `trust proxy` 配置。
- 未经用户明确要求，不执行 `git add`、`git commit` 或 `git push`。
- 修改 `server/**/*.js` 后，交付时提醒用户重启服务器，但不自行启动常驻服务器。

## Review Focus

- 同一时刻恰好到达尝试窗口或封禁截止时间时，记录应视为过期并允许新窗口开始。
- IPv4、IPv4-mapped IPv6 和同一原生 IPv6 `/64` 必须形成预期的共享/隔离键。
- 已注册动态路由返回业务 404 或参数 400 时不得误触发封禁。
- 用户端触发的封禁必须立即作用于管理端，反向亦然。
- 大量不同扫描 IP 产生的过期记录必须可清理，且清理定时器不能阻止进程退出。

---

### Task 1: 共享未注册路由封禁器

**Files:**
- Create: `server/middleware/unregistered-route-blocker.js`
- Create: `server/test/test-unregistered-route-blocker.js`
- Modify: `server/config.js:81-86`
- Modify: `server/ecosystem.config.js` 的安全环境变量区

**Interfaces:**
- Consumes: `getIpRateLimitKey(ip)` from `server/utils/ip-rate-limit-key.js`；`config.security.unregisteredRouteWindowMs`、`unregisteredRouteMaxAttempts`、`unregisteredRouteBlockMs`
- Produces: `class UnregisteredRouteBlocker`，公开 `createGuardMiddleware()`、`recordNotFound(req)`、`cleanupExpired()`、`close()`；共享实例 `unregisteredRouteBlocker`
- `recordNotFound(req)` returns `{ blocked: boolean, blockedUntil: number | null, ipKey: string }`，供兜底处理器在不重复解析 IP 的前提下记录安全日志

- [ ] **Step 1: 编写封禁器失败测试**

在 `server/test/test-unregistered-route-blocker.js` 使用可推进的假时钟，覆盖以下具名断言：首次记录不封禁；10 分钟内第二次建立 30 分钟封禁；守卫返回 429、JSON 包装和正确 `Retry-After`；第二次记录自身仍可由兜底处理器返回 404；封禁到期后放行；尝试窗口到期后重新从 1 计数。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node server/test/test-unregistered-route-blocker.js`

Expected: FAIL，原因是 `server/middleware/unregistered-route-blocker.js` 尚不存在。

- [ ] **Step 3: 增加配置默认值**

在 `config.security` 增加：

- `unregisteredRouteWindowMs: parseInt(process.env.UNREGISTERED_ROUTE_WINDOW_MS) || 10 * 60 * 1000`
- `unregisteredRouteMaxAttempts: parseInt(process.env.UNREGISTERED_ROUTE_MAX_ATTEMPTS) || 2`
- `unregisteredRouteBlockMs: parseInt(process.env.UNREGISTERED_ROUTE_BLOCK_MS) || 30 * 60 * 1000`

在 `ecosystem.config.js` 的 `env` 和 `env_production` 安全配置中都写入对应的非敏感默认环境变量 `600000`、`2`、`1800000`。

- [ ] **Step 4: 实现最小封禁器**

实现构造签名 `new UnregisteredRouteBlocker(options = {})`，其中测试可注入 `now`、三个时长/阈值及 `cleanupIntervalMs`。内部使用 Map 保存每个归一化 IP 的 `{ attempts, windowStartedAt, blockedUntil }`；`createGuardMiddleware()` 在有效封禁时直接返回 429，否则调用 `next()`；`recordNotFound(req)` 只负责推进状态；所有到期比较使用 `now >= deadline`。

- [ ] **Step 5: 增加 IP 归一化与生命周期测试**

补充断言：`127.0.0.1` 与 `::ffff:127.0.0.1` 共享状态；同一 IPv6 `/64` 共享状态、不同 `/64` 隔离；`cleanupExpired()` 删除过期尝试和封禁；定时器调用 `unref()`；`close()` 可清理定时器且可重复调用。

- [ ] **Step 6: 运行封禁器测试并确认通过**

Run: `node server/test/test-unregistered-route-blocker.js`

Expected: PASS，并输出所有封禁器行为测试通过的汇总。

### Task 2: 接入用户端和管理端并验证 token 隔离

**Files:**
- Modify: `server/bootstrap/create-user-app.js:18-39`
- Modify: `server/bootstrap/create-admin-app.js:20-61`
- Modify: `server/bootstrap/register-user-routes.js:27-56`
- Modify: `server/bootstrap/register-admin-routes.js:29-60`
- Create: `server/test/test-unregistered-route-blocking-http.js`

**Interfaces:**
- Consumes: Task 1 的 `unregisteredRouteBlocker`、`createGuardMiddleware()`、`recordNotFound(req)`
- Produces: `createUserApp({ db, logger, routeBlocker = unregisteredRouteBlocker })`、`createAdminApp({ db, logger, routeBlocker = unregisteredRouteBlocker })`；两个注册函数接受第三个可选参数 `routeBlocker = unregisteredRouteBlocker`

- [ ] **Step 1: 编写真实 HTTP 失败测试**

创建共享的测试封禁器和两个随机端口应用，断言：用户端第一次、第二次未知路径均为 404，随后用户端健康检查为 429；同一 IP 的管理端健康检查也为 429；`Retry-After` 为 `1800`；推进 30 分钟后两个应用均恢复 200。

- [ ] **Step 2: 增加已注册动态路由隔离测试**

在两次未知路径之间分别请求已注册但参数无效的订阅动态路由 `/api/user/subscription/sub/test?clash=invalid`、下载动态路由 `/api/user/download/short-token` 和密码重置路由 `/api/user/reset-password`，断言这些响应不会提前触发封禁；请求已注册的 `/api/user/help/images/not-found.png` 并断言其业务 404 同样不进入最终兜底计数。

- [ ] **Step 3: 运行 HTTP 测试并确认按预期失败**

Run: `node server/test/test-unregistered-route-blocking-http.js`

Expected: FAIL，因为两个应用尚未挂载守卫且兜底 404 尚未记录。

- [ ] **Step 4: 在两个应用入口挂载共享守卫**

在 Morgan/请求解析之后、健康检查和业务路由之前调用 `app.use(routeBlocker.createGuardMiddleware())`。保留现有 `trust proxy` 层数，确保只使用 Express 已解析的 `req.ip` 或 socket 地址。

- [ ] **Step 5: 仅在最终兜底 404 中记录**

让 `registerUserRoutes` 和 `registerAdminRoutes` 的兜底处理器先调用 `routeBlocker.recordNotFound(req)`，若本次刚建立封禁则通过对应 logger 只输出返回结果中的归一化 `ipKey` 和 30 分钟封禁时长；随后仍发送原有 `{ code: 404, message: '接口不存在', data: null }`。不得根据 `res.statusCode` 或控制器结果进行全局统计，也不得把未知 URL 或查询参数写入新增警告日志。

- [ ] **Step 6: 运行新增测试**

Run: `node server/test/test-unregistered-route-blocker.js`

Expected: PASS。

Run: `node server/test/test-unregistered-route-blocking-http.js`

Expected: PASS，并输出用户端、管理端共享封禁及动态 token 隔离测试汇总。

- [ ] **Step 7: 运行相关后端回归测试**

Run: `node server/test/test-password-reset-submit-rate-limiter.js`

Expected: PASS，密码重置 token 限流行为保持不变。

Run: `node server/test/test-user-subscription-controller.js`

Expected: PASS，订阅控制器响应保持不变。

Run: `node server/test/test-wallet-routes.js`

Expected: PASS，现有注册/兜底路由装配断言保持通过。

- [ ] **Step 8: 检查最终变更和语法**

Run: `node --check server/middleware/unregistered-route-blocker.js`

Expected: 无输出，退出码 0。

Run: `git diff --check`

Expected: 无输出，退出码 0；设计、计划、实现和测试文件保持未暂存，等待用户确认。


# Subscription Service Unified Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原始订阅抓取改为类封装的 Axios 实现，并与 3X-UI 面板 API 共享同一代理配置。

**Architecture:** 抽取无状态的 Axios 代理配置构建器，供两个版本的面板客户端与 `SubscriptionService` 使用。订阅服务维护不带面板鉴权头的独立 Axios 实例，默认导出绑定方法的单例，并额外导出类以支持依赖注入测试。

**Tech Stack:** Node.js 20、CommonJS、Axios 1.6、Node `assert`、本地 HTTP 测试服务器

**Spec:** `docs/superpowers/specs/2026-10-27-subscription-service-proxy-design.md`

## Global Constraints

- 使用简体中文注释与提交信息；新建文件和新增方法必须说明职责、关键参数和核心分支语义。
- 不创建或切换分支，不创建 worktree；在当前 `main` 分支实施。
- 不修改外部 API、数据库、前端或现有环境变量名。
- 代理启用后原始订阅不得回退直连，也不得发送 3X-UI API Token。
- 保持现有导出方法、15 秒默认超时、单次超时覆盖及 `SUBSCRIPTION_FETCH_TIMEOUT` 兼容。
- 严格执行测试先行；生产代码修改前必须看到对应测试因缺少新行为而失败。
- 修改 `server/**/*.js` 后不启动服务器，交付时提醒用户重启。

## Review Focus

- `proxy.enabled=false` 时 Axios 必须显式禁用环境代理，直连行为不受环境变量影响。
- HTTP/HTTPS 代理协议、端口和认证字段必须与原面板客户端校验完全一致。
- 解构导入 `fetchOriginalSubscription` 后调用不能丢失实例上下文。
- 订阅 URL 重定向及跨域请求不能携带面板 `Authorization`。
- Axios 的超时、非 200 和连接失败必须维持既有可观察错误语义。

---

### Task 1: 统一 3X-UI Axios 代理配置构建器

**Files:**
- Create: `server/integrations/xui/xui-proxy-config.js`
- Modify: `server/integrations/xui/xui-api-client-v302.js`
- Modify: `server/integrations/xui/xui-api-client-v3102.js`
- Test: `server/test/test-xui-api-client.js`

**Interfaces:**
- Consumes: `proxy` 对象，字段为 `enabled/protocol/host/port/username/password`。
- Produces: `buildXuiProxyConfig(proxy = {}) -> false|AxiosProxyConfig`。

- [ ] **Step 1: 扩展代理客户端测试，覆盖公共构建器的关闭、协议归一化、认证和无效配置行为**

- [ ] **Step 2: 运行 `node server/test/test-xui-api-client.js`，确认因公共构建器尚不存在而失败**

- [ ] **Step 3: 新建 `xui-proxy-config.js`，迁移现有校验逻辑，并让两个版本客户端调用 `buildXuiProxyConfig`**

- [ ] **Step 4: 运行 `node server/test/test-xui-api-client.js`，确认通过且两个版本的 Axios `proxy` 配置保持一致**

- [ ] **Step 5: 自查仅发生机械提取，没有改变面板 API 的代理、鉴权、超时或重定向行为**

### Task 2: 将原始订阅服务改为 Axios 类并接入统一代理

**Files:**
- Modify: `server/services/shared/subscription-service.js`
- Modify: `server/test/test-subscription-service.js`
- Modify: `server/test/test-user-subscription-service.js`
- Test: `server/test/test-subscription-generation-performance.js`

**Interfaces:**
- Consumes: `buildXuiProxyConfig(config.xui.proxy)` 和可注入的 `httpClient/proxy/timeout`。
- Produces: `SubscriptionService` 类、默认单例，以及兼容现有调用的四个绑定方法。

- [ ] **Step 1: 在 `test-subscription-service.js` 增加类导出、解构调用、代理请求、无 Authorization、代理失败不回退、HTTP 状态和稳定超时错误测试**

- [ ] **Step 2: 运行 `node server/test/test-subscription-service.js`，确认因类和 Axios 代理行为尚不存在而失败**

- [ ] **Step 3: 实现 `SubscriptionService` 构造函数与 `createHttpClient()`，使用独立 Axios 实例、公共代理构建器和可注入依赖**

- [ ] **Step 4: 用 Axios 重写 `fetchOriginalSubscription(subUrl, subId, options = {})`，保留活动跟踪、超时覆盖和错误兼容**

- [ ] **Step 5: 将解析与筛选函数迁移为类方法，绑定公开方法并默认导出单例，同时导出 `SubscriptionService` 类**

- [ ] **Step 6: 运行 `node server/test/test-subscription-service.js`，确认新增测试通过**

- [ ] **Step 7: 运行 `node server/test/test-user-subscription-service.js`，确认用户订阅生成与缓存流程通过**

- [ ] **Step 8: 运行 `node server/test/test-subscription-generation-performance.js`，确认并发、超时和性能回归测试通过**

- [ ] **Step 9: 再次运行 `node server/test/test-xui-api-client.js`，确认公共代理构建器没有破坏面板访问**

- [ ] **Step 10: 检查 `git diff --check`，确认无空白错误，并记录全部测试日志**


# 原始订阅统一代理设计

## 意图

将 `server/services/shared/subscription-service.js` 改造成类，由独立 Axios 客户端负责原始订阅抓取，并与 3X-UI 面板客户端共享 `config.xui.proxy`。代理开启后，面板 API 和原始订阅都强制走同一代理；代理失败不回退直连。

## 目标

- 使用 `SubscriptionService` 类封装原始订阅抓取、解析与协议筛选。
- 保持现有 CommonJS 解构导入和公开方法签名兼容。
- 抽取统一的 Axios 代理配置构建器，供 3.0.2、3.10.2 面板客户端和订阅服务复用。
- 订阅客户端不携带 3X-UI 面板 `Authorization`。
- 保留 15 秒默认超时、单次超时覆盖、`SUBSCRIPTION_FETCH_TIMEOUT` 和既有业务错误文案。
- 继续接入 `xuiActivityTracker`，保持前后台请求调度语义。

## 非目标

- 不修改外部 API、数据库、前端或环境变量。
- 不把原始订阅请求放进 `XuiService`。
- 不新增订阅专用代理配置。
- 不在代理失败时自动回退直连。

## 方案

### 选择方案

在 shared service 中维护独立 Axios 实例，并通过公共代理配置构建器读取 `config.xui.proxy`。模块默认导出 `SubscriptionService` 单例，同时导出类供测试注入依赖。构造函数绑定公开方法，保证现有解构调用不会丢失 `this`。

### 备选方案

- 在订阅服务中复制代理转换逻辑：改动较小，但会与面板客户端产生规则漂移。
- 复用面板 Axios 实例：会把 API Token 带到订阅地址，存在凭证泄露风险。
- 重构统一 HTTP Transport：结构最完整，但超过本次需求范围。

## 关键行为

- `XUI_PROXY_ENABLED=false`：面板 API 和原始订阅均直连。
- `XUI_PROXY_ENABLED=true`：二者均使用同一代理，代理不可用则失败。
- 原始订阅客户端只发送通用请求头，不发送面板 API Token。
- HTTP 非 200、连接错误和响应异常仍拒绝请求；Axios 超时统一转换为原有稳定错误。
- `fetchOriginalSubscription(subUrl, subId, options)`、`parseSubscriptionContent(content)`、`pickSingleNodeLink(links, expectedProtocol)` 和 `getProtocolAliases(protocol)` 保持可用。

## 验证

- 代理构建器在两个面板客户端中的既有行为不变。
- 直连抓取、代理抓取、无 Authorization、代理失败不回退、超时错误映射、HTTP 状态错误均有自动化测试。
- 订阅解析、用户订阅生成及性能回归测试全部通过。


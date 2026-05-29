# Backend MVC + Service + Repository Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改现有接口、功能和业务语义的前提下，将 `server/` 后端逐步整理为 `MVC + Service + Repository + Integrations + Jobs` 的混合架构。

**Architecture:** 保留现有 `routes/` 和核心 service 对外能力，先拆启动层、DB 初始化层、任务层，再以低风险模块建立 `route + controller + service + repository` 样板，最后迁移订阅、XUI、流量、订单等复杂业务。整个过程以兼容旧接口、保留代码风格、保留现有注释语义为第一原则。

**Tech Stack:** Node.js、Express、PostgreSQL(`pg`)、现有中间件体系、现有 3X-UI / VMQ / Brevo 集成

---

## 约束与验收原则

- 不修改现有 API 路径、HTTP 方法、请求参数名、响应结构。
- 不修改现有数据库表结构语义，除非后续单独评审。
- 保留现有代码风格、命名习惯和注释表达方式；新增文件和新增方法补充职责注释。
- 旧 service 可先保留导出接口，内部逐步转调新分层实现，避免大范围调用方改动。
- 每个阶段单独可验收，允许暂停，不要求一次性完成全量重构。
- 涉及 `server/**/*.js` 修改后，按项目约定提醒用户手动重启服务，不自行启动。

## 目标目录结构

```text
server/
  app.js
  config.js
  bootstrap/
    create-user-app.js
    create-admin-app.js
    register-user-routes.js
    register-admin-routes.js
    register-shutdown.js
  controllers/
    user/
    admin/
  routes/
    user/
    admin/
  services/
    user/
    admin/
    shared/
  repositories/
  integrations/
    xui/
    vmq/
    email/
  jobs/
    index.js
    handlers/
  db/
    init.js
    schema/
    migrations/
  middleware/
  shared/
    response/
    errors/
    utils/
    constants/
  utils/
    logger.js
```

## 分层职责

### Route 层

- 只负责路径定义、中间件挂载、controller 调用。
- 不直接写复杂 SQL，不直接编排 3X-UI、支付、邮件、工单状态机逻辑。

### Controller 层

- 只负责解析参数、调用 service、返回统一响应。
- 不直接查库，不直接控制事务。

### Service 层

- 负责业务规则、事务、跨 repository/integration 编排。
- 是用户端、管理端、定时任务复用的核心层。

### Repository 层

- 负责 SQL、表访问、组合查询。
- 每个 repository 围绕一个表或一个强相关聚合。

### Integrations 层

- 负责 3X-UI、VMQ、Brevo 这类外部系统的适配与错误隔离。
- 将第三方字段格式差异限制在本层内部。

### Jobs 层

- `jobs/index.js` 只负责注册和停止任务。
- 具体任务拆到 `jobs/handlers/*.js`，由 handler 调用 service。

## 文件拆分总表

### 启动层

- 保留：`server/app.js`
- 新建：`server/bootstrap/create-user-app.js`
- 新建：`server/bootstrap/create-admin-app.js`
- 新建：`server/bootstrap/register-user-routes.js`
- 新建：`server/bootstrap/register-admin-routes.js`
- 新建：`server/bootstrap/register-shutdown.js`

### DB 初始化层

- 保留：`server/db/init.js`
- 新建：`server/db/schema/tables.js`
- 新建：`server/db/schema/indexes.js`
- 新建：`server/db/schema/default-data.js`

### 任务层

- 保留：`server/jobs/index.js`
- 新建：`server/jobs/handlers/mark-expired-orders.js`
- 新建：`server/jobs/handlers/delete-expired-orders.js`
- 新建：`server/jobs/handlers/clean-zombie-users.js`
- 新建：`server/jobs/handlers/sync-xui-users.js`
- 新建：`server/jobs/handlers/sync-xui-tasks.js`
- 新建：`server/jobs/handlers/sync-traffic.js`
- 新建：`server/jobs/handlers/auto-close-tickets.js`
- 新建：`server/jobs/handlers/release-expired-sales.js`
- 新建：`server/jobs/handlers/process-email-campaigns.js`
- 新建：`server/jobs/handlers/backup-xui-db.js`

### 公共能力层

- 新建：`server/shared/response/api-response.js`
- 新建：`server/shared/errors/app-error.js`
- 新建：`server/shared/errors/error-codes.js`
- 新建：`server/shared/utils/format-traffic.js`
- 新建：`server/shared/utils/pagination.js`
- 新建：`server/shared/utils/time.js`
- 新建：`server/shared/utils/db-transaction.js`
- 可迁移：`server/utils/site-url.js -> server/shared/utils/site-url.js`

### 业务层样板

- 新建：`server/controllers/user/*.js`
- 新建：`server/controllers/admin/*.js`
- 新建：`server/repositories/*.js`
- 增量整理：`server/services/user/*.js`
- 增量整理：`server/services/admin/*.js`
- 兼容保留：现有 `server/services/*.js`

## 业务流程描述

以下流程描述用于约束后续重构时的职责边界，确保“代码位置变化，不改变业务行为”。

### 1. 用户认证业务

流程：

1. 用户端路由接收登录、注册、鉴权请求。
2. controller 负责读取邮箱、密码、验证码或 token。
3. service 负责限流配合、密码校验、JWT 生成、用户状态判断。
4. repository 负责读取和更新 `users` 表。
5. controller 返回现有格式的登录结果。

重构目标：

- 将参数读取和响应格式从 `routes/user/auth.js` 下沉到 `controllers/user/auth-controller.js`。
- 将用户查找、用户创建、登录失败后的状态更新收敛到 `user-repository.js`。

### 2. 套餐展示与管理业务

流程：

1. 用户端读取可用套餐列表。
2. 管理端增删改查套餐。
3. service 负责启用状态、排序、销售数量等业务规则。
4. repository 负责 `plans` 表操作。

重构目标：

- 作为第一批低风险模块，建立标准样板。
- 形成 `plans route -> plans controller -> plans service -> plan repository` 的完整模板。

### 3. 公告与帮助内容业务

流程：

1. 用户端读取启用公告和帮助内容。
2. 管理端维护公告或文章内容。
3. service 负责启用状态、置顶状态、排序与内容聚合。
4. repository 负责 `announcements`、`blog_articles` 或相关表查询。

重构目标：

- 与套餐模块一起作为低风险迁移样板。
- 统一前后端使用的响应封装。

### 4. 管理端用户管理业务

流程：

1. 管理端读取用户列表、详情、编辑用户状态。
2. controller 解析分页、筛选、状态变更参数。
3. service 负责用户状态校验、套餐关系、同步触发条件。
4. repository 负责 `users` 相关 SQL。
5. 如涉及外部系统同步，由 service 调用 integration 或共享 service。

重构目标：

- 保持管理端接口不变。
- 将分页解析、布尔值转换等公共逻辑抽到 `shared/utils`。

### 5. 订单与支付业务

流程：

1. 用户下单，生成订单记录。
2. 调用 VMQ 创建支付链接。
3. 支付回调更新订单状态。
4. 订单支付成功后触发用户启用、套餐赋值、XUI 同步。

重构目标：

- 保持 `order-service.js` 作为兼容入口。
- 后续内部拆为 `order service + order repository + vmq integration + xui integration`。
- 这是高风险域，放在最后阶段迁移。

### 6. 续费业务

流程：

1. 用户发起续费或切换套餐请求。
2. service 判断是否在流量耗尽后 3 天内、套餐是否售罄、是否允许切换。
3. 支付成功后累加流量、更新到期时间、同步 3X-UI。
4. 若用户此前被自动禁用，续费后解除禁用并同步。

重构目标：

- 保持续费规则和订单号前缀规则完全不变。
- 事务边界仍保留在 service 层。

### 7. 订阅生成业务

流程：

1. 用户请求获取订阅或生成订阅。
2. service 根据缓存、节点配置、策略规则组织节点数据。
3. 必要时调用 XUI 同步服务或读取 `user_node_configs`、`user_subscriptions`。
4. 生成通用订阅或 Clash 配置并返回。

重构目标：

- 保持 URL、token、Clash 参数语义不变。
- 最后阶段再拆，避免前期误伤复杂逻辑。

### 8. XUI 同步业务

流程：

1. 用户购买、续费、启用、禁用后触发同步任务。
2. service 聚合用户、节点、订阅配置。
3. integration 层调用 3X-UI API，处理驼峰字段和唯一用户写入。
4. repository 更新 `user_node_configs`、`xui_nodes`、`xui_sync_tasks` 等数据。

重构目标：

- 外部 API 适配逐步转移到 `integrations/xui/`。
- 旧 `xui-service.js` 先保留导出接口，内部逐步分拆。

### 9. 流量同步与自动禁用业务

流程：

1. 定时任务触发流量同步。
2. service 汇总各 3X-UI 服务器用户流量。
3. repository 读取和更新 `traffic_sync_log`、`users` 等表。
4. service 判断是否超限，必要时禁用用户并同步到 XUI。
5. 用户续费后自动解除禁用。

重构目标：

- 将 `traffic-manager.js` 逐步拆为 `traffic service` 和 repository。
- 任务调度与业务处理彻底分离。

### 10. 工单业务

流程：

1. 用户创建工单、查看工单、回复、关闭工单。
2. 管理端查看、回复、关闭、删除工单。
3. service 负责状态流转、未读逻辑、自动关闭规则。
4. repository 负责 `tickets`、`ticket_replies`、`ticket_reads`。

重构目标：

- 作为中风险模块迁移。
- 保持 `open -> pending -> closed` 语义不变。

### 11. 资源下载业务

流程：

1. 管理端上传并分发资源。
2. 用户端通过 token 下载资源。
3. service 负责 token、有效期、下载次数和启用状态检查。
4. repository 负责 `resources`、`resource_distributions`。

重构目标：

- 适合作为中风险模块迁移样板。

### 12. 邮件模板与群发业务

流程：

1. 管理端维护模板和群发任务。
2. 定时任务扫描待发送记录。
3. service 负责用户筛选、发送批次、失败重试与日志记录。
4. integration 层调用 Brevo。

重构目标：

- 将第三方发送逻辑统一收口到 `integrations/email/`。
- 将定时任务调度与发送业务拆开。

### 13. 定时任务业务

流程：

1. 应用启动时注册所有后台任务。
2. 每个任务 handler 只负责调用 service 并记录日志。
3. service 负责真正的业务处理。
4. 应用关闭时统一停止任务。

重构目标：

- `jobs/index.js` 不再承载具体业务 SQL 和复杂同步逻辑。
- 每个任务一个 handler，便于测试和定位。

## 分阶段迁移计划

### 阶段一：拆启动层、DB 初始化层、任务层

目标：

- 降低超大文件复杂度。
- 不改任何业务规则。

范围：

- `server/app.js`
- `server/db/init.js`
- `server/jobs/index.js`

完成标准：

- `app.js` 只负责初始化、装配和生命周期。
- `db/init.js` 只负责连接池与初始化编排。
- `jobs/index.js` 只负责注册和停止。

验证：

- 运行现有后端相关测试脚本。
- 确认 `/health`、用户端和管理端服务都能正常装配。

### 阶段二：抽取公共复用层

目标：

- 为后续所有模块提供统一基础设施。

范围：

- `shared/response`
- `shared/errors`
- `shared/utils`

完成标准：

- 新旧模块都可复用统一响应工具、事务工具、分页工具、时间工具。
- 代码风格和注释风格保持一致。

验证：

- 低风险路由接入后响应结构不变化。

### 阶段三：低风险模块模板化迁移

推荐顺序：

1. `plans`
2. `announcements`
3. `blogs/help`
4. `dashboard`

目标：

- 建立稳定的迁移模板。

完成标准：

- 每个模块都具备 `route + controller + service + repository` 闭环。
- 原有前端和接口调用不需修改。

验证：

- 对应后端测试或最小构建验证通过。
- 管理端 / 用户端相关接口回归检查通过。

### 阶段四：中风险模块迁移

推荐顺序：

1. `auth`
2. `users`
3. `tickets`
4. `resources`
5. `email`

目标：

- 将状态流转、权限、分页、消息等常见业务模式迁入标准分层。

完成标准：

- 认证、用户、工单、资源、邮件模块不再在 route 中直写主要业务逻辑。

验证：

- 运行对应测试脚本。
- 重点回归登录、工单状态流转、资源下载 token、邮件任务记录。

### 阶段五：复杂业务域迁移

推荐顺序：

1. `orders`
2. `renew`
3. `payment`
4. `subscription`
5. `xui-service / xui-sync-task-service`
6. `traffic-manager`

目标：

- 完成复杂域的最终收口。

完成标准：

- 复杂业务的路由层只剩参数和响应。
- 事务在 service 中集中。
- 第三方 API 适配在 integrations 中集中。

验证：

- 运行支付、续费、流量、XUI、速率限制相关测试脚本。
- 保持现有订阅格式、节点策略和自动禁用逻辑不变。

## 模块迁移模板

以后续迁移 `plans` 为例：

```text
routes/user/plans.js
  -> controllers/user/plans-controller.js
    -> services/user/plans-service.js
      -> repositories/plan-repository.js
        -> db.prepare(...)
```

规则：

- route 保留原路径文件名，减少导入范围变更。
- controller 只关心入参与响应。
- service 只关心业务。
- repository 只关心数据。

## 验证策略

### 后端验证

- 每个阶段完成后运行 `server/test/` 下相关脚本。
- 对于直接影响后端启动的改动，至少验证健康检查和关键模块初始化。

### 前端联动验证

- 如果影响用户端或管理端接口装配，补充执行前端构建验证。
- 保持接口字段名和返回格式稳定，避免额外前端改动。

### 日志验证

- 保留现有 logger 调用风格。
- 任务拆分后仍能从日志区分 `USER`、`ADMIN`、`JOBS`、`DB` 等来源。

## 风险控制

- 不在一个提交内同时改启动层和复杂业务规则。
- 不在一个提交内同时迁移多个高风险模块。
- XUI、订阅、流量相关改动最后做，并逐个验证。
- 若发现旧逻辑耦合过深，优先加兼容转发层，不直接硬改所有调用方。

## 建议的提交粒度

1. 拆启动层
2. 拆 DB 初始化层
3. 拆任务层
4. 抽公共能力
5. 迁移 `plans`
6. 迁移 `announcements`
7. 迁移 `help/blogs/dashboard`
8. 迁移 `auth/users/tickets/resources/email`
9. 迁移 `orders/renew/payment/subscription/xui/traffic`

提交说明要求：

- 使用中文提交信息。
- 每次提交只覆盖一个清晰目标。

## 不建议一起修改的组合

- 不要把 `orders + payment + renew + subscription` 放在同一次改动里。
- 不要把 `xui-service + traffic-manager + jobs/index.js` 放在同一次改动里。
- 不要在未建立低风险模块样板前直接迁移复杂业务。

## 实施前检查单

- [ ] 当前分支独立，不在主分支直接操作
- [ ] 明确当前阶段目标，只做一个阶段
- [ ] 明确本阶段影响的文件列表
- [ ] 明确本阶段的验证脚本
- [ ] 明确是否会影响 `server/**/*.js`，若影响则完成后提醒用户重启

## 实施后检查单

- [ ] 接口路径未改变
- [ ] 响应结构未改变
- [ ] 注释风格与现有代码一致
- [ ] 新增文件和新增方法已补充职责注释
- [ ] 已运行相关测试脚本并保留日志
- [ ] 已记录本阶段完成范围与剩余风险

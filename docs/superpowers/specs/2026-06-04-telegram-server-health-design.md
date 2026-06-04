# Telegram 服务器健康巡检设计

## 背景

当前 Telegram Bot 的 `/servers` 指令读取 `telegram_server_health_checks` 表中的服务器状态，但状态来源存在两个问题：

1. `panel_api_status` / `panel_auth_status` 目前混在流量同步任务里，职责不够清晰，不利于后续扩展 Telegram 巡检能力。
2. `xray_runtime_status` 仍然长期为 `unknown`，Telegram Bot 无法及时展示真实的 Xray 运行状态。

为便于后续持续扩展 Telegram 相关巡检能力，本次将“面板健康检测 + Xray 运行状态检测”从 `traffic-manager` 中独立出来，做成一个专门的 Telegram 巡检任务。

## 目标

- 新增一个文件名包含 `telegram` 关键字的独立定时任务。
- 任务每 `40 分钟` 执行一次。
- 统一写入：
  - `panel_api_status`
  - `panel_auth_status`
  - `xray_runtime_status`
- 通过真实调用 `GET /panel/api/server/status` 获取实际返回值，并从中提取 `xray state`。
- 即使请求失败、返回结构不符或解析失败，程序也不能崩溃；应降级写入可接受状态。
- 删除 `traffic-manager` 中现有的面板健康检测逻辑，避免多入口覆盖同一张健康表。

## 方案选择

本次采用“独立 Telegram 巡检任务”方案，而不是继续挂在流量同步任务中。

原因：

- 更符合 Telegram Bot 的后续演进方向，后面如果要增加 CPU、内存、磁盘、负载、连接数等状态，只需继续扩展这一条任务链路。
- 避免 `traffic-manager` 混入越来越多与“流量统计”无关的职责。
- 避免不同任务共同写 `telegram_server_health_checks` 导致状态来源不明确。

## 架构设计

### 1. 新增独立任务

新增任务文件：

- `server/jobs/handlers/telegram-server-health-check.js`

职责：

- 枚举在线 `xui_servers`
- 检测面板 API 可达性
- 检测面板鉴权状态
- 调用 `/panel/api/server/status`
- 提取并标准化 `xray state`
- 将结果写入 `telegram_server_health_checks`
- 根据失败情况补充或清理 `panel_unreachable` 告警

调度方式：

- 首次延迟建议与现有巡检任务保持一致，采用短延迟启动
- 之后每 `40 分钟` 执行一次

### 2. 扩展 3X-UI API 客户端

需要修改：

- `server/integrations/xui/xui-api-client-v302.js`
- `server/integrations/xui/xui-api-client-v325.js`

新增能力：

- 支持访问 `GET /panel/api/server/status`

要求：

- 两个版本客户端都暴露统一方法，例如 `getServerStatus()`
- 因为 3.2.5 的 server 接口仍复用旧版 server 路径，所以 `v325` 可以沿用父类实现
- 接口访问失败时只抛出已有的结构化错误，不新增会导致上层崩溃的异常形态

### 3. 扩展 XuiService

需要修改：

- `server/integrations/xui/xui-service.js`

新增能力：

- 封装一个上层读取方法，例如 `getServerStatus()`

职责：

- 调用底层 client 的 `getServerStatus()`
- 统一返回 `{ success, data, message }`
- 尝试从真实返回中提取 `xray state`
- 如果返回结构不符合预期，不抛出未处理异常，而是返回失败或 `unknown`

### 4. 抽离 Telegram 巡检服务逻辑

建议扩展：

- `server/services/shared/telegram-monitor-service.js`

新增职责：

- 统一标准化面板状态和 Xray 状态
- 统一写入 `telegram_server_health_checks`
- 统一处理告警打开与清理

这样 job handler 只负责调度和遍历服务器，不直接堆大量状态判断细节。

## 状态判定规则

### 面板 API 与鉴权状态

沿用当前已经确认的判定口径：

- 鉴权失败：
  - `panel_api_status = healthy`
  - `panel_auth_status = unhealthy`
- API 不通、超时、DNS 错误、网络错误：
  - `panel_api_status = unhealthy`
  - `panel_auth_status = unknown`
- 请求成功：
  - `panel_api_status = healthy`
  - `panel_auth_status = healthy`

### Xray 运行状态

来源：

- `GET /panel/api/server/status`

写入规则：

- 成功解析到明确 `xray state` 时，写入标准化后的值
- 请求失败、字段缺失、结构异常、无法识别时，写入 `unknown`

标准化策略：

- 若返回为明显“运行中”语义，写入 `running`
- 若返回为明显“停止”语义，写入 `stopped`
- 其他无法稳定归类的值，先保留原始值的小写标准化版本，或回退 `unknown`

最终以真实接口返回为准，先通过脚本验证字段位置和内容后再锁定映射。

## 数据流

1. 定时任务启动
2. 查询在线 `xui_servers`
3. 对每台服务器创建 `XuiService`
4. 先做面板能力探测
5. 再调用 `/panel/api/server/status`
6. 提取 `xray state`
7. 统一写入 `telegram_server_health_checks`
8. 更新或清理相应告警
9. 继续处理下一台服务器

任何单台服务器异常都不应中断整个任务。

## 错误处理

### 原则

- 任何网络错误、鉴权错误、结构解析错误都不能导致任务崩溃
- 任何单台服务器失败都不能影响其他服务器巡检
- 对错误尽量保留 `failure_reason` 与 `failure_detail`

### 失败分类

- 面板访问失败：
  - 写 `panel_*` 失败状态
  - `xray_runtime_status = unknown`
- `server/status` 单独失败：
  - 面板状态仍按成功写入
  - `xray_runtime_status = unknown`
- 返回结构异常：
  - 记录 `failure_detail`
  - `xray_runtime_status = unknown`

## 要修改的文件

- 修改：`server/integrations/xui/xui-api-client-v302.js`
- 修改：`server/integrations/xui/xui-api-client-v325.js`
- 修改：`server/integrations/xui/xui-service.js`
- 修改：`server/services/shared/telegram-monitor-service.js`
- 新增：`server/jobs/handlers/telegram-server-health-check.js`
- 修改：`server/jobs/index.js`
- 修改：`server/services/shared/traffic-manager.js`
- 新增或修改：`server/test/` 下对应测试脚本
- 新增：用于真实接口只读验证的脚本

## 测试设计

### 自动化测试

需要覆盖：

- `v302` / `v325` 新增 `getServerStatus()` 方法
- 面板鉴权失败时状态写入正确
- 面板 API 不通时状态写入正确
- `server/status` 成功时写入 `xray_runtime_status`
- `server/status` 失败时不崩溃且写 `unknown`
- 新任务调度间隔为 `40 分钟`
- `traffic-manager` 不再负责 Telegram 面板健康写入

### 真实只读验证

新增脚本对真实配置服务器执行只读请求：

- 调用 `/panel/api/server/status`
- 打印原始返回值
- 打印提取出的 `xray state`

这一步的目标是锁定真实字段名与返回结构，而不是依赖文档猜测。

## 风险与规避

### 风险 1：不同 3X-UI 版本返回结构不一致

规避：

- 先对真实服务器执行只读验证
- 提取逻辑做兼容与兜底，字段缺失时回退 `unknown`

### 风险 2：面板状态与 Xray 状态更新来源混乱

规避：

- 从 `traffic-manager` 删除现有健康写入
- 保证仅由 Telegram 独立巡检任务负责这张表

### 风险 3：接口失败导致任务中断

规避：

- 单台服务器维度独立 try/catch
- 上层统一返回结构化结果，不让解析异常冒泡

## 非目标

- 本次不扩展 Telegram Bot 的展示文案
- 本次不引入新的数据库字段
- 本次不做 CPU、内存、磁盘、负载等额外状态采集
- 本次不改动 4 小时账号同步任务的业务同步目标，仅保持其不负责健康状态写入

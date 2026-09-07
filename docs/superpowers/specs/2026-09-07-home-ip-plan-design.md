# 家宽 IP 套餐设计规格

## 背景

系统已有流量套餐、限时套餐和家宽 IP outbound 管理能力。现在需要在管理端套餐管理中新增“家宽 IP 套餐”，让管理员可以把套餐绑定到 `home_proxies.tag`，并在用户购买后保存用户当前持有的家宽 IP 套餐。该能力仅为后续用户面板自助配置 3X-UI routing 做数据准备，本次不实现 routing 绑定。

## 目标

- 管理端套餐管理支持新增、编辑和展示家宽 IP 套餐。
- 家宽 IP 套餐不限制流量，只限制有效时间。
- 家宽 IP 套餐必须绑定一个家宽 IP `tag`。
- 用户必须已经拥有主流量套餐，才能购买家宽 IP 套餐。
- 用户购买家宽 IP 套餐后，系统单独保存家宽套餐 ID 和家宽权益到期时间。
- 主流量套餐和家宽 IP 套餐互不覆盖。

## 非目标

- 不实现用户面板中的 3X-UI routing 绑定操作。
- 不自动修改 3X-UI routing 规则。
- 不改变现有家宽 IP outbound 同步逻辑。
- 不允许新用户注册首单购买家宽 IP 套餐。
- 不把家宽 IP 套餐计入流量统计、流量超限禁用或主订阅流量额度。

## 数据模型

### plans

新增字段：

- `home_proxy_tag VARCHAR(255)`：家宽 IP 套餐绑定的 `home_proxies.tag`。仅 `plan_type = 'home_ip'` 时必填。

套餐类型扩展：

- `lifetime`：不限时流量套餐，历史默认类型。
- `timed`：限时流量套餐。
- `home_ip`：家宽 IP 套餐。

家宽 IP 套餐规则：

- `duration_days` 必须大于 0。
- `traffic_limit` 固定保存为 `0`。
- `home_proxy_tag` 必须非空。
- `home_proxy_tag` 必须能在 `home_proxies` 表中找到对应记录。

### users

新增字段：

- `home_plan_id INTEGER`：用户当前持有的家宽 IP 套餐 ID。
- `home_expire_at BIGINT`：用户当前家宽 IP 权益到期时间，秒级 Unix 时间戳。

字段语义：

- `plan_id` 和 `expire_at` 继续表示主流量套餐。
- `home_plan_id` 和 `home_expire_at` 仅表示家宽 IP 附加套餐。
- 用户没有家宽 IP 套餐时，两个字段允许为空。

## 管理端套餐管理

套餐类型控件新增“家宽IP套餐”选项。

选择家宽 IP 套餐时：

- 有效天数输入保持可用，最小值为 1。
- 流量上限输入隐藏或禁用，提交时统一写入 `0`。
- 显示 `home_proxy_tag` 字段，优先用下拉选择当前 `home_proxies` 列表中的 tag；如果复用接口成本过高，可以先用文本输入并由后端校验。
- 首页展示、上架状态、排序、销售总量继续复用现有字段。

套餐列表需要展示：

- 套餐类型中文名“家宽IP套餐”。
- 家宽 IP tag；非家宽套餐显示 `-`。
- 家宽套餐流量上限显示“不限制流量”。

## 用户购买规则

注册首单：

- `/api/user/auth/register-and-pay` 不允许选择 `plan_type = 'home_ip'`。
- 如果用户选择家宽 IP 套餐注册，返回业务错误“家宽 IP 套餐仅支持已购买流量套餐的用户购买”。

已登录购买：

- 已拥有主流量套餐的用户可以通过现有续费下单接口购买家宽 IP 套餐。
- 如果用户没有主流量套餐，购买家宽 IP 套餐返回业务错误“请先购买流量套餐后再购买家宽 IP 套餐”。
- 家宽 IP 套餐售罄检查继续使用 `sales_limit` / `sales_count`。

支付完成：

- 普通流量套餐仍按现有逻辑更新 `users.plan_id`、`users.traffic_limit`、`users.expire_at`，并触发 3X-UI 用户同步。
- 家宽 IP 套餐只更新 `users.home_plan_id` 和 `users.home_expire_at`，不覆盖主流量套餐字段。
- 家宽 IP 套餐支付成功不触发 3X-UI 用户同步，不重置流量。
- 家宽 IP 套餐购买成功后增加该套餐 `sales_count`。

家宽权益时间计算：

- 如果用户当前 `home_expire_at` 是未来时间，新家宽套餐从当前 `home_expire_at` 顺延。
- 如果用户当前 `home_expire_at` 为空、为 0 或已过期，新家宽套餐从支付完成时间开始计算。
- 到期时间为 `baseTime + duration_days * 86400`。

## 续费列表

现有主流量套餐续费列表继续只返回当前主套餐类型下的流量套餐。

家宽 IP 套餐购买入口可以复用现有已登录套餐页面中的家宽 IP 套餐区域：

- 该区域展示 `plan_type = 'home_ip'` 且已上架、首页可见的套餐。
- 提交时仍调用现有续费下单接口。
- 该接口需要允许家宽 IP 套餐作为附加购买，不再要求目标套餐类型等于当前主套餐类型。

## 查询与展示数据

用户资料接口后续可以返回：

- `home_plan_id`
- `home_plan_name`
- `home_expire_at`
- `home_proxy_tag`

本次至少保证后端已具备查询这些字段的基础数据。前端用户面板自助 routing 功能不在本次范围。

## 兼容性

- 历史套餐 `plan_type` 为空时仍按 `lifetime` 处理。
- 历史用户没有 `home_plan_id` / `home_expire_at` 时按未购买家宽 IP 套餐处理。
- 普通流量套餐不需要填写 `home_proxy_tag`，后端输出为空字符串或 `null`。

## 验证要求

后端：

- 新增迁移脚本，幂等添加 `plans.home_proxy_tag`、`users.home_plan_id`、`users.home_expire_at`。
- 更新表初始化结构，确保新部署包含新增字段。
- 新增或更新测试脚本覆盖：
  - 管理端创建家宽 IP 套餐时必须填写有效 tag。
  - 家宽 IP 套餐流量上限保存为 0。
  - 注册首单禁止购买家宽 IP 套餐。
  - 已有主套餐用户购买家宽 IP 套餐后写入 `home_plan_id` 和 `home_expire_at`。
  - 家宽 IP 套餐支付成功不覆盖 `plan_id`、`traffic_limit`、`expire_at`。

前端：

- 执行 `cd client-admin && npx vite build --minify esbuild`。

服务端：

- 修改 `server/**/*.js` 后提醒用户重启后端服务。

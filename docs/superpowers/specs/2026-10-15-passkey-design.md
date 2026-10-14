# Passkey 功能设计

> 状态：已确认，待制定实施计划。

## 1. 目标与范围

为用户账号增加基于 WebAuthn 的 Passkey 免密登录能力，同时保留现有邮箱密码登录作为备用方式。

- 用户可在“我的”页面添加、查看和删除自己的 Passkey。
- 每个用户最多绑定 2 个 Passkey。
- 用户可为 Passkey 设置名称；名称为空时自动使用“Passkey 1”“Passkey 2”。
- 登录页提供独立的“Passkey 登录”入口，无需先输入邮箱。
- 管理员可分页检索、查看和撤销用户 Passkey，但不能代用户添加、查看私钥或导出密钥材料。
- 用户端和管理端均展示 Passkey 名称、创建时间和最近使用时间。

## 2. 技术方案

后端采用 `@simplewebauthn/server`，用户端采用 `@simplewebauthn/browser`。WebAuthn 凭据与一次性挑战均持久化到 PostgreSQL，以支持 PM2 多进程、请求跨进程处理和服务重启。

生产环境参数：

- RP Name：通过 `WEBAUTHN_RP_NAME` 配置，默认使用站点名称。
- RP ID：`tl.lolok.dpdns.org`。
- Expected Origin：`https://tl.lolok.dpdns.org`。
- 浏览器通过不带端口的 HTTPS 地址访问用户端，反向代理将请求转发至内部端口。

生产环境若缺少或无法解析 Passkey 配置，Passkey 相关接口应返回明确的服务不可用错误，不能使用请求头动态猜测 RP ID 或 Origin。

## 3. 数据库设计

### 3.1 `users` 表扩展

新增字段：

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `webauthn_user_id` | `VARCHAR(64)` | `UNIQUE`，允许为空 | WebAuthn 稳定用户标识；首次绑定时随机生成，不从邮箱或数据库主键推导 |

同一用户的所有 Passkey 共用该标识。字段允许为空，以兼容尚未使用 Passkey 的既有用户。

### 3.2 `user_passkeys` 表

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 | 本地凭据 ID |
| `user_id` | `BIGINT` | 外键，非空 | 关联 `users.id`，用户删除时级联删除 |
| `credential_id` | `TEXT` | 全局唯一，非空 | Base64URL 编码的 WebAuthn Credential ID |
| `public_key` | `BYTEA` | 非空 | COSE 公钥；服务器不保存私钥 |
| `counter` | `BIGINT` | 非空，默认 0 | 签名计数器 |
| `transports` | `JSONB` | 非空，默认 `[]` | 凭据支持的传输方式 |
| `device_type` | `VARCHAR(32)` | 允许为空 | `singleDevice` 或 `multiDevice` |
| `backed_up` | `BOOLEAN` | 非空，默认 `FALSE` | 凭据是否已备份/同步 |
| `name` | `VARCHAR(50)` | 非空 | 用户可识别名称 |
| `created_at` | `BIGINT` | 非空 | 创建时间，Unix 秒 |
| `last_used_at` | `BIGINT` | 允许为空 | 最近一次成功登录时间，Unix 秒 |

索引：

- `UNIQUE (credential_id)`：凭据只能属于一个用户。
- `INDEX (user_id, created_at)`：用户端列表与数量检查。
- `INDEX (last_used_at)`：管理端排序和审计查询。

### 3.3 `webauthn_challenges` 表

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | `VARCHAR(64)` | 主键 | 返回给前端的随机流程 ID，不使用连续序号 |
| `challenge` | `TEXT` | 非空 | SimpleWebAuthn 生成的挑战 |
| `ceremony_type` | `VARCHAR(16)` | 非空 | `registration` 或 `authentication` |
| `user_id` | `BIGINT` | 允许为空，外键 | 注册挑战必须有关联用户；无用户名登录挑战为空 |
| `expires_at` | `BIGINT` | 非空 | 过期时间，默认签发后 5 分钟 |
| `used_at` | `BIGINT` | 允许为空 | 消费时间；非空后不可再次使用 |
| `created_at` | `BIGINT` | 非空 | 创建时间 |

索引：

- `INDEX (expires_at)`：清理过期挑战。
- `INDEX (user_id, ceremony_type, created_at)`：使新挑战失效及审计查询。

挑战必须由密码学安全随机数生成，并在验证时通过数据库事务原子消费。验证失败的挑战同样标记为已消费，防止重放和反复试探。过期或已消费挑战返回统一错误。

### 3.4 迁移与初始化

- 新增幂等迁移脚本，负责添加用户字段、创建两张表及索引。
- 同步更新 `server/db/schema/tables.js` 和 `server/db/schema/indexes.js`，保证全新安装与升级安装结构一致。
- 用户本地数据删除流程补充 Passkey 与挑战清理；外键级联作为最终保护。

## 4. 后端模块边界

### 4.1 Passkey Repository

职责：只负责 Passkey、挑战及稳定用户标识的数据库读写，不包含 WebAuthn 协议判断。

核心操作：

- 获取或创建用户的 `webauthn_user_id`。
- 按用户列出 Passkey、统计数量。
- 按 Credential ID 查询凭据及所属用户。
- 在事务中锁定用户并新增凭据，强制最多 2 个。
- 更新签名计数器与 `last_used_at`。
- 用户或管理员撤销凭据。
- 创建、读取并原子消费挑战。

### 4.2 Passkey Service

使用 class 封装 RP 配置、WebAuthn 协议操作和业务规则，符合项目对有状态、多方法模块的组织约束。

职责：

- 生成注册选项与登录选项。
- 验证注册结果和认证结果。
- 校验当前密码后发起绑定或删除操作。
- 检查每用户最多 2 个 Passkey。
- 生成默认名称并校验名称长度。
- 登录成功后更新计数器和最近使用时间。
- 复用现有用户登录状态检查和 JWT 签发逻辑。

关键 WebAuthn 参数：

- 注册：`residentKey: 'required'`。
- 注册与认证：要求 User Verification。
- Attestation：`none`，不采集不必要的设备证明信息。
- 注册时通过 `excludeCredentials` 排除用户已有凭据。
- 无用户名认证时不限定 `allowCredentials`，由浏览器显示该 RP 下可用的可发现凭据。

### 4.3 Controller 与路由

Controller 保持项目现有职责：处理参数校验结果、日志、HTTP 状态及统一响应结构；业务规则全部下沉到 Passkey Service。

## 5. 用户端 API

### `GET /api/user/auth/passkeys`

需要用户 JWT。返回当前用户的 Passkey 列表与配额：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": 1,
        "name": "Windows Hello",
        "created_at": 1792051200,
        "last_used_at": 1792137600
      }
    ],
    "limit": 2,
    "remaining": 1
  }
}
```

不得返回 `public_key`、`credential_id`、计数器或内部用户标识。

### `POST /api/user/auth/passkeys/registration/options`

需要用户 JWT。请求体：

```json
{
  "password": "当前密码",
  "name": "Windows Hello"
}
```

处理顺序：

1. 验证当前密码。
2. 校验名称并检查当前数量。
3. 获取或创建稳定 WebAuthn 用户标识。
4. 生成注册选项并保存 5 分钟挑战。
5. 返回 `ceremony_id` 和浏览器注册选项。

密码仅用于本次二次验证，不存入挑战表。

### `POST /api/user/auth/passkeys/registration/verify`

需要用户 JWT。请求体包含 `ceremony_id` 和浏览器返回的 registration response。

处理顺序：

1. 原子读取并消费属于当前用户的注册挑战。
2. 按固定 RP ID 与 Origin 验证响应。
3. 在事务中锁定用户并再次检查数量上限。
4. 保存凭据公钥及元数据。
5. 返回新建凭据的公开信息。

### `DELETE /api/user/auth/passkeys/:id`

需要用户 JWT，请求体包含当前密码。只能删除属于当前用户的凭据。删除成功后返回剩余数量。

### `POST /api/user/auth/passkey/login/options`

公开接口。生成不绑定用户的认证挑战，不接收邮箱，并返回 `ceremony_id` 和认证选项。

### `POST /api/user/auth/passkey/login/verify`

公开接口。根据 Credential ID 找到用户与公钥，消费认证挑战并验证签名。成功后：

1. 执行与密码登录一致的用户状态检查。
2. 在事务中更新签名计数器和 `last_used_at`。
3. 签发与密码登录相同结构和有效期的 JWT。
4. 异步记录登录 IP 归属地。

不存在、已撤销、校验失败或用户不可登录时，对外返回统一认证失败信息。

## 6. 管理端 API

### `GET /api/admin/passkeys`

需要管理员 JWT。支持参数：

- `page`
- `limit`
- `keyword`：匹配用户邮箱或 Passkey 名称

以用户为分页单位，返回用户 ID、邮箱、配额和 `passkeys` 数组；每个密钥只包含 ID、名称、创建时间和最近使用时间。`total` 表示匹配的用户总数，而不是密钥总数。同一用户的两个密钥不得拆到不同分页。不得返回公钥、Credential ID、计数器和用户标识。

示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "user_id": 1,
        "email": "fuqiang_2015@163.com",
        "passkey_count": 2,
        "passkey_limit": 2,
        "passkeys": [
          {
            "id": 11,
            "name": "Windows Hello",
            "created_at": 1791796200,
            "last_used_at": 1792036680
          },
          {
            "id": 12,
            "name": "iPhone",
            "created_at": 1790583900,
            "last_used_at": 1791621720
          }
        ]
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 15
  }
}
```

### `DELETE /api/admin/passkeys/:id`

需要管理员 JWT。撤销指定 Passkey，并记录管理员、目标用户、凭据名称和操作时间到服务日志。管理员不能代用户新增 Passkey。

## 7. 安全与错误处理

- 新增和删除 Passkey 均要求用户重新输入当前密码。
- 注册和认证挑战有效期为 5 分钟、只允许使用一次。
- 数量上限必须由事务和用户行锁保证，不能只依赖前端检查。
- Credential ID 必须全局唯一。
- Passkey 登录接口使用独立速率限制，成功请求不计入失败次数，失败响应不泄露账号或凭据存在性。
- 服务端只信任配置中的 RP ID 和 Origin，不信任可伪造的 Host、Origin 转发头来动态决定验证目标。
- 浏览器不支持 Passkey、用户取消系统弹窗、挑战过期和认证失败分别映射为可理解但不泄密的提示。
- 服务端不保存或接触私钥；管理员也无法导出可用于认证的密钥材料。
- 日志不得写入完整 Challenge、Credential ID、公钥或浏览器认证响应。

## 8. 用户端交互设计

### 8.1 “我的”页面

- 在现有浅色页面中增加独立的 Passkey 操作区域。
- 使用横向列表布局：顶部为标题、说明、`已添加 N / 2` 和“添加 Passkey”按钮；下方为名称、创建时间、最近使用时间和删除操作。
- 最近使用时间为空时显示“尚未使用”。
- 达到 2 个密钥时禁用添加按钮，并提示“每个账户最多添加 2 个 Passkey”。
- 移动端将表头式布局转换为纵向信息块，保证名称、时间和操作按钮完整可读。

添加流程：

1. 用户点击“添加 Passkey”。
2. 弹窗要求填写密钥名称和当前密码；名称允许为空。
3. 前端请求注册选项，密码错误时停留在弹窗内，不唤起系统验证窗口。
4. 密码验证通过后调用浏览器 WebAuthn API。
5. 用户完成系统验证后提交注册结果；成功时关闭弹窗并刷新列表。
6. 用户取消系统窗口时只恢复页面状态，不显示红色错误提示。

删除流程：

1. 用户点击指定密钥的“删除”。
2. 中文确认弹窗说明删除后的影响，并要求输入当前密码。
3. 删除成功后刷新配额和列表。

### 8.2 登录页

- 保持现有登录页布局、配色、文案和右侧说明区不变。
- 将原整行“登录”按钮区域拆为两个等宽按钮，间距 12px。
- 左侧为绿色实心主按钮“登录”，提交邮箱密码表单。
- 右侧为绿色描边次按钮“Passkey 登录”，配安全密钥图标；点击后直接开始无用户名认证，不读取或提交邮箱和密码输入框。
- 浏览器不支持 WebAuthn 或页面不是安全上下文时，禁用 Passkey 按钮并提示“当前浏览器或访问环境不支持 Passkey”；密码登录保持可用。
- 移动端优先保持双按钮同行；可缩减间距和字号，但不改变左右顺序。

## 9. 管理端交互设计

- 在现有深色侧栏中新增独立入口“Passkey 管理”，使用现有激活态与 Element Plus 页面样式。
- 页面标题为“Passkey 管理”，副标题为“查看和撤销用户的 Passkey 密钥”。
- 工具栏提供单一搜索框，按用户邮箱或密钥名称搜索。
- 表格以用户为一行，邮箱只显示一次，并显示 `N / 2` 配额。
- 同一用户的密钥在该行内纵向分组；每个密钥分别展示名称、创建时间、最近使用时间和独立撤销按钮。
- 分页总数按用户计算，界面显示“共 N 位用户”。
- 撤销前使用中文确认框，说明该密钥将不能再用于登录；成功后只刷新当前数据，不影响用户的其他密钥。
- 管理端不提供新增、导出、公钥查看或 Credential ID 查看功能。
- 移动端将每名用户渲染为一个记录块，内部继续按密钥分行展示和撤销。

## 10. 错误处理

| 场景 | 用户端行为 |
| --- | --- |
| 当前密码错误 | 提示“当前密码错误”，不启动系统 Passkey 窗口 |
| 用户取消系统窗口 | 结束 loading 并保持原页面，不显示错误通知 |
| 挑战过期或已消费 | 提示“验证已过期，请重新操作” |
| 达到数量上限 | 刷新列表并提示“每个账户最多添加 2 个 Passkey” |
| 重复绑定同一凭据 | 提示“该 Passkey 已绑定，无需重复添加” |
| 凭据不存在或已撤销 | 统一提示“Passkey 验证失败，请重试或使用密码登录” |
| 浏览器不支持或非安全上下文 | 禁用 Passkey 按钮，显示环境不支持提示 |
| 网络错误 | 保留当前页面状态并提示稍后重试 |
| RP 配置不可用 | 提示“Passkey 服务暂不可用，请使用密码登录或联系管理员” |
| 用户状态不允许登录 | 复用密码登录现有账号状态提示 |

前端需要区分浏览器取消产生的 `NotAllowedError` 与服务端认证失败，不能把用户主动取消显示为安全错误。所有提交按钮在请求和浏览器验证期间防重复点击。

## 11. 测试与验收

### 11.1 后端自动化测试

在 `server/test/` 新增 Passkey 测试脚本，至少覆盖：

- 注册选项包含固定 RP ID、固定 Origin、可发现凭据和 User Verification 要求。
- 正常注册并保存公钥、计数器、传输方式和设备元数据。
- 注册前当前密码验证失败。
- 每用户最多 2 个密钥，包括两个并发注册完成请求。
- 挑战超时、类型错误、用户不匹配和重复消费。
- 错误 RP ID、Origin、Challenge 或签名验证失败。
- 无用户名登录通过 Credential ID 识别正确用户。
- 成功登录签发与密码登录一致的 JWT，并原子更新计数器和最近使用时间。
- 不存在或已撤销凭据返回统一错误。
- 禁用用户或不满足现有登录条件时不能通过 Passkey 绕过限制。
- 用户只能删除自己的密钥，管理员可撤销指定密钥。
- 管理端按用户分页、按邮箱或密钥名称搜索，同一用户凭据正确分组。

运行新增脚本，并回归与用户认证、速率限制和本地用户删除相关的既有脚本。

### 11.2 前端组件测试

用户端覆盖：

- 登录页双按钮分别触发密码登录和 Passkey 登录。
- Passkey 登录不要求或提交邮箱。
- 不支持 WebAuthn 和非安全上下文时按钮禁用。
- 用户取消系统窗口不显示错误消息。
- “我的”页面列表、空状态、时间格式、添加/删除弹窗和 2 个上限状态。
- 移动端布局不会溢出。

管理端覆盖：

- 同一用户的两个密钥合并为一行，并可分别撤销。
- 搜索参数、按用户分页和空状态。
- 撤销确认框使用中文按钮，成功后刷新列表。
- 移动端用户记录块正确展示多个密钥。

两个前端分别执行组件测试和生产构建。

### 11.3 实机验收

- 在 `https://tl.lolok.dpdns.org` 验证 RP ID 与 Origin 配置。
- 至少使用 Windows Hello 完成添加、免密登录、最近使用时间更新和删除。
- 至少使用手机同步 Passkey 或跨设备二维码流程完成一次免密登录。
- 验证密码登录始终可作为备用方式。
- 实机验收如需使用项目测试账号，执行前先征得用户同意。

## 12. 已确认决策

- 保留邮箱密码登录。
- Passkey 用于免密码登录。
- 登录时无需先填写邮箱。
- 每个用户最多添加 2 个 Passkey。
- 用户新增和删除时均进行当前密码二次验证。
- Passkey 支持用户命名，空名称自动生成。
- 用户端和管理端展示名称、创建时间和最近使用时间。
- 管理员只能查看元数据和撤销凭据。
- 采用 SimpleWebAuthn 与 PostgreSQL 持久化挑战。
- 用户端采用浅色横向列表布局，与现有“我的”页面视觉一致。
- 登录页原按钮区域拆为左侧密码登录和右侧 Passkey 登录。
- 管理端以用户为分页和表格行单位，同一用户的两个密钥在行内分组。

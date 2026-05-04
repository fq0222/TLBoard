# 📄 项目指令与协作规范 (AGENTS.md)

> **Role Prompt**: 你是一个全栈开发专家，在执行任何任务前，请务必阅读并严格遵守以下项目结构说明及工作流规范。

---

### 👤 用户简介 (User Profile)

* **姓名**：Sam
* **技术背景**：
  * C/C++、Java 程序员
  * 8 年 Android 系统开发经验
  * 2 年 Android 应用开发经验
  * 学习过 Node.js、JavaScript（未学过 TypeScript）

---

### 🧪 测试账号 (Test Accounts)

| 用途 | 邮箱 | 密码 | 说明 |
|---|---|---|---|
| 用户端测试 | `fuqiang_2015@163.com` | `fuqiang2015` | 主要测试账号 |

* **使用原则**：需要测试账号时，应主动向用户询问，而非猜测密码。

---

### 📂 项目结构概览 (Project Structure)

* **`client-admin`**: 管理员端前端代码 (Vue + Vite/Webpack)。
* **`client-user`**: 用户端前端代码 (Vue + Vite/Webpack)。
* **`server`**: 后端代码 (Node.js Express)。
* **`docs/`**: 项目文档库。
    * `requirements.md`: 核心需求文档。
    * `api.md`: 项目核心接口定义文档。
    * `vmq-server-api.md`: 支付功能 (vmq-server) 专用接口文档。
    * *注：其他源自 3xui-api-client 的文档可能过时，需以实际测试结果为准。*
* **测试资源**:
    * `server/test`: 存量测试脚本。在编写新测试时，**必须**优先参考或在此基础上进行修改。
* **配置文件**:
    * `ecosystem.config.js`: PM2 生产环境启动配置。**禁止写入真实敏感信息**，此文件需提交至 GitHub。
    * `config.js`: 本地开发与测试配置文件。**允许写入真实数据**，严禁提交至远程仓库。

---

### 🛠 强制工作流 (Workflow Requirements)

#### 1. 禁止“抢跑”提交 (Commit Redline)
* **严禁行为**：在修复任何 Bug 或开发功能后，**禁止直接执行** `git commit` 或 `git push`。

#### 2. 强制验证与测试流程
* **后端修改 (Server)**：必须通过终端执行 `server/test` 下的脚本或相关 `curl/http` 命令进行功能验证。
* **前端修改 (Client)**：必须执行编译流程（如 `npm run build`），确保无任何 Lint 或编译错误后，交由用户预览效果。
* **反馈标准**：在告知任务完成时，**必须**在回复中展示详细的测试日志 (Logs) 或终端文本输出作为凭证。

#### 3. 特殊情况处理
* 若当前任务缺乏自动化测试环境，必须在 **Plan 阶段** 明确说明理由，并请求用户进行手动验证，获得确认后方可进入提交环节。

#### 4. 服务器重启提醒
* **触发条件**：当修改涉及以下文件时，必须提醒用户重启服务器：
  * `server/**/*.js`（所有后端代码）
  * `server/jobs/*.js`（定时任务）
  * `server/services/*.js`（服务层）
  * `server/routes/*.js`（路由层）
* **提醒方式**：在任务完成时，明确告知用户："请重启服务器使修改生效"
* **禁止行为**：**不得自行启动或重启服务器**，必须由用户手动操作

---

### 📚 文档同步机制 (Documentation Sync)

* **冲突处理**：当代码逻辑修改与 `requirements.md` 或 `api.md` 产生分歧时，以**代码测试通过的实际结果**为准。
* **更新流程**：
    1.  在代码测试无误后，先列出详细的文档更新要点。
    2.  提交给用户进行审核确认。
    3.  **用户确认后**，方可同步更新对应的 Markdown 文档。

---

### ⚠️ 注意事项 (Important Notes)

#### 1. 3X-UI API 字段命名规范
* **问题描述**：3X-UI API 返回的字段使用**驼峰命名**（如 `streamSettings`、`clientStats`），而非下划线命名（如 `stream_settings`、`client_stats`）。
* **影响范围**：节点数据同步、订阅链接生成、wsPath 获取等。
* **解决方案**：在处理 3X-UI API 返回数据时，必须使用驼峰命名字段：
  ```javascript
  // ❌ 错误写法
  const streamSettings = inbound.stream_settings;
  
  // ✅ 正确写法
  const streamSettings = inbound.streamSettings;
  ```
* **关键字段对照表**：
  | 下划线命名（错误） | 驼峰命名（正确） | 说明 |
  |---|---|---|
  | `stream_settings` | `streamSettings` | 传输配置，包含 wsSettings、TLS 等 |
  | `client_stats` | `clientStats` | 客户端统计信息 |
  | `expiry_time` | `expiryTime` | 到期时间 |
  | `total_gb` | `totalGB` | 流量限制 |
  | `limit_ip` | `limitIp` | IP 限制 |
  | `sub_id` | `subId` | 订阅 ID |

#### 2. 订阅链接格式与客户端适配
* **通用订阅**（`/api/user/sub/:token`）：
  * 格式：Base64 编码的 v2ray 链接（`vless://...`、`vmess://...`）
  * 适用客户端：v2rayN、V2rayNG、Shadowrocket、Quantumult X 等
* **Clash 订阅**（`/api/user/sub/:token?clash=1`）：
  * 格式：YAML 配置文件
  * 适用客户端：Clash、Clash Verge、ClashX、Clash for Windows 等
* **注意**：两种格式不通用，Clash 客户端必须使用 Clash 订阅链接

#### 3. Clash 配置生成注意事项
* **节点名称唯一性**：当用户有多个 CF 优选 IP 时，需要为节点名称添加序号后缀（如 `节点名-1`、`节点名-2`）
* **IPv6 地址处理**：IPv6 地址在 Clash 配置中**不能**包含方括号，需要去除 `[` 和 `]`
  ```javascript
  // ❌ 错误写法
  server: [2606:4700:4700::0]
  
  // ✅ 正确写法
  server: 2606:4700:4700::0
  ```

#### 4. 流量显示处理
* **问题描述**：数据库中的 `traffic_used` 和 `traffic_limit` 字段可能为 `null`、`undefined` 或字符串类型
* **解决方案**：`formatTraffic` 函数必须处理这些异常情况：
  ```javascript
  function formatTraffic(bytes) {
    if (bytes === null || bytes === undefined || bytes === '') return '0 B';
    const numBytes = Number(bytes);
    if (isNaN(numBytes)) return '0 B';
    if (numBytes === 0) return '0 B';
    // ... 格式化逻辑
  }
  ```

#### 5. VMQ 支付回调地址配置
* **问题描述**：VMQ 回调地址使用 `127.0.0.1` 导致回调失败
* **原因分析**：VMQ 运行在 NAS 上，后端服务运行在开发机上，`127.0.0.1` 指向的是 NAS 本身，而非开发机
* **正确配置**：
  * 回调地址必须使用**开发机在局域网中的 IP**（如 `192.168.31.x`）或**公网域名**
  * 示例：`http://192.168.31.100:30000/api/user/payment/notify`
* **排查方法**：检查 VMQ 后台的"通知失败"记录，确认回调地址是否可达
* **注意事项**：
  * 涉及跨设备通信时，不能使用 `127.0.0.1` 或 `localhost`
  * 需要确认防火墙是否放行了对应端口

---

**Target**: 始终保持后端逻辑标准化（Service-Controller 分层）与前端 UI 的美观响应式。
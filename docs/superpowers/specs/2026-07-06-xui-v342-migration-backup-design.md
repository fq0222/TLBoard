# 3X-UI V3.4.2 迁移备份适配设计

## 背景与结论

目标服务器运行 3X-UI V3.4.2，并已切换到 PostgreSQL。经登录目标面板并读取其 OpenAPI 3.0.3 文档确认：

- 当前项目使用的 `/panel/api/inbounds/*`、`/panel/api/clients/*` 和 `/panel/api/server/status` 路由仍然存在。
- V3.4.2 继续使用 V3.2.5 引入的 `/panel/api/clients` 路由族，现有客户端管理适配逻辑可以复用。
- `/panel/api/server/getDb` 仍存在，但 PostgreSQL 模式下用于跨存储引擎备份的接口是 `GET /panel/api/server/getMigration`。
- `getMigration` 在 PostgreSQL 模式下从实时数据生成 SQLite `.db` 文件并以附件形式返回。

因此，V3.4.2 的业务 API 与当前项目兼容，但数据库备份下载需要使用新增的迁移接口。

## 设计

### V3.4.2 API 客户端

新增 `server/integrations/xui/xui-api-client-v342.js`，继承 `XuiApiClientV325`：

- 将实例版本设置为 `3.4.2`。
- 保留 V3.2.5 已实现的 clients API 转换逻辑。
- 新增 `getMigration()`，通过已有 `download()` 方法请求 `/panel/api/server/getMigration`，保持 Bearer Token、超时、活动请求跟踪和二进制响应处理一致。

版本工厂为 `3.4.2` 单独注册该客户端，不修改旧版本映射和未知版本回退行为。

### 备份任务

`server/jobs/backupDB.js` 继续通过版本工厂创建客户端。下载时采用能力判断：

```javascript
const data = typeof client.getMigration === 'function'
  ? await client.getMigration()
  : await client.getDb();
```

这样 V3.4.2 自动使用迁移备份，V3.0.2、V3.2.5 和 V3.3.1 保持原有 `getDb()` 行为。下载结果仍校验 SQLite 文件头，避免把 JSON 错误响应写成备份文件。

### 错误处理

- HTTP、认证、超时错误继续由现有 Axios 拦截器抛出并由备份任务统计为失败。
- `getMigration` 返回内容若不是 SQLite 文件，任务标记失败且不覆盖已有有效备份。
- 不在仓库中保存面板账号、密码、API Token 或 OpenAPI 原始文件。

## 验证

扩展现有两份测试：

1. `server/test/test-xui-api-client.js`
   - 工厂正确解析 `3.4.2`。
   - 客户端版本为 `3.4.2` 且继续支持 clients API。
   - `getMigration()` 使用 GET、正确路径、Bearer Token 和 `arraybuffer`。
2. `server/test/test-xui-db-backup-job.js`
   - 具备 `getMigration()` 的客户端优先调用该方法。
   - 旧客户端仍回退到 `getDb()`。
   - 两类下载均通过 SQLite 文件头校验并正确写入。

运行：

```bash
node server/test/test-xui-api-client.js
node server/test/test-xui-db-backup-job.js
```

本次不调用真实服务器的 `getMigration`，避免生成和下载真实生产备份；真实凭据仅用于只读文档核验。


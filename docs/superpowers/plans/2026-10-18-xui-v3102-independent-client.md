# 3X-UI v3.10.2 独立客户端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增完全独立的 3X-UI v3.10.2 API 客户端，并通过现有工厂创建，同时保持当前业务字段、服务层调用方式和 `/panel/api/inbounds/list` 流量同步逻辑不变。

**Architecture:** 新客户端独立实现请求基础设施与现有公开方法，不继承或导入旧版本客户端。工厂仅新增精确的 `3.10.2` 映射；现有业务服务继续依赖相同方法签名和原始 `{ success, msg, obj }` 响应。

**Tech Stack:** Node.js、CommonJS、Axios、Node.js `assert`

**Spec:** 本聊天中已批准的 bounded 设计（2026-10-18）

## Global Constraints

- 必须新建 `server/integrations/xui/xui-api-client-v3102.js`，不得继承、导入或委托旧版客户端类。
- 必须继续由 `server/integrations/xui/xui-api-client-factory.js` 创建客户端，并精确匹配版本 `3.10.2`。
- 客户端新增和更新 payload 只保留当前项目已经发送的字段，不引入 v3.10.2 新业务字段。
- 流量同步继续调用 `GET /panel/api/inbounds/list`，不得改用 `/panel/api/clients/list` 或主动上报。
- 不修改服务层公开接口、数据库结构、前端或项目文档。
- 新文件和新增方法必须使用中文注释说明职责、关键参数和核心分支。
- 不创建或切换分支，不创建 worktree，不启动服务器，不推送远程。

## Review Focus

- `3.10.2` 必须精确解析到独立类，不能回退到 `3.0.2`。
- v3.10.2 客户端不得通过继承或导入旧版客户端共享实现。
- `getInbounds()` 必须仍请求 `/panel/api/inbounds/list`。
- 旧 `settings.clients[0]` 与新 `{ client, inboundIds }` 两种调用形态必须保持兼容。
- 更新 payload 不得意外增加 `limitHwid/resetDay/resetWeekday/resetMax/reverse` 等当前项目未管理字段。

---

### Task 1: 独立 v3.10.2 客户端与工厂接入

**Files:**
- Create: `server/integrations/xui/xui-api-client-v3102.js`
- Modify: `server/integrations/xui/xui-api-client-factory.js`
- Modify: `server/test/test-xui-api-client.js`

**Interfaces:**
- Consumes: 当前 `XuiService` 依赖的 API 客户端公开方法签名和 `{ success, msg, obj }` 原始响应。
- Produces: `XuiApiClientV3102` 类，以及工厂中 `3.10.2 -> XuiApiClientV3102` 的精确映射。

- [ ] **Step 1: 写失败测试**

在 `server/test/test-xui-api-client.js` 添加断言，覆盖工厂分流、独立类身份、Bearer 鉴权、代理/超时、inbound/client/server/Xray 路由、两种客户端 payload，以及未引入新业务字段。

- [ ] **Step 2: 运行测试并确认因缺少 v3.10.2 实现而失败**

Run: `node server/test/test-xui-api-client.js`

Expected: FAIL，失败原因是工厂尚未解析 `3.10.2` 或独立类尚不存在。

- [ ] **Step 3: 实现独立客户端并接入工厂**

创建 `XuiApiClientV3102`，独立实现当前客户端公开方法；保留当前字段构造规则和 URL 编码；注册精确版本映射。

- [ ] **Step 4: 运行客户端测试并确认通过**

Run: `node server/test/test-xui-api-client.js`

Expected: 输出 `test-xui-api-client: PASS`。

- [ ] **Step 5: 运行语法与相关回归测试**

Run:

```powershell
node --check server/integrations/xui/xui-api-client-v3102.js
node --check server/integrations/xui/xui-api-client-factory.js
node server/test/test-traffic-server-email-dedup.js
node server/test/test-admin-xui-user-sync.js
node server/test/test-user-subscription-service.js
node server/test/test-telegram-health-status.js
```

Expected: 所有命令退出码为 `0`，各测试脚本输出 `PASS`。

- [ ] **Step 6: 自审并提交**

仅暂存本任务三个文件，提交信息使用中文：`新增 3X-UI v3.10.2 独立客户端适配`。

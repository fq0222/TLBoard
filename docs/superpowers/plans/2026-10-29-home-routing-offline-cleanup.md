# 家宽 routing 离线服务器待清理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户跳过离线旧服务器完成家宽换绑，并持久化待清理服务器供后续修改、到期处理和管理员删除时收敛。

**Architecture:** 在现有 route 行上增加 `pending_cleanup_server_ids`，由共享 home routing service 统一执行“先清理、后绑定”。管理员删除服务器通过事务清理两个 JSON 文本数组；前端仅负责过滤回填和展示跳过提示。

**Tech Stack:** Node.js、Express、PostgreSQL、Vue 3、Element Plus、Node.js `assert` 测试脚本

**Spec:** `docs/superpowers/specs/2026-10-29-home-routing-offline-cleanup-design.md`

## Global Constraints

- 严格保持先删除旧 routing、再绑定新服务器。
- 在线旧服务器删除失败时必须中止，不能绑定新服务器。
- 离线服务器允许跳过并写入 `pending_cleanup_server_ids`。
- 不增加服务器恢复后的独立定时清理任务。
- 新建文件和新增方法必须补充职责、关键参数及核心分支注释。
- 不创建或切换分支，不创建 worktree。
- 后端修改后必须提醒用户重启服务器，不自行启动。

## Review Focus

- 待清理 ID 被重新选择时应从清理目标排除，并在成功绑定后从待清理集合移除。
- 多台在线旧服务器部分删除成功、随后失败时不得开始新绑定，重试删除必须幂等。
- 服务器记录已不存在时应从待清理集合清除，不能永久阻塞。
- `server_ids=[]` 但待清理非空的内部 route 不应在用户端显示为当前有效绑定。
- 管理员删除最后一个活动或待清理 ID 时应删除空 route，且任一步失败都回滚服务器删除。

---

### Task 1: 数据库字段与仓储读写

**Files:**
- Create: `server/db/migrations/036-home-routing-pending-cleanup.js`
- Modify: `server/db/schema/tables.js`
- Modify: `server/repositories/user-home-routing-repository.js`
- Create: `server/test/test-home-routing-pending-cleanup-migration.js`

**Interfaces:**
- Produces: route 记录字段 `pending_cleanup_server_ids`，默认值 `'[]'`。
- Produces: `upsertUserHomeRoute(db, payload)` 接收 `payload.pendingCleanupServerIds: number[]`。
- Produces: `removeServerIdFromAllHomeRoutes(db, serverId): Promise<void>`，同时清理两个数组并删除空 route。

- [ ] **Step 1: 编写迁移失败测试**

覆盖新增字段、默认值、幂等检查、事务提交和异常回滚；断言迁移使用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`。

- [ ] **Step 2: 运行迁移测试确认失败**

Run: `node server/test/test-home-routing-pending-cleanup-migration.js`

Expected: FAIL，原因是迁移文件或导出接口尚不存在。

- [ ] **Step 3: 实现迁移并同步全新安装表结构**

迁移导出可注入连接池的 `up(pool)`；命令行入口复用 `server/db/init.js`。在 `tables.js` 的 `user_home_proxy_routes` 定义中加入同名字段。

- [ ] **Step 4: 运行迁移测试确认通过**

Run: `node server/test/test-home-routing-pending-cleanup-migration.js`

Expected: PASS，事务顺序为 `BEGIN`、字段变更、`COMMIT`，异常路径包含 `ROLLBACK`。

- [ ] **Step 5: 扩展仓储测试并实现数组持久化方法**

在迁移测试文件增加仓储断言：upsert 同时写入两个数组；`removeServerIdFromAllHomeRoutes` 从两列去除目标正整数 ID，并删除两个数组都为空的记录。实现时沿用项目数据库代理占位符，不拼接用户输入。

- [ ] **Step 6: 运行 Task 1 测试**

Run: `node server/test/test-home-routing-pending-cleanup-migration.js`

Expected: PASS。

- [ ] **Step 7: 提交 Task 1**

```bash
git add server/db/migrations/036-home-routing-pending-cleanup.js server/db/schema/tables.js server/repositories/user-home-routing-repository.js server/test/test-home-routing-pending-cleanup-migration.js
git commit -m "功能：增加家宽 routing 待清理字段"
```

### Task 2: 先清理后绑定的服务流程

**Files:**
- Modify: `server/services/shared/home-routing-service.js`
- Modify: `server/test/test-user-home-routing-service.js`

**Interfaces:**
- Consumes: `route.pending_cleanup_server_ids` 和 `upsertUserHomeRoute(...pendingCleanupServerIds)`。
- Produces: 更新结果中的 `skipped_cleanup_servers: Array<{id:number,name:string,message:string}>`。
- Produces: 内部清理结果 `{ failedServers, skippedServers, remainingPendingServerIds }`，供更新、删除和到期清理复用。

- [ ] **Step 1: 编写离线旧服务器换绑失败测试**

新增测试：当前绑定服务器离线、新服务器在线时，旧服务器不调用 XUI，先进入待清理集合，随后新服务器收到绑定请求并保存新 `server_ids`。

- [ ] **Step 2: 编写在线删除失败顺序测试**

新增测试：在线旧服务器删除抛错时，断言新服务器没有收到 `getXrayConfig` 或更新请求、route 没有写入新绑定、错误包含失败服务器。

- [ ] **Step 3: 编写历史待清理重试和重新选择测试**

分别断言：在线 pending ID 在下一次修改时先被删除；重新选中的 pending ID 不执行删除并在成功保存后从 pending 列表移除；不存在的 pending ID直接丢弃。

- [ ] **Step 4: 运行服务测试确认失败**

Run: `node server/test/test-user-home-routing-service.js`

Expected: FAIL，现有 `loadInvolvedServers` 会因离线旧服务器提前抛错。

- [ ] **Step 5: 实现清理目标分类与严格执行顺序**

在 `home-routing-service.js` 增加有注释的解析、集合合并和清理辅助方法。`updateHomeRouting` 先校验所有新服务器在线，再顺序完成清理阶段；在线删除失败直接抛出 4107，只有清理阶段通过才调用新绑定同步。

- [ ] **Step 6: 保存待清理状态并调整 route 格式化**

成功时写入两个数组并返回 `skipped_cleanup_servers`。当 `server_ids` 为空但 pending 非空时，配置选项的 `route` 对用户端返回 `null`，内部记录仍保留。

- [ ] **Step 7: 运行服务测试确认通过**

Run: `node server/test/test-user-home-routing-service.js`

Expected: PASS，且现有冷却、共享 rule 和节点前缀测试继续通过。

- [ ] **Step 8: 提交 Task 2**

```bash
git add server/services/shared/home-routing-service.js server/test/test-user-home-routing-service.js
git commit -m "修复：允许跳过离线服务器完成家宽换绑"
```

### Task 3: 手动删除和套餐到期清理

**Files:**
- Modify: `server/services/shared/home-routing-service.js`
- Modify: `server/services/shared/home-ip-expiration-service.js`
- Modify: `server/test/test-user-home-routing-service.js`
- Modify: `server/test/test-home-ip-expiration.js`

**Interfaces:**
- Consumes: Task 2 的清理结果和待清理持久化接口。
- Produces: `cleanupHomeRoutingForUser` 在离线跳过时返回成功，并保留内部 pending route；在线失败语义保持不变。

- [ ] **Step 1: 编写手动删除离线服务器测试**

断言当前服务器离线时不调用 XUI，`server_ids` 被清空、ID 写入 pending、用户端结果没有当前 route；两个数组都为空时仍删除 route 行。

- [ ] **Step 2: 编写到期清理分支测试**

在 `test-home-ip-expiration.js` 覆盖：在线删除失败不标记 expired；离线服务器被跳过后仍标记 expired，并保留 pending route；在线全部成功时删除 route。

- [ ] **Step 3: 运行相关测试确认失败**

Run: `node server/test/test-user-home-routing-service.js`

Run: `node server/test/test-home-ip-expiration.js`

Expected: 至少一个新增测试 FAIL，因为当前清理要求全部服务器在线且成功。

- [ ] **Step 4: 复用清理流程实现手动删除与到期语义**

手动删除和到期清理都合并 active/pending ID；离线项进入 pending，在线失败继续返回失败。保留 `home-ip-expiration-service` 的用户状态锁和邮件流程，不增加新的定时任务。

- [ ] **Step 5: 运行相关测试确认通过**

Run: `node server/test/test-user-home-routing-service.js`

Run: `node server/test/test-home-ip-expiration.js`

Expected: PASS。

- [ ] **Step 6: 提交 Task 3**

```bash
git add server/services/shared/home-routing-service.js server/services/shared/home-ip-expiration-service.js server/test/test-user-home-routing-service.js server/test/test-home-ip-expiration.js
git commit -m "修复：完善家宽 routing 删除与到期清理"
```

### Task 4: 管理员删除服务器时清理 route 引用

**Files:**
- Modify: `server/services/admin/servers-service.js`
- Modify: `server/test/test-xui-server-cascade-cleanup.js`

**Interfaces:**
- Consumes: `removeServerIdFromAllHomeRoutes(transactionDb, serverId)`。
- Produces: `deleteServer(db, serverId)` 在同一事务中先清理 route 数组，再删除服务器。

- [ ] **Step 1: 修改管理员删除服务器测试**

断言事务调用顺序为：查询服务器、清理 home route 引用、删除 `xui_servers`、提交；清理或删除失败时回滚。覆盖目标 ID 位于 active、pending、两者同时出现以及清理后空 route 四种数据形态。

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/test/test-xui-server-cascade-cleanup.js`

Expected: FAIL，当前服务只调用 `serversRepository.deleteServer`。

- [ ] **Step 3: 实现事务删除**

在 `servers-service.js` 引入 user home routing repository，通过 `db.transaction` 在同一事务内先清理数组再删除服务器；保持“服务器不存在”的现有错误。

- [ ] **Step 4: 运行测试确认通过**

Run: `node server/test/test-xui-server-cascade-cleanup.js`

Expected: PASS。

- [ ] **Step 5: 提交 Task 4**

```bash
git add server/services/admin/servers-service.js server/test/test-xui-server-cascade-cleanup.js
git commit -m "修复：删除服务器时清理家宽 routing 引用"
```

### Task 5: 用户端过滤回填与跳过提示

**Files:**
- Modify: `client-user/src/views/user/Subscription.vue`

**Interfaces:**
- Consumes: options 中仅在线的 `servers` 和更新响应中的 `skipped_cleanup_servers`。
- Produces: 修改弹窗只回填在线绑定；成功换绑存在跳过项时显示警告，否则显示普通成功提示。

- [ ] **Step 1: 修改弹窗回填逻辑**

新增带注释的纯辅助逻辑，将 route ID 与在线服务器 ID 求交集并压缩到两个表单槽位；离线旧 ID 不进入 `el-select` 的 model。

- [ ] **Step 2: 修改成功提示逻辑**

响应含 `skipped_cleanup_servers` 时，使用服务器名称生成警告提示；否则保留“家宽 IP 配置已同步”。错误提示继续展示在线删除失败服务器。

- [ ] **Step 3: 构建用户端**

Run: `npm run build`

Workdir: `client-user`

Expected: Vite 构建成功，无 Vue 编译错误；若本地缺少 terser，则运行 `npx vite build --minify esbuild` 并记录原因。

- [ ] **Step 4: 提交 Task 5**

```bash
git add client-user/src/views/user/Subscription.vue
git commit -m "修复：隐藏离线家宽绑定服务器"
```

### Task 6: 综合回归验证

**Files:**
- Test: `server/test/test-home-routing-pending-cleanup-migration.js`
- Test: `server/test/test-user-home-routing-service.js`
- Test: `server/test/test-home-ip-expiration.js`
- Test: `server/test/test-xui-server-cascade-cleanup.js`

**Interfaces:**
- Consumes: Task 1 至 Task 5 的最终实现。
- Produces: 可交付测试日志和服务器重启提醒。

- [ ] **Step 1: 运行全部专项后端测试**

Run: `node server/test/test-home-routing-pending-cleanup-migration.js`

Run: `node server/test/test-user-home-routing-service.js`

Run: `node server/test/test-home-ip-expiration.js`

Run: `node server/test/test-xui-server-cascade-cleanup.js`

Expected: 全部 PASS，无未处理 Promise rejection。

- [ ] **Step 2: 运行用户端生产构建**

Run: `npm run build`

Workdir: `client-user`

Expected: 构建成功；缺少 terser 时使用项目规定的 esbuild 备用命令。

- [ ] **Step 3: 检查最终差异**

Run: `git diff --check`

Run: `git status --short`

Expected: 无空白错误；只包含本计划列出的文件和用户原有改动。

- [ ] **Step 4: 整理提交**

遵循项目约束，将设计、计划等文档合并为一笔中文提交，将功能实现与测试整理为一笔中文提交；未获得用户确认前不执行 `git push`。

- [ ] **Step 5: 交付说明**

展示完整测试日志，说明数据库迁移命令，并提醒用户因修改了 `server/**/*.js` 需要重启服务器，不自行启动服务。


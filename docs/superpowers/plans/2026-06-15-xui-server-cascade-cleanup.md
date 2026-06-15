# XUI Server Cascade Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让删除 `xui_servers` 时自动级联删除四张关联表数据，并提供清理现有孤儿数据的脚本。

**Architecture:** 使用 PostgreSQL 外键 `ON DELETE CASCADE` 作为长期一致性边界。迁移脚本先清理孤儿记录，再幂等添加外键；管理端服务只删除服务器本表，由数据库负责关联清理。

**Tech Stack:** Node.js, Express service layer, PostgreSQL, 项目现有 db proxy 和迁移脚本模式。

---

### Task 1: 新增级联外键迁移脚本

**Files:**
- Create: `server/db/migrations/018-xui-server-cascade-cleanup.js`
- Test: `server/test/test-xui-server-cascade-cleanup.js`

- [ ] **Step 1: 编写迁移测试桩**

创建测试，模拟 PostgreSQL client，断言迁移脚本执行顺序为 `BEGIN`、四条孤儿清理 `DELETE`、四个约束检查、四条 `ALTER TABLE ... ON DELETE CASCADE`、`COMMIT`。

- [ ] **Step 2: 实现迁移脚本**

迁移脚本导出 `up(pool)`，使用 `pool.connect()` 开启事务。核心函数包括：

- `deleteOrphanRows(client, tableName)`：删除 `NOT EXISTS` 的孤儿记录并返回删除数量。
- `constraintExists(client, constraintName)`：查询 `information_schema.table_constraints`。
- `addCascadeForeignKey(client, tableName, constraintName)`：不存在时添加外键。

- [ ] **Step 3: 覆盖已存在约束分支**

测试中让 `constraintExists` 返回已存在，确认不会执行重复 `ALTER TABLE`。

### Task 2: 更新初始化 schema

**Files:**
- Modify: `server/db/schema/tables.js`

- [ ] **Step 1: 给四张表补外键定义**

在 `CREATE TABLE IF NOT EXISTS` 中将四个 `server_id INTEGER NOT NULL` 改为：

```sql
server_id INTEGER NOT NULL REFERENCES xui_servers(id) ON DELETE CASCADE
```

- [ ] **Step 2: 保持现有用户外键不变**

`user_node_configs.user_id` 和 `user_subscription_sources.user_id` 继续保持 `REFERENCES users(id) ON DELETE CASCADE`。

### Task 3: 调整管理端删除服务

**Files:**
- Modify: `server/services/admin/servers-service.js`
- Modify: `server/repositories/servers-repository.js`
- Test: `server/test/test-admin-layered-services.js`

- [ ] **Step 1: 移除删除服务里的手动节点删除**

`serversService.deleteServer` 查询服务器存在后，直接调用 `serversRepository.deleteServer(db, serverId)`。

- [ ] **Step 2: 保留或移除未使用仓储方法**

如果没有其他调用 `serversRepository.deleteServerNodes`，从导出中移除，避免未来误用应用层级联。

- [ ] **Step 3: 补测试**

测试 `deleteServer` 只调用 `DELETE FROM xui_servers WHERE id = ?`，不调用 `DELETE FROM xui_nodes WHERE server_id = ?`。

### Task 4: 验证

**Files:**
- No code files

- [ ] **Step 1: 运行后端相关测试**

Run:

```bash
node server/test/test-xui-server-cascade-cleanup.js
node server/test/test-admin-layered-services.js
```

Expected:

```text
xui server cascade cleanup tests passed
admin layered services tests passed
```

- [ ] **Step 2: 汇总结果**

最终回复展示修改文件、测试命令和测试日志。提醒用户修改了 `server/**/*.js`，需要重启后端服务后生效。

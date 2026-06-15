# XUI 服务器级联清理设计

## 背景

管理端服务器管理删除 `xui_servers` 记录后，`xui_nodes`、`traffic_sync_log`、`user_node_configs`、`user_subscription_sources` 中可能继续保留同一个 `server_id` 的数据。历史数据中也已经可能存在 `server_id` 不再对应任何 `xui_servers.id` 的孤儿记录。

## 目标

删除 `xui_servers` 中的服务器时，数据库自动删除四张关联表中的相关记录；同时提供一次性清理脚本处理当前残留孤儿数据。

## 方案

新增迁移脚本，按事务执行两个阶段：

1. 清理孤儿数据：删除四张关联表中 `server_id` 不存在于 `xui_servers` 的记录。
2. 补齐外键：为四张关联表的 `server_id` 添加 `REFERENCES xui_servers(id) ON DELETE CASCADE` 外键约束。

脚本必须幂等执行。约束已存在时跳过；清理阶段只删除孤儿记录，不支持指定服务器强制删除。

## 涉及表

- `xui_nodes.server_id`
- `traffic_sync_log.server_id`
- `user_node_configs.server_id`
- `user_subscription_sources.server_id`

## 管理端删除行为

管理端删除服务器仍调用现有 `DELETE /api/admin/servers/:id` 接口。后端只需删除 `xui_servers` 记录，四张关联表由 PostgreSQL 外键级联删除。

## 初始化结构

更新 `server/db/schema/tables.js`，让新初始化数据库直接创建带级联外键的表结构，避免新环境还需要额外迁移才能具备一致性保护。

## 错误处理

迁移脚本使用 PostgreSQL 事务。清理或添加约束任一步失败时回滚，避免出现只清理一部分或只添加一部分约束的状态。

## 验证

新增后端测试覆盖：

- 管理端删除服务不再手动删除四张关联表，只删除 `xui_servers`。
- 迁移脚本先删除孤儿记录，再添加四个级联外键。
- 迁移脚本检测到已有约束时不会重复添加。

执行后端相关测试脚本，并在完成时展示日志。

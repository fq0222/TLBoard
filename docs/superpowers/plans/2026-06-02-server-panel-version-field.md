# 服务器面板版本字段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `xui_servers` 增加每台服务器独立的 3X-UI 面板版本号字段，并让管理端表单、后端 CRUD、XUI 实例工厂调用链都读取该版本号创建对应客户端实例。

**Architecture:** 以 `xui_servers.panel_version` 作为单一数据源，管理端新增/编辑表单负责写入，仓库层和服务层负责读写与默认值回退，所有基于服务器记录创建 XUI 实例的业务统一透传 `apiVersion` 给 factory。

**Tech Stack:** Vue 3、Element Plus、Node.js、PostgreSQL、CommonJS、自定义测试脚本

---

### Task 1: 扩展数据库与仓库层

**Files:**
- Modify: `server/db/schema/tables.js`
- Create: `server/db/migrations/012-xui-server-panel-version.js`
- Modify: `server/repositories/servers-repository.js`

- [ ] **Step 1: 为初始化表结构补充 `panel_version` 字段**
- [ ] **Step 2: 新增幂等迁移脚本，为旧库补 `xui_servers.panel_version`**
- [ ] **Step 3: 仓库层查询、插入、更新都带上版本字段，并默认回退到 `3.0.2`**

### Task 2: 更新后端服务器服务与 XUI 调用链

**Files:**
- Modify: `server/services/admin/servers-service.js`
- Modify: `server/integrations/xui/xui-sync.js`
- Modify: `server/jobs/handlers/sync-xui-users.js`
- Modify: `server/jobs/backupDB.js`

- [ ] **Step 1: 服务器连接测试、详情、同步、用户更新/删除都透传 `apiVersion: server.panel_version`**
- [ ] **Step 2: 备份任务从服务器记录读取 `panel_version` 创建客户端**
- [ ] **Step 3: 其余按服务器记录创建 `XuiService` 的调用点全部透传版本号**

### Task 3: 更新管理端服务器管理表单

**Files:**
- Modify: `client-admin/src/views/Servers.vue`
- Modify: `client-admin/src/api/index.js`

- [ ] **Step 1: 新增“3X-UI 面板版本号”输入项，默认 `3.0.2`**
- [ ] **Step 2: 编辑弹窗回填已有版本号**
- [ ] **Step 3: 提交新增/编辑时把 `panel_version` 一并提交**

### Task 4: 验证

**Files:**
- Test: `server/test/test-xui-db-backup-job.js`
- Test: `server/test/test-xui-get-db.js`

- [ ] **Step 1: 运行语法检查与后端相关测试**
- [ ] **Step 2: 运行管理端构建验证表单修改无错误**
- [ ] **Step 3: 汇总变更与提醒用户重启服务**

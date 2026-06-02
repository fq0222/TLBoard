# XUI API 版本适配层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 3X-UI 客户端增加按版本选择实现的适配层，并补充 3.2.5 中文 API 文档，同时保持当前默认仍使用 3.0.2 版本 API。

**Architecture:** 将现有 `xui-api-client.js` 的 3.0.2 实现拆分为独立版本客户端，再引入工厂文件负责版本到客户端类的映射，`XuiService` 只在初始化阶段通过工厂创建客户端。3.2.5 本次仅提供适配器骨架与版本元信息，不引入新的调用分支，确保当前行为不回归。

**Tech Stack:** Node.js、CommonJS、axios、assert、自定义后端测试脚本

---

### Task 1: 拆分现有 3.0.2 客户端并引入版本工厂

**Files:**
- Create: `server/integrations/xui/xui-api-client-v302.js`
- Create: `server/integrations/xui/xui-api-client-v325.js`
- Create: `server/integrations/xui/xui-api-client-factory.js`
- Modify: `server/integrations/xui/xui-api-client.js`
- Modify: `server/integrations/xui/xui-service.js`
- Test: `server/test/test-xui-api-client.js`

- [ ] **Step 1: 保留 3.0.2 现有行为并迁移到独立文件**

将当前 `xui-api-client.js` 的核心实现原样迁移到 `xui-api-client-v302.js`，补齐清晰中文注释，并暴露 `version = '3.0.2'` 等元信息，确保请求路径、鉴权方式和下载逻辑不变。

- [ ] **Step 2: 新增 3.2.5 适配器骨架**

在 `xui-api-client-v325.js` 中继承或复用 3.0.2 客户端，显式标记 `version = '3.2.5'`，并在注释中说明“当前为兼容骨架，具体差异待后续按真实版本识别逻辑接入”，避免后续新增版本时继续修改老文件。

- [ ] **Step 3: 添加版本工厂与默认版本策略**

在 `xui-api-client-factory.js` 中实现：

```javascript
const DEFAULT_XUI_API_VERSION = '3.0.2';

function normalizeVersion(version) {
  if (!version) {
    return DEFAULT_XUI_API_VERSION;
  }
  return String(version).trim();
}
```

并维护版本到客户端类的映射，未知版本默认回退到 `3.0.2`，同时返回已解析的版本值供日志输出。

- [ ] **Step 4: 保持旧导出兼容并接入 XuiService**

`xui-api-client.js` 继续保留为兼容入口，默认导出 3.0.2 客户端；`xui-service.js` 中初始化逻辑改为调用工厂创建实例，并先写死默认版本 `3.0.2`，不提前引入后续版本探测逻辑。

- [ ] **Step 5: 更新最小测试覆盖**

扩展 `server/test/test-xui-api-client.js`，验证：

```javascript
assert.strictEqual(client.version, '3.0.2');
assert.strictEqual(factoryResult.resolvedVersion, '3.0.2');
assert.strictEqual(fallbackResult.resolvedVersion, '3.0.2');
```

同时确认现有 `/panel/api/inbounds/*` 与 `/panel/api/server/getDb` 请求行为未变化。

### Task 2: 补充 3.2.5 中文 API 书面文档

**Files:**
- Create: `docs/3x-ui-api-3.2.5.md`

- [ ] **Step 1: 根据官方文档整理结构**

文档按“认证方式 / Inbounds API / Server API / Extra API / 与当前项目适配关系 / 已知注意事项”组织，统一使用中文，必要时保留原始接口路径与字段名，避免二次翻译导致实现歧义。

- [ ] **Step 2: 标明本次落地范围**

文档中单独声明：

```markdown
- 本项目当前默认接入版本：3.0.2
- 本次仅完成版本适配层与 3.2.5 文档整理
- 面板版本识别与 3.2.5 差异实现后续再补
```

- [ ] **Step 3: 补充版本差异预留说明**

在文档末尾加入“待适配核对清单”，列出后续要逐项确认的内容，例如请求路径是否变化、鉴权头/会话是否变化、是否新增 `/panel/api/clients` 与 `/panel/api/nodes` 相关能力、请求体结构是否变化等。

### Task 3: 执行回归验证

**Files:**
- Test: `server/test/test-xui-api-client.js`

- [ ] **Step 1: 运行 XUI 客户端测试**

Run: `node server/test/test-xui-api-client.js`
Expected: 输出 `test-xui-api-client: PASS`

- [ ] **Step 2: 如有必要补充语法检查**

Run: `node --check server/integrations/xui/xui-api-client-factory.js`
Expected: 无输出，退出码为 `0`

- [ ] **Step 3: 汇总变更与风险**

在交付说明中明确：
- 当前默认版本仍是 `3.0.2`
- `3.2.5` 仅提供适配层骨架和中文文档
- 修改了 `server/**/*.js`，需要用户自行重启服务后生效

# 管理端用户订阅管理功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理端用户编辑弹窗中添加 CF IP 管理和生成订阅链接功能

**Architecture:** 扩展现有编辑弹窗，新增 2 个后端接口，复用现有 CF IP 和订阅生成逻辑

**Tech Stack:** Vue 3 + Element Plus (前端), Node.js + Express + PostgreSQL (后端)

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/routes/admin/users.js` | 修改 | 新增 2 个接口 |
| `client-admin/src/api/index.js` | 修改 | 新增 2 个 API 方法 |
| `client-admin/src/views/Users.vue` | 修改 | 扩展编辑弹窗 |

---

## Task 1: 后端 - 新增更新用户 CF IP 接口

**Files:**
- Modify: `server/routes/admin/users.js`

- [ ] **Step 1: 添加更新用户 CF IP 接口**

在 `server/routes/admin/users.js` 中，在 `PUT /:id` 接口之后添加新接口：

```javascript
/**
 * PUT /api/admin/users/:id/cf-ips
 * 更新用户的 CF 优选 IP
 */
router.put('/:id/cf-ips', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数'),
  body('ip_pool_ids')
    .isArray({ min: 1, max: 5 })
    .withMessage('IP数量必须在1-5之间'),
  body('ip_pool_ids.*')
    .isInt({ min: 1 })
    .withMessage('IP ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('更新用户CF IP参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const userId = parseInt(req.params.id);
    const { ip_pool_ids } = req.body;
    const db = req.app.locals.db;

    // 验证用户存在
    const user = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
    if (!user) {
      logger.warn(`更新用户CF IP失败: 用户不存在 - ${userId}`);
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    // 验证 IP ID 有效性
    const validIps = await db.prepare(`
      SELECT id, ip FROM cf_ip_pool 
      WHERE id IN (${ip_pool_ids.map(() => '?').join(',')}) AND enabled = 1
    `).all(...ip_pool_ids);

    if (validIps.length !== ip_pool_ids.length) {
      logger.warn(`更新用户CF IP失败: 部分IP无效 - ${JSON.stringify(ip_pool_ids)}`);
      return res.status(400).json({
        code: 4002,
        message: 'IP ID 无效或已禁用',
        data: null
      });
    }

    // 事务中删除旧记录，插入新记录
    const transaction = db.transaction(async () => {
      await db.prepare('DELETE FROM user_cf_ips WHERE user_id = ?').run(userId);
      const insertStmt = db.prepare('INSERT INTO user_cf_ips (user_id, ip_pool_id) VALUES (?, ?)');
      for (const ipId of ip_pool_ids) {
        await insertStmt.run(userId, ipId);
      }
    });

    await transaction();

    logger.info(`更新用户CF IP成功: ${user.email}, ${validIps.length}个IP`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        cf_ips: validIps
      }
    });
  } catch (error) {
    logger.error(`更新用户CF IP错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});
```

- [ ] **Step 2: 验证接口语法**

运行以下命令检查语法：
```bash
node -c server/routes/admin/users.js
```

预期输出：无错误

- [ ] **Step 3: 提交代码**

```bash
git add server/routes/admin/users.js
git commit -m "后端：添加更新用户CF IP接口"
```

---

## Task 2: 后端 - 新增生成用户订阅链接接口

**Files:**
- Modify: `server/routes/admin/users.js`

- [ ] **Step 1: 添加生成用户订阅链接接口**

在 `server/routes/admin/users.js` 中，在更新用户 CF IP 接口之后添加新接口：

```javascript
/**
 * POST /api/admin/users/:id/generate-subscription
 * 为用户生成订阅链接
 */
router.post('/:id/generate-subscription', authenticateAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('生成用户订阅链接参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const userId = parseInt(req.params.id);
    const db = req.app.locals.db;

    // 查询用户信息
    const user = await db.prepare(`
      SELECT 
        u.id, u.email, u.subscription_token, u.sub_id,
        u.traffic_used, u.traffic_limit, u.expire_at, u.enabled,
        p.name as plan_name
      FROM users u
      LEFT JOIN plans p ON u.plan_id = p.id
      WHERE u.id = ?
    `).get(userId);

    if (!user) {
      logger.warn(`生成订阅链接失败: 用户不存在 - ${userId}`);
      return res.status(400).json({
        code: 2004,
        message: '用户不存在',
        data: null
      });
    }

    // 检查账号是否启用
    if (!user.enabled) {
      logger.warn(`生成订阅链接失败: 账号已禁用 - ${user.email}`);
      return res.status(400).json({
        code: 2003,
        message: '账号已被禁用',
        data: null
      });
    }

    // 检查是否已配置 CF IP
    const cfIps = await db.prepare(`
      SELECT cp.ip
      FROM user_cf_ips uci
      JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
      WHERE uci.user_id = ? AND cp.enabled = 1
    `).all(userId);

    if (cfIps.length === 0) {
      logger.warn(`生成订阅链接失败: 未配置CF IP - ${user.email}`);
      return res.status(400).json({
        code: 3001,
        message: '请先配置优选 IP',
        data: null
      });
    }

    // 同步服务器节点信息
    logger.info(`用户 ${user.email} 生成订阅链接，开始同步节点信息`);
    const syncResult = await syncAllServers(db);
    logger.info(`节点同步完成: ${syncResult.syncedCount}/${syncResult.totalCount} 台服务器`);

    // 获取所有在线服务器
    const servers = await db.prepare(`
      SELECT id, name, api_url, host, client_port, sub_url
      FROM xui_servers
      WHERE status = 1
    `).all();

    // 聚合所有节点
    const allNodes = [];

    for (const server of servers) {
      try {
        // 获取用户在该服务器的节点配置
        const nodeConfigs = await db.prepare(`
          SELECT unc.uuid, unc.sub_id, xn.remark, xn.protocol, xn.inbound_id
          FROM user_node_configs unc
          JOIN xui_nodes xn ON unc.server_id = xn.server_id AND unc.inbound_id = xn.inbound_id
          WHERE unc.user_id = ? AND unc.server_id = ?
        `).all(userId, server.id);

        if (nodeConfigs.length === 0) {
          logger.warn(`服务器 ${server.name} 没有用户 ${user.email} 的节点配置`);
          continue;
        }

        // 检查服务器是否有订阅地址
        if (!server.sub_url) {
          logger.warn(`服务器 ${server.name} 没有设置订阅地址`);
          continue;
        }

        // 为每个节点分别获取原始订阅
        for (const config of nodeConfigs) {
          // 判断策略
          const strategy = getStrategyFromRemark(config.remark);

          // 从 3X-UI 获取该节点的原始订阅
          let originalLink = null;
          try {
            const originalContent = await fetchOriginalSubscription(server.sub_url, config.sub_id);
            const links = parseSubscriptionContent(originalContent);
            if (links.length > 0) {
              originalLink = links[0];
              logger.info(`从服务器 ${server.name} 获取节点 ${config.remark} 的原始链接`);
            }
          } catch (error) {
            logger.warn(`从服务器 ${server.name} 获取节点 ${config.remark} 原始订阅失败: ${error.message}`);
            continue;
          }

          if (!originalLink) {
            logger.warn(`找不到节点 ${config.remark} 的原始链接`);
            continue;
          }

          // 处理节点链接
          let processedLink;
          if (strategy === 'cf') {
            // 为每个 CF 优选 IP 生成一个节点
            for (let i = 0; i < cfIps.length; i++) {
              processedLink = processNodeLink(originalLink, 'cf', {
                cfIp: cfIps[i].ip,
                clientPort: server.client_port,
                host: server.host
              });
              // 节点名：服务器名-remark，多个 CF IP 时添加序号后缀
              const baseName = `${server.name}-${config.remark}`;
              const nodeName = cfIps.length > 1 ? `${baseName}-${i + 1}` : baseName;
              // 替换链接中的 remark
              const hashIdx = processedLink.indexOf('#');
              if (hashIdx > 0) {
                processedLink = processedLink.substring(0, hashIdx + 1) + encodeURIComponent(nodeName);
              }
              logger.info(`生成CF节点: nodeName=${nodeName}`);
              allNodes.push({
                server_name: server.name,
                node_name: nodeName,
                protocol: config.protocol,
                strategy: strategy,
                link: processedLink,
                original_link: originalLink
              });
            }
          } else {
            processedLink = processNodeLink(originalLink, 'direct');
            const nodeName = `${server.name}-${config.remark}`;
            // 替换链接中的 remark
            const hashIdx = processedLink.indexOf('#');
            if (hashIdx > 0) {
              processedLink = processedLink.substring(0, hashIdx + 1) + encodeURIComponent(nodeName);
            }
            logger.info(`生成Direct节点: nodeName=${nodeName}`);
            allNodes.push({
              server_name: server.name,
              node_name: nodeName,
              protocol: config.protocol,
              strategy: strategy,
              link: processedLink,
              original_link: originalLink
            });
          }
        }
      } catch (error) {
        logger.error(`处理服务器 ${server.name} 错误: ${error.message}`);
      }
    }

    // 存储到 user_subscriptions 表
    const now = Math.floor(Date.now() / 1000);
    await db.prepare(`
      INSERT INTO user_subscriptions (user_id, sub_id, nodes_data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (sub_id) DO UPDATE SET
        nodes_data = ?,
        updated_at = ?
    `).run(userId, user.sub_id, JSON.stringify(allNodes), now, JSON.stringify(allNodes), now);

    logger.info(`用户 ${user.email} 生成订阅链接成功，共 ${allNodes.length} 个节点`);

    // 返回订阅链接
    const urls = generateSubscriptionUrls(req, user.sub_id);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        subscription_url: urls.subscription_url,
        clash_url: urls.clash_url,
        node_count: allNodes.length
      }
    });
  } catch (error) {
    logger.error(`生成用户订阅链接错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});
```

- [ ] **Step 2: 添加必要的导入**

在 `server/routes/admin/users.js` 文件顶部，确保导入了必要的模块：

```javascript
const { generateSubscriptionUrls } = require('../../utils/site-url');
const { syncAllServers } = require('../../services/xui-sync');
const { getStrategyFromRemark, processNodeLink } = require('../../services/subscription-strategy');
```

注意：需要检查这些函数是否已导出，如果没有需要在相应文件中添加导出。

- [ ] **Step 3: 验证接口语法**

运行以下命令检查语法：
```bash
node -c server/routes/admin/users.js
```

预期输出：无错误

- [ ] **Step 4: 提交代码**

```bash
git add server/routes/admin/users.js
git commit -m "后端：添加生成用户订阅链接接口"
```

---

## Task 3: 前端 - 新增 API 方法

**Files:**
- Modify: `client-admin/src/api/index.js`

- [ ] **Step 1: 添加更新用户 CF IP 方法**

在 `client-admin/src/api/index.js` 中，在 `updateUser` 方法之后添加：

```javascript
/**
 * 更新用户 CF IP
 * @param {number} id - 用户ID
 * @param {Array} ipPoolIds - CF IP 池 ID 列表
 * @returns {Promise<Object>} 响应数据
 */
updateUserCfIps(id, ipPoolIds) {
  return apiClient.put(`/users/${id}/cf-ips`, { ip_pool_ids: ipPoolIds })
},
```

- [ ] **Step 2: 添加生成用户订阅链接方法**

在 `updateUserCfIps` 方法之后添加：

```javascript
/**
 * 生成用户订阅链接
 * @param {number} id - 用户ID
 * @returns {Promise<Object>} 响应数据
 */
generateUserSubscription(id) {
  return apiClient.post(`/users/${id}/generate-subscription`)
},
```

- [ ] **Step 3: 验证语法**

运行以下命令检查语法：
```bash
cd client-admin && npm run build
```

预期输出：构建成功

- [ ] **Step 4: 提交代码**

```bash
git add client-admin/src/api/index.js
git commit -m "前端：添加管理端用户订阅管理API方法"
```

---

## Task 4: 前端 - 扩展编辑弹窗

**Files:**
- Modify: `client-admin/src/views/Users.vue`

- [ ] **Step 1: 添加 CF IP 相关状态变量**

在 `client-admin/src/views/Users.vue` 的 `<script setup>` 中，在现有状态变量之后添加：

```javascript
// CF IP 相关
const cfIps = ref([])
const selectedCfIpId = ref('')
const cfIpPool = ref([])
const generatingSubscription = ref(false)
const subscriptionUrl = ref('')
const clashUrl = ref('')
```

- [ ] **Step 2: 添加获取 CF IP 池方法**

在 `fetchUsers` 方法之后添加：

```javascript
/**
 * 获取 CF IP 池列表
 */
async function fetchCfIpPool() {
  try {
    const response = await api.admin.getCfIps({ limit: 1000 })
    if (response.code === 0) {
      cfIpPool.value = response.data.list || []
    }
  } catch (error) {
    console.error('获取CF IP池失败:', error)
  }
}

/**
 * 获取可选择的 CF IP（过滤已选择的）
 */
function getSelectableCfIps() {
  const selectedIds = cfIps.value.map(ip => ip.id)
  return cfIpPool.value.filter(ip => !selectedIds.includes(ip.id) && ip.enabled)
}

/**
 * 添加 CF IP
 */
function addCfIp() {
  if (!selectedCfIpId.value) return
  const ip = cfIpPool.value.find(ip => ip.id === selectedCfIpId.value)
  if (ip && cfIps.value.length < 5) {
    cfIps.value.push({ id: ip.id, ip: ip.ip })
    selectedCfIpId.value = ''
  }
}

/**
 * 删除 CF IP
 */
function removeCfIp(index) {
  cfIps.value.splice(index, 1)
}

/**
 * 生成订阅链接
 */
async function generateSubscription() {
  if (cfIps.value.length === 0) {
    ElMessage.warning('请先配置优选 IP')
    return
  }
  
  try {
    generatingSubscription.value = true
    const response = await api.admin.generateUserSubscription(editingId.value)
    if (response.code === 0) {
      subscriptionUrl.value = response.data.subscription_url
      clashUrl.value = response.data.clash_url
      ElMessage.success(`订阅链接已生成，共 ${response.data.node_count} 个节点`)
    } else {
      ElMessage.error(response.message || '生成订阅链接失败')
    }
  } catch (error) {
    console.error('生成订阅链接失败:', error)
    ElMessage.error('生成订阅链接失败')
  } finally {
    generatingSubscription.value = false
  }
}

/**
 * 复制订阅链接
 */
function copySubscriptionUrl() {
  if (subscriptionUrl.value) {
    navigator.clipboard.writeText(subscriptionUrl.value)
    ElMessage.success('订阅链接已复制')
  }
}
```

- [ ] **Step 3: 修改 showEditDialog 方法**

修改 `showEditDialog` 方法，加载用户 CF IP 和订阅链接：

```javascript
function showEditDialog(user) {
  editingId.value = user.id
  // 将数字转换为布尔值（0 = false, 1 = true）
  userForm.enabled = !!user.enabled
  
  // 存储原始字节值，并转换为合适的单位显示
  const trafficLimit = Number(user.traffic_limit) || 0
  userForm.traffic_bytes = trafficLimit
  const traffic = bytesToUnit(trafficLimit)
  userForm.traffic_value = traffic.value
  userForm.traffic_unit = traffic.unit
  
  // 处理到期时间：0 或 "0" 表示无限期，应设为 null
  const expireAt = Number(user.expire_at) || 0
  userForm.expire_at = expireAt > 0 ? new Date(expireAt * 1000) : null
  
  // 加载用户 CF IP
  cfIps.value = user.cf_ips || []
  
  // 加载订阅链接
  subscriptionUrl.value = user.subscription_url || ''
  clashUrl.value = user.clash_url || ''
  
  // 获取 CF IP 池
  fetchCfIpPool()
  
  dialogVisible.value = true
}
```

- [ ] **Step 4: 修改 handleSubmit 方法**

修改 `handleSubmit` 方法，同时保存基本信息和 CF IP：

```javascript
async function handleSubmit() {
  try {
    submitting.value = true
    
    // 保存基本信息
    const data = {
      enabled: userForm.enabled,
      traffic_limit: userForm.traffic_bytes,
      expire_at: userForm.expire_at ? Math.floor(userForm.expire_at.getTime() / 1000) : null
    }
    await api.admin.updateUser(editingId.value, data, { timeout: 60000 })
    
    // 保存 CF IP
    const ipPoolIds = cfIps.value.map(ip => ip.id)
    await api.admin.updateUserCfIps(editingId.value, ipPoolIds)
    
    ElMessage.success('用户信息更新成功')
    dialogVisible.value = false
    fetchUsers()
  } catch (error) {
    console.error('更新失败:', error)
    ElMessage.error('更新失败')
  } finally {
    submitting.value = false
  }
}
```

- [ ] **Step 5: 修改弹窗模板**

修改 `client-admin/src/views/Users.vue` 中的 `<el-dialog>` 部分：

```vue
<el-dialog v-model="dialogVisible" title="编辑用户" width="600px" :close-on-click-modal="!submitting">
  <el-form :model="userForm" label-width="100px">
    <!-- 基本信息 -->
    <el-divider content-position="left">基本信息</el-divider>
    <el-form-item label="启用">
      <el-switch v-model="userForm.enabled" :disabled="submitting" />
    </el-form-item>
    <el-form-item label="流量上限">
      <div style="display: flex; gap: 10px; align-items: center;">
        <el-input-number v-model="userForm.traffic_value" :min="0" :precision="2" style="flex: 1;" @change="handleValueChange" :disabled="submitting" />
        <el-select v-model="userForm.traffic_unit" style="width: 100px;" @change="handleUnitChange" :disabled="submitting">
          <el-option label="B" value="B" />
          <el-option label="KB" value="KB" />
          <el-option label="MB" value="MB" />
          <el-option label="GB" value="GB" />
          <el-option label="TB" value="TB" />
        </el-select>
      </div>
    </el-form-item>
    <el-form-item label="到期时间">
      <el-date-picker v-model="userForm.expire_at" type="datetime" placeholder="选择到期时间" :disabled="submitting" />
    </el-form-item>
    
    <!-- CF IP 管理 -->
    <el-divider content-position="left">优选 IP（最多 5 个）</el-divider>
    <el-form-item>
      <div style="width: 100%;">
        <!-- 已选择的 IP 列表 -->
        <div v-for="(ip, index) in cfIps" :key="ip.id" style="display: flex; align-items: center; margin-bottom: 8px; padding: 8px; background: #f5f7fa; border-radius: 4px;">
          <span style="flex: 1;">{{ ip.ip }}</span>
          <el-button type="danger" size="small" text @click="removeCfIp(index)" :disabled="submitting">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
        
        <!-- 添加 IP -->
        <div v-if="cfIps.length < 5" style="display: flex; gap: 10px;">
          <el-select
            v-model="selectedCfIpId"
            filterable
            placeholder="搜索并选择 IP"
            style="flex: 1;"
            :disabled="submitting"
          >
            <el-option
              v-for="ip in getSelectableCfIps()"
              :key="ip.id"
              :label="ip.ip"
              :value="ip.id"
            />
          </el-select>
          <el-button type="primary" @click="addCfIp" :disabled="!selectedCfIpId || submitting">
            添加
          </el-button>
        </div>
        
        <div v-if="cfIps.length === 0" style="color: #909399; font-size: 12px; margin-top: 5px;">
          未配置优选 IP
        </div>
      </div>
    </el-form-item>
    
    <!-- 订阅链接 -->
    <el-divider content-position="left">订阅链接</el-divider>
    <el-form-item>
      <div style="width: 100%;">
        <div v-if="subscriptionUrl" style="display: flex; gap: 10px; margin-bottom: 10px;">
          <el-input v-model="subscriptionUrl" readonly>
            <template #append>
              <el-button @click="copySubscriptionUrl">
                <el-icon><CopyDocument /></el-icon>
              </el-button>
            </template>
          </el-input>
        </div>
        <div v-else style="color: #909399; font-size: 12px; margin-bottom: 10px;">
          未生成订阅链接
        </div>
        <el-button 
          type="success" 
          @click="generateSubscription" 
          :loading="generatingSubscription"
          :disabled="cfIps.length === 0 || submitting"
        >
          <el-icon><Link /></el-icon>
          {{ generatingSubscription ? '正在生成...' : '生成订阅链接' }}
        </el-button>
        <div v-if="cfIps.length === 0" style="color: #e6a23c; font-size: 12px; margin-top: 5px;">
          请先配置优选 IP 后再生成订阅链接
        </div>
      </div>
    </el-form-item>
  </el-form>
  
  <div v-if="submitting" style="text-align: center; color: #409eff; margin-top: 10px;">
    <el-icon class="is-loading"><Loading /></el-icon>
    正在同步到 3X-UI 服务器，请稍候...
  </div>
  
  <template #footer>
    <el-button @click="dialogVisible = false" :disabled="submitting">取消</el-button>
    <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
  </template>
</el-dialog>
```

- [ ] **Step 6: 添加图标导入**

在 `<script setup>` 的导入部分添加图标：

```javascript
import { Search, Loading, Delete, CopyDocument, Link } from '@element-plus/icons-vue'
```

- [ ] **Step 7: 验证构建**

运行以下命令检查构建：
```bash
cd client-admin && npm run build
```

预期输出：构建成功

- [ ] **Step 8: 提交代码**

```bash
git add client-admin/src/views/Users.vue
git commit -m "前端：扩展用户编辑弹窗，添加CF IP管理和生成订阅链接功能"
```

---

## Task 5: 测试验证

- [ ] **Step 1: 启动后端服务**

```bash
cd server && npm run dev
```

预期输出：服务启动成功

- [ ] **Step 2: 启动前端服务**

```bash
cd client-admin && npm run dev
```

预期输出：前端服务启动成功

- [ ] **Step 3: 测试 CF IP 管理功能**

1. 登录管理端
2. 进入用户管理页面
3. 点击用户"编辑"按钮
4. 验证弹窗中显示"优选 IP"区域
5. 添加 CF IP（从下拉列表选择）
6. 删除 CF IP
7. 点击"确定"保存
8. 重新打开编辑弹窗，验证 CF IP 已保存

- [ ] **Step 4: 测试生成功能**

1. 在编辑弹窗中，确保已配置 CF IP
2. 点击"生成订阅链接"按钮
3. 验证显示 loading 状态
4. 验证生成成功后显示订阅链接
5. 点击复制按钮，验证链接已复制

- [ ] **Step 5: 测试错误场景**

1. 未配置 CF IP 时点击"生成订阅链接"，验证显示警告
2. 用户账号禁用时生成订阅链接，验证显示错误

- [ ] **Step 6: 提交最终代码**

```bash
git add .
git commit -m "完成管理端用户订阅管理功能"
```

---

## 实施计划自检

- ✅ 所有设计需求都有对应任务
- ✅ 无占位符或 TODO
- ✅ 函数名、类型一致
- ✅ 代码完整，无省略

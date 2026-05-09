# 流量统计与自动禁用功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现流量统计汇总、自动禁用和自动解除禁用功能

**Architecture:** 修改现有的流量同步任务，创建独立的流量管理模块，实现增量更新和自动禁用逻辑

**Tech Stack:** Node.js, Express, PostgreSQL, 3X-UI API

---

## 文件结构

### 新建文件
- `server/services/traffic-manager.js` - 流量管理模块，包含流量统计、禁用逻辑
- `server/test/test-traffic-manager.js` - 流量管理模块测试脚本

### 修改文件
- `server/db/init.js` - 添加 `traffic_sync_log` 表
- `server/jobs/index.js` - 修改定时任务，调用新的流量管理模块
- `server/services/order-service.js` - 添加续费解除禁用逻辑

---

## 任务分解

### Task 1: 创建 `traffic_sync_log` 表

**Files:**
- Modify: `server/db/init.js`

- [ ] **Step 1: 添加 `traffic_sync_log` 表创建语句**

在 `server/db/init.js` 中添加新表的创建语句：

```javascript
// 在 users 表创建之后添加
await client.query(`
  CREATE TABLE IF NOT EXISTS traffic_sync_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    server_id INTEGER NOT NULL,
    last_sync_traffic BIGINT DEFAULT 0,
    last_sync_at BIGINT,
    UNIQUE(user_id, server_id)
  )
`);
logger.info('流量同步日志表初始化完成');

// 添加索引
await client.query(`
  CREATE INDEX IF NOT EXISTS idx_traffic_sync_log_user_server 
  ON traffic_sync_log(user_id, server_id)
`);
await client.query(`
  CREATE INDEX IF NOT EXISTS idx_traffic_sync_log_last_sync_at 
  ON traffic_sync_log(last_sync_at)
`);
logger.info('流量同步日志表索引创建完成');
```

- [ ] **Step 2: 运行数据库初始化**

```bash
cd server && npm run init-db
```

Expected: 看到 "流量同步日志表初始化完成" 和 "流量同步日志表索引创建完成" 日志

- [ ] **Step 3: 验证表创建成功**

```bash
node -e "
const { Pool } = require('pg');
const config = require('./config');
const pool = new Pool({ connectionString: config.database.url });
pool.query(\"SELECT table_name FROM information_schema.tables WHERE table_name = 'traffic_sync_log'\")
  .then(res => {
    console.log('表存在:', res.rows.length > 0);
    pool.end();
  })
  .catch(err => {
    console.error('错误:', err.message);
    pool.end();
  });
"
```

Expected: 输出 "表存在: true"

- [ ] **Step 4: Commit**

```bash
git add server/db/init.js
git commit -m "feat: 添加 traffic_sync_log 表用于流量增量同步"
```

---

### Task 2: 创建流量管理模块基础结构

**Files:**
- Create: `server/services/traffic-manager.js`

- [ ] **Step 1: 创建模块基础结构**

创建 `server/services/traffic-manager.js` 文件：

```javascript
/**
 * 流量管理模块
 * 负责流量统计、禁用检查和3X-UI同步
 */

const XuiService = require('./xui-service');
const { createLogger } = require('../utils/logger');

const logger = createLogger('TRAFFIC-MANAGER');

/**
 * 获取所有服务器的流量数据
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 服务器流量数据 { serverId: { email: { up, down, total } } }
 */
async function fetchAllServerTraffic(db) {
  // TODO: 实现
}

/**
 * 计算用户总流量（增量更新）
 * @param {Object} db - 数据库实例
 * @param {Object} serverTrafficData - 服务器流量数据
 * @returns {Promise<Object>} 用户流量数据 { userId: { email, trafficUsed, trafficLimit, isOverLimit } }
 */
async function calculateUserTotalTraffic(db, serverTrafficData) {
  // TODO: 实现
}

/**
 * 更新本地数据库的流量统计
 * @param {Object} db - 数据库实例
 * @param {Object} userTrafficData - 用户流量数据
 */
async function updateTrafficInDatabase(db, userTrafficData) {
  // TODO: 实现
}

/**
 * 检查并禁用超量用户
 * @param {Object} db - 数据库实例
 * @param {Object} userTrafficData - 用户流量数据
 */
async function checkAndDisableOverLimitUsers(db, userTrafficData) {
  // TODO: 实现
}

/**
 * 同步禁用状态到3X-UI
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户ID
 * @param {boolean} disable - 是否禁用
 * @returns {Promise<boolean>} 是否成功
 */
async function syncDisableStatusToXui(db, userId, disable) {
  // TODO: 实现
}

/**
 * 主函数：同步流量并处理禁用
 * @param {Object} db - 数据库实例
 */
async function syncTrafficAndHandleDisable(db) {
  // TODO: 实现
}

module.exports = {
  syncTrafficAndHandleDisable,
  fetchAllServerTraffic,
  calculateUserTotalTraffic,
  updateTrafficInDatabase,
  checkAndDisableOverLimitUsers,
  syncDisableStatusToXui
};
```

- [ ] **Step 2: 验证模块可以加载**

```bash
node -e "
const trafficManager = require('./server/services/traffic-manager');
console.log('模块加载成功');
console.log('导出函数:', Object.keys(trafficManager));
"
```

Expected: 输出 "模块加载成功" 和导出的函数列表

- [ ] **Step 3: Commit**

```bash
git add server/services/traffic-manager.js
git commit -m "feat: 创建流量管理模块基础结构"
```

---

### Task 3: 实现 `fetchAllServerTraffic` 函数

**Files:**
- Modify: `server/services/traffic-manager.js`

- [ ] **Step 1: 实现 `fetchAllServerTraffic` 函数**

```javascript
/**
 * 获取所有服务器的流量数据
 * @param {Object} db - 数据库实例
 * @returns {Promise<Object>} 服务器流量数据 { serverId: { email: { up, down, total } } }
 */
async function fetchAllServerTraffic(db) {
  try {
    // 查询所有在线服务器
    const servers = await db.prepare(`
      SELECT id, name, api_url, api_username, api_password
      FROM xui_servers
      WHERE status = 1
    `).all();

    if (servers.length === 0) {
      logger.warn('没有在线服务器');
      return {};
    }

    logger.info(`开始获取 ${servers.length} 台服务器的流量数据`);

    const serverTrafficData = {};

    // 并行获取所有服务器的流量数据
    const promises = servers.map(async (server) => {
      try {
        const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
        await xuiService.init();

        // 获取所有inbounds
        const inboundsResult = await xuiService.getInbounds();
        if (!inboundsResult.success) {
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败: ${inboundsResult.message}`);
          return;
        }

        const serverData = {};

        // 遍历所有inbound，收集用户流量数据
        for (const inbound of inboundsResult.data) {
          const clientStats = inbound.clientStats || [];
          
          for (const client of clientStats) {
            const email = client.email;
            if (!email) continue;

            // 累加同一用户在不同inbound的流量
            if (!serverData[email]) {
              serverData[email] = {
                up: 0,
                down: 0,
                total: 0
              };
            }

            serverData[email].up += client.up || 0;
            serverData[email].down += client.down || 0;
            serverData[email].total += (client.up || 0) + (client.down || 0);
          }
        }

        serverTrafficData[server.id] = serverData;
        logger.info(`获取服务器 ${server.name} 流量数据成功，${Object.keys(serverData).length} 个用户`);
      } catch (error) {
        logger.error(`获取服务器 ${server.name} 流量数据错误: ${error.message}`);
      }
    });

    await Promise.all(promises);

    logger.info(`获取所有服务器流量数据完成，共 ${Object.keys(serverTrafficData).length} 台服务器`);
    return serverTrafficData;
  } catch (error) {
    logger.error(`获取服务器流量数据错误: ${error.message}`);
    return {};
  }
}
```

- [ ] **Step 2: 测试函数**

创建测试脚本 `server/test/test-traffic-manager.js`：

```javascript
/**
 * 流量管理模块测试脚本
 */

const { Pool } = require('pg');
const config = require('../config');
const trafficManager = require('../services/traffic-manager');

async function test() {
  const pool = new Pool({ connectionString: config.database.url });
  const db = {
    prepare: (sql) => ({
      all: async (...params) => {
        const result = await pool.query(sql.replace(/\?/g, (i) => `$${i + 1}`), params);
        return result.rows;
      },
      get: async (...params) => {
        const result = await pool.query(sql.replace(/\?/g, (i) => `$${i + 1}`), params);
        return result.rows[0];
      },
      run: async (...params) => {
        const result = await pool.query(sql.replace(/\?/g, (i) => `$${i + 1}`), params);
        return { changes: result.rowCount };
      }
    })
  };

  try {
    console.log('测试 fetchAllServerTraffic...');
    const serverTrafficData = await trafficManager.fetchAllServerTraffic(db);
    console.log('结果:', JSON.stringify(serverTrafficData, null, 2));
  } catch (error) {
    console.error('测试失败:', error.message);
  } finally {
    await pool.end();
  }
}

test();
```

- [ ] **Step 3: 运行测试**

```bash
node server/test/test-traffic-manager.js
```

Expected: 看到服务器流量数据输出

- [ ] **Step 4: Commit**

```bash
git add server/services/traffic-manager.js server/test/test-traffic-manager.js
git commit -m "feat: 实现 fetchAllServerTraffic 函数"
```

---

### Task 4: 实现 `calculateUserTotalTraffic` 函数

**Files:**
- Modify: `server/services/traffic-manager.js`

- [ ] **Step 1: 实现 `calculateUserTotalTraffic` 函数**

```javascript
/**
 * 计算用户总流量（增量更新）
 * @param {Object} db - 数据库实例
 * @param {Object} serverTrafficData - 服务器流量数据
 * @returns {Promise<Object>} 用户流量数据 { userId: { email, trafficUsed, trafficLimit, isOverLimit } }
 */
async function calculateUserTotalTraffic(db, serverTrafficData) {
  try {
    // 查询所有启用的用户
    const users = await db.prepare(`
      SELECT id, email, traffic_used, traffic_limit
      FROM users
      WHERE enabled = 1
    `).all();

    if (users.length === 0) {
      logger.info('没有启用的用户');
      return {};
    }

    logger.info(`开始计算 ${users.length} 个用户的流量`);

    const userTrafficData = {};

    // 遍历所有用户
    for (const user of users) {
      let totalIncrement = 0;

      // 遍历所有服务器，计算增量
      for (const serverId of Object.keys(serverTrafficData)) {
        const serverData = serverTrafficData[serverId];
        const clientData = serverData[user.email];

        if (!clientData) {
          continue;
        }

        // 获取上次同步的流量值
        const lastSyncLog = await db.prepare(`
          SELECT last_sync_traffic FROM traffic_sync_log
          WHERE user_id = ? AND server_id = ?
        `).get(user.id, serverId);

        const lastSyncTraffic = lastSyncLog ? lastSyncLog.last_sync_traffic : 0;
        const currentTraffic = clientData.total;

        // 计算增量
        let increment = 0;
        if (currentTraffic >= lastSyncTraffic) {
          increment = currentTraffic - lastSyncTraffic;
        } else {
          // 服务器流量被重置
          increment = currentTraffic;
        }

        totalIncrement += increment;

        // 更新同步日志
        await db.prepare(`
          INSERT INTO traffic_sync_log (user_id, server_id, last_sync_traffic, last_sync_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (user_id, server_id)
          DO UPDATE SET last_sync_traffic = ?, last_sync_at = ?
        `).run(
          user.id, serverId, currentTraffic, Math.floor(Date.now() / 1000),
          currentTraffic, Math.floor(Date.now() / 1000)
        );
      }

      // 计算新的总流量
      const newTrafficUsed = (user.traffic_used || 0) + totalIncrement;
      const trafficLimit = Number(user.traffic_limit) || 0;
      const isOverLimit = trafficLimit > 0 && newTrafficUsed >= trafficLimit;

      userTrafficData[user.id] = {
        email: user.email,
        trafficUsed: newTrafficUsed,
        trafficLimit: trafficLimit,
        isOverLimit: isOverLimit,
        increment: totalIncrement
      };
    }

    logger.info(`计算用户流量完成，${Object.keys(userTrafficData).length} 个用户`);
    return userTrafficData;
  } catch (error) {
    logger.error(`计算用户流量错误: ${error.message}`);
    return {};
  }
}
```

- [ ] **Step 2: 更新测试脚本**

在 `server/test/test-traffic-manager.js` 中添加测试：

```javascript
async function test() {
  const pool = new Pool({ connectionString: config.database.url });
  const db = {
    prepare: (sql) => ({
      all: async (...params) => {
        const result = await pool.query(sql.replace(/\?/g, (i) => `$${i + 1}`), params);
        return result.rows;
      },
      get: async (...params) => {
        const result = await pool.query(sql.replace(/\?/g, (i) => `$${i + 1}`), params);
        return result.rows[0];
      },
      run: async (...params) => {
        const result = await pool.query(sql.replace(/\?/g, (i) => `$${i + 1}`), params);
        return { changes: result.rowCount };
      }
    })
  };

  try {
    console.log('测试 fetchAllServerTraffic...');
    const serverTrafficData = await trafficManager.fetchAllServerTraffic(db);
    console.log('服务器流量数据:', Object.keys(serverTrafficData).length, '台服务器');

    console.log('\n测试 calculateUserTotalTraffic...');
    const userTrafficData = await trafficManager.calculateUserTotalTraffic(db, serverTrafficData);
    console.log('用户流量数据:', Object.keys(userTrafficData).length, '个用户');
    
    // 显示前5个用户的流量数据
    const userIds = Object.keys(userTrafficData).slice(0, 5);
    for (const userId of userIds) {
      const data = userTrafficData[userId];
      console.log(`  用户 ${data.email}: ${data.trafficUsed} 字节, 超限: ${data.isOverLimit}`);
    }
  } catch (error) {
    console.error('测试失败:', error.message);
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 3: 运行测试**

```bash
node server/test/test-traffic-manager.js
```

Expected: 看到用户流量数据输出

- [ ] **Step 4: Commit**

```bash
git add server/services/traffic-manager.js server/test/test-traffic-manager.js
git commit -m "feat: 实现 calculateUserTotalTraffic 函数"
```

---

### Task 5: 实现 `updateTrafficInDatabase` 函数

**Files:**
- Modify: `server/services/traffic-manager.js`

- [ ] **Step 1: 实现 `updateTrafficInDatabase` 函数**

```javascript
/**
 * 更新本地数据库的流量统计
 * @param {Object} db - 数据库实例
 * @param {Object} userTrafficData - 用户流量数据
 */
async function updateTrafficInDatabase(db, userTrafficData) {
  try {
    const userIds = Object.keys(userTrafficData);
    
    if (userIds.length === 0) {
      logger.info('没有需要更新的用户流量数据');
      return;
    }

    logger.info(`开始更新 ${userIds.length} 个用户的流量数据`);

    let updatedCount = 0;

    for (const userId of userIds) {
      const data = userTrafficData[userId];
      
      try {
        await db.prepare(`
          UPDATE users SET traffic_used = ?, updated_at = ? WHERE id = ?
        `).run(data.trafficUsed, Math.floor(Date.now() / 1000), userId);
        
        updatedCount++;
      } catch (error) {
        logger.error(`更新用户 ${data.email} 流量数据错误: ${error.message}`);
      }
    }

    logger.info(`更新用户流量数据完成，${updatedCount}/${userIds.length} 个用户`);
  } catch (error) {
    logger.error(`更新用户流量数据错误: ${error.message}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/traffic-manager.js
git commit -m "feat: 实现 updateTrafficInDatabase 函数"
```

---

### Task 6: 实现 `syncDisableStatusToXui` 函数

**Files:**
- Modify: `server/services/traffic-manager.js`

- [ ] **Step 1: 实现 `syncDisableStatusToXui` 函数**

```javascript
/**
 * 同步禁用状态到3X-UI
 * @param {Object} db - 数据库实例
 * @param {number} userId - 用户ID
 * @param {boolean} disable - 是否禁用
 * @returns {Promise<boolean>} 是否成功
 */
async function syncDisableStatusToXui(db, userId, disable) {
  try {
    // 查询用户信息
    const user = await db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    if (!user) {
      logger.warn(`用户不存在: ${userId}`);
      return false;
    }
    
    // 查询所有在线服务器
    const servers = await db.prepare(`
      SELECT id, name, api_url, api_username, api_password
      FROM xui_servers
      WHERE status = 1
    `).all();
    
    if (servers.length === 0) {
      logger.warn('没有在线服务器');
      return false;
    }
    
    logger.info(`开始同步禁用状态到 ${servers.length} 台服务器: 用户 ${user.email}, 禁用 ${disable}`);
    
    // 遍历服务器，同步禁用状态
    let successCount = 0;
    for (const server of servers) {
      try {
        const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
        await xuiService.init();
        
        // 获取所有inbound
        const inboundsResult = await xuiService.getInbounds();
        if (!inboundsResult.success) {
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败`);
          continue;
        }
        
        // 对每个inbound，查找匹配用户并更新
        for (const inbound of inboundsResult.data) {
          const updateResult = await xuiService.updateClient(inbound.id, user.email, {
            enabled: !disable
          });
          
          if (updateResult.success) {
            successCount++;
            logger.info(`同步服务器 ${server.name} 的 inbound ${inbound.id} 成功`);
          } else {
            logger.warn(`同步服务器 ${server.name} 的 inbound ${inbound.id} 失败: ${updateResult.message}`);
          }
        }
      } catch (error) {
        logger.error(`同步服务器 ${server.name} 禁用状态错误: ${error.message}`);
      }
    }
    
    logger.info(`同步禁用状态完成: 用户 ${user.email}, 禁用 ${disable}, 成功 ${successCount} 个 inbound`);
    return successCount > 0;
  } catch (error) {
    logger.error(`同步禁用状态错误: ${error.message}`);
    return false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/traffic-manager.js
git commit -m "feat: 实现 syncDisableStatusToXui 函数"
```

---

### Task 7: 实现 `checkAndDisableOverLimitUsers` 函数

**Files:**
- Modify: `server/services/traffic-manager.js`

- [ ] **Step 1: 实现 `checkAndDisableOverLimitUsers` 函数**

```javascript
/**
 * 检查并禁用超量用户
 * @param {Object} db - 数据库实例
 * @param {Object} userTrafficData - 用户流量数据
 */
async function checkAndDisableOverLimitUsers(db, userTrafficData) {
  try {
    const userIds = Object.keys(userTrafficData);
    
    if (userIds.length === 0) {
      logger.info('没有需要检查的用户');
      return;
    }

    logger.info(`开始检查 ${userIds.length} 个用户的流量限制`);

    let disabledCount = 0;

    for (const userId of userIds) {
      const data = userTrafficData[userId];
      
      // 检查是否超限
      if (!data.isOverLimit) {
        continue;
      }

      // 检查用户当前状态
      const user = await db.prepare('SELECT enabled FROM users WHERE id = ?').get(userId);
      if (!user || user.enabled === 0) {
        continue;
      }

      logger.info(`用户 ${data.email} 流量超限，开始禁用: ${data.trafficUsed}/${data.trafficLimit}`);

      try {
        // 先同步到3X-UI
        const syncSuccess = await syncDisableStatusToXui(db, userId, true);
        
        if (syncSuccess) {
          // 更新本地数据库
          await db.prepare(`
            UPDATE users SET enabled = 0, traffic_used_at = ? WHERE id = ?
          `).run(Math.floor(Date.now() / 1000), userId);
          
          disabledCount++;
          logger.info(`禁用用户 ${data.email} 成功`);
        } else {
          logger.warn(`同步禁用状态到3X-UI失败，跳过用户 ${data.email}`);
        }
      } catch (error) {
        logger.error(`禁用用户 ${data.email} 错误: ${error.message}`);
      }
    }

    logger.info(`检查用户流量限制完成，禁用 ${disabledCount} 个用户`);
  } catch (error) {
    logger.error(`检查用户流量限制错误: ${error.message}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/traffic-manager.js
git commit -m "feat: 实现 checkAndDisableOverLimitUsers 函数"
```

---

### Task 8: 实现主函数 `syncTrafficAndHandleDisable`

**Files:**
- Modify: `server/services/traffic-manager.js`

- [ ] **Step 1: 实现 `syncTrafficAndHandleDisable` 函数**

```javascript
/**
 * 主函数：同步流量并处理禁用
 * @param {Object} db - 数据库实例
 */
async function syncTrafficAndHandleDisable(db) {
  try {
    logger.info('开始执行流量同步与禁用检查任务...');
    
    // 1. 获取所有服务器的流量数据
    const serverTrafficData = await fetchAllServerTraffic(db);
    
    if (Object.keys(serverTrafficData).length === 0) {
      logger.info('没有获取到服务器流量数据，跳过后续步骤');
      return;
    }
    
    // 2. 计算用户总流量（增量更新）
    const userTrafficData = await calculateUserTotalTraffic(db, serverTrafficData);
    
    if (Object.keys(userTrafficData).length === 0) {
      logger.info('没有计算到用户流量数据，跳过后续步骤');
      return;
    }
    
    // 3. 更新本地数据库的流量统计
    await updateTrafficInDatabase(db, userTrafficData);
    
    // 4. 检查并禁用超量用户
    await checkAndDisableOverLimitUsers(db, userTrafficData);
    
    logger.info('流量同步与禁用检查任务完成');
  } catch (error) {
    logger.error(`流量同步与禁用检查任务错误: ${error.message}`);
  }
}
```

- [ ] **Step 2: 更新测试脚本**

在 `server/test/test-traffic-manager.js` 中添加完整测试：

```javascript
async function test() {
  const pool = new Pool({ connectionString: config.database.url });
  const db = {
    prepare: (sql) => ({
      all: async (...params) => {
        const result = await pool.query(sql.replace(/\?/g, (i) => `$${i + 1}`), params);
        return result.rows;
      },
      get: async (...params) => {
        const result = await pool.query(sql.replace(/\?/g, (i) => `$${i + 1}`), params);
        return result.rows[0];
      },
      run: async (...params) => {
        const result = await pool.query(sql.replace(/\?/g, (i) => `$${i + 1}`), params);
        return { changes: result.rowCount };
      }
    })
  };

  try {
    console.log('测试 syncTrafficAndHandleDisable...');
    await trafficManager.syncTrafficAndHandleDisable(db);
    console.log('测试完成');
  } catch (error) {
    console.error('测试失败:', error.message);
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 3: 运行测试**

```bash
node server/test/test-traffic-manager.js
```

Expected: 看到流量同步任务完成日志

- [ ] **Step 4: Commit**

```bash
git add server/services/traffic-manager.js server/test/test-traffic-manager.js
git commit -m "feat: 实现主函数 syncTrafficAndHandleDisable"
```

---

### Task 9: 修改定时任务调用新模块

**Files:**
- Modify: `server/jobs/index.js`

- [ ] **Step 1: 导入流量管理模块**

在 `server/jobs/index.js` 顶部添加导入：

```javascript
const trafficManager = require('../services/traffic-manager');
```

- [ ] **Step 2: 修改 `registerTrafficSyncJob` 函数**

```javascript
/**
 * 注册流量同步任务
 * 每1小时从3X-UI服务器同步用户流量数据到本地数据库
 * @param {Object} db - 数据库实例
 */
function registerTrafficSyncJob(db) {
  // 启动时延迟10分钟执行第一次，避免启动时负载过高
  setTimeout(async () => {
    await trafficManager.syncTrafficAndHandleDisable(db);
  }, 10 * 60 * 1000);

  const interval = setInterval(async () => {
    await trafficManager.syncTrafficAndHandleDisable(db);
  }, 60 * 60 * 1000); // 每1小时执行一次
  
  intervals.push(interval);
  logger.info('流量同步任务已注册（每1小时执行一次）');
}
```

- [ ] **Step 3: 删除旧的 `runTrafficSync` 函数**

删除 `server/jobs/index.js` 中的 `runTrafficSync` 函数（第268-352行）。

- [ ] **Step 4: Commit**

```bash
git add server/jobs/index.js
git commit -m "feat: 修改定时任务调用新的流量管理模块"
```

---

### Task 10: 修改续费逻辑添加解除禁用功能

**Files:**
- Modify: `server/services/order-service.js`

- [ ] **Step 1: 导入流量管理模块**

在 `server/services/order-service.js` 顶部添加导入：

```javascript
const trafficManager = require('./traffic-manager');
```

- [ ] **Step 2: 修改 `handleOrderPaid` 函数**

在 `handleOrderPaid` 函数中，更新用户信息后添加解除禁用逻辑：

```javascript
// 在现有代码之后添加
// 检查用户是否需要解除禁用
const user = await db.prepare('SELECT enabled FROM users WHERE id = ?').get(order.user_id);
if (user && user.enabled === 0) {
  logger.info(`用户 ${order.email} 已禁用，开始解除禁用`);
  
  // 更新本地数据库
  await db.prepare(`
    UPDATE users SET enabled = 1, traffic_used_at = NULL WHERE id = ?
  `).run(order.user_id);
  
  // 异步同步到3X-UI
  trafficManager.syncDisableStatusToXui(db, order.user_id, false).catch(err => {
    logger.error(`后台同步解除禁用到 3X-UI 失败: ${err.message}`);
  });
  
  logger.info(`用户 ${order.email} 解除禁用成功`);
}
```

- [ ] **Step 3: Commit**

```bash
git add server/services/order-service.js
git commit -m "feat: 添加续费后自动解除禁用功能"
```

---

### Task 11: 完善测试脚本

**Files:**
- Modify: `server/test/test-traffic-manager.js`

- [ ] **Step 1: 完善测试脚本**

```javascript
/**
 * 流量管理模块测试脚本
 * 
 * 使用方法：
 * node server/test/test-traffic-manager.js
 * 
 * 测试内容：
 * 1. 测试 fetchAllServerTraffic 函数
 * 2. 测试 calculateUserTotalTraffic 函数
 * 3. 测试 updateTrafficInDatabase 函数
 * 4. 测试 checkAndDisableOverLimitUsers 函数
 * 5. 测试 syncDisableStatusToXui 函数
 * 6. 测试 syncTrafficAndHandleDisable 主函数
 */

const { Pool } = require('pg');
const config = require('../config');
const trafficManager = require('../services/traffic-manager');

// 创建数据库连接
const pool = new Pool({ connectionString: config.database.url });

// 模拟 db 对象
const db = {
  prepare: (sql) => ({
    all: async (...params) => {
      const result = await pool.query(sql.replace(/\?/g, (_, i) => `$${i + 1}`), params);
      return result.rows;
    },
    get: async (...params) => {
      const result = await pool.query(sql.replace(/\?/g, (_, i) => `$${i + 1}`), params);
      return result.rows[0];
    },
    run: async (...params) => {
      const result = await pool.query(sql.replace(/\?/g, (_, i) => `$${i + 1}`), params);
      return { changes: result.rowCount };
    }
  })
};

async function testFetchAllServerTraffic() {
  console.log('\n=== 测试 fetchAllServerTraffic ===');
  const serverTrafficData = await trafficManager.fetchAllServerTraffic(db);
  const serverIds = Object.keys(serverTrafficData);
  console.log(`获取到 ${serverIds.length} 台服务器的流量数据`);
  
  for (const serverId of serverIds.slice(0, 2)) {
    const emails = Object.keys(serverTrafficData[serverId]);
    console.log(`  服务器 ${serverId}: ${emails.length} 个用户`);
  }
  
  return serverTrafficData;
}

async function testCalculateUserTotalTraffic(serverTrafficData) {
  console.log('\n=== 测试 calculateUserTotalTraffic ===');
  const userTrafficData = await trafficManager.calculateUserTotalTraffic(db, serverTrafficData);
  const userIds = Object.keys(userTrafficData);
  console.log(`计算到 ${userIds.length} 个用户的流量数据`);
  
  let overLimitCount = 0;
  for (const userId of userIds) {
    const data = userTrafficData[userId];
    if (data.isOverLimit) {
      overLimitCount++;
    }
  }
  console.log(`  超限用户: ${overLimitCount} 个`);
  
  return userTrafficData;
}

async function testUpdateTrafficInDatabase(userTrafficData) {
  console.log('\n=== 测试 updateTrafficInDatabase ===');
  await trafficManager.updateTrafficInDatabase(db, userTrafficData);
  console.log('更新完成');
}

async function testCheckAndDisableOverLimitUsers(userTrafficData) {
  console.log('\n=== 测试 checkAndDisableOverLimitUsers ===');
  await trafficManager.checkAndDisableOverLimitUsers(db, userTrafficData);
  console.log('检查完成');
}

async function testSyncTrafficAndHandleDisable() {
  console.log('\n=== 测试 syncTrafficAndHandleDisable ===');
  await trafficManager.syncTrafficAndHandleDisable(db);
  console.log('主函数测试完成');
}

async function runAllTests() {
  try {
    console.log('开始流量管理模块测试...');
    
    // 测试各个函数
    const serverTrafficData = await testFetchAllServerTraffic();
    const userTrafficData = await testCalculateUserTotalTraffic(serverTrafficData);
    await testUpdateTrafficInDatabase(userTrafficData);
    await testCheckAndDisableOverLimitUsers(userTrafficData);
    
    // 测试主函数
    await testSyncTrafficAndHandleDisable();
    
    console.log('\n=== 所有测试完成 ===');
  } catch (error) {
    console.error('\n测试失败:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

// 运行测试
runAllTests();
```

- [ ] **Step 2: 运行完整测试**

```bash
node server/test/test-traffic-manager.js
```

Expected: 看到所有测试通过

- [ ] **Step 3: Commit**

```bash
git add server/test/test-traffic-manager.js
git commit -m "test: 完善流量管理模块测试脚本"
```

---

### Task 12: 集成测试和验证

**Files:**
- None

- [ ] **Step 1: 重启服务器**

提醒用户重启服务器以应用更改。

- [ ] **Step 2: 检查定时任务日志**

查看服务器日志，确认流量同步任务已注册并开始执行。

- [ ] **Step 3: 手动测试禁用流程**

1. 创建一个测试用户，设置较小的流量限额
2. 等待流量同步任务执行
3. 验证用户是否被自动禁用
4. 检查3X-UI服务器上的用户状态

- [ ] **Step 4: 手动测试解除禁用流程**

1. 为被禁用的用户创建续费订单
2. 模拟订单支付成功
3. 验证用户是否被自动解除禁用
4. 检查3X-UI服务器上的用户状态

- [ ] **Step 5: 检查错误处理**

1. 模拟3X-UI服务器不可用
2. 验证错误日志是否正确记录
3. 验证其他服务器是否继续处理

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: 完成流量统计与自动禁用功能实现"
```

---

## 验证清单

- [ ] 流量统计是否汇总所有服务器
- [ ] 增量更新是否正确工作
- [ ] 流量超限后用户是否被自动禁用
- [ ] 禁用状态是否同步到3X-UI
- [ ] 续费后用户是否被自动解除禁用
- [ ] 解除禁用状态是否同步到3X-UI
- [ ] 定时任务是否每小时执行
- [ ] 错误处理是否正确记录日志
- [ ] 测试脚本是否通过

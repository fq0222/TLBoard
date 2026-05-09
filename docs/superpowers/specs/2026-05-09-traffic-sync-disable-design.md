# 流量统计与自动禁用功能设计文档

## 1. 概述

### 1.1 需求背景
当前系统的流量统计机制存在以下问题：
- 流量统计不是汇总所有服务器，而是覆盖
- 流量用完后不会自动禁用用户
- 定时任务每3小时执行一次，延迟较大

### 1.2 需求目标
1. **流量统计**：汇总所有3X-UI服务器内该用户的已用流量
2. **自动禁用**：已用流量达到套餐限额后，自动禁用用户并同步到3X-UI
3. **自动解除禁用**：用户续费后，自动解除禁用状态

### 1.3 设计原则
- 复用现有代码，减少改动
- 将复杂逻辑拆分为小函数，提高可维护性
- 错误处理不影响主流程

## 2. 整体架构

### 2.1 架构设计
```
定时任务(1小时) → 流量管理器 → 3X-UI API → 本地数据库 → 禁用/启用用户 → 同步到3X-UI
```

### 2.2 主要变更
1. 修改 `server/jobs/index.js` 中的 `runTrafficSync` 函数
2. 创建新的 `server/services/traffic-manager.js` 模块
3. 修改 `server/services/order-service.js` 中的续费逻辑

### 2.3 数据流
1. 定时任务每小时触发
2. 从所有3X-UI服务器获取流量数据
3. 计算用户总流量（增量更新）
4. 更新本地数据库
5. 检查并禁用超量用户
6. 同步禁用状态到3X-UI

## 3. 流量统计模块设计

### 3.1 模块位置
`server/services/traffic-manager.js`

### 3.2 核心函数
```javascript
// 主函数：同步流量并处理禁用
async function syncTrafficAndHandleDisable(db)

// 子函数1：获取所有服务器的流量数据
async function fetchAllServerTraffic(db)
// 返回: { serverId: { userId: { up, down, total } } }

// 子函数2：计算用户总流量（增量更新）
async function calculateUserTotalTraffic(db, serverTrafficData)
// 返回: { userId: { trafficUsed, trafficLimit, isOverLimit } }

// 子函数3：更新本地数据库的流量统计
async function updateTrafficInDatabase(db, userTrafficData)

// 子函数4：检查并禁用超量用户
async function checkAndDisableOverLimitUsers(db, userTrafficData)

// 子函数5：同步禁用状态到3X-UI
async function syncDisableStatusToXui(db, userId, disable)
```

### 3.3 增量更新逻辑
1. 记录每个服务器上次同步的流量值（存储在 `traffic_sync_log` 表）
2. 本次同步时，计算增量：`本次流量 - 上次流量`
3. 累加到用户的总流量：`用户总流量 += 增量`
4. 更新上次同步的流量值

**增量计算规则**：
- 如果 `本次流量 >= 上次流量`，增量 = `本次流量 - 上次流量`
- 如果 `本次流量 < 上次流量`，说明服务器流量被重置，增量 = `本次流量`
- 增量不能为负数

**数据一致性**：
- 使用数据库事务确保流量更新的原子性
- 定期全量同步，校验增量计算结果

### 3.4 流量计算公式
```javascript
// 增量计算
const increment = currentTraffic >= lastSyncTraffic 
  ? currentTraffic - lastSyncTraffic 
  : currentTraffic; // 服务器流量重置

// 总流量更新
const newTotalTraffic = currentTrafficUsed + increment;

// 流量用完检查
const isOverLimit = trafficLimit > 0 && newTotalTraffic >= trafficLimit;
```

## 4. 禁用逻辑设计

### 4.1 禁用条件
- 用户已用流量 >= 套餐流量限额
- 用户当前状态为启用（`enabled = 1`）

### 4.2 禁用流程
1. 同步到所有3X-UI服务器：调用 `updateClient` 方法，设置 `enabled: false`
2. 更新本地数据库：`UPDATE users SET enabled = 0 WHERE id = ?`
3. 记录禁用时间：`UPDATE users SET traffic_used_at = ? WHERE id = ?`

### 4.3 3X-UI同步逻辑
```javascript
async function syncDisableStatusToXui(db, userId, disable) {
  try {
    // 1. 查询用户信息
    const user = await db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    if (!user) {
      logger.warn(`用户不存在: ${userId}`);
      return false;
    }
    
    // 2. 查询所有在线服务器
    const servers = await db.prepare(`
      SELECT id, name, api_url, api_username, api_password
      FROM xui_servers
      WHERE status = 1
    `).all();
    
    if (servers.length === 0) {
      logger.warn('没有在线服务器');
      return false;
    }
    
    // 3. 遍历服务器，同步禁用状态
    let successCount = 0;
    for (const server of servers) {
      try {
        const xuiService = new XuiService(server.api_url, server.api_username, server.api_password);
        await xuiService.init();
        
        // 4. 获取所有inbound
        const inboundsResult = await xuiService.getInbounds();
        if (!inboundsResult.success) {
          logger.warn(`获取服务器 ${server.name} 的 inbounds 失败`);
          continue;
        }
        
        // 5. 对每个inbound，查找匹配用户并更新
        for (const inbound of inboundsResult.data) {
          const updateResult = await xuiService.updateClient(inbound.id, user.email, {
            enabled: disable
          });
          
          if (updateResult.success) {
            successCount++;
          }
        }
      } catch (error) {
        logger.error(`同步服务器 ${server.name} 禁用状态错误: ${error.message}`);
      }
    }
    
    logger.info(`同步禁用状态完成: 用户 ${user.email}, 禁用 ${disable}, 成功 ${successCount} 个服务器`);
    return successCount > 0;
  } catch (error) {
    logger.error(`同步禁用状态错误: ${error.message}`);
    return false;
  }
}
```

### 4.4 错误处理
- 如果某个服务器同步失败，记录日志，继续处理其他服务器
- 不因单个服务器失败而中断整个流程

## 5. 续费解除禁用设计

### 5.1 解除禁用条件
- 用户完成续费（订单状态变为 `paid`）
- 用户当前状态为禁用（`enabled = 0`）

### 5.2 解除禁用流程
1. 在 `order-service.js` 的 `handleOrderPaid` 函数中添加解除禁用逻辑
2. 更新本地数据库：`UPDATE users SET enabled = 1, traffic_used_at = NULL WHERE id = ?`
3. 同步到所有3X-UI服务器：调用 `updateClient` 方法，设置 `enabled: true`
4. 流量统计继续累加：保持原有的 `traffic_used` 值
5. 记录解除禁用日志

**关键代码位置**：
- `server/services/order-service.js:169-178`：订单支付成功后的用户更新逻辑

**错误处理**：
- 如果3X-UI同步失败，记录日志，但不影响订单处理流程
- 用户可以在订阅链接页面手动触发重新同步

### 5.3 关键点
- 续费后流量上限累加：`新总流量 = 当前套餐流量 + 新套餐流量`
- 流量统计继续累加：保持原有的 `traffic_used` 值
- 只清除禁用时间戳：`traffic_used_at = NULL`

## 6. 定时任务设计

### 6.1 任务配置
- 任务名称：流量同步与禁用检查
- 执行间隔：1小时（从3小时改为1小时）
- 启动时执行：是
- 首次延迟：10分钟

### 6.2 任务流程
```javascript
async function runTrafficSyncAndDisable(db) {
  try {
    logger.info('开始执行流量同步与禁用检查任务...');
    
    // 1. 获取所有服务器的流量数据
    const serverTrafficData = await fetchAllServerTraffic(db);
    
    // 2. 计算用户总流量（增量更新）
    const userTrafficData = await calculateUserTotalTraffic(db, serverTrafficData);
    
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

### 6.3 性能优化
- 并行获取多个服务器的流量数据
- 批量更新数据库，减少数据库操作次数
- 记录日志，便于监控和调试

## 7. 数据库设计

### 7.1 现有表结构
- `users` 表：已有 `traffic_used`、`traffic_limit`、`traffic_used_at`、`enabled` 字段
- `xui_servers` 表：已有服务器信息

### 7.2 新增表
`traffic_sync_log` 表，用于记录每个服务器的上次同步流量值，实现增量更新。

```sql
CREATE TABLE IF NOT EXISTS traffic_sync_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  server_id INTEGER NOT NULL,
  last_sync_traffic BIGINT DEFAULT 0,
  last_sync_at BIGINT,
  UNIQUE(user_id, server_id)
);
```

### 7.3 字段说明
- `user_id`：用户ID
- `server_id`：服务器ID
- `last_sync_traffic`：上次同步时的流量值（字节）
- `last_sync_at`：上次同步时间戳

### 7.4 索引建议
- 在 `user_id` 和 `server_id` 上创建联合索引，提高查询效率
- 在 `last_sync_at` 上创建索引，便于清理过期日志

## 8. 错误处理设计

### 8.1 错误分类
1. **3X-UI API 错误**：网络超时、认证失败、服务器不可用
2. **数据库错误**：连接失败、查询超时、约束冲突
3. **业务逻辑错误**：用户不存在、服务器不存在

### 8.2 错误处理策略

**3X-UI API 错误**：
- 记录错误日志，包含服务器名称和错误信息
- 跳过当前服务器，继续处理其他服务器
- 不中断整个流量同步流程

**数据库错误**：
- 记录错误日志，包含操作类型和错误信息
- 对于关键操作（如禁用用户），可以重试一次
- 如果重试失败，记录日志，不中断流程
- 使用数据库事务确保数据一致性

**业务逻辑错误**：
- 记录警告日志，包含用户ID和错误信息
- 跳过当前用户，继续处理其他用户

### 8.3 日志级别
- `logger.error`：严重错误，需要关注
- `logger.warn`：警告信息，可能需要处理
- `logger.info`：正常操作信息

## 9. 测试策略设计

### 9.1 测试目标
- 验证流量统计的准确性
- 验证禁用/启用逻辑的正确性
- 验证3X-UI同步的可靠性

### 9.2 测试类型

**单元测试**：
- 测试 `calculateUserTotalTraffic` 函数的增量计算逻辑
- 测试 `checkAndDisableOverLimitUsers` 函数的禁用条件判断
- 测试 `syncDisableStatusToXui` 函数的同步逻辑

**集成测试**：
- 测试完整的流量同步流程
- 测试续费后解除禁用流程
- 测试定时任务的执行

### 9.3 测试数据
- 模拟多个服务器的流量数据
- 模拟用户达到流量限额的场景
- 模拟用户续费的场景

### 9.4 测试工具
- 使用现有的测试脚本框架
- 创建测试数据库，避免影响生产数据
- 使用 mock 对象模拟 3X-UI API
- 使用 `server/test/` 目录下的测试脚本

## 10. 实现计划

### 10.1 需要修改的文件
1. `server/services/traffic-manager.js`（新建）
2. `server/jobs/index.js`（修改定时任务）
3. `server/services/order-service.js`（添加解除禁用逻辑）
4. `server/db/init.js`（添加新表）

### 10.2 实现顺序
1. 创建 `traffic_sync_log` 表
2. 实现 `traffic-manager.js` 模块
3. 修改定时任务调用新模块
4. 修改续费逻辑添加解除禁用功能
5. 编写测试脚本
6. 集成测试

### 10.3 验证方法
1. 运行测试脚本验证流量统计准确性
2. 手动测试禁用/启用流程
3. 检查日志确保错误处理正确
4. 验证3X-UI同步状态
5. 验证定时任务执行频率和日志

## 11. 风险与缓解

### 11.1 潜在风险
1. **性能问题**：每小时同步所有服务器可能增加负载
2. **数据一致性**：增量更新可能出现计算误差
3. **3X-UI API限制**：频繁调用可能触发API限制

### 11.2 缓解措施
1. **性能优化**：并行处理、批量更新、记录日志
2. **数据校验**：定期全量同步，校验增量计算结果
3. **API限制处理**：添加重试机制、记录失败日志
4. **监控告警**：设置错误率阈值，超过阈值时告警

## 12. 监控与维护

### 12.1 监控指标
- 流量同步成功率
- 禁用/启用操作成功率
- 定时任务执行时间
- 错误日志数量

### 12.2 维护建议
1. 定期检查错误日志
2. 监控定时任务执行状态
3. 定期清理过期的同步日志
4. 根据实际使用情况调整同步频率
5. 定期备份 `traffic_sync_log` 表

## 13. 总结

本设计方案通过修改现有的流量同步任务，实现了流量统计、自动禁用和自动解除禁用功能。主要特点包括：

1. **增量更新**：通过 `traffic_sync_log` 表实现流量增量统计
2. **自动禁用**：流量达到限额后自动禁用并同步到3X-UI
3. **自动解除禁用**：续费后自动解除禁用状态
4. **错误处理**：分类处理，不中断主流程
5. **可维护性**：拆分为小函数，便于测试和维护
6. **性能优化**：并行处理、批量更新、定期清理

设计方案完整，可以开始实现计划。

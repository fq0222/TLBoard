/**
 * 流量管理模块测试脚本
 */

const databaseManager = require('../db/init');
const trafficManager = require('../services/shared/traffic-manager');

/**
 * 确保测试库具备推广流量字段，避免老测试库 schema 落后导致无法覆盖总流量逻辑。
 *
 * @param {Object} db - 数据库实例，需暴露 PostgreSQL 连接池
 * @returns {Promise<void>}
 */
async function ensureReferralTrafficColumn(db) {
  await db.pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS referral_traffic_limit BIGINT DEFAULT 0
  `);
}

async function test() {
  try {
    // 初始化数据库连接
    const db = await databaseManager.init();
    console.log('数据库连接成功');
    await ensureReferralTrafficColumn(db);
    console.log('测试库 referral_traffic_limit 字段已就绪');

    console.log('\n测试 fetchAllServerTraffic...');
    const serverTrafficData = await trafficManager.fetchAllServerTraffic(db);
    console.log('服务器流量数据:', Object.keys(serverTrafficData).length, '台服务器');

    console.log('\n测试 calculateUserTotalTraffic...');
    const userTrafficData = await trafficManager.calculateUserTotalTraffic(db, serverTrafficData);
    console.log('用户流量数据:', Object.keys(userTrafficData).length, '个用户');

    const userIds = Object.keys(userTrafficData).slice(0, 5);
    for (const userId of userIds) {
      const data = userTrafficData[userId];
      console.log(`  用户 ${data.email}: ${data.trafficUsed} 字节, 超限: ${data.isOverLimit}`);
    }
  } catch (error) {
    console.error('测试失败:', error.message);
  } finally {
    await databaseManager.close();
  }
}

test();


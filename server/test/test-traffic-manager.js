/**
 * 流量管理模块测试脚本
 */

const databaseManager = require('../db/init');
const trafficManager = require('../services/shared/traffic-manager');

async function test() {
  try {
    // 初始化数据库连接
    const db = await databaseManager.init();
    console.log('数据库连接成功');

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


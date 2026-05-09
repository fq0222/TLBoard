/**
 * 流量管理模块测试脚本
 */

const databaseManager = require('../db/init');
const trafficManager = require('../services/traffic-manager');

async function test() {
  try {
    // 初始化数据库连接
    const db = await databaseManager.init();
    console.log('数据库连接成功');

    console.log('\n测试 fetchAllServerTraffic...');
    const serverTrafficData = await trafficManager.fetchAllServerTraffic(db);
    console.log('结果:', JSON.stringify(serverTrafficData, null, 2));
  } catch (error) {
    console.error('测试失败:', error.message);
  } finally {
    await databaseManager.close();
  }
}

test();

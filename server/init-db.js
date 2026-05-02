/**
 * 数据库初始化脚本
 * 仅在首次部署时运行一次，用于创建表结构和插入默认数据（管理员、套餐、公告）
 * 
 * 使用方式：node init-db.js
 * 
 * 前提条件：
 * 1. 已安装并启动 PostgreSQL 服务
 * 2. 已创建数据库（默认数据库名：subscription_manager）
 * 3. 已配置正确的数据库连接信息（config.js 或环境变量）
 */

const databaseManager = require('./db/init');

async function main() {
  console.log('========================================');
  console.log('数据库初始化脚本 (PostgreSQL)');
  console.log('========================================');
  
  try {
    // 初始化数据库（创建表结构）
    await databaseManager.init();
    console.log('[OK] 数据库表结构初始化完成');
    
    // 初始化默认数据
    await databaseManager.initDefaultData();
    console.log('[OK] 默认数据初始化完成');
    
    // 关闭数据库连接
    await databaseManager.close();
    
    console.log('========================================');
    console.log('初始化完成！');
    console.log('默认管理员账号: admin / admin123');
    console.log('========================================');
    
    process.exit(0);
  } catch (error) {
    console.error('[ERROR] 初始化失败:', error.message);
    console.error('请检查：');
    console.error('1. PostgreSQL 服务是否已启动');
    console.error('2. 数据库是否已创建');
    console.error('3. 数据库连接配置是否正确');
    process.exit(1);
  }
}

main();
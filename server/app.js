/**
 * 统一启动入口
 * 同时启动用户端(30000)和管理端(30001)Express应用
 * 共享同一个数据库实例
 */

const config = require('./config');
const databaseManager = require('./db/init');
const { startAllJobs, stopAllJobs } = require('./jobs');
const createUserApp = require('./bootstrap/create-user-app');
const createAdminApp = require('./bootstrap/create-admin-app');
const registerShutdown = require('./bootstrap/register-shutdown');
const { registerAdminBatchSubscriptionWs } = require('./websocket/admin-batch-subscription-ws');
const { createLogger } = require('./utils/logger');

const logger = createLogger('APP');

// 保存服务器实例引用
let userServer = null;
let adminServer = null;
let db = null;

registerShutdown({
  logger,
  stopAllJobs,
  databaseManager,
  getServers: () => ({ userServer, adminServer })
});

/**
 * 启动应用
 * 负责初始化数据库、启动定时任务并监听用户端与管理端端口
 */
async function startApp() {
  try {
    db = await databaseManager.init();
    logger.info('数据库初始化成功');
  } catch (error) {
    logger.error(`数据库初始化失败: ${error.message}`);
    process.exit(1);
  }

  startAllJobs(db);

  const userApp = createUserApp({ db, logger });
  const adminApp = createAdminApp({ db, logger });

  userServer = userApp.listen(config.user.port, () => {
    logger.info(`用户端服务器启动成功，端口: ${config.user.port}`);
  });

  adminServer = adminApp.listen(config.admin.port, () => {
    logger.info(`管理端服务器启动成功，端口: ${config.admin.port}`);
  });
  // 管理端批量任务进度使用 WebSocket 实时推送，不影响普通 HTTP API。
  registerAdminBatchSubscriptionWs(adminServer, db);
}

startApp();

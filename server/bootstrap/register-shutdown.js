/**
 * 注册优雅关闭逻辑
 * 负责接管进程退出信号、未捕获异常和 Promise 拒绝，保持现有关闭流程语义不变
 * @param {Object} params 注册参数
 * @param {Object} params.logger 日志实例
 * @param {Function} params.stopAllJobs 停止全部定时任务的方法
 * @param {Object} params.databaseManager 数据库管理器
 * @param {Function} params.getServers 获取当前服务实例的方法
 * @returns {Function} gracefulShutdown 优雅关闭方法
 */

function registerShutdown({ logger, stopAllJobs, databaseManager, getServers }) {
  async function gracefulShutdown(signal) {
    logger.info(`收到${signal}信号，正在优雅关闭服务器...`);

    stopAllJobs();

    const forceExitTimeout = setTimeout(() => {
      logger.error('关闭超时，强制退出');
      process.exit(1);
    }, 10000);

    try {
      const { userServer, adminServer } = getServers();

      if (userServer) {
        await new Promise((resolve) => {
          userServer.close(() => {
            logger.info('用户端服务器已关闭');
            resolve();
          });
        });
      }

      if (adminServer) {
        await new Promise((resolve) => {
          adminServer.close(() => {
            logger.info('管理端服务器已关闭');
            resolve();
          });
        });
      }

      logger.info('正在关闭数据库连接...');
      await databaseManager.close();
      logger.info('数据库连接已关闭');

      clearTimeout(forceExitTimeout);

      logger.info('服务器已安全关闭');
      process.exit(0);
    } catch (error) {
      logger.error(`关闭过程中发生错误: ${error.message}`);
      clearTimeout(forceExitTimeout);
      process.exit(1);
    }
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  process.on('uncaughtException', (error) => {
    logger.error(`未捕获的异常: ${error.message}`);
    logger.error(error.stack);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`未处理的Promise拒绝: ${reason}`);
    gracefulShutdown('unhandledRejection');
  });

  return gracefulShutdown;
}

module.exports = registerShutdown;

/**
 * 3X-UI 数据库备份定时任务
 * 每天从 xui_servers 表读取所有 3X-UI 服务器，使用 API Token 下载 x-ui.db，
 * 并覆盖保存到 server/backupDB 目录，防止远端服务器数据丢失。
 */

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const XuiApiClient = require('../services/xui-api-client');
const { createLogger } = require('../utils/logger');

const logger = createLogger('XUI-DB-BACKUP');
const defaultBackupDir = path.join(__dirname, '..', 'backupDB');

/**
 * 清理服务器名称中的非法文件名字符
 * @param {string} value - 原始服务器名称
 * @returns {string} 可用于文件名的服务器名称
 */
function sanitizeFileName(value) {
  const name = String(value || '').trim();
  if (!name) return 'server';
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

/**
 * 校验下载内容是否为 SQLite 数据库文件
 * @param {Buffer} buffer - 数据库文件内容
 * @returns {boolean} 是否包含 SQLite 文件头
 */
function isSqliteDatabase(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 16).toString('utf8') === 'SQLite format 3\0';
}

/**
 * 读取所有 3X-UI 服务器配置
 * @param {Object} db - 数据库实例
 * @returns {Promise<Array>} 服务器列表
 */
async function loadServers(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token
    FROM xui_servers
    ORDER BY id
  `).all();
}

/**
 * 备份单台 3X-UI 服务器数据库
 * @param {Object} server - 服务器配置
 * @param {Object} options - 测试或运行时选项
 * @returns {Promise<Object>} 备份结果
 */
async function backupServer(server, options = {}) {
  const backupDir = options.backupDir || defaultBackupDir;
  const XuiApiClientClass = options.XuiApiClientClass || XuiApiClient;

  if (!server.api_token) {
    logger.warn(`跳过服务器 ${server.name}，api_token 为空`);
    return { success: false, skipped: true, server };
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const client = new XuiApiClientClass(server.api_url, server.api_token, { timeout: 30000 });
  const data = await client.getDb();
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const filePath = path.join(backupDir, `${sanitizeFileName(server.name)}-x-ui.db`);

  fs.writeFileSync(filePath, buffer);

  const validSqlite = isSqliteDatabase(buffer);
  if (!validSqlite) {
    logger.warn(`服务器 ${server.name} 备份文件 SQLite 头校验未通过: ${filePath}`);
  }

  logger.info(`服务器 ${server.name} 数据库备份完成: ${filePath}, ${buffer.length} bytes`);
  return {
    success: validSqlite,
    skipped: false,
    server,
    filePath,
    size: buffer.length,
    validSqlite
  };
}

/**
 * 备份所有 3X-UI 服务器数据库
 * @param {Object} db - 数据库实例
 * @param {Object} options - 测试或运行时选项
 * @returns {Promise<Object>} 汇总结果
 */
async function backupXuiDatabases(db, options = {}) {
  const servers = await loadServers(db);
  const summary = {
    total: servers.length,
    success: 0,
    failed: 0,
    skipped: 0,
    results: []
  };

  for (const server of servers) {
    try {
      const result = await backupServer(server, options);
      summary.results.push(result);

      if (result.skipped) {
        summary.skipped++;
      } else if (result.success) {
        summary.success++;
      } else {
        summary.failed++;
      }
    } catch (error) {
      logger.error(`服务器 ${server.name} 数据库备份失败: ${error.message}`);
      summary.failed++;
      summary.results.push({
        success: false,
        skipped: false,
        server,
        error: error.message
      });
    }
  }

  logger.info(`3X-UI 数据库备份完成：成功 ${summary.success}/${summary.total}，失败 ${summary.failed}，跳过 ${summary.skipped}`);
  return summary;
}

/**
 * 注册 3X-UI 数据库备份任务
 * 每天凌晨 4 点执行一次，不在启动时立即执行。
 * @param {Object} db - 数据库实例
 * @param {Array} cronTasks - 定时任务引用列表
 */
function registerXuiDbBackupJob(db, cronTasks) {
  const task = cron.schedule('0 4 * * *', async () => {
    logger.info('开始执行 3X-UI 数据库备份任务');
    await backupXuiDatabases(db);
  });

  cronTasks.push(task);
  logger.info('3X-UI 数据库备份任务已注册（每天 4:00 执行）');
}

module.exports = {
  backupXuiDatabases,
  registerXuiDbBackupJob,
  sanitizeFileName
};

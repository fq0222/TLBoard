/**
 * 3X-UI 数据库备份工具。
 * 负责读取 `xui_servers` 表中的服务器配置，通过原生数据库接口下载备份
 * 并保存到 `server/backupDB` 目录，同时支持通过回调上报逐服务器进度。
 */

const fs = require('fs');
const path = require('path');
const {
  createXuiApiClient
} = require('../integrations/xui/xui-api-client-factory');
const { createLogger } = require('../utils/logger');

const logger = createLogger('XUI-DB-BACKUP');
const defaultBackupDir = path.join(__dirname, '..', 'backupDB');

/**
 * 清理服务器名称中的非法文件名字符。
 *
 * @param {string} value - 原始服务器名称
 * @returns {string} 可用于文件名的服务器名称
 */
function sanitizeFileName(value) {
  const name = String(value || '').trim();
  if (!name) return 'server';
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

/**
 * 识别 3X-UI 原生数据库备份格式，并拒绝常见的错误页面响应。
 *
 * @param {Buffer} buffer - 下载得到的二进制内容
 * @returns {{valid: boolean, format: string, extension: string|null}} 格式识别结果
 */
function detectBackupFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { valid: false, format: 'empty', extension: null };
  }

  if (buffer.subarray(0, 16).toString('utf8') === 'SQLite format 3\0') {
    return { valid: true, format: 'sqlite', extension: '.db' };
  }

  if (buffer.subarray(0, 5).toString('ascii') === 'PGDMP') {
    return { valid: true, format: 'postgres-custom', extension: '.dump' };
  }

  const prefix = buffer.subarray(0, 512).toString('utf8').trimStart();
  if (prefix.startsWith('{') || prefix.startsWith('[')) {
    return { valid: false, format: 'json-response', extension: null };
  }

  if (/^<!doctype html|^<html/i.test(prefix)) {
    return { valid: false, format: 'html-response', extension: null };
  }

  return { valid: false, format: 'unknown', extension: null };
}

/**
 * 先写入同目录临时文件，再重命名替换最终备份，避免残缺响应直接污染备份文件。
 *
 * @param {string} filePath - 最终备份路径
 * @param {Buffer} buffer - 已校验的备份内容
 */
function writeBackupFile(filePath, buffer) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

/**
 * 读取全部 3X-UI 服务器配置。
 *
 * @param {Object} db - 数据库代理对象
 * @returns {Promise<Array>} 服务器列表
 */
async function loadServers(db) {
  return db.prepare(`
    SELECT id, name, api_url, api_token, panel_version
    FROM xui_servers
    ORDER BY id
  `).all();
}

/**
 * 根据运行选项创建 3X-UI 客户端。
 * 优先保留测试注入能力，其次再走版本工厂创建正式客户端。
 *
 * @param {Object} server - 服务器配置
 * @param {Object} options - 运行选项
 * @returns {Object} 3X-UI 客户端实例
 */
function buildClient(server, options = {}) {
  if (options.XuiApiClientClass) {
    return new options.XuiApiClientClass(server.api_url, server.api_token, { timeout: 30000 });
  }

  if (typeof options.createClient === 'function') {
    return options.createClient(server, options);
  }

  const { client } = createXuiApiClient(server.api_url, server.api_token, {
    timeout: 30000,
    apiVersion: options.apiVersion || server.panel_version
  });
  return client;
}

/**
 * 备份单台 3X-UI 服务器数据库。
 *
 * @param {Object} server - 服务器配置
 * @param {Object} options - 运行选项
 * @returns {Promise<Object>} 备份结果
 */
async function backupServer(server, options = {}) {
  const backupDir = options.backupDir || defaultBackupDir;

  if (!server.api_token) {
    logger.warn(`跳过服务器 ${server.name}：api_token 为空`);
    return { success: false, skipped: true, server };
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const client = buildClient(server, options);
  const data = await client.getDb();
  const buffer = data === null || data === undefined
    ? Buffer.alloc(0)
    : (Buffer.isBuffer(data) ? data : Buffer.from(data));
  const detected = detectBackupFormat(buffer);
  const validSqlite = detected.format === 'sqlite';

  if (!detected.valid) {
    const prefixHex = buffer.subarray(0, 16).toString('hex');
    logger.warn(
      `服务器 ${server.name} 数据库备份格式校验失败: `
      + `format=${detected.format}, size=${buffer.length}, prefix_hex=${prefixHex}`
    );
    return {
      success: false,
      skipped: false,
      server,
      size: buffer.length,
      format: detected.format,
      validSqlite
    };
  }

  const filePath = path.join(
    backupDir,
    `${sanitizeFileName(server.name)}-x-ui${detected.extension}`
  );
  writeBackupFile(filePath, buffer);

  logger.info(
    `服务器 ${server.name} 数据库备份完成: `
    + `${filePath}, format=${detected.format}, ${buffer.length} bytes`
  );
  return {
    success: detected.valid,
    skipped: false,
    server,
    filePath,
    size: buffer.length,
    format: detected.format,
    validSqlite
  };
}

/**
 * 备份全部 3X-UI 服务器数据库。
 * 通过 `onProgress` 回调实时上报整体开始、单服务器开始、单服务器完成和全部完成事件。
 *
 * @param {Object} db - 数据库代理对象
 * @param {Object} options - 运行选项
 * @param {Function} [options.onProgress] - 进度回调
 * @returns {Promise<Object>} 汇总结果
 */
async function backupXuiDatabases(db, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const servers = await loadServers(db);
  const summary = {
    total: servers.length,
    success: 0,
    failed: 0,
    skipped: 0,
    results: []
  };

  if (onProgress) {
    onProgress({
      type: 'start',
      total: summary.total,
      completed: 0
    });
  }

  for (const server of servers) {
    if (onProgress) {
      onProgress({
        type: 'server_start',
        server,
        total: summary.total,
        completed: summary.success + summary.failed + summary.skipped
      });
    }

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

      if (onProgress) {
        onProgress({
          type: 'server_complete',
          server,
          result,
          total: summary.total,
          completed: summary.success + summary.failed + summary.skipped
        });
      }
    } catch (error) {
      logger.error(`服务器 ${server.name} 数据库备份失败: ${error.message}`);
      summary.failed++;
      const result = {
        success: false,
        skipped: false,
        server,
        error: error.message
      };
      summary.results.push(result);

      if (onProgress) {
        onProgress({
          type: 'server_complete',
          server,
          result,
          total: summary.total,
          completed: summary.success + summary.failed + summary.skipped
        });
      }
    }
  }

  logger.info(`3X-UI 数据库备份完成：成功 ${summary.success}/${summary.total}，失败 ${summary.failed}，跳过 ${summary.skipped}`);

  if (onProgress) {
    onProgress({
      type: 'finish',
      summary
    });
  }

  return summary;
}

module.exports = {
  backupXuiDatabases,
  backupServer,
  buildClient,
  detectBackupFormat,
  sanitizeFileName
};

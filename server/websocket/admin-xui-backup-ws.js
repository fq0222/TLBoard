/**
 * 管理端 3X-UI 备份任务 WebSocket。
 * 负责管理员鉴权、任务状态订阅和任务结束后的主动断开。
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { createLogger } = require('../utils/logger');
const xuiBackupTaskService = require('../services/admin/xui-backup-task-service');

const logger = createLogger('ADMIN-XUI-BACKUP-WS');
const WS_PATH = '/api/admin/servers/backup/ws';
const FINISHED_STATUSES = new Set(['completed', 'failed']);

/**
 * 发送 JSON 消息。
 *
 * @param {WebSocket} socket - WebSocket 连接
 * @param {Object} payload - 要发送的内容
 * @returns {void}
 */
function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

/**
 * 校验 URL 中的管理员 token。
 *
 * @param {URLSearchParams} searchParams - URL 查询参数
 * @returns {Object|null} 管理员 JWT 载荷
 */
function verifyAdminToken(searchParams) {
  const token = searchParams.get('token');
  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, config.admin.jwtSecret);
  } catch (error) {
    logger.warn(`3X-UI 备份 WebSocket Token 验证失败: ${error.message}`);
    return null;
  }
}

/**
 * 绑定管理端 3X-UI 备份任务 WebSocket 服务。
 *
 * @param {Object} server - 管理端 HTTP Server
 * @returns {WebSocket.Server} WebSocket 服务实例
 */
function registerAdminXuiBackupWs(server) {
  const wsServer = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== WS_PATH) {
      return;
    }

    const admin = verifyAdminToken(url.searchParams);
    if (!admin) {
      socket.destroy();
      return;
    }

    request.admin = admin;
    request.backupTaskId = url.searchParams.get('task_id');
    wsServer.handleUpgrade(request, socket, head, (webSocket) => {
      wsServer.emit('connection', webSocket, request);
    });
  });

  wsServer.on('connection', (socket, request) => {
    logger.info(`3X-UI 备份 WebSocket 已连接: ${request.admin.username}`);
    const taskId = Number(request.backupTaskId) || null;

    const listener = (status) => {
      if (taskId && Number(status.id) !== taskId) {
        return;
      }
      sendJson(socket, { type: 'status', data: status });
      if (FINISHED_STATUSES.has(status.status)) {
        socket.close(1000, '备份任务已结束');
      }
    };

    socket.on('close', () => {
      xuiBackupTaskService.off('status', listener);
      logger.info(`3X-UI 备份 WebSocket 已关闭: ${request.admin.username}`);
    });

    const currentStatus = xuiBackupTaskService.getStatus(taskId);
    if (currentStatus) {
      listener(currentStatus);
    }
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    xuiBackupTaskService.on('status', listener);
  });

  return wsServer;
}

module.exports = {
  registerAdminXuiBackupWs
};

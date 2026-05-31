/**
 * 管理端批量订阅生成 WebSocket。
 * 负责管理员鉴权、任务状态订阅和结束后主动关闭连接，业务执行仍由 service 层处理。
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { createLogger } = require('../utils/logger');
const batchSubscriptionService = require('../services/admin/batch-subscription-service');

const logger = createLogger('ADMIN-BATCH-WS');
const WS_PATH = '/api/admin/users/batch-generate-subscriptions/ws';
const FINISHED_STATUSES = new Set(['completed', 'failed']);
const STATUS_PUSH_INTERVAL = 2000;

/**
 * 发送 JSON 消息。
 *
 * @param {WebSocket} socket - WebSocket 连接
 * @param {Object} payload - 消息内容
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
    logger.warn(`WebSocket Token 验证失败: ${error.message}`);
    return null;
  }
}

/**
 * 绑定管理端批量订阅 WebSocket 服务。
 *
 * @param {Object} server - 管理端 HTTP Server
 * @param {Object} db - 数据库代理对象
 * @returns {WebSocket.Server} WebSocket 服务实例
 */
function registerAdminBatchSubscriptionWs(server, db) {
  const wsServer = new WebSocket.Server({ noServer: true });
  batchSubscriptionService.bindDb(db);

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
    request.batchTaskId = url.searchParams.get('task_id');
    wsServer.handleUpgrade(request, socket, head, (webSocket) => {
      wsServer.emit('connection', webSocket, request);
    });
  });

  wsServer.on('connection', async (socket, request) => {
    logger.info(`批量订阅 WebSocket 已连接: ${request.admin.username}`);
    const taskId = Number(request.batchTaskId) || null;

    const listener = (status) => {
      sendJson(socket, { type: 'status', data: status });
      if (FINISHED_STATUSES.has(status.status)) {
        socket.close(1000, '任务已结束');
      }
    };

    const pushCurrentStatus = async () => {
      const status = taskId
        ? await batchSubscriptionService.getStatusById(taskId)
        : await batchSubscriptionService.getLatestStatus(db);

      if (status) {
        listener(status);
      }
    };

    batchSubscriptionService.on('status', listener);
    const statusTimer = setInterval(() => {
      pushCurrentStatus().catch(error => {
        logger.warn(`推送批量订阅状态失败: ${error.message}`);
      });
    }, STATUS_PUSH_INTERVAL);

    socket.on('close', () => {
      clearInterval(statusTimer);
      batchSubscriptionService.off('status', listener);
      logger.info(`批量订阅 WebSocket 已关闭: ${request.admin.username}`);
    });

    await pushCurrentStatus();
  });

  return wsServer;
}

module.exports = {
  registerAdminBatchSubscriptionWs
};

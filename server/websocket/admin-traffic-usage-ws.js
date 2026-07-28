/**
 * 管理端流量统计 WebSocket。
 * 职责：仅向当前停留在数据统计页面的管理端连接推送最新流量统计快照。
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { createLogger } = require('../utils/logger');
const trafficUsagePushService = require('../services/admin/traffic-usage-push-service');

const logger = createLogger('ADMIN-TRAFFIC-USAGE-WS');
const WS_PATH = '/api/admin/dashboard/traffic-usage/ws';

/**
 * 发送 JSON 消息。
 *
 * @param {WebSocket} socket - WebSocket 连接。
 * @param {Object} payload - 消息内容。
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
 * @param {URLSearchParams} searchParams - URL 查询参数。
 * @returns {Object|null} 管理员 JWT 载荷。
 */
function verifyAdminToken(searchParams) {
  const token = searchParams.get('token');
  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, config.admin.jwtSecret);
  } catch (error) {
    logger.warn(`流量统计 WebSocket Token 验证失败: ${error.message}`);
    return null;
  }
}

/**
 * 绑定管理端流量统计 WebSocket 服务。
 *
 * @param {Object} server - 管理端 HTTP Server。
 * @param {Object} db - 数据库实例。
 * @returns {WebSocket.Server} WebSocket 服务实例。
 */
function registerAdminTrafficUsageWs(server, db) {
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
    wsServer.handleUpgrade(request, socket, head, (webSocket) => {
      wsServer.emit('connection', webSocket, request);
    });
  });

  wsServer.on('connection', async (socket, request) => {
    logger.info(`流量统计 WebSocket 已连接: ${request.admin.username}`);

    const listener = (stats) => {
      sendJson(socket, { type: 'traffic-usage', data: stats });
    };

    socket.on('close', () => {
      trafficUsagePushService.off('stats', listener);
      logger.info(`流量统计 WebSocket 已关闭: ${request.admin.username}`);
    });

    trafficUsagePushService.on('stats', listener);
    try {
      const currentStats = await trafficUsagePushService.getCurrentStats(db);
      listener(currentStats);
    } catch (error) {
      logger.warn(`推送当前流量统计失败: ${error.message}`);
    }
  });

  return wsServer;
}

module.exports = {
  registerAdminTrafficUsageWs
};

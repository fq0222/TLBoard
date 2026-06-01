const { validationResult } = require('express-validator');
const { legacyFail } = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const { getSiteBaseUrl } = require('../../utils/site-url');
const {
  getOrCreateDownloadLink,
  listDownloadResources
} = require('../../services/shared/download-link-service');
const downloadService = require('../../services/user/download-service');

const logger = createLogger('USER-DOWNLOAD');

/**
 * 用户端下载控制器。
 * 负责参数校验、日志记录、旧响应结构兼容与文件下载响应编排。
 */

function handleControllerError(res, action, error) {
  if (error && error.isLegacyBusinessError) {
    logger.warn(`${action}失败: ${error.message}`);
    return res.status(error.statusCode).json({
      code: error.code,
      message: error.message,
      data: error.data
    });
  }

  logger.error(`${action}错误: ${error.message}`);
  return legacyFail(res);
}

function handleValidationFailure(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }

  res.status(400).json({
    code: 7001,
    message: '请求参数无效',
    data: null
  });
  return true;
}

/**
 * 返回帮助页可展示的下载资源列表。
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} 旧格式响应
 */
async function getDownloadResources(req, res) {
  try {
    const data = await listDownloadResources({
      db: req.app.locals.db
    });

    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    logger.error(`获取下载资源列表错误: 用户 ${req.user?.email || 'unknown'}, ${error.message}`);
    return legacyFail(res);
  }
}

/**
 * 按资源 ID 生成下载链接。
 * 分支语义：参数无效直接返回 400；业务错误保持旧接口 code/message/data；成功返回下载 URL。
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} 旧格式响应
 */
async function getDownloadLink(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await getOrCreateDownloadLink({
      db: req.app.locals.db,
      resourceId: req.params.resourceId,
      userId: req.user.id,
      siteBaseUrl: getSiteBaseUrl(req)
    });

    logger.info(
      `获取下载链接成功: 用户 ${req.user.email}, 资源 ${data.resource_name}, 动作 ${data.action}, 过期时间 ${data.expire_at}`
    );

    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    logger.error(`获取下载链接错误: 用户 ${req.user?.email || 'unknown'}, ${error.message}`);
    return res.json({
      code: error.code || 500,
      message: error.message,
      data: null
    });
  }
}

async function downloadFile(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return res.status(400).json({
        code: 7001,
        message: '下载链接无效',
        data: null
      });
    }

    const downloadInfo = await downloadService.prepareDownload(req.app.locals.db, req.params.token);
    const { stream, activeStreamCount } = downloadService.createDownloadStream(downloadInfo);

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadInfo.fileName)}`);
    res.setHeader('Content-Type', downloadInfo.fileMimetype || 'application/octet-stream');
    res.setHeader('Content-Length', downloadInfo.fileSize);

    const downloadStartTime = Date.now();
    const downloadLimitText = downloadInfo.speedLimit > 0
      ? `全局限速 ${downloadInfo.speedLimit / 1024}KB/s, 当前活跃流 ${activeStreamCount}`
      : '不限速';
    logger.info(`开始下载(${downloadLimitText}): ${downloadInfo.resourceName} (ID: ${downloadInfo.resourceId})`);

    stream.on('error', (error) => {
      logger.error(`文件读取错误: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({
          code: 500,
          message: '文件读取失败',
          data: null
        });
      }
    });

    res.on('finish', () => {
      const durationMs = Date.now() - downloadStartTime;
      logger.info(
        `下载完成(${downloadLimitText}, 耗时 ${durationMs}ms): ${downloadInfo.resourceName} (ID: ${downloadInfo.resourceId})`
      );
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        const durationMs = Date.now() - downloadStartTime;
        logger.warn(
          `下载中断(${downloadLimitText}, 已传输 ${durationMs}ms): ${downloadInfo.resourceName} (ID: ${downloadInfo.resourceId})`
        );
      }
    });

    stream.pipe(res);
  } catch (error) {
    return handleControllerError(res, '下载文件', error);
  }
}

module.exports = {
  getDownloadResources,
  getDownloadLink,
  downloadFile
};

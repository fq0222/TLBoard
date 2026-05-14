const express = require('express');
const path = require('path');
const fs = require('fs');
const { Transform } = require('stream');
const { param, validationResult } = require('express-validator');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('USER-DOWNLOAD');

// 全局限速器
class GlobalThrottle {
  constructor() {
    this.bytesPerSecond = 0;
    this.availableTokens = 0;
    this.lastRefillTime = Date.now();
    this.activeStreams = new Set();
    this.refillInterval = null;
  }

  // 更新限速配置
  updateSpeed(bytesPerSecond) {
    if (this.bytesPerSecond !== bytesPerSecond) {
      this.bytesPerSecond = bytesPerSecond;
      this.availableTokens = bytesPerSecond;
      
      if (bytesPerSecond > 0 && !this.refillInterval) {
        this.startRefill();
      } else if (bytesPerSecond <= 0 && this.refillInterval) {
        this.stopRefill();
      }
    }
  }

  // 开始令牌补充
  startRefill() {
    this.refillInterval = setInterval(() => {
      if (this.bytesPerSecond > 0) {
        this.availableTokens = Math.min(
          this.bytesPerSecond * 2, // 最大积累2秒的令牌
          this.availableTokens + this.bytesPerSecond
        );
      }
    }, 1000);
  }

  // 停止令牌补充
  stopRefill() {
    if (this.refillInterval) {
      clearInterval(this.refillInterval);
      this.refillInterval = null;
    }
  }

  // 获取令牌
  async acquireTokens(bytes) {
    if (this.bytesPerSecond <= 0) {
      return; // 不限速
    }

    while (bytes > 0) {
      if (this.availableTokens >= bytes) {
        this.availableTokens -= bytes;
        return;
      }

      // 等待令牌补充
      const waitTime = Math.ceil((bytes - this.availableTokens) / this.bytesPerSecond * 1000);
      await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 100)));
    }
  }

  // 注册流
  registerStream(stream) {
    this.activeStreams.add(stream);
  }

  // 注销流
  unregisterStream(stream) {
    this.activeStreams.delete(stream);
  }

  // 获取活跃流数量
  getActiveStreamCount() {
    return this.activeStreams.size;
  }
}

// 全局限速器实例
const globalThrottle = new GlobalThrottle();

// 获取资源配置
async function getResourceConfig(db) {
  try {
    const config = await db.prepare("SELECT value FROM system_settings WHERE key = 'resource_config'").get();
    if (config) {
      return JSON.parse(config.value);
    }
    return { max_file_size: 100, download_speed_limit: 0 };
  } catch (error) {
    logger.error(`获取资源配置失败: ${error.message}`);
    return { max_file_size: 100, download_speed_limit: 0 };
  }
}

// 创建全局限速流
class GlobalThrottleStream extends Transform {
  constructor(globalThrottle) {
    super();
    this.globalThrottle = globalThrottle;
    this.globalThrottle.registerStream(this);
    this.transferred = 0;
  }

  async _transform(chunk, encoding, callback) {
    if (this.globalThrottle.bytesPerSecond <= 0) {
      this.push(chunk);
      this.transferred += chunk.length;
      callback();
      return;
    }

    try {
      // 等待令牌
      await this.globalThrottle.acquireTokens(chunk.length);
      this.push(chunk);
      this.transferred += chunk.length;
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    this.globalThrottle.unregisterStream(this);
    callback();
  }
}

/**
 * GET /api/user/download/:token
 * 下载文件
 * 支持两种 token：
 * 1. 分发表中的用户独立 token
 * 2. 资源表中的全局 token
 */
router.get('/:token', [
  param('token').isLength({ min: 32, max: 32 }).withMessage('下载链接无效')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 7001,
        message: '下载链接无效',
        data: null
      });
    }

    const { token } = req.params;
    const db = req.app.locals.db;
    const now = Math.floor(Date.now() / 1000);

    // 优先查询分发表中的用户独立 token
    let distribution = await db.prepare(`
      SELECT rd.*, r.name, r.filename, r.original_name, r.size, r.mimetype, r.path
      FROM resource_distributions rd
      JOIN resources r ON rd.resource_id = r.id
      WHERE rd.download_token = ?
    `).get(token);

    let resource = null;
    let isDistribution = false;

    if (distribution) {
      // 分发记录存在
      isDistribution = true;

      // 检查分发是否启用
      if (!distribution.enabled) {
        logger.warn(`下载失败: 分发已禁用 - ${distribution.name}`);
        return res.status(403).json({
          code: 7002,
          message: '该下载链接已被禁用',
          data: null
        });
      }

      // 检查分发是否过期
      if (distribution.expire_at && distribution.expire_at < now) {
        logger.warn(`下载失败: 链接已过期 - ${distribution.name}`);
        return res.status(410).json({
          code: 7003,
          message: '下载链接已过期',
          data: null
        });
      }

      // 检查资源是否启用
      resource = await db.prepare('SELECT * FROM resources WHERE id = ?').get(distribution.resource_id);
      if (!resource || !resource.enabled) {
        logger.warn(`下载失败: 资源已禁用 - ${distribution.name}`);
        return res.status(403).json({
          code: 7002,
          message: '该资源已被禁用',
          data: null
        });
      }
    } else {
      // 分发表中没有，查询资源表中的全局 token
      resource = await db.prepare('SELECT * FROM resources WHERE download_token = ?').get(token);

      if (!resource) {
        logger.warn(`下载失败: 链接无效 - token: ${token}`);
        return res.status(404).json({
          code: 7001,
          message: '下载链接无效或资源不存在',
          data: null
        });
      }

      // 检查资源是否启用
      if (!resource.enabled) {
        logger.warn(`下载失败: 资源已禁用 - ${resource.name}`);
        return res.status(403).json({
          code: 7002,
          message: '该资源已被禁用',
          data: null
        });
      }

      // 检查资源是否过期
      if (resource.expire_at && resource.expire_at < now) {
        logger.warn(`下载失败: 链接已过期 - ${resource.name}`);
        return res.status(410).json({
          code: 7003,
          message: '下载链接已过期',
          data: null
        });
      }
    }

    // 检查文件是否存在
    const filePath = isDistribution ? distribution.path : resource.path;
    const fileName = isDistribution ? distribution.original_name : resource.original_name;
    const fileSize = isDistribution ? distribution.size : resource.size;
    const fileMimetype = isDistribution ? distribution.mimetype : resource.mimetype;
    const resourceName = isDistribution ? distribution.name : resource.name;
    const resourceId = isDistribution ? distribution.resource_id : resource.id;

    if (!fs.existsSync(filePath)) {
      logger.error(`下载失败: 文件不存在 - ${filePath}`);
      return res.status(404).json({
        code: 7004,
        message: '文件不存在',
        data: null
      });
    }

    // 获取下载速度限制配置
    const config = await getResourceConfig(db);
    const speedLimit = config.download_speed_limit * 1024; // 转换为字节/秒

    // 更新全局限速器配置
    globalThrottle.updateSpeed(speedLimit);

    // 更新下载次数
    if (isDistribution) {
      await db.prepare('UPDATE resource_distributions SET download_count = download_count + 1 WHERE id = ?')
        .run(distribution.id);
    } else {
      await db.prepare('UPDATE resources SET download_count = download_count + 1 WHERE id = ?')
        .run(resource.id);
    }

    // 设置响应头
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Content-Type', fileMimetype || 'application/octet-stream');
    res.setHeader('Content-Length', fileSize);

    // 创建读取流
    const fileStream = fs.createReadStream(filePath);

    if (speedLimit > 0) {
      // 使用全局限速流
      const throttleStream = new GlobalThrottleStream(globalThrottle);
      fileStream.pipe(throttleStream).pipe(res);
      logger.info(`下载成功(全局限速 ${config.download_speed_limit}KB/s, 当前活跃流: ${globalThrottle.getActiveStreamCount()}): ${resourceName} (ID: ${resourceId})`);
    } else {
      fileStream.pipe(res);
      logger.info(`下载成功: ${resourceName} (ID: ${resourceId})`);
    }

    fileStream.on('error', (error) => {
      logger.error(`文件读取错误: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({
          code: 500,
          message: '文件读取失败',
          data: null
        });
      }
    });
  } catch (error) {
    logger.error(`下载错误: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({
        code: 500,
        message: '服务器内部错误',
        data: null
      });
    }
  }
});

module.exports = router;

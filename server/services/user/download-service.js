const fs = require('fs');
const { Transform } = require('stream');
const { createLogger } = require('../../utils/logger');
const downloadRepository = require('../../repositories/download-repository');

const logger = createLogger('USER-DOWNLOAD');

/**
 * 用户端下载服务。
 * 负责下载鉴权后的资源解析、限速配置与文件流编排，保持旧接口语义不变。
 */

class GlobalThrottle {
  constructor() {
    this.bytesPerSecond = 0;
    this.availableTokens = 0;
    this.activeStreams = new Set();
    this.refillInterval = null;
  }

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

  startRefill() {
    this.refillInterval = setInterval(() => {
      if (this.bytesPerSecond > 0) {
        this.availableTokens = Math.min(
          this.bytesPerSecond * 2,
          this.availableTokens + this.bytesPerSecond
        );
      }
    }, 1000);
  }

  stopRefill() {
    if (this.refillInterval) {
      clearInterval(this.refillInterval);
      this.refillInterval = null;
    }
  }

  async acquireTokens(bytes) {
    if (this.bytesPerSecond <= 0) {
      return;
    }

    while (bytes > 0) {
      if (this.availableTokens >= bytes) {
        this.availableTokens -= bytes;
        return;
      }

      const waitTime = Math.ceil((bytes - this.availableTokens) / this.bytesPerSecond * 1000);
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitTime, 100)));
    }
  }

  registerStream(stream) {
    this.activeStreams.add(stream);
  }

  unregisterStream(stream) {
    this.activeStreams.delete(stream);
  }

  getActiveStreamCount() {
    return this.activeStreams.size;
  }
}

class GlobalThrottleStream extends Transform {
  constructor(globalThrottle) {
    super();
    this.globalThrottle = globalThrottle;
    this.globalThrottle.registerStream(this);
  }

  async _transform(chunk, encoding, callback) {
    if (this.globalThrottle.bytesPerSecond <= 0) {
      this.push(chunk);
      callback();
      return;
    }

    try {
      await this.globalThrottle.acquireTokens(chunk.length);
      this.push(chunk);
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

const globalThrottle = new GlobalThrottle();

function createLegacyBusinessError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  return error;
}

function formatExpireTime(timestamp) {
  if (!timestamp) {
    return '无限期';
  }

  return new Date(Number(timestamp) * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false
  });
}

async function getResourceConfig(db) {
  try {
    const configRow = await downloadRepository.getResourceConfigRow(db);
    if (configRow) {
      return JSON.parse(configRow.value);
    }
  } catch (error) {
    logger.error(`获取资源配置失败: ${error.message}`);
  }

  return { max_file_size: 100, download_speed_limit: 0 };
}

/**
 * 解析下载 token 对应的资源与权限状态。
 *
 * @param {Object} db - 数据库实例
 * @param {string} token - 下载 token
 * @returns {Promise<Object>} 下载准备结果
 */
async function prepareDownload(db, token) {
  const now = Math.floor(Date.now() / 1000);
  let distribution = await downloadRepository.findDistributionDownloadByToken(db, token);
  let resource = null;
  let isDistribution = false;

  if (distribution) {
    isDistribution = true;

    if (!distribution.enabled) {
      throw createLegacyBusinessError('该下载链接已被禁用', {
        statusCode: 403,
        code: 7002
      });
    }

    if (distribution.expire_at && Number(distribution.expire_at) < now) {
      throw createLegacyBusinessError('下载链接已过期', {
        statusCode: 410,
        code: 7003
      });
    }

    resource = await downloadRepository.findResourceById(db, distribution.resource_id);
    if (!resource || !resource.enabled) {
      throw createLegacyBusinessError('该资源已被禁用', {
        statusCode: 403,
        code: 7002
      });
    }
  } else {
    resource = await downloadRepository.findResourceDownloadByToken(db, token);

    if (!resource) {
      throw createLegacyBusinessError('下载链接无效或资源不存在', {
        statusCode: 404,
        code: 7001
      });
    }

    if (!resource.enabled) {
      throw createLegacyBusinessError('该资源已被禁用', {
        statusCode: 403,
        code: 7002
      });
    }

    if (resource.expire_at && Number(resource.expire_at) < now) {
      throw createLegacyBusinessError('下载链接已过期', {
        statusCode: 410,
        code: 7003
      });
    }
  }

  const filePath = isDistribution ? distribution.path : resource.path;
  if (!fs.existsSync(filePath)) {
    throw createLegacyBusinessError('文件不存在', {
      statusCode: 404,
      code: 7004
    });
  }

  const config = await getResourceConfig(db);
  const speedLimit = Number(config.download_speed_limit || 0) * 1024;

  if (isDistribution) {
    await downloadRepository.incrementDistributionDownloadCount(db, distribution.id);
  } else {
    await downloadRepository.incrementResourceDownloadCount(db, resource.id);
  }

  return {
    filePath,
    fileName: isDistribution ? distribution.original_name : resource.original_name,
    fileSize: isDistribution ? distribution.size : resource.size,
    fileMimetype: isDistribution ? distribution.mimetype : resource.mimetype,
    resourceName: isDistribution ? distribution.name : resource.name,
    resourceId: isDistribution ? distribution.resource_id : resource.id,
    speedLimit,
    expireText: formatExpireTime(isDistribution ? distribution.expire_at : resource.expire_at)
  };
}

/**
 * 创建下载文件流，必要时挂接全局限速流。
 *
 * @param {Object} downloadInfo - 下载准备结果
 * @returns {{stream: import('stream').Readable, activeStreamCount: number}} 流结果
 */
function createDownloadStream(downloadInfo) {
  const fileStream = fs.createReadStream(downloadInfo.filePath);

  if (downloadInfo.speedLimit > 0) {
    globalThrottle.updateSpeed(downloadInfo.speedLimit);
    const throttleStream = new GlobalThrottleStream(globalThrottle);
    return {
      stream: fileStream.pipe(throttleStream),
      activeStreamCount: globalThrottle.getActiveStreamCount()
    };
  }

  return {
    stream: fileStream,
    activeStreamCount: 0
  };
}

module.exports = {
  getResourceConfig,
  prepareDownload,
  createDownloadStream
};

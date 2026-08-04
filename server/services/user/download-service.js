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
    } else if (bytesPerSecond > 0 && !this.refillInterval) {
      this.availableTokens = bytesPerSecond;
      this.startRefill();
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
    if (this.activeStreams.size === 0) {
      this.stopRefill();
    }
  }

  getActiveStreamCount() {
    return this.activeStreams.size;
  }
}

class GlobalThrottleStream extends Transform {
  constructor(globalThrottle) {
    super();
    this.globalThrottle = globalThrottle;
    this.unregistered = false;
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
    this.unregister();
    callback();
  }

  _destroy(error, callback) {
    this.unregister();
    callback(error);
  }

  unregister() {
    if (this.unregistered) {
      return;
    }

    this.unregistered = true;
    this.globalThrottle.unregisterStream(this);
  }
}

const globalThrottle = new GlobalThrottle();

function createLegacyBusinessError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  error.headers = options.headers;
  return error;
}

/**
 * 解析浏览器 Range 头，生成断点续传需要的文件读取范围。
 *
 * @param {string} rangeHeader - HTTP Range 请求头
 * @param {number} fileSize - 文件总字节数
 * @returns {{start:number,end:number}|null} 可读取范围；无 Range 时返回 null
 */
function parseDownloadRange(rangeHeader, fileSize) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match) {
    return null;
  }

  let start = match[1] === '' ? null : Number(match[1]);
  let end = match[2] === '' ? null : Number(match[2]);

  if (start === null && end === null) {
    return null;
  }

  if (start === null) {
    start = Math.max(fileSize - end, 0);
    end = fileSize - 1;
  } else if (end === null || end >= fileSize) {
    end = fileSize - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    throw createLegacyBusinessError('请求的下载范围无效', {
      statusCode: 416,
      code: 7006,
      headers: {
        'Content-Range': `bytes */${fileSize}`
      }
    });
  }

  return { start, end };
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

  return {
    filePath,
    fileName: isDistribution ? distribution.original_name : resource.original_name,
    fileSize: isDistribution ? distribution.size : resource.size,
    fileMimetype: isDistribution ? distribution.mimetype : resource.mimetype,
    resourceName: isDistribution ? distribution.name : resource.name,
    resourceId: isDistribution ? distribution.resource_id : resource.id,
    downloadCountTarget: {
      type: isDistribution ? 'distribution' : 'resource',
      id: isDistribution ? distribution.id : resource.id
    },
    speedLimit,
    expireText: formatExpireTime(isDistribution ? distribution.expire_at : resource.expire_at)
  };
}

/**
 * 按准备结果增加一次业务下载次数，Range 后续分片不会重复调用。
 *
 * @param {Object} db - 数据库实例
 * @param {Object} downloadInfo - 下载准备结果
 * @returns {Promise<void>}
 */
async function incrementPreparedDownloadCount(db, downloadInfo) {
  if (downloadInfo.downloadCountTarget?.type === 'distribution') {
    await downloadRepository.incrementDistributionDownloadCount(db, downloadInfo.downloadCountTarget.id);
    return;
  }

  await downloadRepository.incrementResourceDownloadCount(db, downloadInfo.downloadCountTarget.id);
}

/**
 * 构建文件下载响应元数据，Range 请求返回 206 以支持手机端断点续传。
 *
 * @param {Object} downloadInfo - 下载准备结果
 * @param {string} rangeHeader - HTTP Range 请求头
 * @returns {{statusCode:number,headers:Object,streamOptions:Object}} 响应状态、头和读取范围
 */
function buildDownloadResponse(downloadInfo, rangeHeader) {
  const range = parseDownloadRange(rangeHeader, Number(downloadInfo.fileSize));
  const baseHeaders = {
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(downloadInfo.fileName)}`,
    'Content-Type': downloadInfo.fileMimetype || 'application/octet-stream',
    'Accept-Ranges': 'bytes'
  };

  if (!range) {
    return {
      statusCode: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': downloadInfo.fileSize
      },
      streamOptions: {},
      isPartial: false,
      shouldCountDownload: true
    };
  }

  return {
    statusCode: 206,
    headers: {
      ...baseHeaders,
      'Content-Length': range.end - range.start + 1,
      'Content-Range': `bytes ${range.start}-${range.end}/${downloadInfo.fileSize}`
    },
    streamOptions: range,
    isPartial: true,
    shouldCountDownload: range.start === 0
  };
}

/**
 * 创建下载文件流，必要时挂接全局限速流。
 *
 * @param {Object} downloadInfo - 下载准备结果
 * @param {Object} streamOptions - fs.createReadStream 读取范围选项
 * @returns {{stream: import('stream').Readable, activeStreamCount: number, cleanup: Function}} 流结果
 */
function createDownloadStream(downloadInfo, streamOptions = {}) {
  const fileStream = fs.createReadStream(downloadInfo.filePath, streamOptions);

  if (downloadInfo.speedLimit > 0) {
    globalThrottle.updateSpeed(downloadInfo.speedLimit);
    const throttleStream = new GlobalThrottleStream(globalThrottle);
    const stream = fileStream.pipe(throttleStream);
    return {
      stream,
      activeStreamCount: globalThrottle.getActiveStreamCount(),
      cleanup() {
        fileStream.destroy();
        throttleStream.destroy();
      }
    };
  }

  return {
    stream: fileStream,
    activeStreamCount: 0,
    cleanup() {
      fileStream.destroy();
    }
  };
}

/**
 * 返回当前受全局限速管理的活跃下载流数量，供日志和测试确认清理效果。
 *
 * @returns {number} 活跃限速流数量
 */
function getActiveDownloadStreamCount() {
  return globalThrottle.getActiveStreamCount();
}

module.exports = {
  getResourceConfig,
  prepareDownload,
  incrementPreparedDownloadCount,
  buildDownloadResponse,
  createDownloadStream,
  getActiveDownloadStreamCount
};

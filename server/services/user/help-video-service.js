const fs = require('fs');
const { createGlobalThrottle } = require('../shared/global-throttle-stream');

const DEFAULT_BLOG_VIDEO_SPEED_LIMIT_KB = 300;
const blogVideoThrottle = createGlobalThrottle();

/**
 * 构造帮助中心视频业务错误。
 *
 * @param {string} message - 错误消息
 * @param {Object} options - 错误扩展配置
 * @returns {Error} 业务错误
 */
function createVideoError(message, options = {}) {
  const error = new Error(message);
  error.isLegacyBusinessError = true;
  error.statusCode = options.statusCode || 400;
  error.code = options.code || 1001;
  error.data = options.data === undefined ? null : options.data;
  error.headers = options.headers;
  return error;
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

/**
 * 读取博客视频限速配置。
 *
 * @param {Object} db - 数据库实例
 * @returns {Promise<{speedLimit:number,speedLimitKb:number}>} 限速配置，speedLimit 单位为 bytes/s
 */
async function getBlogVideoConfig(db) {
  try {
    const row = await db.prepare("SELECT value FROM system_settings WHERE key = 'resource_config'").get();
    if (row?.value) {
      const parsedConfig = JSON.parse(row.value);
      const speedLimitKb = normalizeNonNegativeInteger(
        parsedConfig.blog_video_speed_limit,
        DEFAULT_BLOG_VIDEO_SPEED_LIMIT_KB
      );
      return {
        speedLimit: speedLimitKb * 1024,
        speedLimitKb
      };
    }
  } catch {
    // 使用默认配置兜底。
  }

  return {
    speedLimit: DEFAULT_BLOG_VIDEO_SPEED_LIMIT_KB * 1024,
    speedLimitKb: DEFAULT_BLOG_VIDEO_SPEED_LIMIT_KB
  };
}

/**
 * 解析 HTTP Range 请求头。
 *
 * @param {string} rangeHeader - Range 头
 * @param {number} fileSize - 文件大小
 * @returns {{start:number,end:number}|null} 读取范围
 */
function parseVideoRange(rangeHeader, fileSize) {
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
    throw createVideoError('请求的视频范围无效', {
      statusCode: 416,
      code: 7106,
      headers: {
        'Content-Range': `bytes */${fileSize}`
      }
    });
  }

  return { start, end };
}

/**
 * 构建博客视频响应元数据。
 *
 * @param {Object} videoInfo - 视频文件信息
 * @param {string} rangeHeader - Range 请求头
 * @returns {{statusCode:number,headers:Object,streamOptions:Object,isPartial:boolean}} 响应元数据
 */
function buildVideoResponse(videoInfo, rangeHeader) {
  const fileSize = Number(videoInfo.fileSize);
  const range = parseVideoRange(rangeHeader, fileSize);
  const baseHeaders = {
    'Content-Type': videoInfo.mimetype || 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  };

  if (!range) {
    return {
      statusCode: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': fileSize
      },
      streamOptions: {},
      isPartial: false
    };
  }

  return {
    statusCode: 206,
    headers: {
      ...baseHeaders,
      'Content-Length': range.end - range.start + 1,
      'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}`
    },
    streamOptions: range,
    isPartial: true
  };
}

/**
 * 创建博客视频读取流，按全局配置限速。
 *
 * @param {Object} videoInfo - 视频文件信息
 * @param {Object} streamOptions - fs.createReadStream 范围配置
 * @param {number} speedLimit - 限速 bytes/s，0 表示不限速
 * @returns {{stream: import('stream').Readable, activeStreamCount: number, cleanup: Function}} 流结果
 */
function createVideoStream(videoInfo, streamOptions = {}, speedLimit = 0) {
  const fileStream = fs.createReadStream(videoInfo.filePath, streamOptions);

  if (speedLimit > 0) {
    blogVideoThrottle.updateSpeed(speedLimit);
    const throttleStream = blogVideoThrottle.createStream();
    return {
      stream: fileStream.pipe(throttleStream),
      activeStreamCount: blogVideoThrottle.getActiveStreamCount(),
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
 * 读取文件系统中的视频元信息。
 *
 * @param {Object} videoFile - help-service 解析出的文件对象
 * @returns {{filePath:string,filename:string,fileSize:number,mimetype:string}} 视频信息
 */
function buildVideoInfo(videoFile) {
  const stat = fs.statSync(videoFile.filePath);
  return {
    filePath: videoFile.filePath,
    filename: videoFile.filename,
    fileSize: stat.size,
    mimetype: 'video/mp4'
  };
}

function getActiveVideoStreamCount() {
  return blogVideoThrottle.getActiveStreamCount();
}

module.exports = {
  DEFAULT_BLOG_VIDEO_SPEED_LIMIT_KB,
  getBlogVideoConfig,
  parseVideoRange,
  buildVideoResponse,
  createVideoStream,
  buildVideoInfo,
  getActiveVideoStreamCount
};

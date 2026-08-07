const multer = require('multer');
const path = require('path');
const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const blogService = require('../../services/shared/blog-service');

const logger = createLogger('ADMIN-BLOGS');

/**
 * 管理端博客控制器。
 * 负责参数校验、上传接入与旧响应结构兼容，
 * 具体博客业务逻辑下沉到 blog-service。
 */

function handleValidationFailure(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }

  legacyValidationError(res);
  return true;
}

function handleBusinessError(res, message) {
  return legacyFail(res, {
    statusCode: 400,
    code: 1001,
    message
  });
}

function handleControllerError(res, action, error) {
  logger.error(`${action}错误: ${error.message}`);
  return legacyFail(res);
}

async function listArticles(req, res) {
  try {
    if (handleValidationFailure(req, res)) {
      return;
    }

    const data = await blogService.listAdminArticles(req.app.locals.db, req.query);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取博客列表', error);
  }
}

async function listCategories(req, res) {
  try {
    const data = await blogService.listAdminCategories(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取博客分类', error);
  }
}

async function createArticle(req, res) {
  try {
    if (handleValidationFailure(req, res)) {
      return;
    }

    const article = await blogService.createArticle(req.app.locals.db, req.body);
    logger.info(`新增博客文章成功: ${article.title} (ID: ${article.id})`);
    return legacySuccess(res, article);
  } catch (error) {
    logger.warn(`新增博客文章失败: ${error.message}`);
    return handleBusinessError(res, error.message);
  }
}

function createImageUploadHandler({ storage }) {
  return function uploadImage(req, res) {
    const upload = multer({
      storage,
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter(_req, file, cb) {
        if (!blogService.isAllowedBlogImageMimeType(file.mimetype)) {
          return cb(new Error('只允许上传 JPG、PNG、GIF 或 WebP 图片'));
        }
        cb(null, true);
      }
    }).single('file');

    upload(req, res, (error) => {
      if (error) {
        const message = error.code === 'LIMIT_FILE_SIZE'
          ? '图片大小不能超过 5MB'
          : error.message;
        return handleBusinessError(res, message);
      }

      if (!req.file) {
        return handleBusinessError(res, '请选择要上传的图片');
      }

      const data = blogService.buildUploadedImagePayload(req.file.filename);
      logger.info(`上传博客图片成功: ${req.file.filename}`);
      return legacySuccess(res, data);
    });
  };
}

/**
 * 创建博客视频上传处理器。
 *
 * @param {Object} options - 上传配置
 * @param {Object} options.storage - multer 磁盘存储配置
 * @returns {Function} Express 处理函数
 */
function createVideoUploadHandler({ storage }) {
  return function uploadVideo(req, res) {
    const upload = multer({
      storage,
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter(_req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.mp4' || !blogService.isAllowedBlogVideoMimeType(file.mimetype)) {
          return cb(new Error('只允许上传 MP4 视频'));
        }
        cb(null, true);
      }
    }).single('file');

    upload(req, res, (error) => {
      if (error) {
        const message = error.code === 'LIMIT_FILE_SIZE'
          ? '视频大小不能超过 50MB'
          : error.message;
        return handleBusinessError(res, message);
      }

      if (!req.file) {
        return handleBusinessError(res, '请选择要上传的视频');
      }

      const data = blogService.buildUploadedVideoPayload(req.file.filename);
      logger.info(`上传博客视频成功: ${req.file.filename}`);
      return legacySuccess(res, data);
    });
  };
}

async function getArticle(req, res) {
  try {
    if (handleValidationFailure(req, res)) {
      return;
    }

    const article = await blogService.getAdminArticle(req.app.locals.db, parseInt(req.params.id, 10));
    if (!article) {
      return handleBusinessError(res, '文章不存在');
    }

    return legacySuccess(res, article);
  } catch (error) {
    return handleControllerError(res, '获取博客详情', error);
  }
}

async function updateArticle(req, res) {
  try {
    if (handleValidationFailure(req, res)) {
      return;
    }

    const article = await blogService.updateArticle(req.app.locals.db, parseInt(req.params.id, 10), req.body);
    if (!article) {
      return handleBusinessError(res, '文章不存在');
    }

    logger.info(`更新博客文章成功: ${article.title} (ID: ${article.id})`);
    return legacySuccess(res, article);
  } catch (error) {
    logger.warn(`更新博客文章失败: ${error.message}`);
    return handleBusinessError(res, error.message);
  }
}

async function deleteArticle(req, res) {
  try {
    if (handleValidationFailure(req, res)) {
      return;
    }

    const article = await blogService.deleteArticle(req.app.locals.db, parseInt(req.params.id, 10), req.blogDeleteOptions);
    if (!article) {
      return handleBusinessError(res, '文章不存在');
    }

    logger.info(`删除博客文章成功: ${article.title} (ID: ${article.id})`);
    return legacySuccess(res, { message: '文章已删除' });
  } catch (error) {
    return handleControllerError(res, '删除博客文章', error);
  }
}

module.exports = {
  listArticles,
  listCategories,
  createArticle,
  createImageUploadHandler,
  createVideoUploadHandler,
  getArticle,
  updateArticle,
  deleteArticle
};

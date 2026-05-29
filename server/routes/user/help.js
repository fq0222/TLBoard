/**
 * 用户端帮助中心路由。
 * 负责帮助文章与图片读取接口的鉴权、参数校验与控制器分发。
 */

const express = require('express');
const { param, query } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const { parsePagination } = require('../../shared/utils/pagination');
const helpController = require('../../controllers/user/help-controller');
const helpService = require('../../services/user/help-service');

const router = express.Router();

/**
 * 归一化帮助文章列表分页参数，保持旧接口传参与返回语义不变。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} _res - Express 响应对象
 * @param {Function} next - Express 下一个中间件
 */
function attachHelpListQuery(req, _res, next) {
  const { page, limit } = parsePagination(req.query);

  req.helpListQuery = {
    ...req.query,
    page,
    limit
  };

  next();
}

/**
 * GET /api/user/help/images/:filename
 * 读取帮助中心图片。
 */
router.get('/images/:filename', [
  param('filename').custom((value) => helpService.isSafeHelpImageFilename(value))
], helpController.getHelpImage);

/**
 * GET /api/user/help/articles
 * 获取帮助文章列表。
 */
router.get('/articles', authenticateUser, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('category').optional().isString(),
  query('keyword').optional().isString()
], attachHelpListQuery, helpController.listHelpArticles);

/**
 * GET /api/user/help/categories
 * 获取帮助文章分类。
 */
router.get('/categories', authenticateUser, helpController.listHelpCategories);

/**
 * GET /api/user/help/articles/:id
 * 获取帮助文章详情。
 */
router.get('/articles/:id', authenticateUser, [
  param('id').isInt({ min: 1 })
], helpController.getHelpArticleDetail);

module.exports = router;

/**
 * 用户端留言板路由
 * 负责声明留言板接口的鉴权、参数校验规则与控制器映射。
 */

const express = require('express');
const { body, param } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const feedbackController = require('../../controllers/user/feedback-controller');

const router = express.Router();

/**
 * GET /api/user/feedback/featured
 * 获取管理员精选展示的留言。
 */
router.get('/featured', authenticateUser, feedbackController.listFeatured);

/**
 * POST /api/user/feedback
 * 提交 150 字以内留言。
 */
router.post('/', authenticateUser, [
  body('content').notEmpty().withMessage('留言内容不能为空')
    .isLength({ max: 150 }).withMessage('留言内容不能超过150字')
], feedbackController.createMessage);

/**
 * POST /api/user/feedback/:id/vote
 * 给精选留言投票，同一用户只能投一次。
 */
router.post('/:id/vote', authenticateUser, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], feedbackController.voteMessage);

module.exports = router;

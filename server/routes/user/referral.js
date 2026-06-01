/**
 * 用户端推广系统路由。
 * 负责用户推广汇总、公开点击记录与奖励明细查询的鉴权、参数校验和 service 调用。
 */

const express = require('express');
const { check, query, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const referralService = require('../../services/referral-service');

const router = express.Router();
const logger = createLogger('USER-REFERRAL');

/**
 * 处理参数校验失败。
 * 职责：统一读取 express-validator 结果并返回旧接口格式的 400 响应。
 * 关键参数：req/res 为当前 Express 请求与响应对象。
 * 核心分支：无错误返回 false；有错误记录日志并返回 code 1001。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {boolean} 是否已经输出校验失败响应
 */
function handleValidationFailure(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }

  logger.warn(`参数校验失败: ${JSON.stringify(errors.array())}`);
  legacyValidationError(res, {
    message: errors.array()[0]?.msg || '参数校验失败'
  });
  return true;
}

/**
 * 处理路由异常。
 * 职责：记录接口异常并保持统一旧响应结构。
 * 关键参数：res 为响应对象，action 用于日志定位，error 为捕获的异常。
 * 核心分支：所有未处理异常统一返回 500/服务器内部错误。
 *
 * @param {Object} res - Express 响应对象
 * @param {string} action - 当前动作描述
 * @param {Error} error - 异常对象
 * @returns {Object} Express 响应结果
 */
function handleRouteError(res, action, error) {
  logger.error(`${action}错误: ${error.message}`);
  return legacyFail(res, {
    message: '服务器内部错误'
  });
}

/**
 * GET /api/user/referral
 * 获取当前登录用户的推广汇总。
 */
router.get('/', authenticateUser, async (req, res) => {
  try {
    const data = await referralService.getUserReferralSummary(req.app.locals.db, req, req.user.id);
    return legacySuccess(res, data);
  } catch (error) {
    return handleRouteError(res, '获取用户推广汇总', error);
  }
});

/**
 * POST /api/user/referral/click
 * 记录公开推广点击，code 可从 body 或 query 传入。
 */
router.post('/click', [
  check('code')
    .trim()
    .notEmpty()
    .withMessage('推广码不能为空')
    .isLength({ max: 64 })
    .withMessage('推广码不能超过64个字符')
], async (req, res) => {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const code = req.body && req.body.code !== undefined ? req.body.code : req.query.code;
    const data = await referralService.recordClick(req.app.locals.db, {
      code,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    return legacySuccess(res, data);
  } catch (error) {
    return handleRouteError(res, '记录推广点击', error);
  }
});

/**
 * GET /api/user/referral/rewards
 * 分页获取当前登录用户的推广奖励明细。
 */
router.get('/rewards', authenticateUser, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('页码必须是大于0的整数'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('每页条数必须是1-100之间的整数')
], async (req, res) => {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await referralService.listUserRewards(req.app.locals.db, req.user.id, req.query);
    return legacySuccess(res, data);
  } catch (error) {
    return handleRouteError(res, '获取用户推广奖励列表', error);
  }
});

module.exports = router;

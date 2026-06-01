/**
 * 管理端推广系统路由。
 * 负责推广汇总列表、用户推广详情、启停状态和重置推广码接口的鉴权、校验与 service 调用。
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const referralService = require('../../services/referral-service');

const router = express.Router();
const logger = createLogger('ADMIN-REFERRALS');

/**
 * 为管理端返回结果补齐统一的用户端推广链接。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object|null} summary - 推广汇总
 * @returns {Object|null} 带 referral_url 的汇总
 */
function withReferralUrl(req, summary) {
  if (!summary) {
    return null;
  }

  return {
    ...summary,
    referral_url: summary.code ? referralService.buildReferralLink(req, summary.code) : ''
  };
}

/**
 * 处理参数校验失败。
 * 职责：统一拦截管理端推广接口的 express-validator 错误。
 * 关键参数：req/res 为当前 Express 请求与响应对象。
 * 核心分支：校验通过返回 false；校验失败记录首个错误并返回 400/code 1001。
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
 * 职责：记录管理端推广接口异常并输出统一旧响应结构。
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
 * GET /api/admin/referrals
 * 分页查询推广汇总列表，支持邮箱、推广码与启用状态筛选。
 */
router.get('/', authenticateAdmin, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('页码必须是大于0的整数'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('每页条数必须是1-100之间的整数'),
  query('email')
    .optional()
    .isString()
    .isLength({ max: 255 })
    .withMessage('邮箱筛选不能超过255个字符'),
  query('code')
    .optional()
    .isString()
    .isLength({ max: 64 })
    .withMessage('推广码不能超过64个字符'),
  query('enabled')
    .optional()
    .isIn([true, false, 0, 1, '0', '1', 'true', 'false'])
    .withMessage('enabled必须是布尔值')
], async (req, res) => {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await referralService.listAdminReferrals(req.app.locals.db, req.query);
    return legacySuccess(res, {
      ...data,
      list: Array.isArray(data.list) ? data.list.map(item => withReferralUrl(req, item)) : []
    });
  } catch (error) {
    return handleRouteError(res, '获取管理端推广列表', error);
  }
});

/**
 * GET /api/admin/referrals/:userId
 * 分页查询指定用户的推广详情和奖励明细。
 */
router.get('/:userId', authenticateAdmin, [
  param('userId')
    .isInt({ min: 1 })
    .withMessage('用户ID必须是大于0的整数'),
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
    const data = await referralService.getAdminReferralDetail(
      req.app.locals.db,
      parseInt(req.params.userId, 10),
      req.query
    );
    return legacySuccess(res, {
      ...data,
      summary: withReferralUrl(req, data.summary)
    });
  } catch (error) {
    return handleRouteError(res, '获取管理端推广详情', error);
  }
});

/**
 * PUT /api/admin/referrals/:userId/enabled
 * 启用或禁用指定用户的推广码。
 */
router.put('/:userId/enabled', authenticateAdmin, [
  param('userId')
    .isInt({ min: 1 })
    .withMessage('用户ID必须是大于0的整数'),
  body('enabled')
    .isBoolean()
    .withMessage('enabled必须是布尔值')
    .toBoolean()
], async (req, res) => {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await referralService.setUserReferralEnabled(
      req.app.locals.db,
      parseInt(req.params.userId, 10),
      req.body.enabled
    );
    return legacySuccess(res, data);
  } catch (error) {
    return handleRouteError(res, '设置用户推广状态', error);
  }
});

/**
 * POST /api/admin/referrals/:userId/reset-code
 * 为指定用户重置推广码。
 */
router.post('/:userId/reset-code', authenticateAdmin, [
  param('userId')
    .isInt({ min: 1 })
    .withMessage('用户ID必须是大于0的整数')
], async (req, res) => {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await referralService.resetUserReferralCode(
      req.app.locals.db,
      parseInt(req.params.userId, 10)
    );
    return legacySuccess(res, withReferralUrl(req, data));
  } catch (error) {
    return handleRouteError(res, '重置用户推广码', error);
  }
});

module.exports = router;

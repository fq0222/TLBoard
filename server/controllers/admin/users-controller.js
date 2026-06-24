const { validationResult } = require('express-validator');
const { createLogger } = require('../../utils/logger');
const { generateSubscriptionUrls } = require('../../utils/site-url');
const usersService = require('../../services/admin/users-service');
const batchSubscriptionService = require('../../services/admin/batch-subscription-service');

const logger = createLogger('ADMIN-USERS');

/**
 * 管理端用户控制器。
 * 负责 admin users 模块的参数校验、日志记录与旧响应结构兼容，
 * 具体业务规则下沉到 users service。
 */

function handleValidationFailure(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }

  logger.warn(`参数校验失败: ${JSON.stringify(errors.array())}`);
  res.status(400).json({
    code: 1001,
    message: '参数校验失败',
    data: null
  });
  return true;
}

/**
 * 输出兼容旧接口的业务异常或系统异常响应。
 *
 * @param {Object} res - Express 响应对象
 * @param {string} action - 当前操作描述
 * @param {Error} error - 捕获到的异常对象
 * @returns {Object} Express 响应结果
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
  return res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    data: null
  });
}

/**
 * 获取管理端用户分页列表。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function listUsers(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await usersService.listUsers(req.app.locals.db, req.query);
    logger.info(`获取用户列表成功，共 ${data.list.length} 条记录`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return handleControllerError(res, '获取用户列表', error);
  }
}

/**
 * 获取指定用户详情及最近订单、CF IP 信息。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getUserDetail(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const userId = parseInt(req.params.id, 10);
    const detail = await usersService.getUserDetail(req.app.locals.db, userId);
    const urls = generateSubscriptionUrls(req, detail.user.sub_id);

    logger.info(`获取用户详情成功: ${detail.user.email}`);
    return res.json({
      code: 0,
      message: 'ok',
      data: {
        user: {
          id: detail.user.id,
          email: detail.user.email,
          plan_id: detail.user.plan_id,
          plan_name: detail.user.plan_name,
          subscription_url: urls.subscription_url,
          clash_url: urls.clash_url,
          traffic_used: detail.user.traffic_used,
          traffic_limit: detail.user.traffic_limit,
          traffic_used_text: detail.user.traffic_used_text,
          traffic_limit_text: detail.user.traffic_limit_text,
          expire_at: detail.user.expire_at,
          expire_text: detail.user.expire_text,
          enabled: detail.user.enabled,
          created_at: detail.user.created_at,
          cf_ips: detail.user.cf_ips
        },
        orders: detail.orders,
        cf_ips: detail.cf_ips
      }
    });
  } catch (error) {
    return handleControllerError(res, '获取用户详情', error);
  }
}

/**
 * 更新用户基础信息并同步到 3X-UI。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function updateUser(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await usersService.updateUser(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      req.body
    );

    logger.info(`修改用户信息成功: ${data.email}`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return handleControllerError(res, '修改用户信息', error);
  }
}

/**
 * 删除用户本地数据库数据，不同步或删除 3X-UI 服务器用户。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function deleteUser(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await usersService.deleteUserLocalData(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );

    logger.info(`删除用户本地数据成功: ${data.email}`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return handleControllerError(res, '删除用户本地数据', error);
  }
}

/**
 * 更新用户绑定的 CF 优选 IP。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function updateUserCfIps(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await usersService.updateUserCfIps(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      req.body.ip_pool_ids
    );

    logger.info(`更新用户 CF IP 成功: user=${req.params.id}, count=${data.cf_ips.length}`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return handleControllerError(res, '更新用户CF IP', error);
  }
}

/**
 * 为指定用户重新生成订阅缓存。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function generateSubscription(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await usersService.generateSubscription(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      logger
    );
    const urls = generateSubscriptionUrls(req, data.sub_id);

    logger.info(`生成用户订阅链接成功: user=${req.params.id}, nodes=${data.node_count}`);
    return res.json({
      code: 0,
      message: 'ok',
      data: {
        subscription_url: urls.subscription_url,
        clash_url: urls.clash_url,
        node_count: data.node_count
      }
    });
  } catch (error) {
    return handleControllerError(res, '生成用户订阅链接', error);
  }
}

/**
 * 启动批量重新生成订阅链接任务。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function startBatchGenerateSubscriptions(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const cfOptimizedOnly = ![false, 0, '0', 'false'].includes(req.body.cf_optimized_only);
    const data = await batchSubscriptionService.startTask(req.app.locals.db, {
      cfOptimizedOnly
    });

    logger.info(`启动批量生成订阅任务: task=${data.id}, total=${data.total_count}`);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return handleControllerError(res, '启动批量生成订阅任务', error);
  }
}

/**
 * 获取最近一次批量重新生成订阅链接任务状态。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getBatchGenerateSubscriptionStatus(req, res) {
  try {
    const data = await batchSubscriptionService.getLatestStatus(req.app.locals.db);
    return res.json({
      code: 0,
      message: 'ok',
      data
    });
  } catch (error) {
    return handleControllerError(res, '获取批量生成订阅任务状态', error);
  }
}

module.exports = {
  listUsers,
  getUserDetail,
  updateUser,
  deleteUser,
  updateUserCfIps,
  generateSubscription,
  startBatchGenerateSubscriptions,
  getBatchGenerateSubscriptionStatus
};

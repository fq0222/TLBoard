const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const plansService = require('../../services/admin/plans-service');

const logger = createLogger('ADMIN-PLANS');

/**
 * 管理端套餐控制器。
 * 负责参数校验、日志记录与旧响应结构兼容，具体业务逻辑下沉到 plans service。
 */

function handleValidationFailure(req, res, action) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return false;
  }

  logger.warn(`${action}参数验证失败`);
  legacyValidationError(res);
  return true;
}

function handleControllerError(res, action, error) {
  if (error && error.isLegacyBusinessError) {
    logger.warn(`${action}失败: ${error.message}`);
    return legacyFail(res, {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      data: error.data
    });
  }

  logger.error(`${action}错误: ${error.message}`);
  return legacyFail(res);
}

async function listPlans(req, res) {
  try {
    const result = await plansService.listPlans(req.app.locals.db);
    logger.info(`获取套餐列表成功，共 ${result.list.length} 个套餐`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '获取套餐列表', error);
  }
}

async function createPlan(req, res) {
  if (handleValidationFailure(req, res, '添加套餐')) {
    return;
  }

  try {
    const plan = await plansService.createPlan(req.app.locals.db, req.body);
    logger.info(`添加套餐成功: ${plan.name} (ID: ${plan.id})`);
    return legacySuccess(res, plan);
  } catch (error) {
    return handleControllerError(res, '添加套餐', error);
  }
}

async function updatePlan(req, res) {
  if (handleValidationFailure(req, res, '修改套餐')) {
    return;
  }

  try {
    const plan = await plansService.updatePlan(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      req.body
    );
    logger.info(`修改套餐成功: ${plan.name} (ID: ${plan.id})`);
    return legacySuccess(res, plan);
  } catch (error) {
    return handleControllerError(res, '修改套餐', error);
  }
}

async function deletePlan(req, res) {
  if (handleValidationFailure(req, res, '删除套餐')) {
    return;
  }

  try {
    const result = await plansService.deletePlan(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );
    logger.info(`删除套餐成功: ID ${req.params.id}`);
    return legacySuccess(res, result);
  } catch (error) {
    return handleControllerError(res, '删除套餐', error);
  }
}

module.exports = {
  listPlans,
  createPlan,
  updatePlan,
  deletePlan
};

const { legacySuccess, legacyFail } = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const plansService = require('../../services/user/plans-service');

const logger = createLogger('USER-PLANS');

/**
 * 用户端套餐控制器
 * 负责处理用户端套餐列表 HTTP 请求与响应。
 */

/**
 * 获取已上架套餐列表。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<Object>} Express 响应结果
 */
async function getPlans(req, res) {
  try {
    const formattedPlans = await plansService.listAvailablePlans(req.app.locals.db);

    logger.info(`获取套餐列表成功，共 ${formattedPlans.length} 个套餐`);

    return legacySuccess(res, {
      plans: formattedPlans
    });
  } catch (error) {
    logger.error(`获取套餐列表错误: ${error.message}`);
    return legacyFail(res);
  }
}

module.exports = {
  getPlans
};

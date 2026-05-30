/**
 * 管理端 Email 控制器。
 * 负责参数校验、请求日志以及旧响应结构兼容，业务逻辑下沉到 service。
 */

const { validationResult } = require('express-validator');
const {
  legacySuccess,
  legacyFail,
  legacyValidationError
} = require('../../shared/response/api-response');
const { createLogger } = require('../../utils/logger');
const adminEmailService = require('../../services/admin/email-service');

const logger = createLogger('ADMIN-EMAIL');

/**
 * 统一处理控制器异常，兼容旧接口 code/message/data 结构。
 *
 * @param {Object} res - Express 响应对象
 * @param {string} action - 当前动作描述
 * @param {Error} error - 异常对象
 * @returns {Object} Express 响应结果
 */
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
  return legacyFail(res, {
    code: 500,
    message: error.message,
    data: null
  });
}

/**
 * 处理参数校验失败。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {boolean} 是否已输出失败响应
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
 * 获取 Brevo 配置。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function getConfig(req, res) {
  try {
    const data = await adminEmailService.getConfig(req.app.locals.db);
    logger.info('获取 Brevo 配置成功');
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取 Brevo 配置', error);
  }
}

/**
 * 保存 Brevo 配置。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function saveConfig(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    await adminEmailService.saveConfig(req.app.locals.db, req.body);
    logger.info('更新 Brevo 配置成功');
    return legacySuccess(res, null, { message: '配置已保存' });
  } catch (error) {
    return handleControllerError(res, '更新 Brevo 配置', error);
  }
}

/**
 * 发送测试邮件验证配置可用性。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function sendTestEmail(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const result = await adminEmailService.sendTestEmail(req.app.locals.db, req.body.email);
    if (result.success) {
      logger.info(`测试邮件已发送: ${req.body.email}`);
      return legacySuccess(res, null, { message: '测试邮件已发送' });
    }

    logger.error(`测试邮件发送失败: ${result.error}`);
    return legacyFail(res, {
      code: 6002,
      message: `发送失败: ${result.error}`,
      data: null
    });
  } catch (error) {
    return handleControllerError(res, '发送测试邮件', error);
  }
}

/**
 * 获取模板列表。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function listTemplates(req, res) {
  try {
    const data = await adminEmailService.listTemplates(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取模板列表', error);
  }
}

/**
 * 创建邮件模板。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function createTemplate(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await adminEmailService.createTemplate(req.app.locals.db, req.body);
    logger.info(`创建模板成功: ${req.body.name}`);
    return legacySuccess(res, data, { message: '模板已创建' });
  } catch (error) {
    return handleControllerError(res, '创建模板', error);
  }
}

/**
 * 更新邮件模板。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function updateTemplate(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const templateId = parseInt(req.params.id, 10);
    const data = await adminEmailService.updateTemplate(req.app.locals.db, templateId, req.body);
    logger.info(`更新模板成功: ${req.body.name} (ID: ${templateId})`);
    return legacySuccess(res, data, { message: '模板已更新' });
  } catch (error) {
    return handleControllerError(res, '更新模板', error);
  }
}

/**
 * 删除邮件模板。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function deleteTemplate(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const templateId = parseInt(req.params.id, 10);
    await adminEmailService.deleteTemplate(req.app.locals.db, templateId);
    logger.info(`删除模板成功 (ID: ${templateId})`);
    return legacySuccess(res, null, { message: '模板已删除' });
  } catch (error) {
    return handleControllerError(res, '删除模板', error);
  }
}

/**
 * 预览模板渲染结果。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function previewTemplate(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const templateId = parseInt(req.params.id, 10);
    const data = await adminEmailService.previewTemplate(
      req.app.locals.db,
      templateId,
      req.query.user_id
    );
    logger.info(`预览模板成功 (ID: ${templateId})`);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '预览模板', error);
  }
}

/**
 * 发送单封后台邮件。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function sendSingleEmail(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const result = await adminEmailService.sendSingleEmail(req.app.locals.db, req.body);
    if (result.success) {
      logger.info(`邮件已发送: ${req.body.to}`);
      return legacySuccess(res, null, { message: '邮件已发送' });
    }

    logger.error(`邮件发送失败: ${result.error}`);
    return legacyFail(res, {
      code: 500,
      message: `发送失败: ${result.error}`,
      data: null
    });
  } catch (error) {
    return handleControllerError(res, '发送邮件', error);
  }
}

/**
 * 创建群发任务。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function createCampaign(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await adminEmailService.createCampaign(req.app.locals.db, req.body);
    logger.info(`群发任务已创建: ${req.body.name}`);
    return legacySuccess(res, data, { message: '群发任务已创建' });
  } catch (error) {
    return handleControllerError(res, '创建群发任务', error);
  }
}

/**
 * 获取群发任务列表。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function listCampaigns(req, res) {
  try {
    const data = await adminEmailService.listCampaigns(req.app.locals.db);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取群发任务列表', error);
  }
}

/**
 * 获取群发任务详情。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function getCampaignDetail(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await adminEmailService.getCampaignDetail(
      req.app.locals.db,
      parseInt(req.params.id, 10)
    );
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取群发任务详情', error);
  }
}

/**
 * 暂停群发任务。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function pauseCampaign(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const campaignId = parseInt(req.params.id, 10);
    const data = await adminEmailService.pauseCampaign(req.app.locals.db, campaignId);
    logger.info(`任务已暂停 (ID: ${campaignId})`);
    return legacySuccess(res, data, { message: '任务已暂停' });
  } catch (error) {
    return handleControllerError(res, '暂停任务', error);
  }
}

/**
 * 恢复群发任务。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function resumeCampaign(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const campaignId = parseInt(req.params.id, 10);
    const data = await adminEmailService.resumeCampaign(req.app.locals.db, campaignId);
    logger.info(`任务已恢复 (ID: ${campaignId})`);
    return legacySuccess(res, data, { message: '任务已恢复' });
  } catch (error) {
    return handleControllerError(res, '恢复任务', error);
  }
}

/**
 * 删除群发任务及关联日志。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function deleteCampaign(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const campaignId = parseInt(req.params.id, 10);
    await adminEmailService.deleteCampaign(req.app.locals.db, campaignId);
    logger.info(`任务已删除 (ID: ${campaignId})`);
    return legacySuccess(res, null, { message: '任务已删除' });
  } catch (error) {
    return handleControllerError(res, '删除任务', error);
  }
}

/**
 * 获取指定群发任务的日志分页。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function listCampaignLogs(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await adminEmailService.listCampaignLogs(
      req.app.locals.db,
      parseInt(req.params.id, 10),
      req.query
    );
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取群发任务日志', error);
  }
}

/**
 * 获取全部邮件日志分页。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function listLogs(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await adminEmailService.listLogs(req.app.locals.db, req.query);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '获取邮件日志', error);
  }
}

/**
 * 清理过期邮件日志。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function clearExpiredLogs(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    await adminEmailService.clearExpiredLogs(req.app.locals.db, req.body.before_days);
    logger.info('已清空过期日志');
    return legacySuccess(res, null, { message: '日志已清空' });
  } catch (error) {
    return handleControllerError(res, '清空日志', error);
  }
}

/**
 * 批量删除邮件日志。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function batchDeleteLogs(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    await adminEmailService.batchDeleteLogs(req.app.locals.db, req.body.ids);
    logger.info(`批量删除日志成功 (数量: ${req.body.ids.length})`);
    return legacySuccess(res, null, { message: '日志已删除' });
  } catch (error) {
    return handleControllerError(res, '批量删除日志', error);
  }
}

/**
 * 删除单条邮件日志。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function deleteLog(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const logId = parseInt(req.params.id, 10);
    await adminEmailService.deleteLog(req.app.locals.db, logId);
    logger.info(`日志已删除 (ID: ${logId})`);
    return legacySuccess(res, null, { message: '日志已删除' });
  } catch (error) {
    return handleControllerError(res, '删除日志', error);
  }
}

/**
 * 按关键词搜索用户列表供邮件收件人选择。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function searchUsers(req, res) {
  if (handleValidationFailure(req, res)) {
    return;
  }

  try {
    const data = await adminEmailService.searchUsers(req.app.locals.db, req.query.keyword);
    return legacySuccess(res, data);
  } catch (error) {
    return handleControllerError(res, '搜索用户', error);
  }
}

module.exports = {
  getConfig,
  saveConfig,
  sendTestEmail,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  previewTemplate,
  sendSingleEmail,
  createCampaign,
  listCampaigns,
  getCampaignDetail,
  pauseCampaign,
  resumeCampaign,
  deleteCampaign,
  listCampaignLogs,
  listLogs,
  clearExpiredLogs,
  batchDeleteLogs,
  deleteLog,
  searchUsers
};

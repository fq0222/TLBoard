/**
 * 用户 Passkey 控制器。
 * 职责：统一参数/业务响应、安全日志及登录 IP 归属地异步记录，协议数据仅交由服务验证。
 */
const { validationResult } = require('express-validator');
const PasskeyService = require('../../services/user/passkey-service');
const ipLocationService = require('../../services/shared/ip-location-service');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('USER-PASSKEY');

class PasskeyController {
  /**
   * 执行 req/res 对应的 action，operation 接收本请求服务；login 标识成功后记录 IP。
   * 核心分支：校验错误不返回原始参数，未知异常只记录固定描述，避免协议内容进入日志。
   */
  async respond(req, res, action, operation, login = false) {
    if (!validationResult(req).isEmpty()) {
      logger.warn(`${action}参数校验失败`);
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }
    try {
      const data = await operation(new PasskeyService({ db: req.app.locals.db }));
      if (login) {
        // 异步错误也只输出固定摘要；IP 服务不得影响已成功的认证响应。
        Promise.resolve().then(() => ipLocationService.recordUserIpLocation(
          req.app.locals.db, data.user.id, 'login', req.ip || req.socket.remoteAddress
        )).catch(() => logger.warn('Passkey 登录 IP 归属地记录失败'));
      }
      logger.info(`${action}成功`);
      return res.json({ code: 0, message: 'ok', data });
    } catch (error) {
      if (error?.isLegacyBusinessError) {
        logger.warn(`${action}失败，业务码 ${error.code}`);
        return res.status(error.statusCode).json({ code: error.code, message: error.message, data: null });
      }
      logger.error(`${action}内部错误`);
      return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
    }
  }

  /** 返回 req.user.id 的安全密钥列表；鉴权由路由负责。 */
  list(req, res) {
    return this.respond(req, res, '读取 Passkey', service => service.listForUser(req.user.id));
  }

  /** 为 req.user.id 复验 req.body.password 并创建注册选项。 */
  registrationOptions(req, res) {
    return this.respond(req, res, '创建 Passkey 注册选项', service => service.createRegistrationOptions(req.user.id, req.body));
  }

  /** 验证 req.body 注册响应并绑定 req.user.id；一次性挑战由服务处理。 */
  registrationVerify(req, res) {
    return this.respond(req, res, '注册 Passkey', service => service.verifyRegistration(req.user.id, req.body));
  }

  /** 复验 req.body.password 后撤销 req.params.id；用户归属由服务校验。 */
  remove(req, res) {
    return this.respond(req, res, '撤销 Passkey', service => service.deleteForUser(req.user.id, Number(req.params.id), req.body.password));
  }

  /** 创建匿名认证选项；不使用请求 Host、转发头或用户标识。 */
  loginOptions(req, res) {
    return this.respond(req, res, '创建 Passkey 登录选项', service => service.createAuthenticationOptions());
  }

  /** 验证 req.body 认证响应；成功返回共享 JWT 并异步记录登录 IP。 */
  loginVerify(req, res) {
    return this.respond(req, res, 'Passkey 登录', service => service.verifyAuthentication(req.body), true);
  }
}

module.exports = new PasskeyController();

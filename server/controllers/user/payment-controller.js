const { createLogger } = require('../../utils/logger');
const paymentService = require('../../services/user/payment-service');

const logger = createLogger('PAYMENT');

/**
 * 用户端支付控制器。
 * 负责支付回调参数读取、日志记录与 HTTP 响应输出，
 * 具体支付业务规则下沉到 user payment service。
 */

/**
 * 处理 VMQ 支付异步通知。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {Promise<void>}
 */
async function handleVmqNotify(req, res) {
  try {
    const params = paymentService.getNotifyParams(req);
    logger.info(`VMQ notify received: payId=${params.payId}, type=${params.type}, price=${params.price}, reallyPrice=${params.reallyPrice}`);

    const result = await paymentService.handleNotify(req.app.locals.db, params);
    logger[result.logLevel](result.logMessage);
    res.send(result.responseText);
  } catch (error) {
    logger.error(`VMQ notify error: ${error.message}`);
    res.send('success');
  }
}

/**
 * 处理支付完成后的同步跳转。
 *
 * @param {Object} req - Express 请求对象
 * @param {Object} res - Express 响应对象
 * @returns {void}
 */
function handleReturn(req, res) {
  res.redirect(paymentService.buildReturnRedirectUrl(req.query));
}

module.exports = {
  handleVmqNotify,
  handleReturn
};

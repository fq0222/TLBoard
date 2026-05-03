/**
 * 通用验证中间件
 * 处理express-validator的验证结果
 */

const { validationResult } = require('express-validator');
const { createLogger } = require('../utils/logger');

const logger = createLogger('VALIDATOR');

/**
 * 验证请求参数
 * 检查express-validator的验证结果，如果有错误则返回错误响应
 */
const validateRequest = (req, res, next) => {
  try {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map(err => err.msg);
      logger.warn(`参数验证失败: ${errorMessages.join(', ')}`);
      
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: {
          errors: errors.array()
        }
      });
    }
    
    next();
  } catch (error) {
    logger.error(`验证中间件错误: ${error.message}`);
    return res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
};

/**
 * 通用验证规则
 */
const commonValidations = {
  // 分页参数
  pagination: [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('页码必须是大于0的整数'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('每页条数必须是1-100之间的整数')
  ],

  // ID参数
  id: [
    param('id')
      .isInt({ min: 1 })
      .withMessage('ID必须是大于0的整数')
  ],

  // 邮箱
  email: [
    body('email')
      .isEmail()
      .withMessage('请输入有效的邮箱地址')
      .normalizeEmail()
  ],

  // 密码
  password: [
    body('password')
      .isLength({ min: 8 })
      .withMessage('密码长度至少8位')
      .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
      .withMessage('密码必须包含字母和数字')
  ]
};

module.exports = {
  validateRequest,
  commonValidations
};
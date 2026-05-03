/**
 * 管理端JWT认证中间件
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('AUTH-ADMIN');

/**
 * 管理员认证中间件
 * 验证JWT Token，提取管理员信息
 */
const authenticateAdmin = (req, res, next) => {
  try {
    // 获取Authorization头
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      logger.warn('请求缺少Authorization头');
      return res.status(401).json({
        code: 1002,
        message: '未登录 / Token 无效',
        data: null
      });
    }

    // 检查Token格式
    if (!authHeader.startsWith('Bearer ')) {
      logger.warn('Authorization头格式错误');
      return res.status(401).json({
        code: 1002,
        message: '未登录 / Token 无效',
        data: null
      });
    }

    // 提取Token
    const token = authHeader.substring(7);
    
    if (!token) {
      logger.warn('Token为空');
      return res.status(401).json({
        code: 1002,
        message: '未登录 / Token 无效',
        data: null
      });
    }

    // 验证Token
    jwt.verify(token, config.admin.jwtSecret, (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          logger.warn('Token已过期');
          return res.status(401).json({
            code: 1003,
            message: 'Token 过期',
            data: null
          });
        }
        
        logger.warn(`Token验证失败: ${err.message}`);
        return res.status(401).json({
          code: 1002,
          message: '未登录 / Token 无效',
          data: null
        });
      }

      // 将管理员信息添加到请求对象
      req.admin = decoded;
      
      logger.info(`管理员认证成功: ${decoded.username}`);
      next();
    });
  } catch (error) {
    logger.error(`认证中间件错误: ${error.message}`);
    return res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
};

/**
 * 超级管理员权限中间件
 * 验证管理员是否为超级管理员
 */
const requireSuperAdmin = (req, res, next) => {
  try {
    if (!req.admin) {
      logger.warn('未找到管理员信息');
      return res.status(401).json({
        code: 1002,
        message: '未登录 / Token 无效',
        data: null
      });
    }

    if (!req.admin.is_super) {
      logger.warn(`非超级管理员尝试访问受限资源: ${req.admin.username}`);
      return res.status(403).json({
        code: 1004,
        message: '无权限',
        data: null
      });
    }

    logger.info(`超级管理员权限验证通过: ${req.admin.username}`);
    next();
  } catch (error) {
    logger.error(`超级管理员权限验证错误: ${error.message}`);
    return res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
};

module.exports = {
  authenticateAdmin,
  requireSuperAdmin
};
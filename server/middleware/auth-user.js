/**
 * 用户端JWT认证中间件
 * 验证用户Token，提取用户信息
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

// 日志工具
const logger = {
  info: (msg) => console.log(`[AUTH-USER] [INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[AUTH-USER] [ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[AUTH-USER] [WARN] ${new Date().toISOString()} - ${msg}`)
};

/**
 * 用户认证中间件
 * 验证JWT Token，提取用户信息
 */
const authenticateUser = (req, res, next) => {
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
    jwt.verify(token, config.user.jwtSecret, (err, decoded) => {
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

      // 将用户信息添加到请求对象
      req.user = decoded;
      
      logger.info(`用户认证成功: ${decoded.email}`);
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
 * 可选认证中间件
 * 如果有Token则验证，没有则继续
 */
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // 没有Token，继续处理
      return next();
    }

    const token = authHeader.substring(7);
    
    if (!token) {
      return next();
    }

    jwt.verify(token, config.user.jwtSecret, (err, decoded) => {
      if (err) {
        // Token无效，继续处理（不返回错误）
        logger.warn(`可选认证Token无效: ${err.message}`);
        return next();
      }

      // Token有效，添加用户信息
      req.user = decoded;
      logger.info(`可选认证成功: ${decoded.email}`);
      next();
    });
  } catch (error) {
    logger.error(`可选认证中间件错误: ${error.message}`);
    return next();
  }
};

module.exports = {
  authenticateUser,
  optionalAuth
};
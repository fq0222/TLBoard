/**
 * 管理员认证路由
 * 处理管理员登录、修改密码等操作
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const config = require('../../config');
const { authenticateAdmin } = require('../../middleware/auth-admin');

const router = express.Router();

// 日志工具
const logger = {
  info: (msg) => console.log(`[ADMIN-AUTH] [INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ADMIN-AUTH] [ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[ADMIN-AUTH] [WARN] ${new Date().toISOString()} - ${msg}`)
};

/**
 * POST /api/admin/login
 * 管理员登录
 */
router.post('/login', [
  body('username')
    .notEmpty()
    .withMessage('用户名不能为空'),
  body('password')
    .notEmpty()
    .withMessage('密码不能为空')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('登录参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const { username, password } = req.body;
    const db = req.app.locals.db;

    // 查询管理员
    const admin = await db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    
    if (!admin) {
      logger.warn(`管理员登录失败: 用户名不存在 - ${username}`);
      return res.status(400).json({
        code: 2002,
        message: '用户名或密码错误',
        data: null
      });
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, admin.password_hash);
    
    if (!isValidPassword) {
      logger.warn(`管理员登录失败: 密码错误 - ${username}`);
      return res.status(400).json({
        code: 2002,
        message: '用户名或密码错误',
        data: null
      });
    }

    // 生成JWT Token
    const token = jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        is_super: admin.is_super
      },
      config.admin.jwtSecret,
      { expiresIn: config.admin.jwtExpiresIn }
    );

    logger.info(`管理员登录成功: ${username}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        token,
        expires_in: 7200, // 2小时 = 7200秒
        admin: {
          id: admin.id,
          username: admin.username,
          is_super: admin.is_super
        }
      }
    });
  } catch (error) {
    logger.error(`管理员登录错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * PUT /api/admin/password
 * 修改管理员密码
 */
router.put('/password', authenticateAdmin, [
  body('old_password')
    .notEmpty()
    .withMessage('原密码不能为空'),
  body('new_password')
    .isLength({ min: 8 })
    .withMessage('新密码长度至少8位')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
    .withMessage('新密码必须包含字母和数字')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('修改密码参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const { old_password, new_password } = req.body;
    const adminId = req.admin.id;
    const db = req.app.locals.db;

    // 查询管理员
    const admin = await db.prepare('SELECT * FROM admins WHERE id = ?').get(adminId);
    
    if (!admin) {
      logger.error(`管理员不存在: ${adminId}`);
      return res.status(400).json({
        code: 2002,
        message: '管理员不存在',
        data: null
      });
    }

    // 验证原密码
    const isValidPassword = await bcrypt.compare(old_password, admin.password_hash);
    
    if (!isValidPassword) {
      logger.warn(`修改密码失败: 原密码错误 - ${admin.username}`);
      return res.status(400).json({
        code: 2002,
        message: '原密码错误',
        data: null
      });
    }

    // 加密新密码
    const newPasswordHash = await bcrypt.hash(new_password, config.security.bcryptRounds);

    // 更新密码
    await db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(newPasswordHash, adminId);

    logger.info(`管理员密码修改成功: ${admin.username}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        message: '密码修改成功，请重新登录'
      }
    });
  } catch (error) {
    logger.error(`修改密码错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

module.exports = router;
/**
 * 管理员管理路由
 * 处理管理员的增删改查操作
 */

const express = require('express');
const bcrypt = require('bcrypt');
const { body, param, validationResult } = require('express-validator');
const config = require('../../config');
const { authenticateAdmin, requireSuperAdmin } = require('../../middleware/auth-admin');

const router = express.Router();

// 日志工具
const logger = {
  info: (msg) => console.log(`[ADMIN-MANAGE] [INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ADMIN-MANAGE] [ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[ADMIN-MANAGE] [WARN] ${new Date().toISOString()} - ${msg}`)
};

/**
 * GET /api/admin/admins
 * 获取管理员列表
 */
router.get('/', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    // 查询所有管理员
    const admins = await db.prepare(`
      SELECT id, username, is_super, created_at 
      FROM admins 
      ORDER BY created_at DESC
    `).all();

    logger.info(`获取管理员列表成功，共 ${admins.length} 条记录`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        list: admins
      }
    });
  } catch (error) {
    logger.error(`获取管理员列表错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * POST /api/admin/admins
 * 添加管理员
 */
router.post('/', authenticateAdmin, requireSuperAdmin, [
  body('username')
    .notEmpty()
    .withMessage('用户名不能为空')
    .isLength({ min: 3, max: 20 })
    .withMessage('用户名长度必须在3-20之间'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('密码长度至少8位')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
    .withMessage('密码必须包含字母和数字'),
  body('is_super')
    .optional()
    .isBoolean()
    .withMessage('is_super必须是布尔值')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('添加管理员参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const { username, password, is_super = false } = req.body;
    const db = req.app.locals.db;

    // 检查用户名是否已存在
    const existingAdmin = await db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
    
    if (existingAdmin) {
      logger.warn(`添加管理员失败: 用户名已存在 - ${username}`);
      return res.status(400).json({
        code: 2001,
        message: '用户名已存在',
        data: null
      });
    }

    // 加密密码
    const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);

    // 插入管理员记录
    const result = await db.prepare(`
      INSERT INTO admins (username, password_hash, is_super) 
      VALUES (?, ?, ?)
    `).run(username, passwordHash, is_super ? 1 : 0);

    logger.info(`添加管理员成功: ${username} (ID: ${result.lastInsertRowid})`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        id: result.lastInsertRowid,
        username,
        is_super: is_super ? 1 : 0,
        created_at: Math.floor(Date.now() / 1000)
      }
    });
  } catch (error) {
    logger.error(`添加管理员错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * DELETE /api/admin/admins/:id
 * 删除管理员
 */
router.delete('/:id', authenticateAdmin, requireSuperAdmin, [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    // 验证请求参数
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('删除管理员参数验证失败');
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const adminId = parseInt(req.params.id);
    const currentAdminId = req.admin.id;
    const db = req.app.locals.db;

    // 检查是否尝试删除自己
    if (adminId === currentAdminId) {
      logger.warn('管理员尝试删除自己');
      return res.status(400).json({
        code: 1004,
        message: '不能删除自己的账号',
        data: null
      });
    }

    // 检查管理员是否存在
    const admin = await db.prepare('SELECT id, username FROM admins WHERE id = ?').get(adminId);
    
    if (!admin) {
      logger.warn(`删除管理员失败: 管理员不存在 - ${adminId}`);
      return res.status(400).json({
        code: 1004,
        message: '管理员不存在',
        data: null
      });
    }

    // 删除管理员
    await db.prepare('DELETE FROM admins WHERE id = ?').run(adminId);

    logger.info(`删除管理员成功: ${admin.username} (ID: ${adminId})`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        message: '管理员已删除'
      }
    });
  } catch (error) {
    logger.error(`删除管理员错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

module.exports = router;
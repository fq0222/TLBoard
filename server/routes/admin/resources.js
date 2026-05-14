const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateAdmin } = require('../../middleware/auth-admin');
const { createLogger } = require('../../utils/logger');

const router = express.Router();
const logger = createLogger('ADMIN-RESOURCES');

// 上传目录
const UPLOAD_DIR = path.join(__dirname, '../../uploads/resources');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 默认资源配置
const DEFAULT_RESOURCE_CONFIG = {
  max_file_size: 100, // MB
  download_speed_limit: 0 // KB/s, 0 表示不限速
};

// 获取资源配置
async function getResourceConfig(db) {
  try {
    const config = await db.prepare("SELECT value FROM system_settings WHERE key = 'resource_config'").get();
    if (config) {
      return JSON.parse(config.value);
    }
    return DEFAULT_RESOURCE_CONFIG;
  } catch (error) {
    logger.error(`获取资源配置失败: ${error.message}`);
    return DEFAULT_RESOURCE_CONFIG;
  }
}

// 保存资源配置
async function saveResourceConfig(db, config) {
  const value = JSON.stringify(config);
  const now = Math.floor(Date.now() / 1000);
  await db.exec(`
    INSERT INTO system_settings (key, value, updated_at) 
    VALUES ('resource_config', '${value}', ${now})
    ON CONFLICT (key) DO UPDATE SET value = '${value}', updated_at = ${now}
  `);
}

// multer 配置（动态文件大小限制）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = crypto.randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueName}${ext}`);
  }
});

// 生成下载 token
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * GET /api/admin/resources/config
 * 获取资源配置
 */
router.get('/config', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const config = await getResourceConfig(db);
    
    res.json({
      code: 0,
      message: 'ok',
      data: config
    });
  } catch (error) {
    logger.error(`获取资源配置错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * PUT /api/admin/resources/config
 * 保存资源配置
 */
router.put('/config', authenticateAdmin, [
  body('max_file_size').isInt({ min: 1, max: 1024 }).withMessage('最大文件大小必须是1-1024之间的整数'),
  body('download_speed_limit').isInt({ min: 0 }).withMessage('下载速度限制必须是大于等于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const db = req.app.locals.db;
    const config = {
      max_file_size: parseInt(req.body.max_file_size),
      download_speed_limit: parseInt(req.body.download_speed_limit)
    };

    await saveResourceConfig(db, config);

    logger.info(`保存资源配置成功: ${JSON.stringify(config)}`);

    res.json({
      code: 0,
      message: 'ok',
      data: config
    });
  } catch (error) {
    logger.error(`保存资源配置错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * GET /api/admin/resources
 * 获取资源列表
 */
router.get('/', authenticateAdmin, [
  query('page').optional().isInt({ min: 1 }).withMessage('页码必须是大于0的整数'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('每页条数必须是1-100之间的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const db = req.app.locals.db;

    const total = (await db.prepare('SELECT COUNT(*) as count FROM resources').get()).count;

    const resources = await db.prepare(`
      SELECT id, name, filename, original_name, size, mimetype, download_token, 
             expire_at, download_count, enabled, created_at, updated_at
      FROM resources
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    logger.info(`获取资源列表成功，共 ${resources.length} 条`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        total,
        page,
        limit,
        list: resources
      }
    });
  } catch (error) {
    logger.error(`获取资源列表错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * POST /api/admin/resources/upload
 * 上传文件
 */
router.post('/upload', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const config = await getResourceConfig(db);
    
    // 动态创建 multer 实例
    const upload = multer({
      storage,
      limits: {
        fileSize: config.max_file_size * 1024 * 1024
      }
    }).single('file');

    upload(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            code: 1001,
            message: `文件大小超过限制，最大允许 ${config.max_file_size}MB`,
            data: null
          });
        }
        return res.status(400).json({
          code: 1001,
          message: err.message,
          data: null
        });
      }

      if (!req.file) {
        return res.status(400).json({
          code: 1001,
          message: '请选择要上传的文件',
          data: null
        });
      }

      const file = req.file;
      const name = req.body.name || path.parse(file.originalname).name;
      const downloadToken = generateToken();

      const result = await db.prepare(`
        INSERT INTO resources (name, filename, original_name, size, mimetype, path, download_token)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        name,
        file.filename,
        file.originalname,
        file.size,
        file.mimetype,
        file.path,
        downloadToken
      );

      const resource = await db.prepare('SELECT * FROM resources WHERE id = ?').get(result.lastInsertRowid);

      logger.info(`上传文件成功: ${file.originalname} (ID: ${result.lastInsertRowid})`);

      res.json({
        code: 0,
        message: 'ok',
        data: resource
      });
    });
  } catch (error) {
    logger.error(`上传文件错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * PUT /api/admin/resources/:id
 * 更新资源信息（重命名等）
 */
router.put('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数'),
  body('name').optional().notEmpty().withMessage('资源名称不能为空'),
  body('enabled').optional().isBoolean().withMessage('enabled必须是布尔值')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const resourceId = parseInt(req.params.id);
    const db = req.app.locals.db;

    const existing = await db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
    if (!existing) {
      return res.status(400).json({
        code: 1001,
        message: '资源不存在',
        data: null
      });
    }

    const updates = [];
    const values = [];

    if (req.body.name !== undefined) {
      updates.push('name = ?');
      values.push(req.body.name);
    }
    if (req.body.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(req.body.enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        code: 1001,
        message: '没有要更新的字段',
        data: null
      });
    }

    updates.push('updated_at = ?');
    values.push(Math.floor(Date.now() / 1000));

    values.push(resourceId);
    await db.prepare(`UPDATE resources SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = await db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);

    logger.info(`更新资源成功: ${updated.name} (ID: ${resourceId})`);

    res.json({
      code: 0,
      message: 'ok',
      data: updated
    });
  } catch (error) {
    logger.error(`更新资源错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * DELETE /api/admin/resources/:id
 * 删除资源
 */
router.delete('/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const resourceId = parseInt(req.params.id);
    const db = req.app.locals.db;

    const existing = await db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
    if (!existing) {
      return res.status(400).json({
        code: 1001,
        message: '资源不存在',
        data: null
      });
    }

    // 删除文件
    const filePath = existing.path;
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`删除文件: ${filePath}`);
    }

    // 删除数据库记录
    await db.prepare('DELETE FROM resources WHERE id = ?').run(resourceId);

    logger.info(`删除资源成功: ${existing.name} (ID: ${resourceId})`);

    res.json({
      code: 0,
      message: 'ok',
      data: { message: '资源已删除' }
    });
  } catch (error) {
    logger.error(`删除资源错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * POST /api/admin/resources/:id/refresh-token
 * 刷新下载 token
 */
router.post('/:id/refresh-token', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const resourceId = parseInt(req.params.id);
    const db = req.app.locals.db;

    const existing = await db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
    if (!existing) {
      return res.status(400).json({
        code: 1001,
        message: '资源不存在',
        data: null
      });
    }

    const newToken = generateToken();
    await db.prepare('UPDATE resources SET download_token = ?, updated_at = ? WHERE id = ?')
      .run(newToken, Math.floor(Date.now() / 1000), resourceId);

    const updated = await db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);

    logger.info(`刷新 token 成功: ${updated.name} (ID: ${resourceId})`);

    res.json({
      code: 0,
      message: 'ok',
      data: updated
    });
  } catch (error) {
    logger.error(`刷新 token 错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * PUT /api/admin/resources/:id/expire
 * 设置过期时间
 */
router.put('/:id/expire', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数'),
  body('expire_at').optional({ nullable: true }).isInt().withMessage('过期时间必须是时间戳')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const resourceId = parseInt(req.params.id);
    const db = req.app.locals.db;

    const existing = await db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
    if (!existing) {
      return res.status(400).json({
        code: 1001,
        message: '资源不存在',
        data: null
      });
    }

    const expireAt = req.body.expire_at === null ? null : parseInt(req.body.expire_at);
    await db.prepare('UPDATE resources SET expire_at = ?, updated_at = ? WHERE id = ?')
      .run(expireAt, Math.floor(Date.now() / 1000), resourceId);

    const updated = await db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);

    logger.info(`设置过期时间成功: ${updated.name} (ID: ${resourceId}, expire_at: ${expireAt})`);

    res.json({
      code: 0,
      message: 'ok',
      data: updated
    });
  } catch (error) {
    logger.error(`设置过期时间错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * POST /api/admin/resources/:id/distribute
 * 分发资源给用户（支持批量）
 */
router.post('/:id/distribute', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('资源ID必须是大于0的整数'),
  body('user_ids').isArray({ min: 1 }).withMessage('用户ID列表不能为空'),
  body('expire_minutes').optional().isInt({ min: 1 }).withMessage('过期时间必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const resourceId = parseInt(req.params.id);
    const { user_ids, expire_minutes } = req.body;
    const db = req.app.locals.db;

    // 检查资源是否存在
    const resource = await db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
    if (!resource) {
      return res.status(400).json({
        code: 1001,
        message: '资源不存在',
        data: null
      });
    }

    // 计算过期时间
    let expireAt = null;
    if (expire_minutes) {
      expireAt = Math.floor(Date.now() / 1000) + (expire_minutes * 60);
    }

    const results = [];
    for (const userId of user_ids) {
      // 检查是否已存在分发记录
      const existing = await db.prepare(
        'SELECT * FROM resource_distributions WHERE resource_id = ? AND user_id = ?'
      ).get(resourceId, userId);

      if (existing) {
        // 更新现有记录
        const newToken = generateToken();
        await db.prepare(
          'UPDATE resource_distributions SET download_token = ?, expire_at = ?, enabled = 1, download_count = 0 WHERE id = ?'
        ).run(newToken, expireAt, existing.id);
        results.push({ user_id: userId, distribution_id: existing.id, action: 'updated' });
      } else {
        // 创建新记录
        const newToken = generateToken();
        const result = await db.prepare(
          'INSERT INTO resource_distributions (resource_id, user_id, download_token, expire_at) VALUES (?, ?, ?, ?)'
        ).run(resourceId, userId, newToken, expireAt);
        results.push({ user_id: userId, distribution_id: result.lastInsertRowid, action: 'created' });
      }
    }

    logger.info(`分发资源成功: 资源ID ${resourceId}, 用户数 ${user_ids.length}`);

    res.json({
      code: 0,
      message: 'ok',
      data: {
        resource_id: resourceId,
        distributions: results
      }
    });
  } catch (error) {
    logger.error(`分发资源错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * GET /api/admin/resources/:id/distributions
 * 获取资源的分发列表
 */
router.get('/:id/distributions', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('资源ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const resourceId = parseInt(req.params.id);
    const db = req.app.locals.db;

    const distributions = await db.prepare(`
      SELECT rd.*, u.email 
      FROM resource_distributions rd
      LEFT JOIN users u ON rd.user_id = u.id
      WHERE rd.resource_id = ?
      ORDER BY rd.created_at DESC
    `).all(resourceId);

    logger.info(`获取分发列表成功: 资源ID ${resourceId}, 共 ${distributions.length} 条`);

    res.json({
      code: 0,
      message: 'ok',
      data: distributions
    });
  } catch (error) {
    logger.error(`获取分发列表错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * PUT /api/admin/resources/distributions/batch-expire
 * 批量设置过期时间
 */
router.put('/distributions/batch-expire', authenticateAdmin, [
  body('ids').isArray({ min: 1 }).withMessage('ID列表不能为空'),
  body('expire_minutes').isInt({ min: 1 }).withMessage('过期时间必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const { ids, expire_minutes } = req.body;
    const db = req.app.locals.db;
    const expireAt = Math.floor(Date.now() / 1000) + (expire_minutes * 60);

    await db.prepare(
      `UPDATE resource_distributions SET expire_at = ? WHERE id = ANY(?)`
    ).run(expireAt, [ids]);

    logger.info(`批量设置过期时间成功: ${ids.length} 条记录`);

    res.json({
      code: 0,
      message: 'ok',
      data: { updated_count: ids.length }
    });
  } catch (error) {
    logger.error(`批量设置过期时间错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

/**
 * DELETE /api/admin/resources/distributions/:id
 * 删除分发记录
 */
router.delete('/distributions/:id', authenticateAdmin, [
  param('id').isInt({ min: 1 }).withMessage('ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 1001,
        message: '参数校验失败',
        data: null
      });
    }

    const distributionId = parseInt(req.params.id);
    const db = req.app.locals.db;

    await db.prepare('DELETE FROM resource_distributions WHERE id = ?').run(distributionId);

    logger.info(`删除分发记录成功: ID ${distributionId}`);

    res.json({
      code: 0,
      message: 'ok',
      data: { message: '分发记录已删除' }
    });
  } catch (error) {
    logger.error(`删除分发记录错误: ${error.message}`);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
});

module.exports = router;

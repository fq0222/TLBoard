/**
 * 用户端Cloudflare IP优选路由
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateUser } = require('../../middleware/auth-user');
const { createLogger } = require('../../utils/logger');
const { generateSubscriptionUrls } = require('../../utils/site-url');

const router = express.Router();
const logger = createLogger('USER-CF');

/**
 * GET /api/user/cf-ips
 * 获取随机20个IP（包含至少3个IPv6）
 */
router.get('/', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = req.app.locals.db;

    // 获取所有启用的IP
    const allIps = await db.prepare('SELECT id, ip FROM cf_ip_pool WHERE enabled = 1 ORDER BY id').all();
    
    // 分离IPv4和IPv6
    const ipv4List = allIps.filter(item => !item.ip.includes(':'));
    const ipv6List = allIps.filter(item => item.ip.includes(':'));
    
    // 随机选择3个IPv6
    let selectedIpv6 = [];
    if (ipv6List.length > 0) {
      const shuffledIpv6 = [...ipv6List].sort(() => Math.random() - 0.5);
      selectedIpv6 = shuffledIpv6.slice(0, Math.min(3, ipv6List.length));
    }
    
    // 随机选择剩余的IPv4（凑够20个）
    const remainingCount = 20 - selectedIpv6.length;
    let selectedIpv4 = [];
    if (ipv4List.length > 0) {
      const shuffledIpv4 = [...ipv4List].sort(() => Math.random() - 0.5);
      selectedIpv4 = shuffledIpv4.slice(0, Math.min(remainingCount, ipv4List.length));
    }
    
    // 合并并随机排序
    const ips = [...selectedIpv4, ...selectedIpv6].sort(() => Math.random() - 0.5);

    // 查询用户当前正在使用的优选IP
    const currentIps = await db.prepare(`
      SELECT cp.ip, 'user_selected' as source
      FROM user_cf_ips uci
      JOIN cf_ip_pool cp ON uci.ip_pool_id = cp.id
      WHERE uci.user_id = $1 AND cp.enabled = 1
    `).all(userId);

    if (currentIps.length === 0) {
      currentIps.push({ ip: '8.8.8.8', source: 'default' });
    }

    logger.info(`获取CF IP池成功，用户: ${req.user.email}，返回 ${ips.length} 个IP（IPv4: ${selectedIpv4.length}, IPv6: ${selectedIpv6.length}）`);

    res.json({ code: 0, message: 'ok', data: { ips, current_ips: currentIps } });
  } catch (error) {
    logger.error(`获取CF IP池错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * POST /api/user/cf-ips/apply
 * 应用用户选择的优选IP（通过 IP ID）
 */
router.post('/apply', authenticateUser, [
  body('ip_ids').isArray({ min: 1 }).withMessage('至少选择1个IP'),
  body('ip_ids.*').isInt({ min: 1 }).withMessage('IP ID必须是大于0的整数')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const { ip_ids } = req.body;
    const userId = req.user.id;
    const db = req.app.locals.db;

    const validIps = await db.prepare(`
      SELECT id, ip FROM cf_ip_pool
      WHERE id IN (${ip_ids.map((_, i) => `$${i + 1}`).join(',')}) AND enabled = 1
    `).all(...ip_ids);

    if (validIps.length !== ip_ids.length) {
      return res.status(400).json({ code: 4002, message: 'IP ID 无效或已禁用', data: null });
    }

    const transaction = db.transaction(async () => {
      await db.prepare('DELETE FROM user_cf_ips WHERE user_id = $1').run(userId);
      const insertStmt = db.prepare('INSERT INTO user_cf_ips (user_id, ip_pool_id) VALUES ($1, $2)');
      for (const ipId of ip_ids) {
        await insertStmt.run(userId, ipId);
      }
    });

    await transaction();

    const user = await db.prepare('SELECT sub_id FROM users WHERE id = $1').get(userId);
    const urls = generateSubscriptionUrls(req, user.sub_id);

    const nodes = validIps.map(ip => ({
      server_name: 'CF优选',
      address: ip.ip,
      port: 443,
      protocol: 'vmess',
      remark: `CF-${ip.ip}`
    }));

    logger.info(`应用优选IP成功，用户: ${req.user.email}，选择了 ${ip_ids.length} 个IP`);

    res.json({
      code: 0, message: 'ok',
      data: {
        applied_count: ip_ids.length,
        subscription_url: urls.subscription_url,
        nodes,
        message: `已成功应用 ${ip_ids.length} 个优选 IP，请重新获取订阅`
      }
    });
  } catch (error) {
    logger.error(`应用优选IP错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

/**
 * POST /api/user/cf-ips/apply-by-ip
 * 应用用户选择的优选IP（通过 IP 地址）
 */
router.post('/apply-by-ip', authenticateUser, [
  body('ips').isArray({ min: 1 }).withMessage('至少选择1个IP'),
  body('ips.*').isString().withMessage('IP地址必须是字符串')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 1001, message: '参数校验失败', data: null });
    }

    const { ips } = req.body;
    const userId = req.user.id;
    const db = req.app.locals.db;

    // 通过 IP 地址查询 ID
    const validIps = await db.prepare(`
      SELECT id, ip FROM cf_ip_pool
      WHERE ip IN (${ips.map((_, i) => `$${i + 1}`).join(',')}) AND enabled = 1
    `).all(...ips);

    if (validIps.length === 0) {
      return res.status(400).json({ code: 4002, message: 'IP 地址无效或已禁用', data: null });
    }

    const transaction = db.transaction(async () => {
      await db.prepare('DELETE FROM user_cf_ips WHERE user_id = $1').run(userId);
      const insertStmt = db.prepare('INSERT INTO user_cf_ips (user_id, ip_pool_id) VALUES ($1, $2)');
      for (const ip of validIps) {
        await insertStmt.run(userId, ip.id);
      }
    });

    await transaction();

    const user = await db.prepare('SELECT sub_id FROM users WHERE id = $1').get(userId);
    const urls = generateSubscriptionUrls(req, user.sub_id);

    logger.info(`应用优选IP成功，用户: ${req.user.email}，选择了 ${validIps.length} 个IP`);

    res.json({
      code: 0, message: 'ok',
      data: {
        applied_count: validIps.length,
        subscription_url: urls.subscription_url,
        message: `已成功应用 ${validIps.length} 个优选 IP`
      }
    });
  } catch (error) {
    logger.error(`应用优选IP错误: ${error.message}`);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

module.exports = router;
/**
 * 默认数据初始化模块
 * 负责按既有语义初始化管理员、套餐和公告等基础数据。
 */

/**
 * 初始化默认数据。
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {object} options - 初始化上下文
 * @param {object} options.config - 项目配置
 * @param {object} options.logger - 日志实例
 */
async function initDefaultData(client, { config, logger }) {
  const adminCount = await client.query('SELECT COUNT(*) as count FROM admins');
  if (parseInt(adminCount.rows[0].count, 10) === 0) {
    const bcrypt = require('bcrypt');
    const defaultPassword = bcrypt.hashSync('admin123', config.security.bcryptRounds);
    await client.query(
      'INSERT INTO admins (username, password_hash, is_super) VALUES ($1, $2, $3)',
      ['admin', defaultPassword, 1]
    );
    logger.info('默认超级管理员创建成功(admin/admin123)');
  }

  const planCount = await client.query('SELECT COUNT(*) as count FROM plans');
  if (parseInt(planCount.rows[0].count, 10) === 0) {
    await client.query(
      'INSERT INTO plans (name, description, price, duration_days, traffic_limit, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
      ['基础套餐', '适合轻度使用，每月100GB流量', 1990, 30, 107374182400, 1]
    );
    await client.query(
      'INSERT INTO plans (name, description, price, duration_days, traffic_limit, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
      ['高级套餐', '适合重度使用，每月500GB流量', 4990, 30, 536870912000, 2]
    );
    logger.info('默认套餐创建成功');
  }

  const announcementCount = await client.query('SELECT COUNT(*) as count FROM announcements');
  if (parseInt(announcementCount.rows[0].count, 10) === 0) {
    await client.query(
      'INSERT INTO announcements (title, content, pinned, enabled) VALUES ($1, $2, $3, $4)',
      ['系统上线通知', '## 系统上线通知\n\n欢迎使用机场面板系统！', 1, 1]
    );
    logger.info('默认公告创建成功');
  }
}

module.exports = {
  initDefaultData
};

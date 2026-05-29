/**
 * 表结构初始化模块
 * 负责按照既有顺序创建数据库表，并输出对应初始化日志。
 */

const tableDefinitions = [
  {
    logMessage: '用户表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        plan_id INTEGER,
        subscription_token VARCHAR(255) UNIQUE,
        sub_id VARCHAR(255) UNIQUE,
        traffic_used BIGINT DEFAULT 0,
        traffic_limit BIGINT DEFAULT 0,
        traffic_used_at BIGINT,
        disable_reason VARCHAR(50),
        expire_at BIGINT,
        enabled INTEGER DEFAULT 0,
        payment_count INTEGER DEFAULT 0,
        sync_status INTEGER DEFAULT 0,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '流量同步日志表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS traffic_sync_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        server_id INTEGER NOT NULL,
        last_sync_traffic BIGINT DEFAULT 0,
        last_sync_at BIGINT,
        UNIQUE(user_id, server_id)
      )
    `
  },
  {
    logMessage: '管理员表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        is_super INTEGER DEFAULT 0,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '套餐表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price INTEGER NOT NULL,
        duration_days INTEGER NOT NULL,
        traffic_limit BIGINT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        sales_limit INTEGER DEFAULT -1,
        sales_count INTEGER DEFAULT 0,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '订单表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        email VARCHAR(255) NOT NULL,
        plan_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        trade_no VARCHAR(255) UNIQUE,
        out_trade_no VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        payment_url TEXT,
        paid_at BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '3X-UI服务器表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS xui_servers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        api_url VARCHAR(500) NOT NULL,
        api_username VARCHAR(255) NOT NULL,
        api_password VARCHAR(255) NOT NULL,
        api_token TEXT DEFAULT '',
        host VARCHAR(500) DEFAULT '',
        client_port INTEGER DEFAULT 0,
        sub_url VARCHAR(500) DEFAULT '',
        status INTEGER DEFAULT 0,
        last_check_at BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '3X-UI节点快照表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS xui_nodes (
        id SERIAL PRIMARY KEY,
        server_id INTEGER NOT NULL,
        inbound_id INTEGER NOT NULL,
        remark VARCHAR(255),
        port INTEGER,
        protocol VARCHAR(50),
        settings TEXT DEFAULT '{}',
        stream_settings TEXT DEFAULT '{}',
        user_count INTEGER DEFAULT 0,
        online_count INTEGER DEFAULT 0,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '用户节点配置表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS user_node_configs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        server_id INTEGER NOT NULL,
        inbound_id INTEGER NOT NULL,
        uuid VARCHAR(100) NOT NULL,
        auth VARCHAR(100) NOT NULL DEFAULT '',
        sub_id VARCHAR(50) NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id, server_id, inbound_id)
      )
    `
  },
  {
    logMessage: '用户订阅缓存表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS user_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sub_id VARCHAR(50) NOT NULL UNIQUE,
        nodes_data TEXT NOT NULL,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '用户原始订阅模板缓存表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS user_subscription_sources (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        server_id INTEGER NOT NULL,
        inbound_id INTEGER NOT NULL,
        sub_id VARCHAR(50) NOT NULL DEFAULT '',
        remark VARCHAR(255) NOT NULL DEFAULT '',
        protocol VARCHAR(50) NOT NULL DEFAULT '',
        original_link TEXT NOT NULL DEFAULT '',
        node_fingerprint VARCHAR(255) NOT NULL DEFAULT '',
        server_fingerprint VARCHAR(255) NOT NULL DEFAULT '',
        fetched_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id, server_id, inbound_id)
      )
    `
  },
  {
    logMessage: '3X-UI 同步任务队列表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS xui_sync_tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        task_type VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        payload TEXT DEFAULT '{}',
        attempts INTEGER DEFAULT 0,
        next_retry_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        last_error TEXT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '公告表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        content TEXT,
        pinned INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '博客文章表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS blog_articles (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        summary VARCHAR(500) NOT NULL,
        category VARCHAR(100),
        content TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'draft',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '工单表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'open',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        closed_at BIGINT,
        last_reply_at BIGINT,
        last_read_at BIGINT,
        reply_count INTEGER DEFAULT 0
      )
    `
  },
  {
    logMessage: '工单回复表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS ticket_replies (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER NOT NULL,
        user_id INTEGER,
        admin_id INTEGER,
        content TEXT NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '工单已读表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS ticket_reads (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        last_read_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(ticket_id, user_id)
      )
    `
  },
  {
    logMessage: 'Cloudflare优选IP池表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS cf_ip_pool (
        id SERIAL PRIMARY KEY,
        ip VARCHAR(50) NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '用户CF优选记录表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS user_cf_ips (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        ip_pool_id INTEGER NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '系统配置表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '邮件模板表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        subject VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        variables TEXT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '群发任务表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS email_campaigns (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        template_id INT,
        subject VARCHAR(200),
        content TEXT,
        target_type VARCHAR(20),
        target_users TEXT,
        total_count INT DEFAULT 0,
        sent_count INT DEFAULT 0,
        failed_count INT DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        daily_limit INT DEFAULT 200,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '邮件日志表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS email_logs (
        id SERIAL PRIMARY KEY,
        campaign_id INT,
        user_id INT,
        email VARCHAR(255),
        subject VARCHAR(200),
        status VARCHAR(20),
        error_message TEXT,
        sent_at BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '资源表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS resources (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        size BIGINT NOT NULL,
        mimetype VARCHAR(100),
        path VARCHAR(500) NOT NULL,
        download_token VARCHAR(32) UNIQUE NOT NULL,
        expire_at BIGINT,
        download_count INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '资源分发表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS resource_distributions (
        id SERIAL PRIMARY KEY,
        resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        download_token VARCHAR(32) UNIQUE NOT NULL,
        expire_at BIGINT,
        download_count INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  }
];

/**
 * 初始化所有表结构。
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {object} logger - 日志实例
 */
async function initTables(client, logger) {
  for (const tableDefinition of tableDefinitions) {
    await client.query(tableDefinition.sql);
    logger.info(tableDefinition.logMessage);
  }
}

module.exports = {
  initTables
};

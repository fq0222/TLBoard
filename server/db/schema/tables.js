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
        referral_traffic_limit BIGINT DEFAULT 0,
        balance INTEGER DEFAULT 0,
        traffic_used_at BIGINT,
        disable_reason VARCHAR(50),
        renewal_notice_attempted_at BIGINT,
        renewal_notice_reason VARCHAR(50),
        expire_at BIGINT,
        enabled INTEGER DEFAULT 0,
        payment_count INTEGER DEFAULT 0,
        sync_status INTEGER DEFAULT 0,
        onboarding_completed INTEGER DEFAULT 0,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
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
        plan_type VARCHAR(20) DEFAULT 'lifetime',
        show_on_home INTEGER DEFAULT 1,
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
        referrer_user_id INTEGER,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '推广码表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS referral_codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(64) NOT NULL UNIQUE,
        enabled INTEGER DEFAULT 1,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '推广点击记录表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS referral_clicks (
        id SERIAL PRIMARY KEY,
        referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(64) NOT NULL,
        ip VARCHAR(64),
        user_agent TEXT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '推广奖励记录表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS referral_rewards (
        id SERIAL PRIMARY KEY,
        referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        referred_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        reward_amount INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(referred_user_id),
        UNIQUE(order_id)
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
    logMessage: '流量同步日志表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS traffic_sync_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        server_id INTEGER NOT NULL REFERENCES xui_servers(id) ON DELETE CASCADE,
        last_sync_traffic BIGINT DEFAULT 0,
        last_sync_at BIGINT,
        UNIQUE(user_id, server_id)
      )
    `
  },
  {
    logMessage: '3X-UI节点快照表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS xui_nodes (
        id SERIAL PRIMARY KEY,
        server_id INTEGER NOT NULL REFERENCES xui_servers(id) ON DELETE CASCADE,
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
        server_id INTEGER NOT NULL REFERENCES xui_servers(id) ON DELETE CASCADE,
        inbound_id INTEGER NOT NULL,
        uuid VARCHAR(100) NOT NULL,
        password VARCHAR(100) NOT NULL DEFAULT '',
        auth VARCHAR(100) NOT NULL DEFAULT '',
        sub_id VARCHAR(50) NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id, server_id, inbound_id)
      )
    `
  },
  {
    logMessage: '3X-UI客户端模型迁移审计表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS xui_client_model_migrations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        server_id INTEGER NOT NULL REFERENCES xui_servers(id) ON DELETE CASCADE,
        status VARCHAR(30) NOT NULL,
        old_emails TEXT NOT NULL DEFAULT '[]',
        new_email VARCHAR(255) NOT NULL DEFAULT '',
        inbound_ids TEXT NOT NULL DEFAULT '[]',
        credential_source VARCHAR(50) NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        migrated_at BIGINT,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id, server_id)
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
        server_id INTEGER NOT NULL REFERENCES xui_servers(id) ON DELETE CASCADE,
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
    logMessage: '批量订阅生成任务表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS batch_subscription_tasks (
        id SERIAL PRIMARY KEY,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        filter_cf_optimized INTEGER DEFAULT 1,
        total_count INTEGER DEFAULT 0,
        completed_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        current_email VARCHAR(255) DEFAULT '',
        last_error TEXT,
        started_at BIGINT,
        finished_at BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '批量订阅生成任务明细表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS batch_subscription_task_items (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES batch_subscription_tasks(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        error_message TEXT,
        started_at BIGINT,
        finished_at BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id)
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
        popup_show_limit INTEGER NOT NULL DEFAULT 0,
        node_show INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '用户公告弹窗统计表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS user_announcement_popup_stats (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        shown_count INTEGER NOT NULL DEFAULT 0,
        last_shown_at BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        UNIQUE(user_id, announcement_id)
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
        pinned INTEGER DEFAULT 0,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '博客文章置顶字段初始化完成',
    sql: 'ALTER TABLE blog_articles ADD COLUMN IF NOT EXISTS pinned INTEGER DEFAULT 0'
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
        ip_pool_id INTEGER,
        custom_ip VARCHAR(45),
        source VARCHAR(20) NOT NULL DEFAULT 'pool',
        slot_index INTEGER NOT NULL DEFAULT 1,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        CONSTRAINT user_cf_ips_source_check CHECK (source IN ('pool', 'custom')),
        CONSTRAINT user_cf_ips_value_check CHECK (
          (source = 'pool' AND ip_pool_id IS NOT NULL AND custom_ip IS NULL)
          OR
          (source = 'custom' AND ip_pool_id IS NULL AND custom_ip IS NOT NULL)
        ),
        CONSTRAINT user_cf_ips_slot_check CHECK (slot_index BETWEEN 1 AND 5),
        CONSTRAINT user_cf_ips_user_slot_unique UNIQUE (user_id, slot_index)
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
        is_download_resource INTEGER DEFAULT 0,
        download_category VARCHAR(100) DEFAULT '其他',
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
  },
  {
    logMessage: 'Telegram 管理员绑定表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_admin_bindings (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL UNIQUE REFERENCES admins(id) ON DELETE CASCADE,
        chat_id VARCHAR(64) NOT NULL UNIQUE,
        telegram_user_id VARCHAR(64) DEFAULT '',
        telegram_username VARCHAR(255) DEFAULT '',
        telegram_first_name VARCHAR(255) DEFAULT '',
        telegram_last_name VARCHAR(255) DEFAULT '',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: 'Telegram 绑定码表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_bind_codes (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        bind_code VARCHAR(64) NOT NULL UNIQUE,
        expires_at BIGINT NOT NULL,
        used_at BIGINT,
        created_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: 'Telegram 服务健康表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_server_health_checks (
        server_id INTEGER PRIMARY KEY REFERENCES xui_servers(id) ON DELETE CASCADE,
        panel_api_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
        panel_auth_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
        xray_runtime_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
        last_success_at BIGINT,
        last_failure_at BIGINT,
        last_checked_at BIGINT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        failure_reason VARCHAR(255) DEFAULT '',
        failure_detail TEXT DEFAULT '',
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: 'Telegram 告警记录表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_alert_records (
        id SERIAL PRIMARY KEY,
        server_id INTEGER NOT NULL REFERENCES xui_servers(id) ON DELETE CASCADE,
        alert_type VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        first_triggered_at BIGINT NOT NULL,
        last_triggered_at BIGINT NOT NULL,
        resolved_at BIGINT,
        last_sent_at BIGINT,
        send_count INTEGER NOT NULL DEFAULT 0,
        last_send_status VARCHAR(20) DEFAULT '',
        last_send_message_id VARCHAR(64) DEFAULT '',
        last_send_error TEXT DEFAULT '',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: 'Telegram 命令日志表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_command_logs (
        id SERIAL PRIMARY KEY,
        binding_id INTEGER REFERENCES telegram_admin_bindings(id) ON DELETE SET NULL,
        admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
        chat_id VARCHAR(64) DEFAULT '',
        command VARCHAR(100) NOT NULL,
        command_args TEXT DEFAULT '',
        result_status VARCHAR(20) NOT NULL DEFAULT 'success',
        result_message TEXT DEFAULT '',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
      )
    `
  },
  {
    logMessage: '密码重置 Token 表初始化完成',
    sql: `
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(64) UNIQUE NOT NULL,
        expires_at BIGINT NOT NULL,
        used_at BIGINT,
        request_ip VARCHAR(64) DEFAULT '',
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

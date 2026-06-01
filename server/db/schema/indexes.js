/**
 * 索引初始化模块
 * 负责创建 DB 初始化阶段依赖的全部索引定义。
 */

const indexStatements = [
  'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
  'CREATE INDEX IF NOT EXISTS idx_users_plan_id ON users(plan_id)',
  'CREATE INDEX IF NOT EXISTS idx_users_subscription_token ON users(subscription_token)',
  'CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)',
  'CREATE INDEX IF NOT EXISTS idx_orders_out_trade_no ON orders(out_trade_no)',
  'CREATE INDEX IF NOT EXISTS idx_xui_nodes_server_id ON xui_nodes(server_id)',
  'CREATE INDEX IF NOT EXISTS idx_user_cf_ips_user_id ON user_cf_ips(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)',
  'CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_blog_articles_status ON blog_articles(status)',
  'CREATE INDEX IF NOT EXISTS idx_blog_articles_category ON blog_articles(category)',
  'CREATE INDEX IF NOT EXISTS idx_blog_articles_updated_at ON blog_articles(updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket_id ON ticket_replies(ticket_id)',
  'CREATE INDEX IF NOT EXISTS idx_ticket_replies_created_at ON ticket_replies(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_ticket_reads_ticket_id ON ticket_reads(ticket_id)',
  'CREATE INDEX IF NOT EXISTS idx_ticket_reads_user_id ON ticket_reads(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_traffic_sync_log_user_server ON traffic_sync_log(user_id, server_id)',
  'CREATE INDEX IF NOT EXISTS idx_traffic_sync_log_last_sync_at ON traffic_sync_log(last_sync_at)',
  'CREATE INDEX IF NOT EXISTS idx_user_node_configs_user_id ON user_node_configs(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_user_node_configs_server_id ON user_node_configs(server_id)',
  'CREATE INDEX IF NOT EXISTS idx_user_node_configs_inbound_id ON user_node_configs(inbound_id)',
  'CREATE INDEX IF NOT EXISTS idx_user_node_configs_sub_id ON user_node_configs(sub_id)',
  'CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_user_subscription_sources_user_id ON user_subscription_sources(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_user_subscription_sources_server_id ON user_subscription_sources(server_id)',
  'CREATE INDEX IF NOT EXISTS idx_batch_subscription_tasks_status ON batch_subscription_tasks(status)',
  'CREATE INDEX IF NOT EXISTS idx_batch_subscription_task_items_task_status ON batch_subscription_task_items(task_id, status)',
  'CREATE INDEX IF NOT EXISTS idx_batch_subscription_task_items_user_id ON batch_subscription_task_items(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_xui_sync_tasks_status_retry ON xui_sync_tasks(status, next_retry_at)',
  'CREATE INDEX IF NOT EXISTS idx_xui_sync_tasks_user_id ON xui_sync_tasks(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_email_logs_campaign_id ON email_logs(campaign_id)',
  'CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status)',
  'CREATE INDEX IF NOT EXISTS idx_resources_download_token ON resources(download_token)',
  'CREATE INDEX IF NOT EXISTS idx_resources_enabled ON resources(enabled)',
  'CREATE INDEX IF NOT EXISTS idx_resources_expire_at ON resources(expire_at)',
  'CREATE INDEX IF NOT EXISTS idx_resources_download_category ON resources(is_download_resource, download_category)',
  'CREATE INDEX IF NOT EXISTS idx_resource_distributions_resource_id ON resource_distributions(resource_id)',
  'CREATE INDEX IF NOT EXISTS idx_resource_distributions_download_token ON resource_distributions(download_token)',
  'CREATE INDEX IF NOT EXISTS idx_resource_distributions_expire_at ON resource_distributions(expire_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_distributions_user_id_unique ON resource_distributions(user_id)'
];

/**
 * 初始化所有索引。
 * @param {import('pg').PoolClient} client - PostgreSQL 事务连接
 * @param {object} logger - 日志实例
 */
async function createIndexes(client, logger) {
  try {
    for (const sql of indexStatements) {
      await client.query(sql);
    }
    logger.info('数据库索引创建完成');
  } catch (error) {
    logger.error(`索引创建失败: ${error.message}`);
  }
}

module.exports = {
  createIndexes
};

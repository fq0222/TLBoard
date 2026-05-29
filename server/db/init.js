/**
 * 数据库初始化模块
 * 使用 PostgreSQL 数据库。
 */

const { Pool } = require('pg');
const config = require('../config');
const { createLogger } = require('../utils/logger');
const { createQueryWithRetry } = require('./query-runner');
const { createDbProxy: buildDbProxy } = require('./proxy');
const { convertPlaceholders: toPgPlaceholders } = require('./sql-utils');
const { initTables: initSchemaTables } = require('./schema/tables');
const { createIndexes: createSchemaIndexes } = require('./schema/indexes');
const { initDefaultData: initSchemaDefaultData } = require('./schema/default-data');

const logger = createLogger('DB');

class DatabaseManager {
  constructor() {
    this.pool = null;
  }

  /**
   * 初始化数据库连接池并编排表结构初始化。
   * @returns {Promise<object>} 兼容原 SQLite 风格的代理对象
   */
  async init() {
    try {
      this.pool = new Pool({
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: config.database.database,
        max: config.database.max,
        idleTimeoutMillis: config.database.idleTimeoutMillis,
        connectionTimeoutMillis: config.database.connectionTimeoutMillis,
        allowExitOnIdle: false,
        application_name: 'subscription_manager'
      });

      this.pool.on('error', (err) => {
        logger.error(`连接池错误: ${err.message}`);
      });

      const client = await this.pool.connect();
      logger.info(`PostgreSQL 连接成功: ${config.database.host}:${config.database.port}/${config.database.database}`);
      client.release();

      await this.initTables();

      return buildDbProxy({
        pool: this.pool,
        queryWithRetry: createQueryWithRetry(this.pool, logger),
        convertPlaceholders: toPgPlaceholders,
        logger
      });
    } catch (error) {
      if (this.pool) {
        try {
          await this.pool.end();
        } catch (closeError) {
          logger.error(`初始化失败后关闭连接池失败: ${closeError.message}`);
        } finally {
          this.pool = null;
        }
      }
      logger.error(`数据库初始化失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 初始化表结构与索引。
   */
  async initTables() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await initSchemaTables(client, logger);
      await createSchemaIndexes(client, logger);
      await client.query('COMMIT');
      logger.info('数据库表初始化完成');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`表结构初始化失败: ${error.message}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 初始化默认数据。
   */
  async initDefaultData() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await initSchemaDefaultData(client, { config, logger });
      await client.query('COMMIT');
      logger.info('默认数据初始化完成');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`默认数据插入失败: ${error.message}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 获取数据库连接池。
   */
  getPool() {
    return this.pool;
  }

  /**
   * 关闭数据库连接池。
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('数据库连接池已关闭');
    }
  }
}

const databaseManager = new DatabaseManager();
module.exports = databaseManager;

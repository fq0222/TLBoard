/**
 * 数据库初始化模块
 * 使用 PostgreSQL 数据库
 */

const { Pool } = require('pg');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('DB');

class DatabaseManager {
  constructor() {
    this.pool = null;
  }

  /**
   * 初始化数据库连接池
   */
  async init() {
    try {
      // 创建连接池
      this.pool = new Pool({
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: config.database.database,
        max: config.database.max,
        idleTimeoutMillis: config.database.idleTimeoutMillis,
        connectionTimeoutMillis: config.database.connectionTimeoutMillis
      });

      // 测试连接
      const client = await this.pool.connect();
      logger.info(`PostgreSQL 连接成功: ${config.database.host}:${config.database.port}/${config.database.database}`);
      client.release();

      // 创建表结构
      await this.initTables();

      return this.createDbProxy();
    } catch (error) {
      logger.error(`数据库初始化失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 创建数据库代理对象
   * 提供与原 SQLite 代理兼容的接口
   */
  createDbProxy() {
    const self = this;
    return {
      /**
       * 准备 SQL 语句
       * @param {string} sql - SQL 语句，使用 $1, $2, ... 作为参数占位符
       */
      prepare(sql) {
        // 将 SQL 中的 ? 占位符转换为 $1, $2, ...
        const convertedSql = self.convertPlaceholders(sql);
        
        return {
          async run(...params) {
            try {
              const result = await self.pool.query(convertedSql + ' RETURNING id', params);
              const lastId = result.rows.length > 0 ? result.rows[0].id : 0;
              return { lastInsertRowid: lastId, changes: result.rowCount };
            } catch (error) {
              logger.error(`SQL执行错误(run): ${convertedSql} - ${error.message}`);
              throw error;
            }
          },
          async get(...params) {
            try {
              const result = await self.pool.query(convertedSql, params);
              return result.rows[0] || undefined;
            } catch (error) {
              logger.error(`SQL执行错误(get): ${convertedSql} - ${error.message}`);
              throw error;
            }
          },
          async all(...params) {
            try {
              const result = await self.pool.query(convertedSql, params);
              return result.rows;
            } catch (error) {
              logger.error(`SQL执行错误(all): ${convertedSql} - ${error.message}`);
              throw error;
            }
          }
        };
      },
      async exec(sql) {
        try {
          await self.pool.query(sql);
        } catch (error) {
          logger.error(`SQL执行错误(exec): ${error.message}`);
          throw error;
        }
      },
      transaction(fn) {
        return async function(...args) {
          const client = await self.pool.connect();
          try {
            await client.query('BEGIN');
            const result = await fn.apply(this, args);
            await client.query('COMMIT');
            return result;
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
        };
      },
      save() {
        // PostgreSQL 自动持久化，无需手动保存
        logger.info('PostgreSQL 自动持久化，无需手动保存');
      }
    };
  }

  /**
   * 将 SQL 中的 ? 占位符转换为 $1, $2, ...
   * @param {string} sql - 原始 SQL
   * @returns {string} 转换后的 SQL
   */
  convertPlaceholders(sql) {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  }

  /**
   * 初始化表结构
   */
  async initTables() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 用户表
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          plan_id INTEGER,
          subscription_token VARCHAR(255) UNIQUE,
          sub_id VARCHAR(255) UNIQUE,
          traffic_used BIGINT DEFAULT 0,
          traffic_limit BIGINT DEFAULT 0,
          expire_at BIGINT,
          enabled INTEGER DEFAULT 0,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `);
      logger.info('用户表初始化完成');

      // 管理员表
      await client.query(`
        CREATE TABLE IF NOT EXISTS admins (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          is_super INTEGER DEFAULT 0,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `);
      logger.info('管理员表初始化完成');

      // 套餐表
      await client.query(`
        CREATE TABLE IF NOT EXISTS plans (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          price INTEGER NOT NULL,
          duration_days INTEGER NOT NULL,
          traffic_limit BIGINT NOT NULL,
          sort_order INTEGER DEFAULT 0,
          enabled INTEGER DEFAULT 1,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `);
      logger.info('套餐表初始化完成');

      // 订单表
      await client.query(`
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
      `);
      logger.info('订单表初始化完成');

      // 3X-UI服务器表
      await client.query(`
        CREATE TABLE IF NOT EXISTS xui_servers (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          api_url VARCHAR(500) NOT NULL,
          api_username VARCHAR(255) NOT NULL,
          api_password VARCHAR(255) NOT NULL,
          host VARCHAR(500) DEFAULT '',
          client_port INTEGER DEFAULT 0,
          status INTEGER DEFAULT 0,
          last_check_at BIGINT,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `);
      logger.info('3X-UI服务器表初始化完成');

      // 3X-UI节点快照表
      await client.query(`
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
      `);
      logger.info('3X-UI节点快照表初始化完成');

      // 公告表
      await client.query(`
        CREATE TABLE IF NOT EXISTS announcements (
          id SERIAL PRIMARY KEY,
          title VARCHAR(500) NOT NULL,
          content TEXT,
          pinned INTEGER DEFAULT 0,
          enabled INTEGER DEFAULT 1,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `);
      logger.info('公告表初始化完成');

      // Cloudflare优选IP池
      await client.query(`
        CREATE TABLE IF NOT EXISTS cf_ip_pool (
          id SERIAL PRIMARY KEY,
          ip VARCHAR(50) NOT NULL,
          enabled INTEGER DEFAULT 1,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `);
      logger.info('Cloudflare优选IP池表初始化完成');

      // 用户CF优选记录
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_cf_ips (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          ip_pool_id INTEGER NOT NULL,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `);
      logger.info('用户CF优选记录表初始化完成');

      // 创建索引
      await this.createIndexes(client);

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
   * 创建数据库索引
   */
  async createIndexes(client) {
    try {
      await client.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_users_plan_id ON users(plan_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_users_subscription_token ON users(subscription_token)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_orders_out_trade_no ON orders(out_trade_no)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_xui_nodes_server_id ON xui_nodes(server_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_user_cf_ips_user_id ON user_cf_ips(user_id)');
      logger.info('数据库索引创建完成');
    } catch (error) {
      logger.error(`索引创建失败: ${error.message}`);
    }
  }

  /**
   * 初始化默认数据
   */
  async initDefaultData() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 检查是否已有管理员数据
      const adminCount = await client.query('SELECT COUNT(*) as count FROM admins');
      if (parseInt(adminCount.rows[0].count) === 0) {
        const bcrypt = require('bcrypt');
        const defaultPassword = bcrypt.hashSync('admin123', config.security.bcryptRounds);
        await client.query(
          'INSERT INTO admins (username, password_hash, is_super) VALUES ($1, $2, $3)',
          ['admin', defaultPassword, 1]
        );
        logger.info('默认超级管理员创建成功 (admin/admin123)');
      }

      // 检查是否已有套餐数据
      const planCount = await client.query('SELECT COUNT(*) as count FROM plans');
      if (parseInt(planCount.rows[0].count) === 0) {
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

      // 检查是否已有公告数据
      const announcementCount = await client.query('SELECT COUNT(*) as count FROM announcements');
      if (parseInt(announcementCount.rows[0].count) === 0) {
        await client.query(
          'INSERT INTO announcements (title, content, pinned, enabled) VALUES ($1, $2, $3, $4)',
          ['系统上线通知', '## 系统上线通知\n\n欢迎使用机场面板系统！', 1, 1]
        );
        logger.info('默认公告创建成功');
      }

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
   * 获取数据库连接池
   */
  getPool() {
    return this.pool;
  }

  /**
   * 关闭数据库连接池
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      logger.info('数据库连接池已关闭');
    }
  }
}

const databaseManager = new DatabaseManager();
module.exports = databaseManager;
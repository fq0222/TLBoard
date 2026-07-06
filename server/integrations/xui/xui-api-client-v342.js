/**
 * 3X-UI 3.4.2 API 客户端。
 * 复用 3.2.5+ clients API，并提供 PostgreSQL 跨引擎迁移备份下载。
 */

const XuiApiClientV325 = require('./xui-api-client-v325');

class XuiApiClientV342 extends XuiApiClientV325 {
  /**
   * 创建 3.4.2 版本客户端。
   * @param {string} baseURL - 3X-UI 面板地址
   * @param {string} apiToken - 3X-UI API Token
   * @param {Object} options - 客户端配置
   */
  constructor(baseURL, apiToken, options = {}) {
    super(baseURL, apiToken, options);
    this.version = '3.4.2';
  }

  /**
   * 下载跨存储引擎迁移备份；PostgreSQL 面板返回 SQLite 数据库。
   * @returns {Promise<Buffer>} 迁移备份内容
   */
  getMigration() {
    return this.download(`${this.serverBasePath}/getMigration`);
  }
}

module.exports = XuiApiClientV342;

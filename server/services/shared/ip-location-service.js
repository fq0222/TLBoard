/**
 * 用户 IP 归属地服务。
 * 职责：规范化请求 IP、查询离线归属地、过滤非中国大陆结果，并提供管理端展示格式化。
 */

const net = require('net');
const fs = require('fs');
const path = require('path');
const userRepository = require('../../repositories/user-repository');

const MAINLAND_EXCLUDED_PROVINCES = ['香港', '澳门', '台湾', '香港特别行政区', '澳门特别行政区'];

const DEFAULT_XDB_PATHS = {
  4: path.join(__dirname, '..', '..', 'ipData', 'ip2region_v4.xdb'),
  6: path.join(__dirname, '..', '..', 'ipData', 'ip2region_v6.xdb')
};

/**
 * 获取秒级 Unix 时间戳。
 *
 * @returns {number} 当前秒级时间戳
 */
function getNowTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 移除 IPv6 映射前缀、端口包裹和多级代理列表中的无效部分。
 *
 * @param {string} value - 原始 IP 字符串
 * @returns {string} 规范化后的 IP
 */
function normalizeIp(value) {
  if (!value) return '';
  const firstIp = String(value).split(',')[0].trim();
  if (!firstIp) return '';
  if (firstIp.startsWith('::ffff:')) return firstIp.slice(7);
  if (firstIp.startsWith('[') && firstIp.includes(']')) {
    return firstIp.slice(1, firstIp.indexOf(']'));
  }
  return firstIp;
}

/**
 * 判断 IP 是否属于不应该定位和记录的本地或保留地址。
 *
 * @param {string} ip - 规范化后的 IP
 * @returns {boolean} 是否应跳过
 */
function shouldSkipIp(ip) {
  const ipVersion = net.isIP(ip);
  if (!ip || ipVersion === 0) return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ipVersion === 4) {
    if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
    if (ip.startsWith('169.254.')) return true;
  }
  if (ipVersion === 6) {
    const lowerIp = ip.toLowerCase();
    if (lowerIp.startsWith('fe80:')) return true;
    if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) return true;
  }
  return false;
}

/**
 * 将 XDB 的空值占位符转换为项目可用字段。
 *
 * @param {string|undefined} value - XDB 字段值
 * @returns {string} 规范化后的字段值
 */
function normalizeRegionField(value) {
  const text = String(value || '').trim();
  return text === '0' ? '' : text;
}

/**
 * 将 IP2Region 查询结果解析成项目统一归属地结构。
 *
 * @param {string} ip - 查询 IP
 * @param {string} region - 国家|省份|城市|运营商|国家代码
 * @returns {Object|undefined} 归属地结构；空结果返回 undefined
 */
function parseIp2RegionLocation(ip, region) {
  if (!region) return undefined;
  const [country, province, city, isp] = region.split('|');

  return {
    ip,
    country: normalizeRegionField(country),
    province: normalizeRegionField(province),
    city: normalizeRegionField(city),
    district: '',
    isp: normalizeRegionField(isp),
    updated_at: getNowTimestamp()
  };
}

/**
 * IP2Region 离线查询器管理类。
 * 职责：按 IP 版本校验并懒加载官方 XDB，在进程生命周期内复用内存查询器。
 */
class Ip2RegionLookup {
  /**
   * @param {Object<number,string>} dbPaths - IPv4/IPv6 对应的 XDB 文件路径
   * @param {Object} [options] - 文件检测和模块加载依赖
   * @param {Function} [options.fileExists] - 判断 XDB 是否存在
   * @param {Function} [options.loadModule] - 加载官方 IP2Region 模块
   */
  constructor(dbPaths, options = {}) {
    this.dbPaths = dbPaths;
    this.fileExists = options.fileExists || fs.existsSync;
    this.loadModule = options.loadModule || (() => import('ip2region.js'));
    this.searcherPromises = new Map();
  }

  /**
   * 获取指定 IP 版本的共享内存查询器。
   * 核心分支：数据库未部署时返回 undefined；存在时只校验并加载一次。
   *
   * @param {4|6} ipVersion - IP 协议版本
   * @returns {Promise<Object|undefined>} IP2Region 查询器
   */
  async getSearcher(ipVersion) {
    const dbPath = this.dbPaths[ipVersion];
    if (!dbPath || !this.fileExists(dbPath)) return undefined;

    if (!this.searcherPromises.has(ipVersion)) {
      const searcherPromise = this.loadModule()
        .then((ip2region) => {
          const version = ipVersion === 4 ? ip2region.IPv4 : ip2region.IPv6;
          ip2region.verifyFromFile(dbPath);
          const content = ip2region.loadContentFromFile(dbPath);
          return ip2region.newWithBuffer(version, content);
        })
        .catch((error) => {
          if (this.searcherPromises.get(ipVersion) === searcherPromise) {
            this.searcherPromises.delete(ipVersion);
          }
          throw error;
        });
      this.searcherPromises.set(ipVersion, searcherPromise);
    }

    return this.searcherPromises.get(ipVersion);
  }

  /**
   * 查询已验证的公网 IP。
   *
   * @param {string} ip - 已规范化的公网 IPv4 或 IPv6 地址
   * @returns {Promise<Object|undefined>} 项目统一归属地结构
   */
  async lookup(ip) {
    const ipVersion = net.isIP(ip);
    const searcher = await this.getSearcher(ipVersion);
    if (!searcher) return undefined;

    const region = await searcher.search(ip);
    return parseIp2RegionLocation(ip, region);
  }
}

const ip2RegionLookup = new Ip2RegionLookup(DEFAULT_XDB_PATHS);

/**
 * 查询 IP 归属地。
 *
 * @param {string} rawIp - 原始请求 IP
 * @returns {Promise<Object|undefined>} 归属地结构；不可记录时返回 undefined
 */
async function lookupIpLocation(rawIp) {
  const ip = normalizeIp(rawIp);
  if (shouldSkipIp(ip)) return undefined;
  return ip2RegionLookup.lookup(ip);
}

/**
 * 判断归属地是否属于中国大陆。
 *
 * @param {Object|undefined} location - 归属地结构
 * @returns {boolean} 是否中国大陆
 */
function isMainlandChinaLocation(location) {
  if (!location) return false;
  const country = String(location.country || '').trim();
  const province = String(location.province || '').trim();
  const isChina = country === '中国' || country.toLowerCase() === 'china';
  if (!isChina) return false;
  return !MAINLAND_EXCLUDED_PROVINCES.some((name) => province.includes(name));
}

/**
 * 判断定位结果是否有管理端可展示的省市区信息。
 *
 * @param {Object} location - 归属地结构
 * @returns {boolean} 是否有可展示位置
 */
function hasDisplayLocation(location) {
  return [location.province, location.city, location.district, location.country]
    .some((item) => String(item || '').trim());
}

/**
 * 精简历史归属地数据里对管理端展示价值较低的运营商尾缀。
 *
 * @param {string} value - 运营商名称
 * @returns {string} 管理端展示名称
 */
function formatIspText(value) {
  return String(value || '').trim()
    .replace(/\s+communications corporation$/i, '');
}

/**
 * 记录用户 IP 归属地。定位失败或非中国大陆时不写入。
 *
 * @param {Object} db - 数据库代理对象
 * @param {number} userId - 用户 ID
 * @param {'login'|'subscription'} source - 记录来源
 * @param {string} rawIp - 原始请求 IP
 * @param {Object} [options] - 测试注入选项
 * @param {Function} [options.lookupIpLocation] - 自定义查询函数
 * @returns {Promise<{recorded:boolean,reason?:string}>} 记录结果
 */
async function recordUserIpLocation(db, userId, source, rawIp, options = {}) {
  const lookup = options.lookupIpLocation || lookupIpLocation;
  const location = await lookup(rawIp);
  if (!location) {
    return { recorded: false, reason: 'empty_location' };
  }
  if (!isMainlandChinaLocation(location)) {
    return { recorded: false, reason: 'non_mainland' };
  }
  if (!hasDisplayLocation(location)) {
    return { recorded: false, reason: 'empty_display_location' };
  }

  await userRepository.updateUserIpLocation(db, userId, source, location);
  return { recorded: true };
}

/**
 * 管理端格式化展示用户归属地。
 *
 * @param {string|Object|undefined} value - users.ip_location 原始值
 * @returns {string} 省市区与运营商文本或“暂未获取”
 */
function formatIpLocationText(value) {
  try {
    const data = typeof value === 'string' ? JSON.parse(value || '{}') : (value || {});
    const location = data.login || data.subscription;
    if (!location) return '暂未获取';
    const text = [location.province, location.city, location.district]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(' ') || String(location.country || '').trim();
    const ispText = formatIspText(location.isp);
    if (!text) return '暂未获取';
    return ispText ? `${text} [${ispText}]` : text;
  } catch (error) {
    return '暂未获取';
  }
}

module.exports = {
  normalizeIp,
  shouldSkipIp,
  lookupIpLocation,
  isMainlandChinaLocation,
  hasDisplayLocation,
  recordUserIpLocation,
  formatIpLocationText,
  __testables: {
    Ip2RegionLookup,
    parseIp2RegionLocation,
    formatIspText
  }
};

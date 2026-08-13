/**
 * 用户 IP 归属地服务。
 * 职责：规范化请求 IP、查询离线归属地、过滤非中国大陆结果，并提供管理端展示格式化。
 */

const net = require('net');
const Searcher = require('ip2region-ts');
const userRepository = require('../../repositories/user-repository');

const MAINLAND_EXCLUDED_PROVINCES = ['香港', '澳门', '台湾', '香港特别行政区', '澳门特别行政区'];

let searcher;

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
  if (!ip || net.isIP(ip) === 0) return true;
  if (net.isIP(ip) !== 4) return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.toLowerCase().startsWith('fe80:')) return true;
  if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true;
  return false;
}

/**
 * 懒加载 ip2region 查询器，避免模块加载时立即做文件 IO。
 *
 * @returns {Object} ip2region 查询器
 */
function getSearcher() {
  if (!searcher) {
    const buffer = Searcher.loadContentFromFile(Searcher.defaultDbFile);
    searcher = Searcher.newWithBuffer(buffer);
  }
  return searcher;
}

/**
 * 将 ip2region 的 region 字符串解析成统一结构。
 *
 * @param {string} ip - 查询 IP
 * @param {string} region - ip2region 返回的 region 字符串
 * @returns {Object|undefined} 归属地结构
 */
function parseRegion(ip, region) {
  if (!region) return undefined;
  const [country = '', , province = '', city = '', isp = ''] = String(region).split('|');
  return {
    ip,
    country,
    province: province === '0' ? '' : province,
    city: city === '0' ? '' : city,
    district: '',
    isp: isp === '0' ? '' : isp,
    updated_at: getNowTimestamp()
  };
}

/**
 * 查询 IP 归属地。
 *
 * @param {string} rawIp - 原始请求 IP
 * @returns {Promise<Object|undefined>} 归属地结构；不可记录时返回 undefined
 */
async function lookupIpLocation(rawIp) {
  const ip = normalizeIp(rawIp);
  if (shouldSkipIp(ip)) return undefined;

  const result = await getSearcher().search(ip);
  return parseRegion(ip, result && result.region);
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
  return [location.province, location.city, location.district]
    .some((item) => String(item || '').trim());
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
 * @returns {string} 省市区文本或“暂未获取”
 */
function formatIpLocationText(value) {
  try {
    const data = typeof value === 'string' ? JSON.parse(value || '{}') : (value || {});
    const location = data.login || data.subscription;
    if (!location) return '暂未获取';
    const text = [location.province, location.city, location.district]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(' ');
    return text || '暂未获取';
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
    parseRegion
  }
};

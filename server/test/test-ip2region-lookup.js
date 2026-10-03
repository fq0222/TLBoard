/**
 * IP2Region 独立查询脚本。
 * 职责：根据命令行传入的 IPv4/IPv6 地址查询官方 XDB，并输出项目使用的归属地 JSON。
 * 用法：node server/test/test-ip2region-lookup.js <IP地址>
 */

const net = require('node:net');
const path = require('node:path');

const IP_DATA_DIR = path.join(__dirname, '..', 'ipData');
const XDB_PATHS = {
  4: path.join(IP_DATA_DIR, 'ip2region_v4.xdb'),
  6: path.join(IP_DATA_DIR, 'ip2region_v6.xdb')
};

/**
 * 将 XDB 的占位值转换为空字符串。
 *
 * @param {string|undefined} value - XDB 字段值
 * @returns {string} 可直接写入项目归属地结构的文本
 */
function normalizeRegionField(value) {
  const text = String(value || '').trim();
  return text === '0' ? '' : text;
}

/**
 * 将 IP2Region 返回值转换为项目现有归属地结构。
 * 核心分支：空结果视为查询失败；缺省字段及 XDB 的“0”占位统一转换为空字符串。
 *
 * @param {string} ip - 已验证的 IPv4 或 IPv6 地址
 * @param {string} region - 国家|省份|城市|运营商|国家代码
 * @returns {Object} 项目使用的归属地 JSON 结构
 */
function toProjectLocation(ip, region) {
  if (!region) {
    throw new Error(`未查询到 IP 归属地：${ip}`);
  }

  const [country, province, city, isp] = region.split('|');
  return {
    ip,
    country: normalizeRegionField(country),
    province: normalizeRegionField(province),
    city: normalizeRegionField(city),
    district: '',
    isp: normalizeRegionField(isp),
    updated_at: Math.floor(Date.now() / 1000)
  };
}

/**
 * 执行一次离线 IP 查询并输出 JSON。
 *
 * @param {string|undefined} rawIp - 命令行传入的 IP 地址
 * @returns {Promise<void>}
 */
async function main(rawIp) {
  const ip = String(rawIp || '').trim();
  const ipVersion = net.isIP(ip);
  if (ipVersion === 0) {
    throw new Error(`无效的 IP 地址：${ip || '(空)'}`);
  }

  const ip2region = await import('ip2region.js');
  const dbPath = XDB_PATHS[ipVersion];
  const version = ipVersion === 4 ? ip2region.IPv4 : ip2region.IPv6;

  ip2region.verifyFromFile(dbPath);
  const content = ip2region.loadContentFromFile(dbPath);
  const searcher = ip2region.newWithBuffer(version, content);
  const region = await searcher.search(ip);

  process.stdout.write(`${JSON.stringify(toProjectLocation(ip, region), null, 2)}\n`);
}

main(process.argv[2]).catch((error) => {
  process.stderr.write(`IP2Region 查询失败：${error.message}\n`);
  process.exitCode = 1;
});

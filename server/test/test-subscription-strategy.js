/**
 * 订阅策略处理服务测试脚本
 */

const {
  getStrategyFromRemark,
  parseNodeLink,
  buildNodeLink,
  applyCfStrategy,
  applyDirectStrategy,
  processNodeLink
} = require('../services/subscription-strategy');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

// 测试 getStrategyFromRemark
console.log('=== 测试 getStrategyFromRemark ===');
assert(getStrategyFromRemark('cf-香港节点') === 'cf', 'cf-香港节点 -> cf');
assert(getStrategyFromRemark('香港节点-cf') === 'cf', '香港节点-cf -> cf');
assert(getStrategyFromRemark('CF节点') === 'cf', 'CF节点 -> cf（大小写不敏感）');
assert(getStrategyFromRemark('direct-美国节点') === 'direct', 'direct-美国节点 -> direct');
assert(getStrategyFromRemark('美国节点') === 'direct', '美国节点 -> direct（默认）');
assert(getStrategyFromRemark('') === 'direct', '空字符串 -> direct');
assert(getStrategyFromRemark(null) === 'direct', 'null -> direct');
assert(getStrategyFromRemark(undefined) === 'direct', 'undefined -> direct');

// 测试 parseNodeLink - Reality 模式
console.log('\n=== 测试 parseNodeLink (Reality 模式) ===');
const vlessReality = 'vless://3210bf88-5a18-4114-b521-22c49748023b@hk01.bidding.dpdns.org:14386?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=A3l0DQSQNFeInDCy9tePrgqrzDyfOyUo8qktD2ranCE&sid=cf&spx=%2F&type=tcp&headerType=none#%E7%9B%B4%E8%BF%9E-arqqnxuy';
const parsed1 = parseNodeLink(vlessReality);
assert(parsed1 !== null, '解析 Reality 链接成功');
assert(parsed1.protocol === 'vless', '协议: vless');
assert(parsed1.uuid === '3210bf88-5a18-4114-b521-22c49748023b', 'UUID 正确');
assert(parsed1.address === 'hk01.bidding.dpdns.org', '地址正确');
assert(parsed1.port === 14386, '端口正确');
assert(parsed1.params.security === 'reality', 'security 参数正确');
assert(parsed1.remark === '直连-arqqnxuy', '备注正确');

// 测试 parseNodeLink - WS 模式
console.log('\n=== 测试 parseNodeLink (WS 模式) ===');
const vlessWs = 'vless://cadff911-3f77-429d-858a-25e8970b7d70@104.17.160.0:80?encryption=none&security=none&type=ws&host=chus00.bidding.dpdns.org&path=%2Fz2vvhqxhdxgkdmz4#US-00-testus000';
const parsed2 = parseNodeLink(vlessWs);
assert(parsed2 !== null, '解析 WS 链接成功');
assert(parsed2.protocol === 'vless', '协议: vless');
assert(parsed2.uuid === 'cadff911-3f77-429d-858a-25e8970b7d70', 'UUID 正确');
assert(parsed2.address === '104.17.160.0', '地址正确');
assert(parsed2.port === 80, '端口正确');
assert(parsed2.params.host === 'chus00.bidding.dpdns.org', 'host 参数正确');
assert(parsed2.params.path === '/z2vvhqxhdxgkdmz4', 'path 参数正确');
assert(parsed2.remark === 'US-00-testus000', '备注正确');

// 测试 buildNodeLink
console.log('\n=== 测试 buildNodeLink ===');
const rebuiltLink = buildNodeLink(parsed1);
assert(rebuiltLink === vlessReality, '重建 Reality 链接与原始链接匹配');

const rebuiltLink2 = buildNodeLink(parsed2);
assert(rebuiltLink2 === vlessWs, '重建 WS 链接与原始链接匹配');

// 测试 applyCfStrategy - WS 模式
console.log('\n=== 测试 applyCfStrategy (WS 模式) ===');
const cfConfig = {
  cfIp: '104.16.132.229',
  clientPort: 443,
  host: 'cf.example.com'
};
const cfResult = applyCfStrategy(vlessWs, cfConfig);
const cfParsed = parseNodeLink(cfResult);
assert(cfParsed.address === '104.16.132.229', 'CF 策略：地址替换正确');
assert(cfParsed.port === 443, 'CF 策略：端口替换正确');
assert(cfParsed.params.host === 'cf.example.com', 'CF 策略：host 替换正确');
assert(cfParsed.uuid === parsed2.uuid, 'CF 策略：UUID 保持不变');
assert(cfParsed.params.path === parsed2.params.path, 'CF 策略：path 保持不变');

// 测试 applyCfStrategy - Reality 模式
console.log('\n=== 测试 applyCfStrategy (Reality 模式) ===');
const cfResult2 = applyCfStrategy(vlessReality, cfConfig);
const cfParsed2 = parseNodeLink(cfResult2);
assert(cfParsed2.address === '104.16.132.229', 'CF 策略 Reality：地址替换正确');
assert(cfParsed2.port === 443, 'CF 策略 Reality：端口替换正确');
assert(cfParsed2.params.sni === parsed1.params.sni, 'CF 策略 Reality：sni 保持不变');

// 测试 applyDirectStrategy
console.log('\n=== 测试 applyDirectStrategy ===');
const directResult = applyDirectStrategy(vlessWs);
assert(directResult === vlessWs, 'Direct 策略：完全不修改');

// 测试 processNodeLink
console.log('\n=== 测试 processNodeLink ===');
const processResult1 = processNodeLink(vlessWs, 'cf', cfConfig);
assert(processResult1 === cfResult, 'processNodeLink cf 策略正确');

const processResult2 = processNodeLink(vlessWs, 'direct');
assert(processResult2 === vlessWs, 'processNodeLink direct 策略正确');

const processResult3 = processNodeLink(vlessWs, 'cf', null);
assert(processResult3 === vlessWs, 'processNodeLink cf 策略但无配置时返回原始链接');

// 汇总
console.log('\n=== 测试汇总 ===');
console.log(`通过: ${passed}, 失败: ${failed}`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('所有测试通过！');
}

/**
 * 用户端 CF 优选服务测试。
 * 验证候选数量以及 IPv6 的固定抽取和不足池处理规则。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const cfOptimizeService = require('../services/user/cf-optimize-service');
const cfOptimizeRepository = require('../repositories/cf-optimize-repository');

/**
 * 使用指定 IP 池调用 CF 候选查询，并在结束后恢复仓储方法。
 *
 * @param {Array<Object>} ipPool - 测试使用的已启用 CF IP 池
 * @returns {Promise<Object>} CF 候选查询结果
 */
async function getCfIpsFromPool(ipPool) {
  const originalListEnabledCfIps = cfOptimizeRepository.listEnabledCfIps;
  const originalListCurrentUserCfIps = cfOptimizeRepository.listCurrentUserCfIps;

  cfOptimizeRepository.listEnabledCfIps = async () => ipPool;
  cfOptimizeRepository.listCurrentUserCfIps = async () => [];

  try {
    return await cfOptimizeService.getCfIps({}, {
      id: 1,
      email: 'cf-test@example.com'
    });
  } finally {
    cfOptimizeRepository.listEnabledCfIps = originalListEnabledCfIps;
    cfOptimizeRepository.listCurrentUserCfIps = originalListCurrentUserCfIps;
  }
}

test('CF IP 池充足时返回 50 个候选且固定包含 3 个 IPv6', async () => {
  const ipv4Pool = Array.from({ length: 60 }, (_, index) => ({
    id: index + 1,
    ip: `192.0.2.${index + 1}`
  }));
  const ipv6Pool = Array.from({ length: 5 }, (_, index) => ({
    id: index + 101,
    ip: `2001:db8::${index + 1}`
  }));

  const result = await getCfIpsFromPool([...ipv4Pool, ...ipv6Pool]);
  const selectedIpv6 = result.ips.filter(item => item.ip.includes(':'));

  assert.equal(result.ips.length, 50);
  assert.equal(selectedIpv6.length, 3);
  assert.equal(new Set(result.ips.map(item => item.id)).size, 50);
});

test('IPv6 池不足 3 个时返回全部 IPv6 且候选不重复', async () => {
  const ipv4Pool = Array.from({ length: 60 }, (_, index) => ({
    id: index + 1,
    ip: `198.51.100.${index + 1}`
  }));
  const ipv6Pool = [
    { id: 201, ip: '2001:db8:1::1' },
    { id: 202, ip: '2001:db8:1::2' }
  ];

  const result = await getCfIpsFromPool([...ipv4Pool, ...ipv6Pool]);
  const selectedIpv6 = result.ips.filter(item => item.ip.includes(':'));

  assert.equal(result.ips.length, 50);
  assert.deepEqual(
    new Set(selectedIpv6.map(item => item.id)),
    new Set(ipv6Pool.map(item => item.id))
  );
  assert.equal(new Set(result.ips.map(item => item.id)).size, result.ips.length);
});

test('总可选池不足 50 个时返回全部候选且不重复', async () => {
  const ipv4Pool = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    ip: `203.0.113.${index + 1}`
  }));
  const ipv6Pool = [
    { id: 301, ip: '2001:db8:2::1' },
    { id: 302, ip: '2001:db8:2::2' }
  ];
  const ipPool = [...ipv4Pool, ...ipv6Pool];

  const result = await getCfIpsFromPool(ipPool);

  assert.equal(result.ips.length, 8);
  assert.deepEqual(
    new Set(result.ips.map(item => item.id)),
    new Set(ipPool.map(item => item.id))
  );
  assert.equal(new Set(result.ips.map(item => item.id)).size, result.ips.length);
});

test('IPv4 不足但 IPv6 充足时固定只返回 3 个 IPv6 且候选不重复', async () => {
  const ipv4Pool = [
    { id: 401, ip: '192.0.2.201' },
    { id: 402, ip: '192.0.2.202' }
  ];
  const ipv6Pool = Array.from({ length: 60 }, (_, index) => ({
    id: index + 501,
    ip: `2001:db8:3::${index + 1}`
  }));

  const result = await getCfIpsFromPool([...ipv4Pool, ...ipv6Pool]);
  const selectedIpv4 = result.ips.filter(item => !item.ip.includes(':'));
  const selectedIpv6 = result.ips.filter(item => item.ip.includes(':'));

  assert.equal(result.ips.length, 5);
  assert.equal(selectedIpv4.length, 2);
  assert.equal(selectedIpv6.length, 3);
  assert.equal(new Set(result.ips.map(item => item.id)).size, result.ips.length);
});

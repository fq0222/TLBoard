/**
 * CF IP 候选抽样回归测试。
 * 验证用户端每次获取的候选池固定由 19 个 IPv4 和 1 个 IPv6 组成。
 */

const assert = require('assert');
const cfOptimizeRepository = require('../repositories/cf-optimize-repository');
const cfOptimizeService = require('../services/user/cf-optimize-service');

/**
 * 构造指定协议族数量的候选 IP。
 * @param {number} ipv4Count - IPv4 数量。
 * @param {number} ipv6Count - IPv6 数量。
 * @returns {Array<Object>} 可供仓储返回的 IP 记录。
 */
function createIpPool(ipv4Count, ipv6Count) {
  const ipv4 = Array.from({ length: ipv4Count }, (_, index) => ({
    id: index + 1,
    ip: `104.16.${Math.floor(index / 256)}.${index % 256}`
  }));
  const ipv6 = Array.from({ length: ipv6Count }, (_, index) => ({
    id: ipv4Count + index + 1,
    ip: `2606:4700::${index + 1}`
  }));
  return [...ipv4, ...ipv6];
}

async function testCandidateFamilyCounts() {
  const originals = {
    listEnabledCfIps: cfOptimizeRepository.listEnabledCfIps,
    listCurrentUserCfIps: cfOptimizeRepository.listCurrentUserCfIps
  };

  try {
    cfOptimizeRepository.listEnabledCfIps = async () => createIpPool(40, 5);
    cfOptimizeRepository.listCurrentUserCfIps = async () => [];

    const result = await cfOptimizeService.getCfIps({}, {
      id: 1,
      email: 'candidate-test@example.com'
    });
    const ipv4Count = result.ips.filter(item => !item.ip.includes(':')).length;
    const ipv6Count = result.ips.filter(item => item.ip.includes(':')).length;

    assert.strictEqual(result.ips.length, 20);
    assert.strictEqual(ipv4Count, 19);
    assert.strictEqual(ipv6Count, 1);
  } finally {
    cfOptimizeRepository.listEnabledCfIps = originals.listEnabledCfIps;
    cfOptimizeRepository.listCurrentUserCfIps = originals.listCurrentUserCfIps;
  }
}

testCandidateFamilyCounts()
  .then(() => {
    console.log('✓ CF IP 候选池固定返回 19 个 IPv4 和 1 个 IPv6');
  })
  .catch((error) => {
    console.error('✗ CF IP 候选抽样测试失败:', error);
    process.exitCode = 1;
  });

/**
 * 用户私有 CF IP 槽位替换测试。
 * 验证用户可以将指定 1~5 槽位替换为私有 IPv4/IPv6，且后端会拒绝非法槽位和非法 IP。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const cfOptimizeService = require('../services/user/cf-optimize-service');
const cfOptimizeRepository = require('../repositories/cf-optimize-repository');

test('用户可以将指定槽位替换为私有 IP', async () => {
  const originalReplace = cfOptimizeRepository.replaceUserCfIpSlotWithCustomIp;
  const calls = [];

  cfOptimizeRepository.replaceUserCfIpSlotWithCustomIp = async (db, userId, slotIndex, ip) => {
    calls.push({ db, userId, slotIndex, ip });
    return {
      id: 1,
      user_id: userId,
      ip_pool_id: null,
      custom_ip: ip,
      source: 'custom',
      slot_index: slotIndex,
      ip
    };
  };

  try {
    const db = {};
    const result = await cfOptimizeService.replaceCfIpSlotByAddress(
      db,
      { id: 77, email: 'private-cf-ip@example.com' },
      '3',
      '2001:db8::1'
    );

    assert.deepEqual(calls, [{
      db,
      userId: 77,
      slotIndex: 3,
      ip: '2001:db8::1'
    }]);
    assert.equal(result.source, 'custom');
    assert.equal(result.slot_index, 3);
    assert.equal(result.ip, '2001:db8::1');
  } finally {
    cfOptimizeRepository.replaceUserCfIpSlotWithCustomIp = originalReplace;
  }
});

test('私有 IP 替换只允许 1 到 5 号槽位', async () => {
  await assert.rejects(
    () => cfOptimizeService.replaceCfIpSlotByAddress(
      {},
      { id: 77, email: 'private-cf-ip@example.com' },
      6,
      '1.1.1.1'
    ),
    /槽位序号必须在 1 到 5 之间/
  );
});

test('私有 IP 替换会拒绝非法 IP 地址', async () => {
  await assert.rejects(
    () => cfOptimizeService.replaceCfIpSlotByAddress(
      {},
      { id: 77, email: 'private-cf-ip@example.com' },
      1,
      'not-an-ip'
    ),
    /请输入合法的 IPv4 或 IPv6 地址/
  );
});

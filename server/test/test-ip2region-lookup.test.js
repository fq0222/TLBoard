const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT_PATH = path.join(__dirname, 'test-ip2region-lookup.js');

/**
 * 运行 IP2Region 命令行脚本。
 *
 * @param {string[]} args - 传给脚本的命令行参数
 * @returns {import('node:child_process').SpawnSyncReturns<string>} 子进程结果
 */
function runLookup(args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: 'utf8'
  });
}

test('IPv4 查询输出项目使用的归属地 JSON 结构', (t) => {
  const dbPath = path.join(__dirname, '..', 'ipData', 'ip2region_v4.xdb');
  if (!fs.existsSync(dbPath)) {
    t.skip(`本机未安装 IP2Region IPv4 数据库: ${dbPath}`);
    return;
  }
  const result = runLookup(['113.118.113.77']);

  assert.equal(result.status, 0, result.stderr);
  const location = JSON.parse(result.stdout);
  assert.deepEqual({
    ip: location.ip,
    country: location.country,
    province: location.province,
    city: location.city,
    district: location.district,
    isp: location.isp
  }, {
    ip: '113.118.113.77',
    country: '中国',
    province: '广东省',
    city: '深圳市',
    district: '',
    isp: '电信'
  });
  assert.equal(Number.isInteger(location.updated_at), true);
});

test('IPv6 查询会选择 IPv6 数据库并返回同一 JSON 结构', (t) => {
  const dbPath = path.join(__dirname, '..', 'ipData', 'ip2region_v6.xdb');
  if (!fs.existsSync(dbPath)) {
    t.skip(`本机未安装 IP2Region IPv6 数据库: ${dbPath}`);
    return;
  }
  const result = runLookup(['240e:3b7:3272:d8d0:db09:c067:8d59:539e']);

  assert.equal(result.status, 0, result.stderr);
  const location = JSON.parse(result.stdout);
  assert.deepEqual({
    ip: location.ip,
    country: location.country,
    province: location.province,
    city: location.city,
    district: location.district,
    isp: location.isp
  }, {
    ip: '240e:3b7:3272:d8d0:db09:c067:8d59:539e',
    country: '中国',
    province: '广东省',
    city: '深圳市',
    district: '',
    isp: '电信'
  });
  assert.equal(Number.isInteger(location.updated_at), true);
});

test('非法 IP 返回非零退出码且不产生伪归属地结果', () => {
  const result = runLookup(['not-an-ip']);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /无效的 IP 地址/);
});

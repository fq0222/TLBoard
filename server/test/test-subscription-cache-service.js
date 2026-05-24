const assert = require('assert');
const cacheService = require('../services/subscription-cache-service');

function makeNode(overrides = {}) {
  return {
    server_id: 1,
    inbound_id: 10,
    remark: ' hk-cf ',
    protocol: 'vless',
    port: 443,
    settings: JSON.stringify({
      clients: [
        { email: 'a@test.com', id: 'u1' }
      ],
      extra: { level: 1, enabled: true }
    }),
    stream_settings: JSON.stringify({
      security: 'tls',
      network: 'ws'
    }),
    ...overrides
  };
}

function makeServer(overrides = {}) {
  return {
    id: 1,
    sub_url: ' https://demo/sub/ ',
    host: ' demo.com ',
    client_port: 8443,
    ...overrides
  };
}

function testStableJsonKeepsEquivalentJsonStable() {
  const left = cacheService.stableJson('{"b":2,"a":{"d":4,"c":3}}');
  const right = cacheService.stableJson('{"a":{"c":3,"d":4},"b":2}');

  assert.strictEqual(left, right, '等价 JSON 应生成稳定且一致的序列化结果');
}

function testNodeFingerprintStable() {
  const first = cacheService.computeNodeFingerprint(makeNode());
  const second = cacheService.computeNodeFingerprint(makeNode({
    settings: '{"extra":{"enabled":true,"level":1},"clients":[{"id":"u1","email":"a@test.com"}]}',
    stream_settings: '{"network":"ws","security":"tls"}'
  }));

  assert.strictEqual(first, second, '相同节点数据即使 JSON 键顺序不同也应生成相同指纹');
}

function testFingerprintChangesWhenProtocolChanges() {
  const first = cacheService.computeNodeFingerprint(makeNode());
  const second = cacheService.computeNodeFingerprint(makeNode({ protocol: 'trojan' }));

  assert.notStrictEqual(first, second, '协议变更后节点指纹应变化');
}

function testCacheUsableWhenAllFingerprintsMatch() {
  const node = makeNode();
  const server = makeServer();
  const source = {
    user_id: 1,
    server_id: 1,
    inbound_id: 10,
    sub_id: 'abcdef1234567890',
    node_fingerprint: cacheService.computeNodeFingerprint(node),
    server_fingerprint: cacheService.computeServerFingerprint(server),
    fetched_at: 1710000000
  };

  const result = cacheService.isSourceCacheUsable({
    source,
    node,
    server,
    subId: 'abcdef1234567890',
    now: 1710000300,
    maxAgeSeconds: 86400
  });

  assert.deepStrictEqual(result, { usable: true, reason: 'ok' });
}

function testCacheInvalidWhenSubIdChanges() {
  const node = makeNode();
  const server = makeServer();
  const source = {
    user_id: 1,
    server_id: 1,
    inbound_id: 10,
    sub_id: 'oldsubid12345678',
    node_fingerprint: cacheService.computeNodeFingerprint(node),
    server_fingerprint: cacheService.computeServerFingerprint(server),
    fetched_at: 1710000000
  };

  const result = cacheService.isSourceCacheUsable({
    source,
    node,
    server,
    subId: 'newsubid12345678',
    now: 1710000300,
    maxAgeSeconds: 86400
  });

  assert.strictEqual(result.usable, false);
  assert.strictEqual(result.reason, 'sub_id_mismatch');
}

function run() {
  testStableJsonKeepsEquivalentJsonStable();
  testNodeFingerprintStable();
  testFingerprintChangesWhenProtocolChanges();
  testCacheUsableWhenAllFingerprintsMatch();
  testCacheInvalidWhenSubIdChanges();
  console.log('subscription cache service tests passed');
}

run();

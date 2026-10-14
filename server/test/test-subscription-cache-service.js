const assert = require('assert');
const cacheService = require('../services/shared/subscription-cache-service');

function makeNode(overrides = {}) {
  return {
    server_id: 1,
    inbound_id: 10,
    remark: ' hk-cf ',
    protocol: 'vless',
    port: 443,
    sub_id: 'abcdef1234567890',
    uuid: '00000000-0000-0000-0000-000000000001',
    auth: '',
    password: '',
    flow: 'xtls-rprx-vision',
    settings: JSON.stringify({
      clients: [
        {
          email: 'a@test.com',
          id: '00000000-0000-0000-0000-000000000001',
          subId: 'abcdef1234567890',
          flow: 'xtls-rprx-vision'
        }
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

function testFingerprintsUseV2Prefix() {
  assert.match(cacheService.computeNodeFingerprint(makeNode()), /^v2:[0-9a-f]{64}$/);
  assert.match(cacheService.computeServerFingerprint(makeServer()), /^v2:[0-9a-f]{64}$/);
}

function testOtherClientsDoNotChangeNodeFingerprint() {
  const first = cacheService.computeNodeFingerprint(makeNode());
  const second = cacheService.computeNodeFingerprint(makeNode({
    settings: JSON.stringify({
      clients: [
        { email: 'other@test.com', id: 'other-user' },
        {
          email: 'a@test.com',
          id: '00000000-0000-0000-0000-000000000001',
          subId: 'abcdef1234567890',
          flow: 'xtls-rprx-vision'
        }
      ]
    })
  }));

  assert.strictEqual(first, second, '其他客户端变化不应使当前用户节点指纹失效');
}

function testCurrentCredentialsChangeNodeFingerprint() {
  const original = cacheService.computeNodeFingerprint(makeNode());
  for (const overrides of [
    { sub_id: 'changed-sub-id' },
    { uuid: '00000000-0000-0000-0000-000000000002' },
    { auth: 'changed-auth' },
    { password: 'changed-password' }
  ]) {
    assert.notStrictEqual(
      original,
      cacheService.computeNodeFingerprint(makeNode(overrides)),
      `当前用户凭据变化应改变节点指纹: ${Object.keys(overrides)[0]}`
    );
  }
}

function testCurrentClientFlowChangeInvalidatesNodeFingerprint() {
  const first = cacheService.computeNodeFingerprint(makeNode());
  const second = cacheService.computeNodeFingerprint(makeNode({
    settings: JSON.stringify({
      clients: [{
        email: 'a@test.com',
        id: '00000000-0000-0000-0000-000000000001',
        subId: 'abcdef1234567890',
        flow: ''
      }]
    })
  }));

  assert.notStrictEqual(first, second, '当前客户端 flow 变化应改变节点指纹');
}

function testLegacyFingerprintIsRejectedByVersion() {
  const node = makeNode();
  const server = makeServer();
  const result = cacheService.isSourceCacheUsable({
    source: {
      sub_id: node.sub_id,
      node_fingerprint: 'a'.repeat(64),
      server_fingerprint: cacheService.computeServerFingerprint(server),
      fetched_at: 1
    },
    node,
    server,
    subId: node.sub_id,
    now: 999999,
    maxAgeSeconds: 86400,
    silent: true
  });

  assert.deepStrictEqual(result, { usable: false, reason: 'fingerprint_version_mismatch' });
}

function testOldFetchedAtDoesNotExpireMatchingCache() {
  const node = makeNode();
  const server = makeServer();
  const result = cacheService.isSourceCacheUsable({
    source: {
      sub_id: node.sub_id,
      node_fingerprint: cacheService.computeNodeFingerprint(node),
      server_fingerprint: cacheService.computeServerFingerprint(server),
      fetched_at: 1
    },
    node,
    server,
    subId: node.sub_id,
    now: 999999,
    maxAgeSeconds: 86400,
    silent: true
  });

  assert.deepStrictEqual(result, { usable: true, reason: 'ok' });
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
    settings: '{"extra":{"enabled":true,"level":1},"clients":[{"flow":"xtls-rprx-vision","subId":"abcdef1234567890","id":"00000000-0000-0000-0000-000000000001","email":"a@test.com"}]}',
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
  testFingerprintsUseV2Prefix();
  testOtherClientsDoNotChangeNodeFingerprint();
  testCurrentCredentialsChangeNodeFingerprint();
  testCurrentClientFlowChangeInvalidatesNodeFingerprint();
  testLegacyFingerprintIsRejectedByVersion();
  testOldFetchedAtDoesNotExpireMatchingCache();
  testStableJsonKeepsEquivalentJsonStable();
  testNodeFingerprintStable();
  testFingerprintChangesWhenProtocolChanges();
  testCacheUsableWhenAllFingerprintsMatch();
  testCacheInvalidWhenSubIdChanges();
  console.log('subscription cache service tests passed');
}

run();


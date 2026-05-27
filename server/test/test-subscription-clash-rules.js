const assert = require('assert');
const subscriptionRouter = require('../routes/user/subscription');

function assertOk(condition, message) {
  assert.strictEqual(Boolean(condition), true, message);
  console.log(`✓ ${message}`);
}

function main() {
  const nodes = [
    {
      node_name: '测试-direct',
      link: 'vless://cdd9305a-5fed-489e-901f-5461f25f3744@us00.bidding.dpdns.org:47504?security=reality&type=tcp&flow=xtls-rprx-vision&sni=www.microsoft.com&fp=chrome&pbk=gyFHpKM27_GMs34XBXGP8S78mc5UsNTyDpjOMMrMXGc&sid=e03f63a90d4483#测试-direct'
    }
  ];

  const clashConfig = subscriptionRouter.generateClashConfig(nodes, {});

  assertOk(
    clashConfig.includes('  - GEOIP,lan,DIRECT,no-resolve') &&
      clashConfig.includes('  - GEOSITE,cn,DIRECT') &&
      clashConfig.includes('  - DOMAIN-SUFFIX,cn,DIRECT') &&
      clashConfig.includes('  - GEOIP,CN,DIRECT') &&
      clashConfig.includes('  - MATCH,Proxy'),
    'Clash 订阅会生成大陆直连规则'
  );

  const rulesBlock = clashConfig.slice(clashConfig.indexOf('rules:'));
  const expectedOrder = [
    '  - GEOIP,lan,DIRECT,no-resolve',
    '  - GEOSITE,cn,DIRECT',
    '  - DOMAIN-SUFFIX,cn,DIRECT',
    '  - GEOIP,CN,DIRECT',
    '  - MATCH,Proxy'
  ];
  let lastIndex = -1;
  for (const rule of expectedOrder) {
    const currentIndex = rulesBlock.indexOf(rule);
    assertOk(currentIndex > lastIndex, `规则顺序正确: ${rule}`);
    lastIndex = currentIndex;
  }
}

try {
  main();
  console.log('\n=== 测试通过 ===');
} catch (error) {
  console.error('\n测试失败:', error.message);
  console.error(error.stack);
  process.exitCode = 1;
}

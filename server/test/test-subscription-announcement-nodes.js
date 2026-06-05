const assert = require('assert');
const {
  buildAnnouncementVirtualNodes,
  appendAnnouncementVirtualNodes,
  generateV2RayConfig,
  generateClashConfig
} = require('../services/user/subscription-service');

function testBuildAnnouncementVirtualNodesUsesOnlyTitle() {
  const nodes = buildAnnouncementVirtualNodes([
    {
      id: 1,
      title: 'System Notice',
      content: 'Body text must not enter node name',
      node_show: 1
    },
    {
      id: 2,
      title: '   ',
      content: 'Blank title must not create virtual node',
      node_show: 1
    }
  ]);

  assert.strictEqual(nodes.length, 1, 'only announcements with a valid title should create virtual nodes');
  assert.strictEqual(nodes[0].node_name, 'System Notice');
  assert.strictEqual(nodes[0].server_name, '\u7cfb\u7edf\u516c\u544a');
  assert.strictEqual(nodes[0].is_announcement, true);
  assert.ok(nodes[0].link.includes('#System%20Notice'));
  assert.ok(!nodes[0].link.includes('Body text'));
}

function testV2RayConfigIncludesAnnouncementNodeTitle() {
  const nodes = buildAnnouncementVirtualNodes([
    { id: 1, title: 'Node Notice', content: 'Hidden body', node_show: 1 }
  ]);
  const content = generateV2RayConfig(nodes);

  assert.ok(content.includes('#Node%20Notice'));
  assert.ok(!content.includes('Hidden body'));
}

function testClashConfigIncludesAnnouncementProxyTitle() {
  const nodes = buildAnnouncementVirtualNodes([
    { id: 1, title: 'Clash Notice', content: 'Hidden body', node_show: 1 }
  ]);
  const content = generateClashConfig(nodes);

  assert.ok(content.includes('  - name: Clash Notice'));
  assert.ok(content.includes('      - Clash Notice'));
  assert.ok(!content.includes('Hidden body'));
}

async function testAppendAnnouncementNodesUsesNodeShowRepositoryContract() {
  const db = {};
  const nodes = await appendAnnouncementVirtualNodes(db, [
    { node_name: 'Real Node', link: 'vless://real-node' }
  ]);

  assert.strictEqual(nodes.length, 2);
  assert.strictEqual(nodes[0].node_name, 'Repository Notice');
  assert.strictEqual(nodes[1].node_name, 'Real Node');
}

async function run() {
  testBuildAnnouncementVirtualNodesUsesOnlyTitle();
  testV2RayConfigIncludesAnnouncementNodeTitle();
  testClashConfigIncludesAnnouncementProxyTitle();
  await testAppendAnnouncementNodesUsesNodeShowRepositoryContract();
  console.log('subscription announcement node tests passed');
}

const subscriptionRepository = require('../repositories/subscription-repository');
subscriptionRepository.listNodeShowAnnouncements = async () => [
  {
    id: 1,
    title: 'Repository Notice',
    content: 'Hidden body',
    enabled: 0,
    node_show: 1
  }
];

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

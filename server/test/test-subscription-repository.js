const test = require('node:test');
const assert = require('node:assert/strict');

const subscriptionRepository = require('../repositories/subscription-repository');

test('subscription repository listOnlineServers returns panel_version for XUI api selection', async () => {
  let capturedSql = '';
  const fakeRows = [
    {
      id: 1,
      name: 'jp01',
      api_url: 'https://jp01.example.com',
      api_token: 'token',
      host: 'jp01.example.com',
      client_port: 443,
      sub_url: 'https://jp01.example.com/sub/',
      panel_version: '3.2.5'
    }
  ];

  const fakeDb = {
    prepare(sql) {
      capturedSql = sql;
      return {
        all() {
          return fakeRows;
        }
      };
    }
  };

  const result = await subscriptionRepository.listOnlineServers(fakeDb);

  assert.ok(
    capturedSql.includes('panel_version'),
    '查询在线服务器时应包含 panel_version，避免生成订阅时回退到默认 3.0.2'
  );
  assert.equal(result[0].panel_version, '3.2.5');
});

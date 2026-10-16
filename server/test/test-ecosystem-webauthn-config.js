/**
 * 验证 PM2 两种环境的 WebAuthn 默认地址。
 * 参数：无；分别检查 env 和 env_production，任一配置不符即失败。
 */
const assert = require('node:assert/strict');
const ecosystem = require('../ecosystem.config');

for (const environment of ['env', 'env_production']) {
  const config = ecosystem.apps[0][environment];
  assert.ok(config, `缺少 ${environment} 配置`);
  assert.equal(config.WEBAUTHN_RP_ID, 'localhost', `${environment} 的 RP ID 应为 localhost`);
  assert.equal(config.WEBAUTHN_ORIGIN, 'http://localhost:5173', `${environment} 的 Origin 应为本地 Vite 地址`);
}

console.log('PASS PM2 两种环境的 WebAuthn 默认地址');

const assert = require('assert');
const { test } = require('node:test');

const {
  parseArgs,
  calculateTargetExpireAt
} = require('./set-user-expired');

test('set-user-expired parses after-minutes as future expiry mode', () => {
  const options = parseArgs(['--email', 'yueka02@qq.com', '--after-minutes', '3']);

  assert.equal(options.email, 'yueka02@qq.com');
  assert.equal(options.afterMinutes, 3);
  assert.equal(options.days, null);
});

test('set-user-expired calculates future expiry from after-minutes', () => {
  const target = calculateTargetExpireAt(1000, {
    afterMinutes: 3,
    days: null
  });

  assert.equal(target, 1180);
});

import assert from 'node:assert';
import { test } from 'node:test';
import { shouldSuppressGlobalErrorMessage } from '../src/api/index.js';

test('renew confirmation conflicts suppress global error toast', () => {
  assert.equal(shouldSuppressGlobalErrorMessage(409, { code: 4091 }), true);
  assert.equal(shouldSuppressGlobalErrorMessage(409, { code: 4092 }), true);
  assert.equal(shouldSuppressGlobalErrorMessage(409, { code: 1001 }), false);
});

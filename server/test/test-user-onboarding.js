/**
 * 用户新手引导状态测试。
 * 通过替换仓储方法验证 service 契约，避免连接真实数据库。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const authService = require('../services/user/auth-service');
const userRepository = require('../repositories/user-repository');

/**
 * 临时替换对象方法，并在测试完成后恢复。
 *
 * @param {Object} target - 被替换对象
 * @param {Object} replacements - 方法替换表
 * @returns {Function} 恢复函数
 */
function replaceMethods(target, replacements) {
  const originals = {};
  Object.keys(replacements).forEach((key) => {
    originals[key] = target[key];
    target[key] = replacements[key];
  });

  return () => {
    Object.keys(originals).forEach((key) => {
      if (originals[key] === undefined) {
        delete target[key];
      } else {
        target[key] = originals[key];
      }
    });
  };
}

test('user profile exposes onboarding completed as boolean', async () => {
  const restoreRepository = replaceMethods(userRepository, {
    findUserProfileById: async () => ({
      id: 7,
      email: 'new-user@example.com',
      plan_id: 2,
      plan_name: '入门套餐',
      sub_id: 'abcdef1234567890',
      traffic_used: 0,
      traffic_limit: 1024,
      expire_at: 0,
      enabled: 1,
      created_at: 1710000000,
      payment_count: 1,
      sync_status: 2,
      onboarding_completed: 1
    }),
    hasUserCfIps: async () => false,
    hasUserSubscriptionCache: async () => false
  });

  try {
    const profile = await authService.getProfile({}, 7);
    assert.equal(profile.onboarding_completed, true);
  } finally {
    restoreRepository();
  }
});

test('complete user onboarding updates current user only', async () => {
  let completedUserId = null;
  const restoreRepository = replaceMethods(userRepository, {
    markUserOnboardingCompleted: async (db, userId) => {
      completedUserId = userId;
    }
  });

  try {
    const result = await authService.completeOnboarding({}, 9);
    assert.equal(completedUserId, 9);
    assert.deepEqual(result, { onboarding_completed: true });
  } finally {
    restoreRepository();
  }
});

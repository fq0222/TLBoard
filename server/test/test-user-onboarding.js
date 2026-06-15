/**
 * 用户新手引导状态测试。
 * 通过替换仓储方法验证 service 契约，避免连接真实数据库。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const authService = require('../services/user/auth-service');
const usersService = require('../services/admin/users-service');
const userRepository = require('../repositories/user-repository');
const { DISABLE_REASONS } = require('../services/shared/renew-policy');

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

/**
 * 创建管理端用户列表测试数据库桩。
 * 职责：只模拟 countUsers/listUsers 需要的查询，捕获列表 SQL 以验证字段选择。
 *
 * @param {Array<Object>} rows - listUsers 查询应返回的用户行
 * @returns {{db:Object,getListSql:Function}} 数据库桩和 SQL 读取器
 */
function createListUsersDb(rows) {
  let listSql = '';

  return {
    db: {
      prepare(sql) {
        if (sql.includes('COUNT(*)')) {
          return {
            get() {
              return { total: rows.length };
            }
          };
        }

        listSql = sql;
        return {
          all() {
            return rows;
          }
        };
      }
    },
    getListSql() {
      return listSql;
    }
  };
}

test('admin user list marks traffic limited disabled account as renew status', async () => {
  const { db, getListSql } = createListUsersDb([
    {
      id: 1,
      email: 'active@example.com',
      plan_id: 1,
      plan_name: '基础套餐',
      traffic_used: 0,
      traffic_limit: 1024,
      expire_at: 0,
      enabled: 1,
      disable_reason: null,
      created_at: 1
    },
    {
      id: 2,
      email: 'admin-disabled@example.com',
      plan_id: 1,
      plan_name: '基础套餐',
      traffic_used: 0,
      traffic_limit: 1024,
      expire_at: 0,
      enabled: 0,
      disable_reason: DISABLE_REASONS.ADMIN,
      created_at: 2
    },
    {
      id: 3,
      email: 'traffic-limited@example.com',
      plan_id: 1,
      plan_name: '基础套餐',
      traffic_used: 2048,
      traffic_limit: 1024,
      expire_at: 0,
      enabled: 0,
      disable_reason: DISABLE_REASONS.TRAFFIC_LIMIT,
      created_at: 3
    },
    {
      id: 4,
      email: 'expired-disabled@example.com',
      plan_id: 1,
      plan_name: '月卡',
      traffic_used: 0,
      traffic_limit: 1024,
      expire_at: 1700000000,
      enabled: 0,
      disable_reason: DISABLE_REASONS.EXPIRED,
      created_at: 4
    }
  ]);

  const result = await usersService.listUsers(db, { page: 1, limit: 15 });
  const statuses = result.list.map(user => ({
    email: user.email,
    status: user.status,
    status_text: user.status_text
  }));

  assert.match(getListSql(), /u\.disable_reason/);
  assert.deepEqual(statuses, [
    { email: 'active@example.com', status: 'active', status_text: '正常' },
    { email: 'admin-disabled@example.com', status: 'disabled', status_text: '禁用' },
    { email: 'traffic-limited@example.com', status: 'renew', status_text: '续费' },
    { email: 'expired-disabled@example.com', status: 'renew', status_text: '续费' }
  ]);
});

test('admin user update preserves disable reason when enabled value is unchanged', async () => {
  const originalUser = {
    id: 10,
    email: 'traffic-limited@example.com',
    plan_id: 1,
    plan_name: '基础套餐',
    traffic_used: 2048,
    traffic_limit: 1024,
    expire_at: 0,
    enabled: 0,
    disable_reason: DISABLE_REASONS.TRAFFIC_LIMIT,
    created_at: 1
  };
  const updatedUser = {
    ...originalUser,
    traffic_limit: 4096
  };
  const updateCalls = [];
  let detailCallCount = 0;

  const restoreRepository = replaceMethods(userRepository, {
    findUserDetailById: async () => {
      detailCallCount += 1;
      return detailCallCount === 1 ? originalUser : updatedUser;
    },
    updateUserFields: async (db, userId, updates, values) => {
      updateCalls.push({ userId, updates, values });
    },
    listOnlineXuiServersForSync: async () => []
  });

  try {
    await usersService.updateUser({}, 10, {
      enabled: false,
      traffic_limit: 4096
    });

    assert.equal(updateCalls.length, 1);
    assert.deepEqual(updateCalls[0].updates, [
      'traffic_limit = ?',
      'updated_at = ?'
    ]);
    assert.equal(updateCalls[0].values[0], 4096);
  } finally {
    restoreRepository();
  }
});

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
    hasUserSubscriptionCache: async () => false,
    findSystemSettingByKey: async () => null
  });

  try {
    const profile = await authService.getProfile({}, 7);
    assert.equal(profile.onboarding_completed, true);
  } finally {
    restoreRepository();
  }
});

test('user profile marks traffic limited disabled account as renew status', async () => {
  const restoreRepository = replaceMethods(userRepository, {
    findUserProfileById: async () => ({
      id: 8,
      email: 'traffic-limited@example.com',
      plan_id: 2,
      plan_name: '入门套餐',
      sub_id: 'abcdef1234567891',
      traffic_used: 2048,
      traffic_limit: 1024,
      referral_traffic_limit: 0,
      expire_at: 0,
      enabled: 0,
      disable_reason: 'traffic_limit',
      created_at: 1710000000,
      payment_count: 1,
      sync_status: 2,
      onboarding_completed: 0
    }),
    hasUserCfIps: async () => false,
    hasUserSubscriptionCache: async () => false,
    findSystemSettingByKey: async () => null
  });

  try {
    const profile = await authService.getProfile({}, 8);
    assert.equal(profile.status, 'renew');
    assert.equal(profile.status_text, '续费');
    assert.equal(profile.disable_reason, 'traffic_limit');
  } finally {
    restoreRepository();
  }
});

test('user profile marks expired disabled account as renew status', async () => {
  const restoreRepository = replaceMethods(userRepository, {
    findUserProfileById: async () => ({
      id: 10,
      email: 'expired@example.com',
      plan_id: 2,
      plan_name: '月卡',
      plan_type: 'timed',
      sub_id: 'abcdef1234567892',
      traffic_used: 1024,
      traffic_limit: 4096,
      referral_traffic_limit: 0,
      expire_at: 1710000000,
      enabled: 0,
      disable_reason: 'expired',
      created_at: 1700000000,
      payment_count: 1,
      sync_status: 2,
      onboarding_completed: 0
    }),
    hasUserCfIps: async () => false,
    hasUserSubscriptionCache: async () => false,
    findSystemSettingByKey: async () => null
  });

  try {
    const profile = await authService.getProfile({}, 10);
    assert.equal(profile.status, 'renew');
    assert.equal(profile.status_text, '续费');
    assert.equal(profile.disable_reason, 'expired');
  } finally {
    restoreRepository();
  }
});

test('user profile marks enabled expired timed account as renew status before disable job runs', async () => {
  const originalNow = Date.now;
  const restoreRepository = replaceMethods(userRepository, {
    findUserProfileById: async () => ({
      id: 11,
      email: 'enabled-expired@example.com',
      plan_id: 2,
      plan_name: '月卡',
      plan_type: 'timed',
      sub_id: 'abcdef1234567893',
      traffic_used: 1024,
      traffic_limit: 4096,
      referral_traffic_limit: 0,
      expire_at: 1700000000,
      enabled: 1,
      disable_reason: null,
      created_at: 1699000000,
      payment_count: 1,
      sync_status: 2,
      onboarding_completed: 0
    }),
    hasUserCfIps: async () => false,
    hasUserSubscriptionCache: async () => false,
    findSystemSettingByKey: async () => null
  });

  try {
    Date.now = () => 1700000001000;
    const profile = await authService.getProfile({}, 11);
    assert.equal(profile.status, 'renew');
    assert.equal(profile.status_text, '续费');
    assert.equal(profile.disable_reason, 'expired');
  } finally {
    Date.now = originalNow;
    restoreRepository();
  }
});

test('user profile repository selects disable reason for status display', async () => {
  let profileSql = '';
  const db = {
    prepare(sql) {
      profileSql = sql;
      return {
        get() {
          return null;
        }
      };
    }
  };

  await userRepository.findUserProfileById(db, 8);
  assert.match(profileSql, /u\.disable_reason/);
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

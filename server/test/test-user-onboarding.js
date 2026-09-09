/**
 * 用户新手引导状态测试。
 * 通过替换仓储方法验证 service 契约，避免连接真实数据库。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const authService = require('../services/user/auth-service');
const usersService = require('../services/admin/users-service');
const userRepository = require('../repositories/user-repository');
const homeRoutingService = require('../services/shared/home-routing-service');
const { DISABLE_REASONS } = require('../services/shared/renew-policy');

const authControllerSource = fs.readFileSync(
  path.join(__dirname, '../controllers/user/auth-controller.js'),
  'utf8'
);

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

test('admin user list sorts traffic used before pagination when requested', async () => {
  const { db, getListSql } = createListUsersDb([
    {
      id: 1,
      email: 'high@example.com',
      plan_id: 1,
      plan_name: '基础套餐',
      traffic_used: 2048,
      traffic_limit: 4096,
      expire_at: 0,
      enabled: 1,
      disable_reason: null,
      created_at: 1
    }
  ]);

  await usersService.listUsers(db, {
    page: 2,
    limit: 15,
    sort_by: 'traffic_used',
    sort_order: 'desc'
  });

  assert.match(getListSql(), /ORDER BY COALESCE\(u\.traffic_used, 0\) DESC, u\.created_at DESC\s+LIMIT \? OFFSET \?/);
});

test('admin user list returns formatted ip location text', async () => {
  const { db, getListSql } = createListUsersDb([
    {
      id: 1,
      email: 'located@example.com',
      plan_id: 1,
      plan_name: '基础套餐',
      traffic_used: 0,
      traffic_limit: 1024,
      expire_at: 0,
      enabled: 1,
      disable_reason: null,
      ip_location: JSON.stringify({
        login: {
          province: '广东省',
          city: '广州市',
          district: '天河区'
        }
      }),
      created_at: 1
    },
    {
      id: 2,
      email: 'unknown@example.com',
      plan_id: 1,
      plan_name: '基础套餐',
      traffic_used: 0,
      traffic_limit: 1024,
      expire_at: 0,
      enabled: 1,
      disable_reason: null,
      ip_location: '{}',
      created_at: 2
    }
  ]);

  const result = await usersService.listUsers(db, { page: 1, limit: 15 });

  assert.match(getListSql(), /u\.ip_location/);
  assert.equal(result.list[0].ip_location_text, '广东省 广州市 天河区');
  assert.equal(result.list[1].ip_location_text, '暂未获取');
});

test('admin user list returns home ip plan and expire fields', async () => {
  const { db, getListSql } = createListUsersDb([
    {
      id: 5,
      email: 'home-user@example.com',
      plan_id: 1,
      plan_name: '流量月卡',
      home_plan_id: 9,
      home_plan_name: '家宽月卡',
      home_expire_at: 1900000000,
      traffic_used: 0,
      traffic_limit: 1024,
      expire_at: 1800000000,
      enabled: 1,
      disable_reason: null,
      ip_location: '{}',
      created_at: 5
    }
  ]);

  const result = await usersService.listUsers(db, { page: 1, limit: 15 });

  assert.match(getListSql(), /u\.home_plan_id/);
  assert.match(getListSql(), /u\.home_expire_at/);
  assert.match(getListSql(), /hp\.name as home_plan_name/);
  assert.equal(result.list[0].home_plan_id, 9);
  assert.equal(result.list[0].home_plan_name, '家宽月卡');
  assert.equal(result.list[0].home_expire_at, 1900000000);
  assert.equal(result.list[0].home_expire_text, '2030/3/18 01:46:40');
});

test('admin user update preserves disable reason when enabled value is unchanged and updates traffic used', async () => {
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
    traffic_used: 3072,
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
      traffic_used: 3072,
      traffic_limit: 4096
    });

    assert.equal(updateCalls.length, 1);
    assert.deepEqual(updateCalls[0].updates, [
      'traffic_used = ?',
      'traffic_limit = ?',
      'updated_at = ?'
    ]);
    assert.equal(updateCalls[0].values[0], 3072);
    assert.equal(updateCalls[0].values[1], 4096);
  } finally {
    restoreRepository();
  }
});

test('admin user delete clears local related records in one transaction', async () => {
  const originalUser = {
    id: 12,
    email: 'delete-me@example.com'
  };
  const calls = [];
  let transactionStarted = false;

  const db = {
    transaction(fn) {
      return async () => {
        transactionStarted = true;
        return fn({
          prepare(sql) {
            return {
              async run(...params) {
                calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
                return { changes: 1 };
              }
            };
          }
        });
      };
    }
  };

  const restoreRepository = replaceMethods(userRepository, {
    findUserDetailById: async () => originalUser
  });

  try {
    const result = await usersService.deleteUserLocalData(db, 12);

    assert.equal(transactionStarted, true);
    assert.equal(result.email, originalUser.email);
    assert.ok(calls[0].sql.includes('DELETE FROM referral_rewards'));
    assert.ok(calls.some(call => call.sql.includes('DELETE FROM traffic_sync_log')));
    assert.ok(calls.some(call => call.sql.includes('DELETE FROM ticket_replies')));
    assert.ok(calls.some(call => call.sql.includes('DELETE FROM email_logs')));
    assert.ok(calls.some(call => call.sql.includes('UPDATE orders SET referrer_user_id = NULL')));
    assert.ok(calls.some(call => call.sql.includes('DELETE FROM orders WHERE user_id = ? OR email = ?')));
    assert.ok(calls[calls.length - 1].sql.includes('DELETE FROM users'));
    assert.deepEqual(calls[calls.length - 1].params, [12]);
  } finally {
    restoreRepository();
  }
});

test('admin user delete returns legacy error when user is missing', async () => {
  const restoreRepository = replaceMethods(userRepository, {
    findUserDetailById: async () => null
  });

  try {
    await assert.rejects(
      () => usersService.deleteUserLocalData({}, 404),
      (error) => error.isLegacyBusinessError && error.code === 2004
    );
  } finally {
    restoreRepository();
  }
});

test('admin home routing actions update expire time and reuse shared service with cooldown skipped', async () => {
  const calls = [];
  const restoreRepository = replaceMethods(userRepository, {
    updateUserHomeExpireAt: async (db, userId, homeExpireAt) => {
      calls.push({ method: 'updateExpire', db, userId, homeExpireAt });
    }
  });
  const restoreHomeRouting = replaceMethods(homeRoutingService, {
    getHomeRoutingOptions: async (db, userId) => {
      calls.push({ method: 'get', db, userId });
      return { available: true };
    },
    updateHomeRouting: async (db, userId, payload, logger, options) => {
      calls.push({ method: 'update', db, userId, payload, options });
      return { route: { server_ids: payload.server_ids } };
    },
    deleteHomeRouting: async (db, userId, logger, options) => {
      calls.push({ method: 'delete', db, userId, options });
      return { route: null };
    }
  });

  try {
    const db = { marker: 'admin-db' };
    await usersService.getHomeRoutingOptions(db, 42);
    await usersService.updateHomeRouting(db, 42, { server_ids: [1, 2], home_expire_at: 1900000000 });
    await usersService.deleteHomeRouting(db, 42);

    assert.deepEqual(calls, [
      { method: 'get', db, userId: 42 },
      { method: 'updateExpire', db, userId: 42, homeExpireAt: 1900000000 },
      { method: 'update', db, userId: 42, payload: { server_ids: [1, 2], home_expire_at: 1900000000 }, options: { skipCooldown: true } },
      { method: 'delete', db, userId: 42, options: { skipCooldown: true } }
    ]);
  } finally {
    restoreHomeRouting();
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

test('user profile exposes plan price and duration days for homepage plan card', async () => {
  const restoreRepository = replaceMethods(userRepository, {
    findUserProfileById: async () => ({
      id: 12,
      email: 'duration@example.com',
      plan_id: 2,
      plan_name: '月卡',
      plan_type: null,
      plan_duration_days: 30,
      plan_price: 1000,
      home_plan_id: 3,
      home_plan_name: '家宽月卡',
      home_plan_duration_days: 30,
      home_plan_price: 2000,
      home_expire_at: 1900000000,
      sub_id: 'abcdef1234567894',
      traffic_used: 1024,
      traffic_limit: 4096,
      referral_traffic_limit: 0,
      expire_at: 1900000000,
      enabled: 1,
      disable_reason: null,
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
    const profile = await authService.getProfile({}, 12);
    assert.equal(profile.plan_type, 'lifetime');
    assert.equal(profile.plan_duration_days, 30);
    assert.equal(profile.plan_price, 1000);
    assert.equal(profile.plan_price_text, '10.00');
    assert.equal(profile.home_plan_duration_days, 30);
    assert.equal(profile.home_plan_price, 2000);
    assert.equal(profile.home_plan_price_text, '20.00');
  } finally {
    restoreRepository();
  }
});

test('user profile repository selects plan price and duration days', async () => {
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

  await userRepository.findUserProfileById(db, 12);
  assert.match(profileSql, /p\.duration_days as plan_duration_days/);
  assert.match(profileSql, /p\.price as plan_price/);
  assert.match(profileSql, /hp\.duration_days as home_plan_duration_days/);
  assert.match(profileSql, /hp\.price as home_plan_price/);
});

test('user profile controller returns plan price and duration days to client', () => {
  assert.match(authControllerSource, /plan_type:\s*profile\.plan_type/);
  assert.match(authControllerSource, /plan_duration_days:\s*profile\.plan_duration_days/);
  assert.match(authControllerSource, /plan_price:\s*profile\.plan_price/);
  assert.match(authControllerSource, /plan_price_text:\s*profile\.plan_price_text/);
  assert.match(authControllerSource, /home_plan_duration_days:\s*profile\.home_plan_duration_days/);
  assert.match(authControllerSource, /home_plan_price:\s*profile\.home_plan_price/);
  assert.match(authControllerSource, /home_plan_price_text:\s*profile\.home_plan_price_text/);
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

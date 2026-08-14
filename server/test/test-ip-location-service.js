const test = require('node:test');
const assert = require('node:assert/strict');

const ipLocationService = require('../services/shared/ip-location-service');
const userRepository = require('../repositories/user-repository');
const authController = require('../controllers/user/auth-controller');
const authService = require('../services/user/auth-service');

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
      target[key] = originals[key];
    });
  };
}

/**
 * 构造只覆盖 getProfile 所需字段的响应对象。
 * 职责：让 controller 测试不依赖真实 Express 服务；json 分支记录响应体供断言使用。
 * @returns {{res:Object,state:Object}} 模拟响应与可断言状态
 */
function createMockResponse() {
  const state = {
    statusCode: 200,
    body: null
  };

  return {
    state,
    res: {
      status(code) {
        state.statusCode = code;
        return this;
      },
      json(body) {
        state.body = body;
        return this;
      }
    }
  };
}

test('formatIpLocationText prefers login location and joins province city district', () => {
  const text = ipLocationService.formatIpLocationText(JSON.stringify({
    login: {
      province: '广东省',
      city: '广州市',
      district: '天河区',
      isp: '移动'
    },
    subscription: {
      province: '河南省',
      city: '郑州市',
      district: ''
    }
  }));

  assert.equal(text, '广东省 广州市 天河区 [移动]');
});

test('formatIpLocationText falls back to subscription then default text', () => {
  assert.equal(ipLocationService.formatIpLocationText(JSON.stringify({
    subscription: {
      province: '河南省',
      city: '郑州市',
      district: '',
      isp: '联通'
    }
  })), '河南省 郑州市 [联通]');

  assert.equal(ipLocationService.formatIpLocationText('{}'), '暂未获取');
  assert.equal(ipLocationService.formatIpLocationText('not-json'), '暂未获取');
});

test('isMainlandChinaLocation rejects overseas and Hong Kong Macau Taiwan', () => {
  assert.equal(ipLocationService.isMainlandChinaLocation({
    country: '中国',
    province: '河南省'
  }), true);

  assert.equal(ipLocationService.isMainlandChinaLocation({
    country: '美国',
    province: '加利福尼亚'
  }), false);

  assert.equal(ipLocationService.isMainlandChinaLocation({
    country: '中国',
    province: '香港'
  }), false);
});

test('shouldSkipIp skips IPv6 because current xdb lookup only accepts IPv4', () => {
  assert.equal(
    ipLocationService.shouldSkipIp('2409:8931:a91:1598:41a8:2084:ab64:7a63'),
    true
  );
});

test('recordUserIpLocation skips non-mainland lookup result', async () => {
  const calls = [];
  const restore = replaceMethods(userRepository, {
    async updateUserIpLocation() {
      calls.push('update');
    }
  });

  try {
    const result = await ipLocationService.recordUserIpLocation({}, 1, 'login', '8.8.8.8', {
      lookupIpLocation: async () => ({
        ip: '8.8.8.8',
        country: '美国',
        province: '加利福尼亚',
        city: '',
        district: '',
        isp: '',
        updated_at: 1
      })
    });

    assert.deepEqual(result, { recorded: false, reason: 'non_mainland' });
    assert.deepEqual(calls, []);
  } finally {
    restore();
  }
});

test('recordUserIpLocation skips mainland result without province city or district', async () => {
  const calls = [];
  const restore = replaceMethods(userRepository, {
    async updateUserIpLocation() {
      calls.push('update');
    }
  });

  try {
    const result = await ipLocationService.recordUserIpLocation({}, 1, 'login', '39.144.238.254', {
      lookupIpLocation: async () => ({
        ip: '39.144.238.254',
        country: '中国',
        province: '',
        city: '',
        district: '',
        isp: '移动',
        updated_at: 1
      })
    });

    assert.deepEqual(result, { recorded: false, reason: 'empty_display_location' });
    assert.deepEqual(calls, []);
  } finally {
    restore();
  }
});

test('recordUserIpLocation writes mainland lookup result', async () => {
  const calls = [];
  const restore = replaceMethods(userRepository, {
    async updateUserIpLocation(db, userId, source, location) {
      calls.push({ db, userId, source, location });
    }
  });
  const db = { name: 'fake-db' };

  try {
    const result = await ipLocationService.recordUserIpLocation(db, 7, 'subscription', '39.144.238.254', {
      lookupIpLocation: async () => ({
        ip: '39.144.238.254',
        country: '中国',
        province: '河南省',
        city: '郑州市',
        district: '',
        isp: '中国移动',
        updated_at: 1
      })
    });

    assert.deepEqual(result, { recorded: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].db, db);
    assert.equal(calls[0].userId, 7);
    assert.equal(calls[0].source, 'subscription');
    assert.equal(calls[0].location.city, '郑州市');
  } finally {
    restore();
  }
});

test('updateUserIpLocation preserves existing source and recovers invalid json', async () => {
  const updates = [];
  const db = {
    prepare(sql) {
      if (sql.includes('SELECT ip_location')) {
        return {
          get(userId) {
            assert.equal(userId, 9);
            return { ip_location: 'not-json' };
          }
        };
      }

      if (sql.includes('UPDATE users SET ip_location')) {
        return {
          run(ipLocation, userId) {
            updates.push({ ipLocation, userId });
          }
        };
      }

      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await userRepository.updateUserIpLocation(db, 9, 'login', {
    ip: '39.144.238.254',
    country: '中国',
    province: '河南省',
    city: '郑州市',
    district: '',
    isp: '中国移动',
    updated_at: 1
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].userId, 9);
  assert.deepEqual(JSON.parse(updates[0].ipLocation), {
    login: {
      ip: '39.144.238.254',
      country: '中国',
      province: '河南省',
      city: '郑州市',
      district: '',
      isp: '中国移动',
      updated_at: 1
    }
  });
});

test('profile records current IP as login location source', async () => {
  const calls = [];
  const restoreAuth = replaceMethods(authService, {
    async getProfile() {
      return {
        id: 7,
        email: 'user@example.com',
        plan_id: 1,
        plan_name: '月付套餐',
        sub_id: 'abc123',
        cf_optimized: false,
        subscription_ready: false,
        telegram_channel_url: '',
        traffic_used: 0,
        plan_traffic_limit: 0,
        plan_traffic_limit_text: '0 B',
        referral_traffic_limit: 0,
        referral_traffic_limit_text: '0 B',
        total_traffic_limit: 0,
        total_traffic_limit_text: '0 B',
        traffic_limit: 0,
        traffic_used_text: '0 B',
        traffic_limit_text: '0 B',
        traffic_percent: 0,
        balance: 0,
        balance_text: '0.00 元',
        expire_at: 0,
        expire_text: '无限期',
        enabled: 1,
        disable_reason: null,
        status: 'active',
        status_text: '正常',
        created_at: 1,
        payment_count: 0,
        sync_status: 'synced',
        onboarding_completed: true
      };
    }
  });
  const restoreIpLocation = replaceMethods(ipLocationService, {
    async recordUserIpLocation(db, userId, source, rawIp) {
      calls.push({ db, userId, source, rawIp });
    }
  });

  try {
    const { res, state } = createMockResponse();
    const db = { name: 'fake-db' };
    await authController.getProfile({
      app: { locals: { db } },
      user: { id: 7, email: 'user@example.com' },
      ip: '112.39.113.195',
      socket: { remoteAddress: '10.0.0.2' },
      protocol: 'http',
      get() { return 'example.com'; }
    }, res);

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.statusCode, 200);
    assert.equal(state.body.code, 0);
    assert.deepEqual(calls, [{
      db,
      userId: 7,
      source: 'login',
      rawIp: '112.39.113.195'
    }]);
  } finally {
    restoreAuth();
    restoreIpLocation();
  }
});

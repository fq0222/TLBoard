const test = require('node:test');
const assert = require('node:assert/strict');

const ipLocationService = require('../services/shared/ip-location-service');
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
      target[key] = originals[key];
    });
  };
}

test('formatIpLocationText prefers login location and joins province city district', () => {
  const text = ipLocationService.formatIpLocationText(JSON.stringify({
    login: {
      province: '广东省',
      city: '广州市',
      district: '天河区'
    },
    subscription: {
      province: '河南省',
      city: '郑州市',
      district: ''
    }
  }));

  assert.equal(text, '广东省 广州市 天河区');
});

test('formatIpLocationText falls back to subscription then default text', () => {
  assert.equal(ipLocationService.formatIpLocationText(JSON.stringify({
    subscription: {
      province: '河南省',
      city: '郑州市',
      district: ''
    }
  })), '河南省 郑州市');

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

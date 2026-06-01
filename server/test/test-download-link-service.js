const assert = require('assert');
const {
  getOrCreateDownloadLink,
  listDownloadResources
} = require('../services/shared/download-link-service');

function createStatementMock(db, sql) {
  return {
    async all(...params) {
      db.calls.push({ method: 'all', sql, params });

      if (sql.includes('FROM resources') && sql.includes('is_download_resource = 1')) {
        const now = params[0];
        return (db.resources || [])
          .filter(resource => resource.enabled === 1)
          .filter(resource => resource.is_download_resource === 1)
          .filter(resource => !resource.expire_at || resource.expire_at > now)
          .sort((a, b) => (a.download_category || '').localeCompare(b.download_category || '') || b.created_at - a.created_at);
      }

      if (sql.includes('FROM resource_distributions')) {
        const distributions = db.distributions || (db.distribution ? [db.distribution] : []);
        return distributions.map(distribution => ({
          resource_enabled: db.resource.enabled,
          resource_name: db.resource.name,
          ...distribution
        }));
      }

      return [];
    },
    async get(...params) {
      db.calls.push({ method: 'get', sql, params });

      if (sql.includes('FROM resources') && sql.includes('WHERE id = ?')) {
        const [resourceId, now] = params;
        return (db.resources || [db.resource])
          .filter(resource => Number(resource.id) === Number(resourceId))
          .filter(resource => resource.enabled === 1)
          .filter(resource => resource.is_download_resource === 1)
          .filter(resource => !resource.expire_at || resource.expire_at > now)[0] || null;
      }

      if (sql.includes('FROM resources')) {
        return db.resource || null;
      }

      if (sql.includes("key = 'resource_config'")) {
        return db.resourceConfig ? { value: JSON.stringify(db.resourceConfig) } : null;
      }

      return null;
    },
    async run(...params) {
      db.calls.push({ method: 'run', sql, params });

      if (sql.includes('INSERT INTO resource_distributions')) {
        db.distribution = {
          id: db.nextDistributionId,
          resource_id: params[0],
          user_id: params[1],
          download_token: params[2],
          expire_at: params[3],
          enabled: 1,
          resource_name: db.resource.name
        };
        return { lastInsertRowid: db.nextDistributionId };
      }

      if (sql.includes('UPDATE resource_distributions')) {
        db.distribution = {
          ...db.distribution,
          resource_id: params[0],
          download_token: params[1],
          expire_at: params[2],
          enabled: 1,
          download_count: 0
        };
        return { changes: 1 };
      }

      if (sql.includes('DELETE FROM resource_distributions')) {
        db.deletedDistributionIds = params[0];
        return { changes: params[0].length };
      }

      return { changes: 0 };
    }
  };
}

function createDb(overrides = {}) {
  const db = {
    calls: [],
    nextDistributionId: 99,
    resourceConfig: { default_expire_minutes: 60 },
    resource: {
      id: 7,
      name: 'Android-App 下载包',
      enabled: 1,
      is_download_resource: 1,
      download_category: 'Android'
    },
    resources: null,
    distribution: null,
    distributions: null,
    deletedDistributionIds: [],
    ...overrides
  };

  db.prepare = (sql) => createStatementMock(db, sql);
  return db;
}

async function testCreateWhenMissing() {
  const db = createDb();

  const result = await getOrCreateDownloadLink({
    db,
    resourceId: 7,
    userId: 12,
    now: 1000,
    siteBaseUrl: 'https://example.com',
    tokenFactory: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  });

  assert.strictEqual(result.download_url, 'https://example.com/api/user/download/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.strictEqual(result.expire_at, 4600);
  assert.strictEqual(result.resource_name, 'Android-App 下载包');
  assert.strictEqual(result.action, 'created');
  assert(db.calls.some(call => call.method === 'run' && call.sql.includes('INSERT INTO resource_distributions')));
}

async function testResetWhenExpired() {
  const db = createDb({
    distribution: {
      id: 4,
      resource_id: 7,
      user_id: 12,
      download_token: 'oldoldoldoldoldoldoldoldoldoldoldold',
      expire_at: 900,
      enabled: 1,
      resource_name: 'Android-App 下载包'
    }
  });

  const result = await getOrCreateDownloadLink({
    db,
    resourceId: 7,
    userId: 12,
    now: 1000,
    siteBaseUrl: 'https://example.com',
    tokenFactory: () => 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  });

  assert.strictEqual(result.download_url, 'https://example.com/api/user/download/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.strictEqual(result.expire_at, 4600);
  assert.strictEqual(result.action, 'reset');
  assert(db.calls.some(call => call.method === 'run' && call.sql.includes('UPDATE resource_distributions')));
}

async function testReuseWhenStillValid() {
  const db = createDb({
    distribution: {
      id: 4,
      resource_id: 7,
      user_id: 12,
      download_token: 'cccccccccccccccccccccccccccccccc',
      expire_at: 5000,
      enabled: 1,
      resource_name: 'Android-App 下载包'
    }
  });

  const result = await getOrCreateDownloadLink({
    db,
    resourceId: 7,
    userId: 12,
    now: 1000,
    siteBaseUrl: 'https://example.com',
    tokenFactory: () => {
      throw new Error('valid distribution should not create a new token');
    }
  });

  assert.strictEqual(result.download_url, 'https://example.com/api/user/download/cccccccccccccccccccccccccccccccc');
  assert.strictEqual(result.expire_at, 5000);
  assert.strictEqual(result.action, 'reused');
  assert.strictEqual(result.removed_duplicates, 0);
  assert(!db.calls.some(call => call.method === 'run'));
}

async function testReuseRemovesDuplicateRecords() {
  const db = createDb({
    distributions: [
      {
        id: 5,
        resource_id: 7,
        user_id: 12,
        download_token: 'ffffffffffffffffffffffffffffffff',
        expire_at: 5000,
        enabled: 1,
        created_at: 200
      },
      {
        id: 4,
        resource_id: 7,
        user_id: 12,
        download_token: 'dddddddddddddddddddddddddddddddd',
        expire_at: 4000,
        enabled: 1,
        created_at: 100
      }
    ]
  });

  const result = await getOrCreateDownloadLink({
    db,
    resourceId: 7,
    userId: 12,
    now: 1000,
    siteBaseUrl: 'https://example.com',
    tokenFactory: () => {
      throw new Error('valid distribution should not create a new token');
    }
  });

  assert.strictEqual(result.download_url, 'https://example.com/api/user/download/ffffffffffffffffffffffffffffffff');
  assert.strictEqual(result.action, 'reused');
  assert.strictEqual(result.removed_duplicates, 1);
  assert.deepStrictEqual(db.deletedDistributionIds, [4]);
}

async function testResetWhenDisabled() {
  const db = createDb({
    distribution: {
      id: 4,
      resource_id: 7,
      user_id: 12,
      download_token: 'dddddddddddddddddddddddddddddddd',
      expire_at: 5000,
      enabled: 0,
      resource_name: 'Android-App 下载包'
    }
  });

  const result = await getOrCreateDownloadLink({
    db,
    resourceId: 7,
    userId: 12,
    now: 1000,
    siteBaseUrl: 'https://example.com',
    tokenFactory: () => 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  });

  assert.strictEqual(result.download_url, 'https://example.com/api/user/download/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
  assert.strictEqual(result.expire_at, 4600);
  assert.strictEqual(result.action, 'reset');
  assert(db.calls.some(call => call.method === 'run' && call.sql.includes('UPDATE resource_distributions')));
}

async function testRejectsUnmarkedDownloadResource() {
  const db = createDb({
    resources: [
      { id: 7, name: 'Android-App 下载包', enabled: 1, is_download_resource: 0, download_category: 'Android' }
    ]
  });

  await assert.rejects(
    getOrCreateDownloadLink({
      db,
      resourceId: 7,
      userId: 12,
      now: 1000,
      siteBaseUrl: 'https://example.com',
      tokenFactory: () => 'ffffffffffffffffffffffffffffffff'
    }),
    /暂无可用资源/
  );
}

async function testListDownloadResourcesByExplicitFlagAndCategory() {
  const db = createDb({
    resources: [
      { id: 1, name: 'Android 客户端', enabled: 1, is_download_resource: 1, download_category: 'Android', expire_at: null, size: 100, created_at: 20 },
      { id: 2, name: '内部文件', enabled: 1, is_download_resource: 0, download_category: 'Android', expire_at: null, size: 100, created_at: 30 },
      { id: 3, name: 'Windows 客户端', enabled: 1, is_download_resource: 1, download_category: 'Windows', expire_at: null, size: 100, created_at: 10 },
      { id: 4, name: '过期客户端', enabled: 1, is_download_resource: 1, download_category: 'Android', expire_at: 900, size: 100, created_at: 40 }
    ]
  });

  const resources = await listDownloadResources({
    db,
    now: 1000
  });

  assert.deepStrictEqual(resources, [
    { id: 1, name: 'Android 客户端', category: 'Android', size: 100 },
    { id: 3, name: 'Windows 客户端', category: 'Windows', size: 100 }
  ]);
}

async function main() {
  await testCreateWhenMissing();
  await testResetWhenExpired();
  await testReuseWhenStillValid();
  await testReuseRemovesDuplicateRecords();
  await testResetWhenDisabled();
  await testRejectsUnmarkedDownloadResource();
  await testListDownloadResourcesByExplicitFlagAndCategory();
  console.log('download link service tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

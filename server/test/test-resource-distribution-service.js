const assert = require('assert');
const { upsertUserDistribution } = require('../services/shared/resource-distribution-service');

function createDb(distributions = []) {
  const db = {
    calls: [],
    distributions: distributions.map(item => ({ ...item })),
    nextId: 100
  };

  db.prepare = (sql) => ({
    async all(...params) {
      db.calls.push({ method: 'all', sql, params });
      if (sql.includes('FROM resource_distributions')) {
        return db.distributions
          .filter(item => item.user_id === params[0])
          .sort((a, b) => (b.created_at - a.created_at) || (b.id - a.id));
      }
      return [];
    },
    async run(...params) {
      db.calls.push({ method: 'run', sql, params });

      if (sql.includes('DELETE FROM resource_distributions')) {
        const ids = params[0];
        db.distributions = db.distributions.filter(item => !ids.includes(item.id));
        return { changes: ids.length };
      }

      if (sql.includes('UPDATE resource_distributions')) {
        const [resourceId, token, expireAt, id] = params;
        db.distributions = db.distributions.map(item => item.id === id
          ? { ...item, resource_id: resourceId, download_token: token, expire_at: expireAt, enabled: 1, download_count: 0 }
          : item
        );
        return { changes: 1 };
      }

      if (sql.includes('INSERT INTO resource_distributions')) {
        const [resourceId, userId, token, expireAt] = params;
        db.distributions.push({
          id: db.nextId,
          resource_id: resourceId,
          user_id: userId,
          download_token: token,
          expire_at: expireAt,
          enabled: 1,
          download_count: 0,
          created_at: 1
        });
        return { lastInsertRowid: db.nextId };
      }

      return { changes: 0 };
    }
  });

  return db;
}

async function testUpdateByUserIdAndRemoveDuplicates() {
  const db = createDb([
    { id: 1, user_id: 9, resource_id: 3, download_token: 'old1', expire_at: 100, created_at: 10, enabled: 1 },
    { id: 2, user_id: 9, resource_id: 4, download_token: 'old2', expire_at: 200, created_at: 20, enabled: 1 }
  ]);

  const result = await upsertUserDistribution({
    db,
    resourceId: 8,
    userId: 9,
    expireAt: 999,
    tokenFactory: () => 'new-token'
  });

  assert.strictEqual(result.action, 'updated');
  assert.strictEqual(result.distribution_id, 2);
  assert.strictEqual(result.removed_duplicates, 1);
  assert.deepStrictEqual(db.distributions.map(item => item.id), [2]);
  assert.strictEqual(db.distributions[0].resource_id, 8);
  assert.strictEqual(db.distributions[0].download_token, 'new-token');
}

async function testCreateWhenUserHasNoDistribution() {
  const db = createDb([]);

  const result = await upsertUserDistribution({
    db,
    resourceId: 8,
    userId: 9,
    expireAt: 999,
    tokenFactory: () => 'created-token'
  });

  assert.strictEqual(result.action, 'created');
  assert.strictEqual(result.distribution_id, 100);
  assert.strictEqual(db.distributions.length, 1);
  assert.strictEqual(db.distributions[0].user_id, 9);
}

async function main() {
  await testUpdateByUserIdAndRemoveDuplicates();
  await testCreateWhenUserHasNoDistribution();
  console.log('resource distribution service tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});


const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { backupXuiDatabases, sanitizeFileName } = require('../jobs/backupDB');

function createDb(servers) {
  return {
    prepare(sql) {
      return {
        async all() {
          assert(sql.includes('FROM xui_servers'));
          return servers;
        }
      };
    }
  };
}

class FakeXuiApiClient {
  constructor(apiUrl, apiToken) {
    this.apiUrl = apiUrl;
    this.apiToken = apiToken;
    FakeXuiApiClient.instances.push(this);
  }

  async getDb() {
    return Buffer.from('SQLite format 3\0fake-db');
  }
}

FakeXuiApiClient.instances = [];

async function testBackupAllServersAndOverwriteByName() {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xui-db-backup-'));
  const existingPath = path.join(backupDir, 'serverA-x-ui.db');
  fs.writeFileSync(existingPath, 'old-content');

  const db = createDb([
    { id: 1, name: 'serverA', api_url: 'https://a.example.com', api_token: 'token-a', panel_version: '3.0.2' },
    { id: 2, name: 'server/B', api_url: 'https://b.example.com', api_token: 'token-b', panel_version: '3.2.5' },
    { id: 3, name: 'missing-token', api_url: 'https://c.example.com', api_token: '', panel_version: '3.0.2' }
  ]);

  const result = await backupXuiDatabases(db, {
    backupDir,
    XuiApiClientClass: FakeXuiApiClient
  });

  assert.strictEqual(result.total, 3);
  assert.strictEqual(result.success, 2);
  assert.strictEqual(result.skipped, 1);
  assert.strictEqual(FakeXuiApiClient.instances.length, 2);
  assert.strictEqual(FakeXuiApiClient.instances[0].apiToken, 'token-a');

  assert.strictEqual(fs.readFileSync(existingPath, 'utf8'), 'SQLite format 3\0fake-db');
  assert(fs.existsSync(path.join(backupDir, 'server_B-x-ui.db')));
}

async function testPreferMigrationBackupWhenSupported() {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xui-migration-backup-'));
  const calls = [];
  const db = createDb([
    { id: 1, name: 'legacy', api_url: 'https://legacy.example.com', api_token: 'token-a', panel_version: '3.3.1' },
    { id: 2, name: 'postgres', api_url: 'https://postgres.example.com', api_token: 'token-b', panel_version: '3.4.2' }
  ]);

  const result = await backupXuiDatabases(db, {
    backupDir,
    createClient(server) {
      if (server.panel_version === '3.4.2') {
        return {
          async getMigration() {
            calls.push(`${server.name}:getMigration`);
            return Buffer.from('SQLite format 3\0migration-db');
          },
          async getDb() {
            calls.push(`${server.name}:getDb`);
            return Buffer.from('SQLite format 3\0wrong-db');
          }
        };
      }

      return {
        async getDb() {
          calls.push(`${server.name}:getDb`);
          return Buffer.from('SQLite format 3\0legacy-db');
        }
      };
    }
  });

  assert.strictEqual(result.success, 2);
  assert.deepStrictEqual(calls, ['legacy:getDb', 'postgres:getMigration']);
}

function testSanitizeFileName() {
  assert.strictEqual(sanitizeFileName('测试:/\\*?"<>| server'), '测试_________ server');
  assert.strictEqual(sanitizeFileName(''), 'server');
}

async function main() {
  testSanitizeFileName();
  await testBackupAllServersAndOverwriteByName();
  await testPreferMigrationBackupWhenSupported();
  console.log('xui db backup job tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

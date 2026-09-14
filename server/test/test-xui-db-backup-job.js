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

async function testAlwaysUsesGetDbAndSavesPostgresDump() {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xui-native-backup-'));
  const calls = [];
  const db = createDb([
    { id: 1, name: 'postgres', api_url: 'https://postgres.example.com', api_token: 'token-b', panel_version: '3.4.2' }
  ]);

  const result = await backupXuiDatabases(db, {
    backupDir,
    createClient(server) {
      return {
        async getMigration() {
          calls.push(`${server.name}:getMigration`);
          throw new Error('定时备份不应调用迁移接口');
        },
        async getDb() {
          calls.push(`${server.name}:getDb`);
          return Buffer.from('PGDMP\x01\x0fpostgres-dump');
        }
      };
    }
  });

  const backupPath = path.join(backupDir, 'postgres-x-ui.dump');
  assert.strictEqual(result.success, 1);
  assert.deepStrictEqual(calls, ['postgres:getDb']);
  assert(fs.existsSync(backupPath));
  assert.strictEqual(fs.readFileSync(backupPath).subarray(0, 5).toString('ascii'), 'PGDMP');
  assert.strictEqual(result.results[0].format, 'postgres-custom');
  assert.strictEqual(result.results[0].validSqlite, false);
}

async function testRejectsInvalidBackupResponsesWithoutWritingFiles() {
  const fixtures = [
    { name: 'empty', data: Buffer.alloc(0), format: 'empty' },
    { name: 'null', data: null, format: 'empty' },
    { name: 'json', data: Buffer.from('{"success":false,"msg":"unauthorized"}'), format: 'json-response' },
    { name: 'html', data: Buffer.from('<!doctype html><html><body>Bad Gateway</body></html>'), format: 'html-response' },
    { name: 'unknown', data: Buffer.from([0x1f, 0x8b, 0x08, 0x00]), format: 'unknown' }
  ];

  for (const fixture of fixtures) {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), `xui-invalid-${fixture.name}-`));
    const warnings = [];
    const infos = [];
    const originalWarn = console.warn;
    const originalLog = console.log;
    console.warn = message => warnings.push(message);
    console.log = message => infos.push(message);

    try {
      const result = await backupXuiDatabases(createDb([
        { id: 1, name: fixture.name, api_url: 'https://invalid.example.com', api_token: 'token', panel_version: '3.4.2' }
      ]), {
        backupDir,
        createClient() {
          return { async getDb() { return fixture.data; } };
        }
      });

      assert.strictEqual(result.failed, 1);
      assert.strictEqual(result.results[0].format, fixture.format);
      const expectedSize = fixture.data ? fixture.data.length : 0;
      const expectedPrefixHex = fixture.data ? fixture.data.subarray(0, 16).toString('hex') : '';
      assert.strictEqual(result.results[0].size, expectedSize);
      assert.deepStrictEqual(fs.readdirSync(backupDir), []);
      assert(warnings.some(message => message.includes(`format=${fixture.format}`)));
      assert(warnings.some(message => message.includes(`size=${expectedSize}`)));
      assert(warnings.some(message => message.includes(`prefix_hex=${expectedPrefixHex}`)));
      assert(!infos.some(message => message.includes(`服务器 ${fixture.name} 数据库备份完成:`)));
    } finally {
      console.warn = originalWarn;
      console.log = originalLog;
    }
  }
}

function testSanitizeFileName() {
  assert.strictEqual(sanitizeFileName('测试:/\\*?"<>| server'), '测试_________ server');
  assert.strictEqual(sanitizeFileName(''), 'server');
}

async function main() {
  testSanitizeFileName();
  await testBackupAllServersAndOverwriteByName();
  await testAlwaysUsesGetDbAndSavesPostgresDump();
  await testRejectsInvalidBackupResponsesWithoutWritingFiles();
  console.log('xui db backup job tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

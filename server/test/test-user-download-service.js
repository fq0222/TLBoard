const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const downloadService = require('../services/user/download-service');

function createDownloadInfo(overrides = {}) {
  return {
    filePath: '',
    fileName: 'app.apk',
    fileSize: 100,
    fileMimetype: 'application/octet-stream',
    resourceName: 'Android App',
    resourceId: 2,
    speedLimit: 0,
    downloadCountTarget: {
      type: 'resource',
      id: 2
    },
    ...overrides
  };
}

function createCountDb() {
  const db = {
    distributionCount: 0,
    resourceCount: 0
  };

  db.prepare = (sql) => ({
    async run(id) {
      if (sql.includes('resource_distributions')) {
        db.distributionCount += 1;
        db.lastDistributionId = id;
      }

      if (sql.includes('UPDATE resources')) {
        db.resourceCount += 1;
        db.lastResourceId = id;
      }

      return { changes: 1 };
    }
  });

  return db;
}

function waitForClose(stream) {
  return new Promise((resolve, reject) => {
    stream.once('close', resolve);
    stream.once('error', reject);
  });
}

async function testBuildPartialDownloadResponse() {
  const response = downloadService.buildDownloadResponse(
    createDownloadInfo(),
    'bytes=10-19'
  );

  assert.strictEqual(response.statusCode, 206);
  assert.strictEqual(response.headers['Accept-Ranges'], 'bytes');
  assert.strictEqual(response.headers['Content-Range'], 'bytes 10-19/100');
  assert.strictEqual(response.headers['Content-Length'], 10);
  assert.deepStrictEqual(response.streamOptions, { start: 10, end: 19 });
  assert.strictEqual(response.isPartial, true);
  assert.strictEqual(response.shouldCountDownload, false);
}

async function testFirstRangeCountsAsOneDownload() {
  const response = downloadService.buildDownloadResponse(
    createDownloadInfo({ fileSize: 1024 * 1024 * 2 }),
    'bytes=0-1048575'
  );

  assert.strictEqual(response.statusCode, 206);
  assert.strictEqual(response.isPartial, true);
  assert.strictEqual(response.shouldCountDownload, true);
}

async function testIncrementPreparedDownloadCountUsesTarget() {
  const db = createCountDb();

  await downloadService.incrementPreparedDownloadCount(db, createDownloadInfo({
    downloadCountTarget: {
      type: 'distribution',
      id: 9
    }
  }));

  assert.strictEqual(db.distributionCount, 1);
  assert.strictEqual(db.resourceCount, 0);
  assert.strictEqual(db.lastDistributionId, 9);
}

async function testRejectUnsatisfiableRange() {
  assert.throws(
    () => downloadService.buildDownloadResponse(createDownloadInfo(), 'bytes=100-200'),
    error => error.statusCode === 416 && error.headers?.['Content-Range'] === 'bytes */100'
  );
}

async function testCleanupUnregistersThrottledStream() {
  const tempFile = path.join(os.tmpdir(), `download-service-${Date.now()}.bin`);
  fs.writeFileSync(tempFile, Buffer.alloc(1024));

  try {
    const result = downloadService.createDownloadStream(createDownloadInfo({
      filePath: tempFile,
      speedLimit: 1024
    }));

    assert.strictEqual(downloadService.getActiveDownloadStreamCount(), 1);
    result.cleanup();
    await waitForClose(result.stream);
    assert.strictEqual(downloadService.getActiveDownloadStreamCount(), 0);
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

async function main() {
  await testBuildPartialDownloadResponse();
  await testFirstRangeCountsAsOneDownload();
  await testIncrementPreparedDownloadCountUsesTarget();
  await testRejectUnsatisfiableRange();
  await testCleanupUnregistersThrottledStream();
  console.log('user download service tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

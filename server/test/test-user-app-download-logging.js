const assert = require('assert');
const { shouldSkipSuccessfulRangeDownloadLog } = require('../middleware/download-log-filter');

function createReq(overrides = {}) {
  return {
    method: 'GET',
    path: '/api/user/download/95e12191eb8c1c466b1e42194bf73726',
    headers: {
      range: 'bytes=1048576-2097151'
    },
    ...overrides
  };
}

function createRes(statusCode = 206) {
  return { statusCode };
}

function testSkipsSuccessfulRangeDownloadLog() {
  assert.strictEqual(
    shouldSkipSuccessfulRangeDownloadLog(createReq(), createRes(206)),
    true
  );
}

function testSkipsSuccessfulRangeDownloadLogByOriginalUrl() {
  assert.strictEqual(
    shouldSkipSuccessfulRangeDownloadLog(createReq({
      path: undefined,
      originalUrl: '/api/user/download/95e12191eb8c1c466b1e42194bf73726'
    }), createRes(206)),
    true
  );
}

function testKeepsFailedRangeDownloadLog() {
  assert.strictEqual(
    shouldSkipSuccessfulRangeDownloadLog(createReq(), createRes(404)),
    false
  );
}

function testKeepsNormalDownloadLog() {
  assert.strictEqual(
    shouldSkipSuccessfulRangeDownloadLog(createReq({ headers: {} }), createRes(200)),
    false
  );
}

function main() {
  testSkipsSuccessfulRangeDownloadLog();
  testSkipsSuccessfulRangeDownloadLogByOriginalUrl();
  testKeepsFailedRangeDownloadLog();
  testKeepsNormalDownloadLog();
  console.log('user app download logging tests passed');
}

main();

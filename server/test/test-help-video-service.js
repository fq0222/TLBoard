const assert = require('assert');
const path = require('path');
const helpVideoService = require('../services/user/help-video-service');

function assertOk(condition, message) {
  assert.strictEqual(Boolean(condition), true, message);
  console.log(`✓ ${message}`);
}

async function main() {
  console.log('=== 帮助中心视频服务测试 ===');

  const db = {
    prepare(sql) {
      return {
        get() {
          if (sql.includes("key = 'resource_config'")) {
            return undefined;
          }
          return undefined;
        }
      };
    }
  };

  const filePath = path.join(__dirname, '../uploads/blog-videos/test.mp4');
  const videoInfo = {
    filePath,
    filename: 'test.mp4',
    fileSize: 1024,
    mimetype: 'video/mp4'
  };

  const config = await helpVideoService.getBlogVideoConfig(db);
  assertOk(config.speedLimit === 300 * 1024, '博客视频默认全局限速为 300KB/s');

  const fullResponse = helpVideoService.buildVideoResponse(videoInfo);
  assertOk(fullResponse.statusCode === 200, '无 Range 请求返回 200');
  assertOk(fullResponse.headers['Content-Length'] === 1024, '完整视频响应包含总长度');
  assertOk(fullResponse.headers['Accept-Ranges'] === 'bytes', '视频响应声明支持 Range');

  const partialResponse = helpVideoService.buildVideoResponse(videoInfo, 'bytes=10-19');
  assertOk(partialResponse.statusCode === 206, '有效 Range 请求返回 206');
  assertOk(partialResponse.headers['Content-Length'] === 10, '分片响应长度正确');
  assertOk(partialResponse.headers['Content-Range'] === 'bytes 10-19/1024', '分片响应 Content-Range 正确');
  assertOk(partialResponse.streamOptions.start === 10 && partialResponse.streamOptions.end === 19, '分片读取范围正确');

  try {
    helpVideoService.buildVideoResponse(videoInfo, 'bytes=2048-4096');
    assert.fail('非法 Range 应抛出错误');
  } catch (error) {
    assertOk(error.statusCode === 416, '非法 Range 返回 416 业务错误');
    assertOk(error.headers['Content-Range'] === 'bytes */1024', '非法 Range 返回正确 Content-Range');
  }

  console.log('\n=== 测试通过 ===');
}

main().catch((error) => {
  console.error('\n测试失败:', error.message);
  console.error(error.stack);
  process.exitCode = 1;
});

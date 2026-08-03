const assert = require('assert');

const controllerPath = require.resolve('../controllers/user/help-controller');
const helpServicePath = require.resolve('../services/user/help-service');
const loggerPath = require.resolve('../utils/logger');

function rememberCache(paths) {
  return new Map(paths.map((modulePath) => [
    modulePath,
    {
      existed: Object.prototype.hasOwnProperty.call(require.cache, modulePath),
      value: require.cache[modulePath]
    }
  ]));
}

function restoreCache(cacheSnapshot) {
  for (const [modulePath, entry] of cacheSnapshot.entries()) {
    if (entry.existed) {
      require.cache[modulePath] = entry.value;
    } else {
      delete require.cache[modulePath];
    }
  }
}

function createJsonResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function main() {
  const cacheSnapshot = rememberCache([controllerPath, helpServicePath, loggerPath]);
  const logs = [];

  try {
    delete require.cache[controllerPath];
    require.cache[helpServicePath] = {
      id: helpServicePath,
      filename: helpServicePath,
      loaded: true,
      exports: {
        getHelpArticleById: async (_db, id) => ({
          id,
          title: 'Clash 客户端使用教程',
          content: 'content'
        })
      }
    };
    require.cache[loggerPath] = {
      id: loggerPath,
      filename: loggerPath,
      loaded: true,
      exports: {
        createLogger: () => ({
          info: (message) => logs.push(message),
          warn: () => {},
          error: () => {}
        })
      }
    };

    const controller = require(controllerPath);
    const req = {
      params: { id: '5' },
      user: { id: 12, email: 'user@example.com' },
      app: { locals: { db: {} } }
    };
    const res = createJsonResponse();

    await controller.getHelpArticleDetail(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(logs.some((message) => message.includes('用户访问帮助文章')));
    assert.ok(logs.some((message) => message.includes('articleTitle="Clash 客户端使用教程"')));
    assert.ok(logs.some((message) => message.includes('articleId=5')));
    assert.ok(logs.some((message) => message.includes('user=user@example.com')));

    console.log('✓ 用户访问帮助文章详情时会记录文章标题');
  } finally {
    restoreCache(cacheSnapshot);
  }
}

main().catch((error) => {
  console.error('\n测试失败:', error.message);
  console.error(error.stack);
  process.exitCode = 1;
});

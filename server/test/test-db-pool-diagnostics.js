const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  instrumentPoolConnectionDiagnostics,
  registerPoolErrorDiagnostics
} = require('../db/pool-diagnostics');

/**
 * 创建可控的连接池替身，用于验证连接获取失败与连接池错误的诊断日志。
 *
 * @param {Error} connectionError - connect 调用需要返回的错误
 * @returns {EventEmitter & Object} 带连接池计数器的测试替身
 */
function createFailingPool(connectionError) {
  const pool = new EventEmitter();
  pool.totalCount = 20;
  pool.idleCount = 0;
  pool.waitingCount = 6;
  pool.connect = callback => {
    if (typeof callback === 'function') {
      queueMicrotask(() => callback(connectionError));
      return undefined;
    }
    return Promise.reject(connectionError);
  };
  return pool;
}

test('连接池获取连接超时时记录 totalCount、idleCount 和 waitingCount', async () => {
  const messages = [];
  const pool = createFailingPool(new Error('timeout exceeded when trying to connect'));
  const logger = { error: message => messages.push(message) };

  instrumentPoolConnectionDiagnostics(pool, logger);

  await assert.rejects(() => pool.connect(), /timeout exceeded/);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /totalCount=20/);
  assert.match(messages[0], /idleCount=0/);
  assert.match(messages[0], /activeCount=20/);
  assert.match(messages[0], /waitingCount=6/);
});

test('回调方式获取连接失败时记录池状态并保留原错误', async () => {
  const messages = [];
  const connectionError = new Error('timeout exceeded when trying to connect');
  const pool = createFailingPool(connectionError);
  const logger = { error: message => messages.push(message) };

  instrumentPoolConnectionDiagnostics(pool, logger);

  const callbackError = await new Promise(resolve => {
    pool.connect(error => resolve(error));
  });
  assert.equal(callbackError, connectionError);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /totalCount=20, idleCount=0, activeCount=20, waitingCount=6/);
});

test('连接池自身错误事件记录当前连接池计数', () => {
  const messages = [];
  const pool = createFailingPool(new Error('unused'));
  const logger = { error: message => messages.push(message) };

  registerPoolErrorDiagnostics(pool, logger);
  pool.emit('error', new Error('connection terminated unexpectedly'));

  assert.equal(messages.length, 1);
  assert.match(messages[0], /连接池错误: connection terminated unexpectedly/);
  assert.match(messages[0], /totalCount=20/);
  assert.match(messages[0], /idleCount=0/);
  assert.match(messages[0], /activeCount=20/);
  assert.match(messages[0], /waitingCount=6/);
});

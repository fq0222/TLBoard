const test = require('node:test');
const assert = require('node:assert/strict');

const feedbackRepository = require('../repositories/feedback-repository');
const feedbackService = require('../services/shared/feedback-service');

/**
 * 临时替换留言板仓储方法，并在单个用例结束后恢复。
 * 职责：让 service 测试只验证业务规则，不依赖真实 PostgreSQL。
 * 关键参数：replacements 是需要替换的方法集合。
 * 核心分支语义：无论用例成功或失败，finally 都恢复原始方法，避免污染后续测试。
 *
 * @param {Object} replacements - 仓储方法替身集合
 * @param {Function} runTest - 测试主体
 * @returns {Promise<void>}
 */
async function withRepositoryMocks(replacements, runTest) {
  const originals = {};

  Object.keys(replacements).forEach((key) => {
    originals[key] = feedbackRepository[key];
    feedbackRepository[key] = replacements[key];
  });

  try {
    await runTest();
  } finally {
    Object.keys(originals).forEach((key) => {
      if (originals[key] === undefined) {
        delete feedbackRepository[key];
      } else {
        feedbackRepository[key] = originals[key];
      }
    });
  }
}

test('feedback create trims content and rejects over 150 chars', async () => {
  let createdPayload = null;

  await withRepositoryMocks({
    countUserMessagesSince: async () => 0,
    createMessage: async (db, payload) => {
      createdPayload = payload;
      return { id: 1, user_id: payload.userId, content: payload.content };
    }
  }, async () => {
    const result = await feedbackService.createMessage({}, 7, '  希望增加日本住宅 IP  ');

    assert.equal(result.content, '希望增加日本住宅 IP');
    assert.deepEqual(createdPayload, {
      userId: 7,
      content: '希望增加日本住宅 IP'
    });

    await assert.rejects(
      () => feedbackService.createMessage({}, 7, 'a'.repeat(151)),
      (error) => error.expose && error.statusCode === 400 && error.code === 1001
    );
  });
});

test('feedback create rejects the fourth message from same user in one day', async () => {
  let created = false;
  let receivedSince = null;

  await withRepositoryMocks({
    countUserMessagesSince: async (db, userId, since) => {
      assert.equal(userId, 7);
      receivedSince = since;
      return 3;
    },
    createMessage: async () => {
      created = true;
    }
  }, async () => {
    await assert.rejects(
      () => feedbackService.createMessage({}, 7, '今天第四条留言'),
      (error) => error.expose && error.statusCode === 429 && error.code === 1003 && error.message === '每个用户每天只能提交3条留言'
    );

    assert.equal(created, false);
    assert.equal(Number.isInteger(receivedSince), true);
  });
});

test('feedback featured list marks current user vote status', async () => {
  await withRepositoryMocks({
    listFeaturedMessages: async (db, userId) => [
      { id: 1, content: '增加台湾节点', vote_count: 3, has_voted: 1, viewer_id: userId },
      { id: 2, content: '需要自建 VPN', vote_count: 0, has_voted: 0, viewer_id: userId }
    ]
  }, async () => {
    const result = await feedbackService.listFeaturedMessages({}, 9);

    assert.equal(result.list.length, 2);
    assert.equal(result.list[0].has_voted, true);
    assert.equal(result.list[1].has_voted, false);
  });
});

test('feedback vote is limited to one vote per user per featured message', async () => {
  const calls = [];

  await withRepositoryMocks({
    findMessageById: async () => ({ id: 5, featured: 1 }),
    findVote: async () => null,
    createVote: async (db, payload) => {
      calls.push(payload);
      return { id: 11 };
    }
  }, async () => {
    const result = await feedbackService.voteMessage({}, 8, 5);

    assert.deepEqual(result, { voted: true, already_voted: false });
    assert.deepEqual(calls, [{ messageId: 5, userId: 8 }]);
  });

  await withRepositoryMocks({
    findMessageById: async () => ({ id: 5, featured: 1 }),
    findVote: async () => ({ id: 11 }),
    createVote: async () => {
      throw new Error('重复投票不应该再次写入');
    }
  }, async () => {
    const result = await feedbackService.voteMessage({}, 8, 5);

    assert.deepEqual(result, { voted: true, already_voted: true });
  });
});

test('admin delete feedback message removes votes and message in one transaction', async () => {
  const calls = [];
  let transactionStarted = false;

  const db = {
    transaction(fn) {
      return async (messageId) => {
        transactionStarted = true;
        return fn({ name: 'tx-db' }, messageId);
      };
    }
  };

  await withRepositoryMocks({
    findMessageById: async () => ({ id: 12, content: '增加新加坡节点' }),
    deleteVotesByMessageId: async (txDb, messageId) => {
      calls.push(['votes', txDb, messageId]);
    },
    deleteMessageById: async (txDb, messageId) => {
      calls.push(['message', txDb, messageId]);
    }
  }, async () => {
    const result = await feedbackService.deleteMessage(db, 12);

    assert.equal(transactionStarted, true);
    assert.deepEqual(result, { message: '留言已删除' });
    assert.deepEqual(calls.map(call => [call[0], call[2]]), [
      ['votes', 12],
      ['message', 12]
    ]);
    assert.equal(calls[0][1].name, 'tx-db');
    assert.equal(calls[1][1].name, 'tx-db');
  });
});

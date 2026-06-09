const assert = require('assert');
const bcrypt = require('bcrypt');
const authService = require('../services/user/auth-service');
const sharedEmailService = require('../integrations/email/email-service');

const RESET_MESSAGE = '如果该邮箱已注册，重置密码邮件已发送，请查收。';

function createFakeDb() {
  const state = {
    users: [
      {
        id: 1,
        email: 'reset@example.com',
        password_hash: bcrypt.hashSync('Oldpass123', 4)
      }
    ],
    tokens: [],
    executedSql: []
  };

  const db = {
    state,
    exec(sql) {
      state.executedSql.push(sql);
      return Promise.resolve();
    },
    prepare(sql) {
      return {
        get(...params) {
          if (sql.includes('FROM users') && sql.includes('WHERE email = ?')) {
            return state.users.find(user => user.email === params[0]);
          }

          if (sql.includes('FROM password_reset_tokens') && sql.includes('token = ?')) {
            return state.tokens.find(token => token.token === params[0]);
          }

          if (sql.includes('COUNT(*) as count') && sql.includes('password_reset_tokens')) {
            const [userId, createdAfter] = params;
            const count = state.tokens.filter(token => token.user_id === userId && token.created_at >= createdAfter).length;
            return { count };
          }

          return undefined;
        },
        run(...params) {
          if (sql.includes('INSERT INTO password_reset_tokens')) {
            const [userId, token, expiresAt, requestIp, createdAt] = params;
            state.tokens.push({
              id: state.tokens.length + 1,
              user_id: userId,
              token,
              expires_at: expiresAt,
              request_ip: requestIp,
              used_at: null,
              created_at: createdAt
            });
            return { lastInsertRowid: state.tokens.length, changes: 1 };
          }

          if (sql.includes('UPDATE password_reset_tokens') && sql.includes('used_at')) {
            const [usedAt, token] = params;
            const resetToken = state.tokens.find(item => item.token === token);
            if (resetToken) {
              resetToken.used_at = usedAt;
            }
            return { changes: resetToken ? 1 : 0 };
          }

          if (sql.includes('UPDATE users SET') && sql.includes('password_hash')) {
            const [passwordHash, updatedAt, userId] = params;
            const user = state.users.find(item => item.id === userId);
            if (user) {
              user.password_hash = passwordHash;
              user.updated_at = updatedAt;
            }
            return { changes: user ? 1 : 0 };
          }

          return { changes: 0 };
        }
      };
    }
  };

  return db;
}

async function testRequestPasswordResetCreatesTokenAndSendsGenericMessage() {
  const db = createFakeDb();
  const originalSendEmail = sharedEmailService.sendEmail;
  let sentEmail = null;
  sharedEmailService.sendEmail = async (emailDb, payload) => {
    sentEmail = payload;
    return { success: true };
  };

  try {
    const result = await authService.requestPasswordReset(db, {
      email: 'reset@example.com',
      ip: '203.0.113.10',
      baseUrl: 'https://example.com'
    });

    assert.strictEqual(result.message, RESET_MESSAGE);
    assert.strictEqual(result.audit.status, 'email_sent');
    assert.strictEqual(db.state.tokens.length, 1);
    assert.match(db.state.tokens[0].token, /^[a-f0-9]{64}$/);
    assert.strictEqual(sentEmail.to, 'reset@example.com');
    assert.strictEqual(sentEmail.subject, '【天澜大陆消息】密码重置');
    assert(sentEmail.content.includes('https://example.com/reset-password?token='));
    assert(sentEmail.content.includes('该链接只能使用一次'));
    assert(sentEmail.content.includes('每天只能申请重置一次密码'));
  } finally {
    sharedEmailService.sendEmail = originalSendEmail;
  }
}

async function testRequestPasswordResetKeepsUnknownEmailGeneric() {
  const db = createFakeDb();
  const originalSendEmail = sharedEmailService.sendEmail;
  let sendCount = 0;
  sharedEmailService.sendEmail = async () => {
    sendCount += 1;
    return { success: true };
  };

  try {
    const result = await authService.requestPasswordReset(db, {
      email: 'missing@example.com',
      ip: '203.0.113.10',
      baseUrl: 'https://example.com'
    });

    assert.strictEqual(result.message, RESET_MESSAGE);
    assert.strictEqual(result.audit.status, 'unknown_email');
    assert.strictEqual(db.state.tokens.length, 0);
    assert.strictEqual(sendCount, 0);
  } finally {
    sharedEmailService.sendEmail = originalSendEmail;
  }
}

async function testRequestPasswordResetAllowsOnePerUserPerDay() {
  const db = createFakeDb();
  const originalSendEmail = sharedEmailService.sendEmail;
  sharedEmailService.sendEmail = async () => ({ success: true });

  try {
    await authService.requestPasswordReset(db, {
      email: 'reset@example.com',
      ip: '203.0.113.10',
      baseUrl: 'https://example.com'
    });
    const secondResult = await authService.requestPasswordReset(db, {
      email: 'reset@example.com',
      ip: '203.0.113.10',
      baseUrl: 'https://example.com'
    });

    assert.strictEqual(secondResult.message, RESET_MESSAGE);
    assert.strictEqual(secondResult.audit.status, 'daily_limit_reached');
    assert.strictEqual(db.state.tokens.length, 1);
  } finally {
    sharedEmailService.sendEmail = originalSendEmail;
  }
}

async function testResetPasswordConsumesTokenAndUpdatesPassword() {
  const db = createFakeDb();
  const originalSendEmail = sharedEmailService.sendEmail;
  sharedEmailService.sendEmail = async () => ({ success: true });

  try {
    await authService.requestPasswordReset(db, {
      email: 'reset@example.com',
      ip: '203.0.113.10',
      baseUrl: 'https://example.com'
    });
    const token = db.state.tokens[0].token;

    const result = await authService.resetPassword(db, {
      token,
      password: 'Newpass123'
    });

    assert.strictEqual(result.reset, true);
    assert(db.state.tokens[0].used_at);
    assert(await bcrypt.compare('Newpass123', db.state.users[0].password_hash));
  } finally {
    sharedEmailService.sendEmail = originalSendEmail;
  }
}

async function testResetPasswordConsumesInvalidAttempt() {
  const db = createFakeDb();
  const originalSendEmail = sharedEmailService.sendEmail;
  sharedEmailService.sendEmail = async () => ({ success: true });

  try {
    await authService.requestPasswordReset(db, {
      email: 'reset@example.com',
      ip: '203.0.113.10',
      baseUrl: 'https://example.com'
    });
    const token = db.state.tokens[0].token;

    await assert.rejects(
      authService.resetPassword(db, {
        token,
        password: 'short'
      }),
      /密码/
    );

    assert(db.state.tokens[0].used_at);
  } finally {
    sharedEmailService.sendEmail = originalSendEmail;
  }
}

async function run() {
  await testRequestPasswordResetCreatesTokenAndSendsGenericMessage();
  await testRequestPasswordResetKeepsUnknownEmailGeneric();
  await testRequestPasswordResetAllowsOnePerUserPerDay();
  await testResetPasswordConsumesTokenAndUpdatesPassword();
  await testResetPasswordConsumesInvalidAttempt();
  console.log('password reset service tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

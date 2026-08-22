const assert = require('assert');
const bcrypt = require('bcrypt');
const authService = require('../services/user/auth-service');
const { DISABLE_REASONS } = require('../services/shared/renew-policy');

/**
 * 构造只覆盖登录查询的轻量数据库替身。
 * 职责：让测试直接验证 authService.login 的账号状态分支，不依赖真实数据库或 HTTP 服务。
 *
 * @param {Object} user - findLoginUserByEmail 需要返回的用户快照
 * @returns {Object} 兼容 db.prepare().get() 的测试数据库对象
 */
function createLoginDb(user) {
  return {
    prepare() {
      return {
        get(email) {
          return user && user.email === email ? user : undefined;
        }
      };
    }
  };
}

/**
 * 生成登录测试用户快照。
 * 职责：集中设置密码哈希、套餐字段与禁用原因，便于覆盖流量禁用和人工禁用分支。
 *
 * @param {Object} overrides - 覆盖默认用户字段的局部数据
 * @returns {Promise<Object>} 登录查询返回的用户记录
 */
async function createLoginUser(overrides = {}) {
  return {
    id: 1,
    email: 'traffic-disabled@example.com',
    password_hash: await bcrypt.hash('password123', 4),
    plan_id: 1,
    plan_name: 'Test Plan',
    expire_at: 0,
    enabled: 0,
    disable_reason: DISABLE_REASONS.TRAFFIC_LIMIT,
    payment_count: 1,
    ...overrides
  };
}

async function assertTrafficDisabledUserCanLogin() {
  const user = await createLoginUser();
  const result = await authService.login(createLoginDb(user), {
    email: user.email,
    password: 'password123'
  });

  assert.ok(result.token, '流量超限禁用用户应能拿到登录 token');
  assert.strictEqual(result.user.id, user.id);
}

async function assertAdminDisabledUserCannotLogin() {
  const user = await createLoginUser({
    email: 'admin-disabled@example.com',
    disable_reason: DISABLE_REASONS.ADMIN
  });

  await assert.rejects(
    () => authService.login(createLoginDb(user), {
      email: user.email,
      password: 'password123'
    }),
    (error) => error.code === 2003
      && error.message === '账号已被禁用，请联系管理员'
  );
}

async function assertUnpaidDisabledUserGetsActivationMessage() {
  const user = await createLoginUser({
    email: 'unpaid-disabled@example.com',
    disable_reason: null,
    payment_count: 0
  });

  await assert.rejects(
    () => authService.login(createLoginDb(user), {
      email: user.email,
      password: 'password123'
    }),
    (error) => error.code === 2003
      && error.message === '该账号需要完成支付激活后使用'
  );
}

async function main() {
  await assertTrafficDisabledUserCanLogin();
  await assertAdminDisabledUserCannotLogin();
  await assertUnpaidDisabledUserGetsActivationMessage();
  console.log('登录禁用原因测试通过');
}

main().catch((error) => {
  console.error('登录禁用原因测试失败:', error);
  process.exit(1);
});

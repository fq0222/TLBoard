# 暴力破解防护实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为用户端登录和注册接口实现暴力破解防护，防止恶意攻击者通过反复尝试密码破解账户。

**Architecture:** 使用express-rate-limit中间件实现基于IP+邮箱组合的固定窗口速率限制，15分钟内最多3次失败尝试。内存存储，单实例部署。

**Tech Stack:** Node.js, Express, express-rate-limit, Vue 3, Element Plus

---

## 文件结构

### 后端文件
- `server/config.js` - 添加安全配置环境变量读取
- `server/ecosystem.config.js` - 添加安全配置环境变量（生产环境）
- `server/middleware/rate-limiter.js` - 新建速率限制中间件
- `server/routes/user/auth.js` - 登录和注册路由添加速率限制

### 前端文件
- `client-user/src/api/index.js` - 添加429错误处理

### 测试文件
- `server/test/test-rate-limiter.js` - 速率限制测试脚本

---

## 任务分解

### 任务1：更新配置文件

**Files:**
- Modify: `server/config.js:53-59`
- Modify: `server/ecosystem.config.js:9-33` 和 `37-52`

- [ ] **步骤1：更新config.js安全配置**

```javascript
// 安全配置
security: {
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 3,
  maxRequestBodySize: '1mb'
}
```

- [ ] **步骤2：更新ecosystem.config.js的env环境变量**

在 `env` 对象中添加：
```javascript
// 安全配置
RATE_LIMIT_WINDOW: 900000, // 15分钟 = 15 * 60 * 1000 = 900000毫秒
RATE_LIMIT_MAX: 3, // 最大尝试次数
BCRYPT_ROUNDS: 12
```

- [ ] **步骤3：更新ecosystem.config.js的env_production环境变量**

在 `env_production` 对象中添加：
```javascript
// 安全配置
RATE_LIMIT_WINDOW: 900000,
RATE_LIMIT_MAX: 3,
BCRYPT_ROUNDS: 12
```

- [ ] **步骤4：提交配置更改**

```bash
git add server/config.js server/ecosystem.config.js
git commit -m "config: 添加暴力破解防护配置参数"
```

---

### 任务2：创建速率限制中间件

**Files:**
- Create: `server/middleware/rate-limiter.js`

- [ ] **步骤1：创建rate-limiter.js文件**

```javascript
const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * 创建基于IP+邮箱的速率限制器
 * @param {Object} options - 配置选项
 * @returns {Function} Express中间件
 */
function createAuthLimiter(options = {}) {
  const {
    windowMs = config.security.rateLimitWindow,
    max = config.security.rateLimitMax,
    message = { code: 429, message: '登录尝试次数过多，请稍后再试', data: null }
  } = options;

  return rateLimit({
    windowMs,
    max,
    message,
    // 自定义keyGenerator：基于IP+邮箱组合
    keyGenerator: (req) => {
      const ip = req.ip || req.connection.remoteAddress;
      const email = req.body?.email || 'unknown';
      return `${ip}:${email}`;
    },
    // 只在失败响应时计数
    skipSuccessfulRequests: true,
    // 设置Retry-After头
    headers: true,
    // 标准化响应格式
    handler: (req, res) => {
      res.status(429).json(message);
    },
    // 跳过成功请求
    skip: (req, res) => {
      return res.statusCode < 400;
    }
  });
}

// 用户端登录速率限制器
const userLoginLimiter = createAuthLimiter();

// 用户端注册速率限制器
const userRegisterLimiter = createAuthLimiter({
  message: { code: 429, message: '注册尝试次数过多，请稍后再试', data: null }
});

module.exports = {
  createAuthLimiter,
  userLoginLimiter,
  userRegisterLimiter
};
```

- [ ] **步骤2：提交中间件文件**

```bash
git add server/middleware/rate-limiter.js
git commit -m "feat: 创建基于IP+邮箱的速率限制中间件"
```

---

### 任务3：更新用户端路由

**Files:**
- Modify: `server/routes/user/auth.js:1-10` 和 `23-40` 和 `239-247`

- [ ] **步骤1：在auth.js顶部导入中间件**

在文件顶部添加：
```javascript
const { userLoginLimiter, userRegisterLimiter } = require('../../middleware/rate-limiter');
```

- [ ] **步骤2：为登录路由添加速率限制**

修改登录路由，添加 `userLoginLimiter` 中间件：
```javascript
router.post('/login', [
  userLoginLimiter, // 添加速率限制中间件
  body('email')
    .isEmail()
    .withMessage('请输入有效的邮箱地址')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('密码不能为空')
], async (req, res) => {
  // 现有登录逻辑保持不变...
});
```

- [ ] **步骤3：为注册路由添加速率限制**

修改注册路由，添加 `userRegisterLimiter` 中间件：
```javascript
router.post('/register-and-pay', [
  userRegisterLimiter, // 添加速率限制中间件
  body('email')
    .isEmail()
    .withMessage('请输入有效的邮箱地址')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('密码长度至少8位')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
    .withMessage('密码必须包含字母和数字'),
  body('plan_id')
    .isInt({ min: 1 })
    .withMessage('套餐ID必须是大于0的整数'),
  body('pay_type')
    .optional()
    .isIn([1, 2, '1', '2'])
    .withMessage('支付方式必须是1(微信)或2(支付宝)')
], async (req, res) => {
  // 现有注册逻辑保持不变...
});
```

- [ ] **步骤4：提交路由更改**

```bash
git add server/routes/user/auth.js
git commit -m "feat: 为用户端登录和注册路由添加速率限制"
```

---

### 任务4：更新前端错误处理

**Files:**
- Modify: `client-user/src/api/index.js:42-64`

- [ ] **步骤1：在响应拦截器中添加429错误处理**

在 `switch (status)` 语句中添加：
```javascript
case 429:
  ElMessage.error('请求过于频繁，请稍后再试');
  break;
```

- [ ] **步骤2：提交前端更改**

```bash
git add client-user/src/api/index.js
git commit -m "feat: 添加429速率限制错误处理"
```

---

### 任务5：创建测试脚本

**Files:**
- Create: `server/test/test-rate-limiter.js`

- [ ] **步骤1：创建测试脚本**

```javascript
/**
 * 暴力破解防护测试脚本
 * 测试速率限制功能
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:30000';
const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = 'wrongpassword';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testLoginRateLimit() {
  console.log('测试用户端登录速率限制...');
  console.log('窗口时间: 15分钟, 最大尝试次数: 3次');
  console.log('---');

  for (let i = 1; i <= 5; i++) {
    try {
      const response = await axios.post(`${BASE_URL}/api/user/login`, {
        email: TEST_EMAIL,
        password: TEST_PASSWORD
      });
      console.log(`尝试 ${i}: 状态码 ${response.status}, 响应:`, response.data);
    } catch (error) {
      if (error.response) {
        console.log(`尝试 ${i}: 状态码 ${error.response.status}, 响应:`, error.response.data);
        if (error.response.status === 429) {
          console.log(`✓ 速率限制在第 ${i} 次尝试时触发`);
          console.log(`  重试时间头: ${error.response.headers['retry-after'] || '未设置'}`);
          break;
        }
      } else {
        console.log(`尝试 ${i}: 错误:`, error.message);
      }
    }
    await sleep(1000); // 等待1秒
  }
}

async function testRegisterRateLimit() {
  console.log('\n测试用户端注册速率限制...');
  console.log('---');

  for (let i = 1; i <= 5; i++) {
    try {
      const response = await axios.post(`${BASE_URL}/api/user/register-and-pay`, {
        email: `test${i}@example.com`,
        password: 'wrongpassword',
        plan_id: 1,
        pay_type: 2
      });
      console.log(`尝试 ${i}: 状态码 ${response.status}, 响应:`, response.data);
    } catch (error) {
      if (error.response) {
        console.log(`尝试 ${i}: 状态码 ${error.response.status}, 响应:`, error.response.data);
        if (error.response.status === 429) {
          console.log(`✓ 速率限制在第 ${i} 次尝试时触发`);
          break;
        }
      } else {
        console.log(`尝试 ${i}: 错误:`, error.message);
      }
    }
    await sleep(1000);
  }
}

async function main() {
  console.log('暴力破解防护测试');
  console.log('================');
  console.log('确保服务器已启动在端口 30000');
  console.log('');

  await testLoginRateLimit();
  await testRegisterRateLimit();

  console.log('\n测试完成');
}

main().catch(console.error);
```

- [ ] **步骤2：提交测试脚本**

```bash
git add server/test/test-rate-limiter.js
git commit -m "test: 添加暴力破解防护测试脚本"
```

---

### 任务6：验证和测试

- [ ] **步骤1：重启服务器**

提醒用户：修改了 `server/**/*.js` 文件，请重启服务器以应用更改。

```bash
# 用户需要手动重启服务器
npm run dev
```

- [ ] **步骤2：运行测试脚本**

```bash
cd server
node test/test-rate-limiter.js
```

预期输出：
```
暴力破解防护测试
================
确保服务器已启动在端口 30000

测试用户端登录速率限制...
窗口时间: 15分钟, 最大尝试次数: 3次
---
尝试 1: 状态码 400, 响应: { code: 2002, message: '邮箱或密码错误', data: null }
尝试 2: 状态码 400, 响应: { code: 2002, message: '邮箱或密码错误', data: null }
尝试 3: 状态码 400, 响应: { code: 2002, message: '邮箱或密码错误', data: null }
尝试 4: 状态码 429, 响应: { code: 429, message: '登录尝试次数过多，请稍后再试', data: null }
✓ 速率限制在第 4 次尝试时触发
  重试时间头: 900

测试用户端注册速率限制...
---
尝试 1: 状态码 400, 响应: { code: 1001, message: '参数校验失败', data: { errors: [...] } }
尝试 2: 状态码 400, 响应: { code: 1001, message: '参数校验失败', data: { errors: [...] } }
尝试 3: 状态码 400, 响应: { code: 1001, message: '参数校验失败', data: { errors: [...] } }
尝试 4: 状态码 429, 响应: { code: 429, message: '注册尝试次数过多，请稍后再试', data: null }
✓ 速率限制在第 4 次尝试时触发

测试完成
```

- [ ] **步骤3：验证前端构建**

```bash
cd client-user
npm run build
```

确保构建成功，无错误。

- [ ] **步骤4：提交所有更改**

```bash
git add .
git commit -m "feat: 完成暴力破解防护功能实现"
```

---

## 自检清单

1. **规格覆盖**：
   - ✓ 防护范围：用户端登录和注册接口
   - ✓ 限制维度：IP+邮箱组合
   - ✓ 窗口时间：15分钟
   - ✓ 最大尝试次数：3次
   - ✓ 存储方式：内存存储
   - ✓ 响应格式：HTTP 429 + Retry-After头

2. **占位符扫描**：
   - ✓ 无TBD、TODO或不完整部分
   - ✓ 所有代码步骤都有完整实现

3. **类型一致性**：
   - ✓ 函数名、变量名一致
   - ✓ 配置参数名称一致

4. **AGENTS.md合规**：
   - ✓ 使用简体中文
   - ✓ ecosystem.config.js未写入真实敏感信息
   - ✓ config.js使用环境变量优先，有默认值
   - ✓ 提醒用户重启服务器

---

## 执行选择

计划完成并保存到 `docs/superpowers/plans/2026-05-07-brute-force-protection.md`。两种执行选项：

**1. 子代理驱动（推荐）** - 我为每个任务分派新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用executing-plans执行任务，批量执行并设置检查点

**选择哪种方式？**
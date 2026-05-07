# 暴力破解防护设计文档

## 概述

为用户端登录和注册接口实现暴力破解防护机制，防止恶意攻击者通过反复尝试密码来破解用户账户。

## 需求

### 防护范围
- 用户端登录接口：`/api/user/login`
- 用户端注册接口：`/api/user/register-and-pay`
- 管理端不需要升级（仅在局域网使用）

### 限制策略
- **限制维度**：IP地址 + 邮箱组合
- **窗口时间**：15分钟
- **最大尝试次数**：3次失败尝试
- **存储方式**：内存存储（单实例部署）
- **响应格式**：HTTP 429 + Retry-After头

### 触发条件
- 仅在登录/注册失败时计数
- 成功请求不计入限制次数
- 每个IP+邮箱组合独立计数

## 技术设计

### 1. 配置更新

#### 1.1 更新 `server/config.js`
```javascript
// 安全配置
security: {
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 3,
  maxRequestBodySize: '1mb'
}
```

#### 1.2 更新 `server/ecosystem.config.js`
在 `env` 和 `env_production` 中添加：
```javascript
// 安全配置
RATE_LIMIT_WINDOW: 900000, // 15分钟 = 15 * 60 * 1000 = 900000毫秒
RATE_LIMIT_MAX: 3, // 最大尝试次数
BCRYPT_ROUNDS: 12
```

### 2. 速率限制中间件

#### 2.1 创建 `server/middleware/rate-limiter.js`
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

### 3. 路由集成

#### 3.1 更新 `server/routes/user/auth.js`
```javascript
// 在文件顶部导入中间件
const { userLoginLimiter, userRegisterLimiter } = require('../../middleware/rate-limiter');

// 登录路由应用速率限制
router.post('/login', [
  userLoginLimiter, // 添加速率限制中间件
  body('email').isEmail().withMessage('请输入有效的邮箱地址').normalizeEmail(),
  body('password').notEmpty().withMessage('密码不能为空')
], async (req, res) => {
  // 现有登录逻辑...
});

// 注册路由应用速率限制
router.post('/register-and-pay', [
  userRegisterLimiter, // 添加速率限制中间件
  body('email').isEmail().withMessage('请输入有效的邮箱地址').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('密码长度至少8位')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)/).withMessage('密码必须包含字母和数字'),
  body('plan_id').isInt({ min: 1 }).withMessage('套餐ID必须是大于0的整数'),
  body('pay_type').optional().isIn([1, 2, '1', '2']).withMessage('支付方式必须是1(微信)或2(支付宝)')
], async (req, res) => {
  // 现有注册逻辑...
});
```

### 4. 前端错误处理

#### 4.1 更新 `client-user/src/api/index.js`
在响应拦截器的switch语句中添加：
```javascript
case 429:
  ElMessage.error('请求过于频繁，请稍后再试');
  break;
```

## 测试策略

### 单元测试
- 测试中间件的key生成功能
- 测试配置读取和默认值

### 集成测试
- 测试登录路由的速率限制行为
- 测试注册路由的速率限制行为
- 测试不同邮箱的独立计数

### 手动测试
1. 连续3次错误登录，第4次应返回429
2. 等待15分钟后，应能正常登录
3. 使用不同邮箱应有独立的限制计数
4. 成功登录不应计入限制次数
5. 检查Retry-After头是否正确返回

## 部署考虑

### 生产环境
- 通过PM2的 `ecosystem.config.js` 配置环境变量
- 监控日志中的速率限制触发记录
- 考虑内存使用情况（每个IP+邮箱组合占用少量内存）

### 扩展性
- 当前设计为单实例内存存储
- 如需多实例部署，需考虑Redis等分布式存储
- 可通过配置调整限制参数

## 安全考虑

### 优势
- 防止针对特定账户的暴力破解
- 增加攻击成本（需要切换IP和邮箱）
- 标准HTTP 429响应，客户端易于处理

### 局限性
- 内存存储重启后清零
- 攻击者可能通过大量IP绕过
- 需要前端配合显示友好错误信息

## 实施步骤

1. 更新配置文件（config.js和ecosystem.config.js）
2. 创建速率限制中间件
3. 更新用户端登录和注册路由
4. 更新前端错误处理
5. 测试验证
6. 部署到生产环境

## 监控和日志

### 日志格式
记录被限制的请求：
```
[USER-AUTH] 速率限制触发: IP=192.168.1.1, Email=user@example.com
```

### 监控指标
- 速率限制触发次数
- 被限制的IP分布
- 被限制的邮箱分布

## 文档更新

- 更新API文档，说明429错误响应
- 更新部署文档，说明环境变量配置
- 更新运维手册，说明监控和日志查看
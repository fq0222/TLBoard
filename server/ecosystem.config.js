module.exports = {
  apps: [
    {
      name: 'subscription-manager',
      script: './app.js',
      cwd: __dirname,
      
      // 环境变量
      env: {
        NODE_ENV: 'production',
        
        // 用户端端口
        USER_PORT: 30000,
        USER_APP_URL: 'https://your-user-site.example.com',
        // 非敏感 WebAuthn 站点配置；生产运行环境要求 Node.js 20 及以上。
        WEBAUTHN_RP_NAME: '订阅管理系统',
        WEBAUTHN_RP_ID: 'tl.lolok.dpdns.org',
        WEBAUTHN_ORIGIN: 'https://tl.lolok.dpdns.org',
        
        // 管理端端口
        ADMIN_PORT: 30001,
        
        // JWT 密钥（生产环境请修改为强密码）
        USER_JWT_SECRET: 'your_user_jwt_secret_here',
        ADMIN_JWT_SECRET: 'your_admin_jwt_secret_here',
        
        // PostgreSQL 数据库配置
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_USER: 'postgres',
        DB_PASSWORD: 'postgres',
        DB_NAME: 'subscription_manager',
        DB_POOL_MAX: 20,
        DB_IDLE_TIMEOUT: 60000, // 空闲超时60秒
        DB_CONNECT_TIMEOUT: 5000, // 连接超时5秒

        // 3X-UI 专用 HTTP 代理（不影响其他外部请求）
        XUI_PROXY_ENABLED: 'false',
        XUI_PROXY_PROTOCOL: 'http',
        XUI_PROXY_HOST: '127.0.0.1',
        XUI_PROXY_PORT: 27890,
        XUI_PROXY_USERNAME: '',
        XUI_PROXY_PASSWORD: '',
        
        // 日志级别
        LOG_LEVEL: 'info',
        TELEGRAM_INTERNAL_API_ENABLED: 'true',
        TELEGRAM_INTERNAL_API_SECRET: 'dasfdafdsaf45sadfasw234erwerwe8765rwerrw',
        TELEGRAM_INTERNAL_API_ALLOWED_SKEW_SECONDS: 300,
        
        // 仓库只保留无效占位符；生产服务器必须替换为 Base64 编码的 32 字节真实密钥。
        WITHDRAWAL_QR_ENCRYPTION_KEY: 'REPLACE_WITH_BASE64_32_BYTE_KEY',

        // 安全配置
        RATE_LIMIT_WINDOW: 900000, // 15分钟 = 15 * 60 * 1000 = 900000毫秒
        RATE_LIMIT_MAX: 3, // 最大尝试次数
        BCRYPT_ROUNDS: 12
      },
      
      // 生产环境配置
      env_production: {
        NODE_ENV: 'production',
        WEBAUTHN_RP_NAME: '订阅管理系统',
        WEBAUTHN_RP_ID: 'tl.lolok.dpdns.org',
        WEBAUTHN_ORIGIN: 'https://tl.lolok.dpdns.org',
        USER_PORT: 30000,
        USER_APP_URL: 'https://your-user-site.example.com',
        ADMIN_PORT: 30001,
        USER_JWT_SECRET: 'your_user_jwt_secret_here',
        ADMIN_JWT_SECRET: 'your_admin_jwt_secret_here',
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_USER: 'postgres',
        DB_PASSWORD: 'your_db_password_here',
        DB_NAME: 'subscription_manager',
        DB_POOL_MAX: 20,
        DB_IDLE_TIMEOUT: 60000, // 空闲超时60秒
        DB_CONNECT_TIMEOUT: 5000, // 连接超时5秒

        XUI_PROXY_ENABLED: 'false',
        XUI_PROXY_PROTOCOL: 'http',
        XUI_PROXY_HOST: '127.0.0.1',
        XUI_PROXY_PORT: 27890,
        XUI_PROXY_USERNAME: '',
        XUI_PROXY_PASSWORD: '',

        LOG_LEVEL: 'warn',
        TELEGRAM_INTERNAL_API_ENABLED: 'true',
        TELEGRAM_INTERNAL_API_SECRET: 'dasfdafdsaf45sadfasw234erwerwe8765rwerrw',
        TELEGRAM_INTERNAL_API_ALLOWED_SKEW_SECONDS: 300,
        
        // 仓库只保留无效占位符；生产服务器必须替换为 Base64 编码的 32 字节真实密钥。
        WITHDRAWAL_QR_ENCRYPTION_KEY: 'REPLACE_WITH_BASE64_32_BYTE_KEY',

        // 安全配置
        RATE_LIMIT_WINDOW: 900000,
        RATE_LIMIT_MAX: 3,
        BCRYPT_ROUNDS: 12
      },
      
      // 日志配置
      log_file: './logs/app.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,           // 合并输出到单个文件
      
      // 自动重启
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      
      // 实例数
      instances: 1,
      exec_mode: 'fork'
    }
  ]
};

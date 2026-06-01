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
        
        // 日志级别
        LOG_LEVEL: 'info',
        
        // 安全配置
        RATE_LIMIT_WINDOW: 900000, // 15分钟 = 15 * 60 * 1000 = 900000毫秒
        RATE_LIMIT_MAX: 3, // 最大尝试次数
        BCRYPT_ROUNDS: 12
      },
      
      // 生产环境配置
      env_production: {
        NODE_ENV: 'production',
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
        LOG_LEVEL: 'warn',
        
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

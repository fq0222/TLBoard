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
        DB_IDLE_TIMEOUT: 30000,
        DB_CONNECT_TIMEOUT: 2000,
        
        // 日志级别
        LOG_LEVEL: 'info'
      },
      
      // 生产环境配置
      env_production: {
        NODE_ENV: 'production',
        USER_PORT: 30000,
        ADMIN_PORT: 30001,
        USER_JWT_SECRET: 'your_user_jwt_secret_here',
        ADMIN_JWT_SECRET: 'your_admin_jwt_secret_here',
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_USER: 'postgres',
        DB_PASSWORD: 'your_db_password_here',
        DB_NAME: 'subscription_manager',
        DB_POOL_MAX: 20,
        DB_IDLE_TIMEOUT: 30000,
        DB_CONNECT_TIMEOUT: 2000,
        LOG_LEVEL: 'warn'
      },
      
      // 日志配置
      log_file: './logs/app.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      
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
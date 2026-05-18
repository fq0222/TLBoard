/**
 * 3X-UI 用户流量迁移脚本
 * 用于将源服务器的用户流量迁移到目标服务器
 * 
 * 使用方法：node server/test/migrate-xui-traffic.js --source <源服务器ID> --target <目标服务器ID>
 */

const XuiService = require('../services/xui-service');
const config = require('../config');
const readline = require('readline');

// 命令行参数解析
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' || args[i] === '-s') {
      params.source = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--target' || args[i] === '-t') {
      params.target = parseInt(args[i + 1]);
      i++;
    }
  }
  
  return params;
}

// 从数据库获取服务器信息
async function getServerInfo(db, serverId) {
  const server = await db.prepare(`
    SELECT id, name, api_url, api_username, api_password
    FROM xui_servers
    WHERE id = $1
  `).get(serverId);
  
  if (!server) {
    throw new Error(`未找到服务器 ID: ${serverId}`);
  }
  
  return server;
}

// 连接服务器
async function connectServer(serverInfo) {
  console.log(`连接服务器: ${serverInfo.name} (${serverInfo.api_url})`);
  
  const xuiService = await XuiService.getInstance(
    serverInfo.api_url,
    serverInfo.api_username,
    serverInfo.api_password
  );
  
  const isConnected = await xuiService.testConnection();
  
  if (!isConnected) {
    throw new Error(`无法连接到服务器: ${serverInfo.name}`);
  }
  
  console.log(`  连接成功\n`);
  return xuiService;
}

// 主函数
async function main() {
  console.log('=== 3X-UI 用户流量迁移工具 ===\n');
  
  const params = parseArgs();
  
  if (!params.source || !params.target) {
    console.error('错误：请指定源服务器和目标服务器 ID');
    console.log('使用方法：node server/test/migrate-xui-traffic.js --source <源服务器ID> --target <目标服务器ID>');
    process.exit(1);
  }
  
  console.log(`源服务器 ID: ${params.source}`);
  console.log(`目标服务器 ID: ${params.target}\n`);
  
  // 初始化数据库
  const dbManager = require('../db/init');
  const db = await dbManager.init();
  
  try {
    // 获取服务器信息
    console.log('[1/4] 连接服务器...');
    const sourceServerInfo = await getServerInfo(db, params.source);
    const targetServerInfo = await getServerInfo(db, params.target);
    
    // 连接服务器
    const sourceXui = await connectServer(sourceServerInfo);
    const targetXui = await connectServer(targetServerInfo);
    
    console.log('服务器连接完成\n');
    
    // TODO: 实现后续步骤
    
  } finally {
    await dbManager.close();
  }
}

main().catch(error => {
  console.error('脚本执行失败:', error.message);
  process.exit(1);
});

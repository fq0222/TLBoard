/**
 * 3X-UI 用户流量迁移脚本
 * 用于将源服务器的用户流量迁移到目标服务器
 * 
 * 使用方法：node server/test/migrate-xui-traffic.js --source <源服务器ID> --target <目标服务器ID>
 */

const XuiService = require('../services/xui-service');
const config = require('../config');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// 日志文件路径
const LOG_DIR = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, `migration-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 写入日志
function writeLog(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, logMessage);
}

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
    SELECT id, name, api_url, api_token
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
    serverInfo.api_token
  );
  
  const isConnected = await xuiService.testConnection();
  
  if (!isConnected) {
    throw new Error(`无法连接到服务器: ${serverInfo.name}`);
  }
  
  console.log(`  连接成功\n`);
  return xuiService;
}

// 获取服务器所有用户流量
async function getAllUsersTraffic(xuiService, serverName) {
  console.log(`读取 ${serverName} 的用户流量...`);
  
  // 获取所有节点
  const inboundsResult = await xuiService.getInbounds();
  
  if (!inboundsResult.success) {
    throw new Error(`获取节点失败: ${inboundsResult.message}`);
  }
  
  const inbounds = inboundsResult.data;
  const allUsers = [];
  let totalTraffic = 0;
  
  // 遍历每个节点
  for (const inbound of inbounds) {
    const settings = JSON.parse(inbound.settings || '{}');
    const clients = settings.clients || [];
    
    // 遍历每个用户
    for (const client of clients) {
      try {
        // 获取用户流量
        const trafficResult = await xuiService.getClientTrafficsByEmail(client.email);
        
        let trafficUsed = 0;
        let trafficLimit = client.totalGB || 0;
        
        if (trafficResult.success && trafficResult.data) {
          trafficUsed = (trafficResult.data.up || 0) + (trafficResult.data.down || 0);
          trafficLimit = trafficResult.data.total || trafficLimit;
        }
        
        allUsers.push({
          email: client.email,
          uuid: client.id,
          inbound_id: inbound.id,
          inbound_remark: inbound.remark,
          traffic_used: trafficUsed,
          traffic_limit: trafficLimit,
          enable: client.enable,
          expiry_time: client.expiryTime
        });
        
        totalTraffic += trafficUsed;
        
      } catch (error) {
        console.warn(`  警告：获取用户 ${client.email} 流量失败: ${error.message}`);
      }
    }
  }
  
  console.log(`  共读取 ${allUsers.length} 个用户，总流量: ${formatTraffic(totalTraffic)}\n`);
  
  return {
    success: true,
    users: allUsers,
    totalTraffic: totalTraffic,
    userCount: allUsers.length
  };
}

// 格式化流量显示
function formatTraffic(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '0 B';
  
  const numBytes = Number(bytes);
  
  if (isNaN(numBytes)) return '0 B';
  if (numBytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(numBytes) / Math.log(k));
  return parseFloat((numBytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 显示汇总统计
function showSummary(sourceUsers, targetUsers) {
  console.log('[3/4] 迁移确认');
  console.log('========================================');
  
  // 统计匹配用户
  const targetEmails = new Set(targetUsers.map(u => u.email));
  const matchedUsers = sourceUsers.filter(u => targetEmails.has(u.email));
  const newUsers = sourceUsers.filter(u => !targetEmails.has(u.email));
  
  console.log(`源服务器用户数: ${sourceUsers.length}`);
  console.log(`目标服务器用户数: ${targetUsers.length}`);
  console.log(`匹配用户数: ${matchedUsers.length}`);
  console.log(`新用户数: ${newUsers.length}`);
  console.log(`总流量: ${formatTraffic(sourceUsers.reduce((sum, u) => sum + u.traffic_used, 0))}`);
  console.log('========================================\n');
  
  return {
    matchedUsers,
    newUsers
  };
}

// 显示详细列表
function showDetailedList(users, title) {
  console.log(`${title}:`);
  console.log('序号 | 邮箱                | 节点       | 已用流量  | 流量限制');
  console.log('-----|--------------------|-----------|---------|---------');
  
  users.forEach((user, index) => {
    const num = String(index + 1).padStart(4);
    const email = user.email.padEnd(20);
    const remark = user.inbound_remark.substring(0, 10).padEnd(10);
    const used = formatTraffic(user.traffic_used).padStart(8);
    const limit = user.traffic_limit > 0 ? formatTraffic(user.traffic_limit).padStart(8) : '无限制'.padStart(8);
    
    console.log(`${num} | ${email} | ${remark} | ${used} | ${limit}`);
  });
  
  console.log('');
}

// 等待用户确认
async function waitForConfirmation() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question('确认执行迁移？(y/n): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// 执行流量迁移
async function migrateTraffic(sourceUsers, targetXuiService, targetUsers) {
  console.log('[4/4] 执行迁移...');
  writeLog('开始执行迁移');
  
  const results = {
    success: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };
  
  // 创建目标服务器用户邮箱映射
  const targetUserMap = new Map();
  for (const user of targetUsers) {
    targetUserMap.set(user.email, user);
  }
  
  const total = sourceUsers.length;
  
  for (let i = 0; i < sourceUsers.length; i++) {
    const sourceUser = sourceUsers[i];
    const progress = `[${i + 1}/${total}]`;
    
    try {
      // 检查目标服务器是否有该用户
      const targetUser = targetUserMap.get(sourceUser.email);
      
      if (!targetUser) {
        const msg = `${progress} 跳过 ${sourceUser.email} - 目标服务器不存在`;
        console.log(msg);
        writeLog(msg);
        results.skipped++;
        continue;
      }
      
      // 计算新流量：目标流量 + 源流量
      const newTrafficLimit = targetUser.traffic_limit + sourceUser.traffic_used;
      
      // 更新目标服务器用户流量
      const updateResult = await targetXuiService.updateClient(
        targetUser.inbound_id,
        sourceUser.email,
        {
          totalGB: newTrafficLimit / (1024 * 1024 * 1024) // 字节转GB
        }
      );
      
      if (updateResult.success) {
        const msg = `${progress} 成功 ${sourceUser.email} - 流量已累加`;
        console.log(msg);
        writeLog(msg);
        results.success++;
      } else {
        const msg = `${progress} 失败 ${sourceUser.email} - ${updateResult.message}`;
        console.log(msg);
        writeLog(msg);
        results.failed++;
        results.errors.push({
          email: sourceUser.email,
          error: updateResult.message
        });
      }
      
    } catch (error) {
      const msg = `${progress} 失败 ${sourceUser.email} - ${error.message}`;
      console.log(msg);
      writeLog(msg);
      results.failed++;
      results.errors.push({
        email: sourceUser.email,
        error: error.message
      });
    }
  }
  
  writeLog(`迁移完成: 成功=${results.success}, 失败=${results.failed}, 跳过=${results.skipped}`);
  
  return results;
}

// 显示迁移结果
function showResults(results) {
  console.log('\n迁移结果汇总:');
  console.log('========================================');
  console.log(`成功: ${results.success}`);
  console.log(`失败: ${results.failed}`);
  console.log(`跳过: ${results.skipped}`);
  console.log('========================================');
  
  if (results.errors.length > 0) {
    console.log('\n失败详情:');
    results.errors.forEach(err => {
      console.log(`  - ${err.email}: ${err.error}`);
    });
  }
}

// 主函数
async function main() {
  console.log('=== 3X-UI 用户流量迁移工具 ===\n');
  writeLog('=== 3X-UI 用户流量迁移工具 ===');
  
  const params = parseArgs();
  
  if (!params.source || !params.target) {
    console.error('错误：请指定源服务器和目标服务器 ID');
    console.log('使用方法：node server/test/migrate-xui-traffic.js --source <源服务器ID> --target <目标服务器ID>');
    process.exit(1);
  }
  
  console.log(`源服务器 ID: ${params.source}`);
  console.log(`目标服务器 ID: ${params.target}\n`);
  writeLog(`源服务器 ID: ${params.source}, 目标服务器 ID: ${params.target}`);
  
  // 初始化数据库
  const dbManager = require('../db/init');
  const db = await dbManager.init();
  
  try {
    // 获取服务器信息
    console.log('[1/4] 连接服务器...');
    writeLog('开始连接服务器');
    
    const sourceServerInfo = await getServerInfo(db, params.source);
    const targetServerInfo = await getServerInfo(db, params.target);
    
    // 连接服务器
    const sourceXui = await connectServer(sourceServerInfo);
    const targetXui = await connectServer(targetServerInfo);
    
    console.log('服务器连接完成\n');
    writeLog('服务器连接完成');
    
    // 读取用户流量
    console.log('[2/4] 读取源服务器用户流量...');
    writeLog('开始读取源服务器用户流量');
    
    const sourceTraffic = await getAllUsersTraffic(sourceXui, sourceServerInfo.name);
    writeLog(`源服务器用户数: ${sourceTraffic.userCount}, 总流量: ${sourceTraffic.totalTraffic}`);
    
    console.log('[2/4] 读取目标服务器用户流量...');
    writeLog('开始读取目标服务器用户流量');
    
    const targetTraffic = await getAllUsersTraffic(targetXui, targetServerInfo.name);
    writeLog(`目标服务器用户数: ${targetTraffic.userCount}, 总流量: ${targetTraffic.totalTraffic}`);
    
    // 显示统计信息
    const { matchedUsers, newUsers } = showSummary(sourceTraffic.users, targetTraffic.users);
    writeLog(`匹配用户数: ${matchedUsers.length}, 新用户数: ${newUsers.length}`);
    
    // 显示详细列表
    if (matchedUsers.length > 0) {
      showDetailedList(matchedUsers, '匹配用户列表');
    }
    
    if (newUsers.length > 0) {
      showDetailedList(newUsers, '新用户列表');
    }
    
    // 等待用户确认
    const confirmed = await waitForConfirmation();
    
    if (!confirmed) {
      console.log('用户取消迁移');
      writeLog('用户取消迁移');
      return;
    }
    
    console.log('\n用户确认执行迁移\n');
    writeLog('用户确认执行迁移');
    
    // 执行迁移
    const results = await migrateTraffic(sourceTraffic.users, targetXui, targetTraffic.users);
    
    // 显示结果
    showResults(results);
    
    console.log('\n迁移完成！');
    console.log(`\n日志文件: ${LOG_FILE}`);
    
  } finally {
    await dbManager.close();
  }
}

main().catch(error => {
  console.error('脚本执行失败:', error.message);
  process.exit(1);
});

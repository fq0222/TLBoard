const databaseManager = require('../db/init');

async function testSalesLimit() {
  try {
    const db = await databaseManager.init();
    
    // 1. 测试添加套餐时设置 sales_limit
    console.log('测试添加套餐...');
    const result = await db.prepare(`
      INSERT INTO plans (name, description, price, duration_days, traffic_limit, sales_limit)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('测试套餐', '测试描述', 1990, 30, 107374182400, 10);
    console.log('添加套餐成功，ID:', result.lastInsertRowid);
    
    // 2. 测试查询套餐
    const plan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(result.lastInsertRowid);
    console.log('查询套餐:', plan);
    
    // 3. 测试更新 sales_count
    await db.prepare('UPDATE plans SET sales_count = sales_count + 1 WHERE id = ?').run(result.lastInsertRowid);
    const updatedPlan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(result.lastInsertRowid);
    console.log('更新 sales_count 后:', updatedPlan);
    
    // 4. 清理测试数据
    await db.prepare('DELETE FROM plans WHERE id = ?').run(result.lastInsertRowid);
    console.log('测试数据已清理');
    
    console.log('所有测试通过！');
  } catch (error) {
    console.error('测试失败:', error);
  }
}

testSalesLimit();

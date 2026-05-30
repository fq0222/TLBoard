const fs = require('fs');
const path = require('path');
const assert = require('assert');
const config = require('../config');
const databaseManager = require('../db/init');
const blogService = require('../services/blog-service');

const uploadDir = path.join(__dirname, '../uploads/blog-images');

function assertOk(condition, message) {
  assert.strictEqual(Boolean(condition), true, message);
  console.log(`✓ ${message}`);
}

function getExpectedSiteBaseUrl() {
  const protocol = config.site?.protocol || 'http';
  const host = config.site?.host || 'localhost:30000';
  return `${protocol}://${host}`;
}

async function cleanupTestArticles(db) {
  await db.pool.query("DELETE FROM blog_articles WHERE title LIKE '测试博客-%'");
}

async function main() {
  let db;

  try {
    db = await databaseManager.init();
    await blogService.ensureBlogArticlesTable(db);
    await cleanupTestArticles(db);

    fs.mkdirSync(uploadDir, { recursive: true });

    console.log('=== 博客文章服务测试 ===');

    const draft = await blogService.createArticle(db, {
      title: '测试博客-草稿',
      summary: '草稿简介',
      category: '订阅教程',
      content: '# 草稿内容',
      status: 'draft'
    });
    assertOk(draft.id, '管理端可以新增草稿文章');

    const updatedDraft = await blogService.updateArticle(db, draft.id, {
      title: '测试博客-草稿已编辑',
      summary: '编辑后的简介',
      category: 'Clash',
      content: '# 编辑后的内容',
      status: 'draft'
    });
    assertOk(updatedDraft.category === 'Clash', '管理端可以编辑文章');

    const published = await blogService.createArticle(db, {
      title: '测试博客-已发布',
      summary: '发布简介',
      category: 'Clash',
      content: '# 已发布内容',
      status: 'published'
    });
    assertOk(published.status === 'published', '管理端可以发布文章');

    const userList = await blogService.listPublishedArticles(db, { page: 1, limit: 20 });
    assertOk(
      userList.list.some((item) => item.id === published.id) &&
        !userList.list.some((item) => item.id === draft.id),
      '用户端列表只返回已发布文章'
    );

    const hiddenDraft = await blogService.getPublishedArticle(db, draft.id);
    assertOk(hiddenDraft === null, '用户端详情不能访问草稿文章');

    const categories = await blogService.listPublishedCategories(db);
    assertOk(categories.includes('Clash') && !categories.includes('订阅教程'), '分类列表只统计已发布文章分类');

    const uploadedImageFilename = '44444444-4444-4444-8444-444444444444.png';
    const imageMarkdown = blogService.buildBlogImageMarkdown(uploadedImageFilename);
    assertOk(
      imageMarkdown === `![图片说明](${getExpectedSiteBaseUrl()}/api/user/help/images/${uploadedImageFilename})`,
      '博客图片 Markdown 会生成用户端可访问的绝对 URL'
    );

    const localImageA = '11111111-1111-4111-8111-111111111111.png';
    const localImageB = '22222222-2222-4222-8222-222222222222.webp';
    const localImageC = '33333333-3333-4333-8333-333333333333.gif';
    fs.writeFileSync(path.join(uploadDir, localImageA), 'image-a');
    fs.writeFileSync(path.join(uploadDir, localImageB), 'image-b');
    fs.writeFileSync(path.join(uploadDir, localImageC), 'image-c');

    const articleWithImages = await blogService.createArticle(db, {
      title: '测试博客-待删除图片',
      summary: '图片简介',
      category: '图片',
      content: [
        `![本地A](/api/user/help/images/${localImageA})`,
        `![本地B](http://localhost:30000/api/user/help/images/${localImageB})`,
        '![外链](https://example.com/outside.png)'
      ].join('\n'),
      status: 'published'
    });

    await blogService.createArticle(db, {
      title: '测试博客-共享图片',
      summary: '共享简介',
      category: '图片',
      content: `![共享](/api/user/help/images/${localImageB})`,
      status: 'published'
    });

    const extracted = blogService.extractLocalBlogImageFilenames(articleWithImages.content);
    assertOk(extracted.includes(localImageA) && extracted.includes(localImageB), '可以解析 Markdown 中的本地博客图片引用');

    await blogService.deleteArticle(db, articleWithImages.id, { uploadDir });
    assertOk(!fs.existsSync(path.join(uploadDir, localImageA)), '删除文章会清理不再被引用的本地图片');
    assertOk(fs.existsSync(path.join(uploadDir, localImageB)), '删除文章不会清理仍被其他文章引用的本地图片');
    assertOk(fs.existsSync(path.join(uploadDir, localImageC)), '删除文章不会清理未被该文章引用的本地图片');

    await cleanupTestArticles(db);
    for (const filename of [localImageB, localImageC]) {
      const filePath = path.join(uploadDir, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    console.log('\n=== 测试通过 ===');
  } catch (error) {
    console.error('\n测试失败:', error.message);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    if (db) {
      await databaseManager.close();
    }
  }
}

main();

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const config = require('../config');
const databaseManager = require('../db/init');
const blogService = require('../services/shared/blog-service');

const imageUploadDir = path.join(__dirname, '../uploads/blog-images');
const videoUploadDir = path.join(__dirname, '../uploads/blog-videos');

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

    fs.mkdirSync(imageUploadDir, { recursive: true });
    fs.mkdirSync(videoUploadDir, { recursive: true });

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
    assertOk(!published.pinned, '新增文章默认不置顶');

    const pinned = await blogService.createArticle(db, {
      title: '测试博客-置顶',
      summary: '置顶简介',
      category: 'Clash',
      content: '# 置顶内容',
      status: 'published',
      pinned: true
    });
    assertOk(Boolean(pinned.pinned), '管理端可以新增置顶文章');

    const unpinned = await blogService.updateArticle(db, pinned.id, { pinned: false });
    assertOk(!unpinned.pinned, '管理端可以取消文章置顶');

    const repinned = await blogService.updateArticle(db, pinned.id, { pinned: true });
    assertOk(Boolean(repinned.pinned), '管理端可以重新置顶文章');

    const adminList = await blogService.listAdminArticles(db, { page: 1, limit: 20, keyword: '测试博客' });
    assertOk(adminList.list[0].id === pinned.id, '管理端列表置顶文章排在前面');

    const userList = await blogService.listPublishedArticles(db, { page: 1, limit: 20, keyword: '测试博客' });
    assertOk(
      userList.list.some((item) => item.id === published.id) &&
        !userList.list.some((item) => item.id === draft.id),
      '用户端列表只返回已发布文章'
    );
    assertOk(userList.list[0].id === pinned.id, '用户端列表置顶文章排在前面');

    const hiddenDraft = await blogService.getPublishedArticle(db, draft.id);
    assertOk(hiddenDraft === null, '用户端详情不能访问草稿文章');

    const categories = await blogService.listPublishedCategories(db);
    assertOk(categories.includes('Clash') && !categories.includes('订阅教程'), '分类列表只统计已发布文章分类');

    assertOk(
      blogService.getBlogMediaBaseUrl() === getExpectedSiteBaseUrl(),
      '博客媒体基础地址与站点基础地址一致'
    );

    const uploadedImageFilename = '44444444-4444-4444-8444-444444444444.png';
    const imageMarkdown = blogService.buildBlogImageMarkdown(uploadedImageFilename);
    assertOk(
      imageMarkdown === `![图片说明](${getExpectedSiteBaseUrl()}/api/user/help/images/${uploadedImageFilename})`,
      '博客图片 Markdown 会生成用户端可访问的绝对 URL'
    );

    assertOk(blogService.isAllowedBlogVideoMimeType('video/mp4'), '允许上传 MP4 博客视频');
    assertOk(!blogService.isAllowedBlogVideoMimeType('video/webm'), '第一版不允许上传非 MP4 博客视频');

    const uploadedVideoFilename = '55555555-5555-4555-8555-555555555555.mp4';
    const videoMarkdown = blogService.buildBlogVideoMarkdown(uploadedVideoFilename);
    assertOk(
      videoMarkdown === `<video controls preload="metadata" src="${getExpectedSiteBaseUrl()}/api/user/help/videos/${uploadedVideoFilename}"></video>`,
      '博客视频 HTML 会生成用户端可访问的绝对 URL'
    );

    const localImageA = '11111111-1111-4111-8111-111111111111.png';
    const localImageB = '22222222-2222-4222-8222-222222222222.webp';
    const localImageC = '33333333-3333-4333-8333-333333333333.gif';
    fs.writeFileSync(path.join(imageUploadDir, localImageA), 'image-a');
    fs.writeFileSync(path.join(imageUploadDir, localImageB), 'image-b');
    fs.writeFileSync(path.join(imageUploadDir, localImageC), 'image-c');

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

    await blogService.deleteArticle(db, articleWithImages.id, { uploadDir: imageUploadDir });
    assertOk(!fs.existsSync(path.join(imageUploadDir, localImageA)), '删除文章会清理不再被引用的本地图片');
    assertOk(fs.existsSync(path.join(imageUploadDir, localImageB)), '删除文章不会清理仍被其他文章引用的本地图片');
    assertOk(fs.existsSync(path.join(imageUploadDir, localImageC)), '删除文章不会清理未被该文章引用的本地图片');

    const localVideoA = '66666666-6666-4666-8666-666666666666.mp4';
    const localVideoB = '77777777-7777-4777-8777-777777777777.mp4';
    const localVideoC = '88888888-8888-4888-8888-888888888888.mp4';
    fs.writeFileSync(path.join(videoUploadDir, localVideoA), 'video-a');
    fs.writeFileSync(path.join(videoUploadDir, localVideoB), 'video-b');
    fs.writeFileSync(path.join(videoUploadDir, localVideoC), 'video-c');

    const articleWithVideos = await blogService.createArticle(db, {
      title: '测试博客-待删除视频',
      summary: '视频简介',
      category: '视频',
      content: [
        `<video controls src="/api/user/help/videos/${localVideoA}"></video>`,
        `<video controls preload="metadata" src="http://localhost:30000/api/user/help/videos/${localVideoB}"></video>`,
        '<video controls src="https://example.com/outside.mp4"></video>'
      ].join('\n'),
      status: 'published'
    });

    await blogService.createArticle(db, {
      title: '测试博客-共享视频',
      summary: '共享简介',
      category: '视频',
      content: `<video controls src="/api/user/help/videos/${localVideoB}"></video>`,
      status: 'published'
    });

    const extractedVideos = blogService.extractLocalBlogVideoFilenames(articleWithVideos.content);
    assertOk(
      extractedVideos.includes(localVideoA) && extractedVideos.includes(localVideoB),
      '可以解析文章内容中的本地博客视频引用'
    );

    await blogService.deleteArticle(db, articleWithVideos.id, { videoUploadDir });
    assertOk(!fs.existsSync(path.join(videoUploadDir, localVideoA)), '删除文章会清理不再被引用的本地视频');
    assertOk(fs.existsSync(path.join(videoUploadDir, localVideoB)), '删除文章不会清理仍被其他文章引用的视频');
    assertOk(fs.existsSync(path.join(videoUploadDir, localVideoC)), '删除文章不会清理未被该文章引用的视频');

    await cleanupTestArticles(db);
    for (const filename of [localImageB, localImageC]) {
      const filePath = path.join(imageUploadDir, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    for (const filename of [localVideoB, localVideoC]) {
      const filePath = path.join(videoUploadDir, filename);
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

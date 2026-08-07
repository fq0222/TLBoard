# Blog Video Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让博客帮助中心支持上传、预览、展示和播放 50MB 以内的 MP4 视频。

**Architecture:** 复用现有博客图片上传模式，新增视频专用上传目录、上传接口、用户端读取接口和 Markdown 插入片段。文章正文仍存储 Markdown/HTML 文本，删除文章时同时清理未被其他文章引用的图片和视频。

**Tech Stack:** Node.js Express、multer、PostgreSQL、Vue 3、Vite、Element Plus、marked。

---

## File Structure

- Modify: `server/services/shared/blog-service.js`
  - 增加视频 URL、HTML 片段、MIME 白名单、文件名校验和视频引用提取函数。
  - 将删除文章时的本地媒体清理扩展为图片和视频两类。
- Modify: `server/services/user/help-service.js`
  - 增加视频文件名校验和视频文件路径解析。
- Modify: `server/controllers/admin/blogs-controller.js`
  - 增加视频上传 handler，50MB 限制，只允许 MP4。
- Modify: `server/controllers/user/help-controller.js`
  - 增加视频读取 controller。
- Modify: `server/routes/admin/blogs.js`
  - 增加 `server/uploads/blog-videos/` 目录、视频 storage、`POST /upload-video`。
  - 删除文章时传入图片和视频目录。
- Modify: `server/routes/user/help.js`
  - 增加 `GET /videos/:filename`。
- Modify: `server/test/test-blog-articles.js`
  - 先写失败断言覆盖视频 payload、文件名解析和删除清理。
- Modify: `client-admin/src/api/index.js`
  - 增加 `uploadBlogVideo(formData)`，上传超时 60 秒。
- Modify: `client-admin/src/views/Blogs.vue`
  - 编辑工具栏增加上传视频按钮。
  - 成功后插入后端返回的 `<video>` 片段。
  - 预览区补充视频属性和样式。
- Modify: `client-user/src/views/user/HelpArticle.vue`
  - 渲染清洗时补充视频体验属性。
  - 正文样式支持响应式视频播放器。

---

### Task 1: 后端博客视频服务能力

**Files:**
- Modify: `server/test/test-blog-articles.js`
- Modify: `server/services/shared/blog-service.js`

- [ ] **Step 1: Write the failing test**

在 `server/test/test-blog-articles.js` 中：

```js
const imageUploadDir = path.join(__dirname, '../uploads/blog-images');
const videoUploadDir = path.join(__dirname, '../uploads/blog-videos');
```

并新增断言：

```js
fs.mkdirSync(videoUploadDir, { recursive: true });

assertOk(blogService.isAllowedBlogVideoMimeType('video/mp4'), '允许上传 MP4 博客视频');
assertOk(!blogService.isAllowedBlogVideoMimeType('video/webm'), '第一版不允许上传非 MP4 博客视频');

const uploadedVideoFilename = '55555555-5555-4555-8555-555555555555.mp4';
const videoMarkdown = blogService.buildBlogVideoMarkdown(uploadedVideoFilename);
assertOk(
  videoMarkdown === `<video controls preload="metadata" src="${getExpectedSiteBaseUrl()}/api/user/help/videos/${uploadedVideoFilename}"></video>`,
  '博客视频 HTML 会生成用户端可访问的绝对 URL'
);

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

await blogService.deleteArticle(db, articleWithVideos.id, {
  uploadDir: imageUploadDir,
  videoUploadDir
});
assertOk(!fs.existsSync(path.join(videoUploadDir, localVideoA)), '删除文章会清理不再被引用的本地视频');
assertOk(fs.existsSync(path.join(videoUploadDir, localVideoB)), '删除文章不会清理仍被其他文章引用的视频');
assertOk(fs.existsSync(path.join(videoUploadDir, localVideoC)), '删除文章不会清理未被该文章引用的视频');
```

清理末尾补充：

```js
for (const filename of [localVideoB, localVideoC]) {
  const filePath = path.join(videoUploadDir, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node server/test/test-blog-articles.js
```

Expected: FAIL，提示 `blogService.isAllowedBlogVideoMimeType is not a function` 或同类视频函数不存在。

- [ ] **Step 3: Write minimal implementation**

在 `server/services/shared/blog-service.js` 中增加：

```js
const BLOG_VIDEO_PREFIX = '/api/user/help/videos/';
const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4'];

function buildBlogVideoUrl(filename) {
  const baseUrl = getSiteBaseUrl();
  const videoPath = `${BLOG_VIDEO_PREFIX}${filename}`;
  return baseUrl ? `${baseUrl}${videoPath}` : videoPath;
}

function buildBlogVideoMarkdown(filename) {
  return `<video controls preload="metadata" src="${buildBlogVideoUrl(filename)}"></video>`;
}

function isAllowedBlogVideoMimeType(mimetype) {
  return ALLOWED_VIDEO_MIME_TYPES.includes(mimetype);
}

function buildUploadedVideoPayload(filename) {
  return {
    filename,
    url: buildBlogVideoUrl(filename),
    markdown: buildBlogVideoMarkdown(filename)
  };
}

function isSafeBlogVideoFilename(filename) {
  return /^[a-f0-9-]+\.mp4$/i.test(filename);
}

function extractLocalBlogVideoFilenames(content = '') {
  const filenames = new Set();
  const videoSrcRegex = /<video\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = videoSrcRegex.exec(content))) {
    const rawUrl = match[1];
    let pathname = rawUrl;
    try {
      pathname = new URL(rawUrl, 'http://local.test').pathname;
    } catch {
      pathname = rawUrl;
    }

    if (pathname.startsWith(BLOG_VIDEO_PREFIX)) {
      const filename = decodeURIComponent(path.basename(pathname));
      if (isSafeBlogVideoFilename(filename)) filenames.add(filename);
    }
  }

  return Array.from(filenames);
}
```

增加视频引用检查和清理：

```js
async function isVideoReferencedByOtherArticles(db, filename, excludeArticleId) {
  const rows = await blogRepository.listOtherArticleContents(db, excludeArticleId);
  return rows.some((row) => extractLocalBlogVideoFilenames(row.content).includes(filename));
}

async function cleanupUnreferencedBlogVideos(db, deletedArticle, { videoUploadDir, logger } = {}) {
  const filenames = extractLocalBlogVideoFilenames(deletedArticle.content);
  const deleted = [];

  for (const filename of filenames) {
    const stillReferenced = await isVideoReferencedByOtherArticles(db, filename, deletedArticle.id);
    if (stillReferenced) continue;

    const filePath = path.resolve(videoUploadDir, filename);
    const resolvedUploadDir = path.resolve(videoUploadDir);
    if (!filePath.startsWith(resolvedUploadDir + path.sep)) continue;

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deleted.push(filename);
      }
    } catch (error) {
      if (logger) logger.error(`删除博客视频失败: ${filename} - ${error.message}`);
    }
  }

  return deleted;
}
```

在 `deleteArticle()` 中补充：

```js
if (options.videoUploadDir) {
  await cleanupUnreferencedBlogVideos(db, existing, options);
}
```

并导出所有新增函数。

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node server/test/test-blog-articles.js
```

Expected: PASS，输出包含“允许上传 MP4 博客视频”和“删除文章会清理不再被引用的本地视频”。

---

### Task 2: 后端上传和播放接口

**Files:**
- Modify: `server/services/user/help-service.js`
- Modify: `server/controllers/admin/blogs-controller.js`
- Modify: `server/controllers/user/help-controller.js`
- Modify: `server/routes/admin/blogs.js`
- Modify: `server/routes/user/help.js`

- [ ] **Step 1: Add user help video path helpers**

在 `server/services/user/help-service.js` 增加：

```js
const HELP_VIDEO_UPLOAD_DIR = path.join(__dirname, '../../uploads/blog-videos');
const HELP_VIDEO_FILENAME_PATTERN = /^[a-f0-9-]+\.mp4$/i;

function isSafeHelpVideoFilename(filename) {
  return HELP_VIDEO_FILENAME_PATTERN.test(filename);
}

function resolveHelpVideoFile(filename) {
  const safeFilename = path.basename(filename);
  const filePath = path.resolve(HELP_VIDEO_UPLOAD_DIR, safeFilename);
  const uploadRoot = path.resolve(HELP_VIDEO_UPLOAD_DIR);

  return {
    filename: safeFilename,
    filePath,
    uploadRoot,
    isInsideUploadRoot: filePath.startsWith(uploadRoot + path.sep)
  };
}
```

并导出两个新函数。

- [ ] **Step 2: Add upload controller**

在 `server/controllers/admin/blogs-controller.js` 增加：

```js
function createVideoUploadHandler({ storage }) {
  return function uploadVideo(req, res) {
    const upload = multer({
      storage,
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter(_req, file, cb) {
        if (!blogService.isAllowedBlogVideoMimeType(file.mimetype)) {
          return cb(new Error('只允许上传 MP4 视频'));
        }
        cb(null, true);
      }
    }).single('file');

    upload(req, res, (error) => {
      if (error) {
        const message = error.code === 'LIMIT_FILE_SIZE'
          ? '视频大小不能超过 50MB'
          : error.message;
        return handleBusinessError(res, message);
      }

      if (!req.file) {
        return handleBusinessError(res, '请选择要上传的视频');
      }

      const data = blogService.buildUploadedVideoPayload(req.file.filename);
      logger.info(`上传博客视频成功: ${req.file.filename}`);
      return legacySuccess(res, data);
    });
  };
}
```

并导出 `createVideoUploadHandler`。

- [ ] **Step 3: Add video read controller**

在 `server/controllers/user/help-controller.js` 增加：

```js
function getHelpVideo(req, res) {
  try {
    if (!validationResult(req).isEmpty()) {
      return legacyNotFound(res, { message: '视频不存在' });
    }

    const videoFile = helpService.resolveHelpVideoFile(req.params.filename);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (!videoFile.isInsideUploadRoot) {
      return legacyNotFound(res, { message: '视频不存在' });
    }

    return res.sendFile(videoFile.filePath, (error) => {
      if (error && !res.headersSent) {
        legacyNotFound(res, { message: '视频不存在' });
      }
    });
  } catch (error) {
    logger.error(`读取帮助中心视频错误: ${error.message}`);
    return legacyFail(res);
  }
}
```

并导出 `getHelpVideo`。

- [ ] **Step 4: Wire routes**

在 `server/routes/admin/blogs.js` 增加：

```js
const VIDEO_UPLOAD_DIR = path.join(__dirname, '../../uploads/blog-videos');
if (!fs.existsSync(VIDEO_UPLOAD_DIR)) {
  fs.mkdirSync(VIDEO_UPLOAD_DIR, { recursive: true });
}

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VIDEO_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});
```

更新删除选项：

```js
req.blogDeleteOptions = {
  uploadDir: UPLOAD_DIR,
  videoUploadDir: VIDEO_UPLOAD_DIR
};
```

新增路由：

```js
router.post('/upload-video', authenticateAdmin, blogsController.createVideoUploadHandler({ storage: videoStorage }));
```

在 `server/routes/user/help.js` 增加：

```js
router.get('/videos/:filename', [
  param('filename').custom((value) => helpService.isSafeHelpVideoFilename(value))
], helpController.getHelpVideo);
```

- [ ] **Step 5: Run backend test**

Run:

```bash
node server/test/test-blog-articles.js
```

Expected: PASS。

---

### Task 3: 管理端上传视频入口

**Files:**
- Modify: `client-admin/src/api/index.js`
- Modify: `client-admin/src/views/Blogs.vue`

- [ ] **Step 1: Add API method**

在 `client-admin/src/api/index.js` 的 `uploadBlogImage()` 后新增：

```js
uploadBlogVideo(formData) {
  return apiClient.post('/blogs/upload-video', formData, {
    timeout: 60000,
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}
```

- [ ] **Step 2: Add upload button and state**

在 `client-admin/src/views/Blogs.vue` 中：

```js
const videoUploading = ref(false)
```

编辑工具栏图片上传旁新增：

```vue
<el-upload
  action="#"
  :show-file-list="false"
  :auto-upload="false"
  accept="video/mp4"
  :on-change="handleVideoSelected"
>
  <el-button :loading="videoUploading">
    <el-icon><Upload /></el-icon>
    上传视频
  </el-button>
</el-upload>
```

新增方法：

```js
async function handleVideoSelected(uploadFile) {
  if (!uploadFile?.raw) return
  const formData = new FormData()
  formData.append('file', uploadFile.raw)

  try {
    videoUploading.value = true
    const response = await api.admin.uploadBlogVideo(formData)
    if (response.code === 0) {
      insertAtCursor(response.data.markdown)
      ElMessage.success('视频上传成功')
    }
  } catch (error) {
    console.error('上传视频失败:', error)
  } finally {
    videoUploading.value = false
  }
}
```

- [ ] **Step 3: Preserve video attributes and style preview**

在 `sanitizeHtml()` 中补充：

```js
template.content.querySelectorAll('video').forEach((node) => {
  node.setAttribute('controls', 'controls')
  node.setAttribute('preload', 'metadata')
  node.setAttribute('playsinline', 'playsinline')
})
```

在样式中增加：

```css
.markdown-body :deep(video) {
  display: block;
  max-width: 100%;
  width: 100%;
  height: auto;
  border-radius: 8px;
  background: #000;
  margin: 0 0 14px;
}
```

- [ ] **Step 4: Build admin client**

Run:

```bash
cd client-admin
npx vite build --minify esbuild
```

Expected: build succeeds。

---

### Task 4: 用户端视频展示样式

**Files:**
- Modify: `client-user/src/views/user/HelpArticle.vue`

- [ ] **Step 1: Add video rendering hardening**

在 `sanitizeHtml()` 的图片处理后增加：

```js
template.content.querySelectorAll('video').forEach((node) => {
  node.setAttribute('controls', 'controls')
  node.setAttribute('preload', 'metadata')
  node.setAttribute('playsinline', 'playsinline')
})
```

- [ ] **Step 2: Add responsive video CSS**

在 `.markdown-body :deep(img)` 后增加：

```css
.markdown-body :deep(video) {
  display: block;
  max-width: 100%;
  width: 100%;
  height: auto;
  border-radius: 8px;
  background: #000;
  margin: 0 0 16px;
}
```

- [ ] **Step 3: Build user client**

Run:

```bash
cd client-user
npx vite build --minify esbuild
```

Expected: build succeeds。

---

### Task 5: Final verification

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run backend blog test**

Run:

```bash
node server/test/test-blog-articles.js
```

Expected: PASS。

- [ ] **Step 2: Build admin client**

Run:

```bash
cd client-admin
npx vite build --minify esbuild
```

Expected: build succeeds。

- [ ] **Step 3: Build user client**

Run:

```bash
cd client-user
npx vite build --minify esbuild
```

Expected: build succeeds。

- [ ] **Step 4: Report server restart requirement**

Because this changes `server/**/*.js`, tell the user to restart the server after review/deploy.

---

## Self Review

- Spec coverage: upload, 50MB limit, MP4-only, playback route, admin insertion, admin preview, user playback, deletion cleanup, and deployment note are covered.
- Placeholder scan: no `TBD`, `TODO`, or unspecified task remains.
- Type consistency: backend payload field remains `markdown`; frontend reuses existing `insertAtCursor(markdown)` path.

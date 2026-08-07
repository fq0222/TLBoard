# 博客视频展示与播放设计

## 背景

当前博客系统作为用户端帮助中心使用。管理端通过 Markdown 编辑文章，支持上传图片并自动插入图片 Markdown；用户端读取已发布文章并用 `marked` 渲染正文。

现有能力只覆盖图片：

- 管理端接口：`POST /api/admin/blogs/upload-image`
- 图片大小限制：5MB
- 图片目录：`server/uploads/blog-images/`
- 用户端访问：`GET /api/user/help/images/:filename`

本次需要在博客文章中支持视频展示和播放，单个视频限制在 50MB 以内。

## 目标

- 管理端博客编辑器支持上传视频。
- 上传成功后自动向 Markdown 内容插入可播放的 HTML 片段。
- 用户端帮助文章详情页可以展示并播放视频。
- 管理端预览区可以展示并播放视频。
- 删除文章时，清理不再被任何文章引用的本地博客视频文件。
- 视频文件单个大小不超过 50MB。

## 非目标

- 不做视频转码、压缩、封面图生成。
- 不做断点续传或分片上传。
- 不做视频在线播放鉴权强化；沿用帮助中心图片的公开读取方式。
- 不接入对象存储或 CDN。
- 不支持把视频作为资源中心下载文件管理。

## 推荐方案

新增独立的视频上传和读取链路，复用现有博客文章 Markdown 存储方式。

### 后端

新增视频上传目录：

```text
server/uploads/blog-videos/
```

新增管理端上传接口：

```text
POST /api/admin/blogs/upload-video
```

接口规则：

- 需要管理员登录。
- 使用 `multer.diskStorage` 保存文件。
- 单文件限制为 `50 * 1024 * 1024` 字节。
- 第一版只允许 `video/mp4`。
- 文件名继续使用 `crypto.randomUUID()` 加原始扩展名。
- 成功返回：

```json
{
  "filename": "uuid.mp4",
  "url": "/api/user/help/videos/uuid.mp4",
  "markdown": "<video controls preload=\"metadata\" src=\"/api/user/help/videos/uuid.mp4\"></video>"
}
```

新增用户端视频读取接口：

```text
GET /api/user/help/videos/:filename
```

读取规则：

- 文件名只允许 UUID 风格的 `.mp4` 文件。
- 路径解析必须限制在 `server/uploads/blog-videos/` 内。
- 响应设置 `Cross-Origin-Resource-Policy: cross-origin`，保持与图片读取一致。
- 使用 `res.sendFile()` 返回视频文件。

### 服务层

在 `server/services/shared/blog-service.js` 中增加博客视频相关工具函数：

- `BLOG_VIDEO_PREFIX`
- `isAllowedBlogVideoMimeType(mimetype)`
- `buildBlogVideoUrl(filename)`
- `buildBlogVideoMarkdown(filename)`
- `buildUploadedVideoPayload(filename)`
- `isSafeBlogVideoFilename(filename)`
- `extractLocalBlogVideoFilenames(content)`
- `cleanupUnreferencedBlogMedia(...)`

现有图片清理函数可以保持兼容，同时新增视频清理逻辑。删除文章时分别检查图片和视频是否仍被其他文章引用，只有未引用时删除本地文件。

在 `server/services/user/help-service.js` 中增加：

- `isSafeHelpVideoFilename(filename)`
- `resolveHelpVideoFile(filename)`

### 管理端

在 `client-admin/src/api/index.js` 增加：

```js
uploadBlogVideo(formData) {
  return apiClient.post('/blogs/upload-video', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000
  })
}
```

在 `client-admin/src/views/Blogs.vue` 的编辑工具栏中增加“上传视频”按钮：

- `accept="video/mp4"`
- 使用独立的 `videoUploading` 状态。
- 成功后将后端返回的 HTML 片段插入当前光标位置。

管理端预览区保留现有 HTML 清洗逻辑，但需要确认 `video` 和 `source` 标签不会被移除，并移除危险事件属性与 `javascript:` 链接。

### 用户端

用户端 `client-user/src/views/user/HelpArticle.vue` 的 Markdown 渲染继续使用现有 `marked` + 清洗逻辑。

对视频元素补充安全和体验属性：

- 保留 `controls`。
- 设置 `preload="metadata"`。
- 可选设置 `playsinline`，改善移动端体验。

补充样式：

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

管理端预览样式保持一致。

## 数据流

1. 管理员在博客编辑器选择 `.mp4` 文件。
2. 管理端调用 `POST /api/admin/blogs/upload-video`。
3. 后端校验 MIME 和大小，保存到 `server/uploads/blog-videos/`。
4. 后端返回可访问 URL 和 HTML 片段。
5. 管理端把 HTML 片段插入文章 Markdown 内容。
6. 文章保存后，用户端详情页渲染为 `<video>` 播放器。
7. 用户播放时浏览器请求 `/api/user/help/videos/:filename`。
8. 删除文章时，后端扫描文章内容中的本地视频引用，清理未被其他文章引用的视频文件。

## 错误处理

- 文件超过 50MB：返回业务错误“视频大小不能超过 50MB”。
- 文件格式不支持：返回业务错误“只允许上传 MP4 视频”。
- 未选择文件：返回业务错误“请选择要上传的视频”。
- 视频文件不存在或文件名非法：用户端读取接口返回 404。
- 上传失败时不修改文章内容。

## 安全

- 视频文件名使用 UUID，避免暴露原始文件名。
- 读取接口校验扩展名和文件名格式，避免路径穿越。
- HTML 清洗继续移除 `script`、`iframe`、`object`、`embed`、`style`、`link`。
- 清洗逻辑继续移除所有 `on*` 事件属性和 `javascript:` 值。
- 第一版只允许 MP4，减少浏览器兼容和 MIME 分支复杂度。

## 测试

后端测试扩展 `server/test/test-blog-articles.js`：

- MP4 MIME 类型允许上传。
- 非视频 MIME 类型拒绝上传。
- 生成的视频 URL 和 HTML 片段符合预期。
- 从文章内容中提取本地视频文件名。
- 删除文章时清理未被引用的视频。
- 删除文章时保留仍被其他文章引用的视频。

前端验证：

- `client-admin` 执行构建。
- `client-user` 执行构建。

后端改动涉及 `server/**/*.js`，完成后需要提醒用户重启服务器。

## 部署注意

如果生产环境前面有 Nginx，需要同步配置：

```nginx
client_max_body_size 50m;
```

如果还有其他反向代理或 WAF，也需要保证请求体限制不低于 50MB。

## 规格自检

- 无未定项或占位符。
- 范围限定在博客帮助中心的视频上传与播放。
- 不引入转码、分片、对象存储等额外复杂度。
- 50MB 限制在后端上传接口明确执行。
- 删除清理策略与现有图片逻辑一致。

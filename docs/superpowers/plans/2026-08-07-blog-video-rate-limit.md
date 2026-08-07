# Blog Video Rate Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为博客视频播放/下载增加后台可配置的进程内全局限速，默认 300KB/s，并复用资源下载已有的全局限速机制。

**Architecture:** 将资源下载中已有的 `GlobalThrottle` 和 `GlobalThrottleStream` 抽到共享服务，资源下载保留现有行为。博客视频读取从 `res.sendFile()` 改为支持 `Range` 的文件流响应，并通过独立的博客视频 throttle 实例限制所有视频请求共享同一总带宽。

**Tech Stack:** Node.js Express、fs stream、Transform stream、Vue 3、Element Plus、PostgreSQL system_settings。

---

## Tasks

### Task 1: 共享全局限速器

**Files:**
- Create: `server/services/shared/global-throttle-stream.js`
- Modify: `server/services/user/download-service.js`
- Test: `server/test/test-global-throttle-stream.js`

- [ ] 写失败测试：断言 `createGlobalThrottle()` 可创建独立实例，限速流注册/销毁后 active count 会归零。
- [ ] 抽出 `GlobalThrottle`、`GlobalThrottleStream` 和 `createGlobalThrottle()`。
- [ ] 修改资源下载继续使用共享限速器，保持 `createDownloadStream()` 返回结构不变。
- [ ] 跑 `node server/test/test-global-throttle-stream.js` 和现有资源/博客相关测试。

### Task 2: 博客视频 Range 响应服务

**Files:**
- Create: `server/services/user/help-video-service.js`
- Modify: `server/controllers/user/help-controller.js`
- Test: `server/test/test-help-video-service.js`

- [ ] 写失败测试：无 Range 返回 200；有效 Range 返回 206；非法 Range 返回 416；默认限速为 300KB/s。
- [ ] 新增 `getBlogVideoConfig()`，读取 `system_settings.resource_config.blog_video_speed_limit`，默认 300。
- [ ] 新增 `buildVideoResponse()` 解析 Range 并生成响应头。
- [ ] 新增 `createVideoStream()`，使用博客视频独立 throttle 实例限速。
- [ ] 将 `getHelpVideo()` 从 `sendFile()` 改为服务层流式输出。

### Task 3: 后台设置支持博客视频限速

**Files:**
- Modify: `server/services/admin/system-settings-service.js`
- Modify: `server/routes/admin/resources.js`
- Modify: `server/routes/admin/system-settings.js`
- Modify: `client-admin/src/views/Settings.vue`

- [ ] 将 `DEFAULT_RESOURCE_CONFIG` 增加 `blog_video_speed_limit: 300`。
- [ ] 读取/保存资源配置时归一化该字段。
- [ ] 后端路由校验 `blog_video_speed_limit >= 0`。
- [ ] 设置页资源配置表单增加“博客视频全局限速 KB/s”输入。

### Task 4: Final verification

**Files:**
- Verify touched files.

- [ ] 运行：
  - `node server/test/test-global-throttle-stream.js`
  - `node server/test/test-help-video-service.js`
  - `node server/test/test-blog-articles.js`
  - `npx vite build --minify esbuild` in `client-admin`
  - `npx vite build --minify esbuild` in `client-user`
- [ ] 提醒用户后端改动需要重启服务器。

## Self Review

- 默认博客视频限速明确为 300KB/s。
- 资源下载继续使用原配置 `download_speed_limit`，不改变资源下载行为。
- 博客视频和资源下载使用不同 throttle 实例，互不抢带宽。
- Range 支持覆盖浏览器播放和拖动进度条。

# 帮助中心与博客管理设计

## 背景

用户端需要在“工单支持”下方增加“帮助中心”，以卡片形式展示帮助文章。文章内容使用 Markdown 编写并支持 Markdown 渲染，方便维护订阅、Clash、CF IP、付款续费等使用教程。

管理端需要在“资源管理”下方增加“博客管理”，支持新增、编辑、预览、删除 Markdown 文章，并支持上传 Markdown 中引用的图片。

## 目标

- 用户端新增仅登录用户可见的帮助中心。
- 管理端新增博客管理页面。
- 文章支持草稿和已发布两种状态。
- 用户端只展示已发布文章。
- 文章支持分类、标题/简介搜索、分页和详情阅读。
- Markdown 内容支持图片显示。
- 管理端上传图片后自动插入 Markdown 图片语法到当前光标位置。
- 删除文章时自动清理该文章引用且不再被其他文章引用的本地博客图片。

## 非目标

- 第一版不做封面图。
- 第一版不做正文全文搜索。
- 第一版不做拖拽或粘贴图片自动上传。
- 第一版不做文章置顶、排序、批量操作或公开访问。
- 第一版不把文章保存为真实 `.md` 文件，文章 Markdown 内容存储在数据库中。

## 信息架构

### 用户端

在用户中心侧边栏 `工单支持` 下方新增菜单：

- `帮助中心`

路由：

- `/user/help`：帮助中心文章列表
- `/user/help/:id`：帮助文章详情

帮助中心沿用用户中心现有登录态。未登录访问时走现有登录跳转逻辑。

### 管理端

在管理端侧边栏 `资源管理` 下方新增菜单：

- `博客管理`

路由：

- `/admin/blogs`：博客文章列表与管理

## 用户端功能

### 帮助中心列表

列表页面包含：

- 搜索框：按标题和简介搜索。
- 分类筛选：展示“全部”和已发布文章中存在的分类。
- 文章卡片：展示标题、简介、分类、更新时间。
- 分页：使用现有分页组件风格。

点击文章卡片进入详情页。

### 帮助文章详情

详情页展示：

- 返回列表按钮。
- 标题。
- 分类和更新时间。
- Markdown 渲染后的正文。

Markdown 需支持标题、段落、列表、代码块、链接和图片。图片使用后端返回的公开图片 URL。

## 管理端功能

### 博客列表

博客管理列表支持：

- 搜索标题和简介。
- 分类筛选。
- 状态筛选：全部、草稿、已发布。
- 表格列：标题、分类、状态、更新时间、操作。
- 操作：编辑、预览、发布/设为草稿、删除。

### 新增和编辑文章

新增和编辑使用同一套表单体验，字段包括：

- 标题：必填。
- 简介：必填。
- 分类：可选。
- Markdown 内容：必填。
- 状态：草稿或已发布。

编辑区采用 Markdown 输入区和预览区并列的布局。预览区使用 `marked` 渲染，尽量与用户端展示一致。

### 图片上传

管理端编辑器提供“上传图片”按钮：

1. 管理员选择图片。
2. 后端保存图片到博客图片目录。
3. 后端返回 Markdown 可用的图片 URL。
4. 前端自动在当前光标位置插入：

```md
![图片说明](图片URL)
```

图片上传限制：

- 只允许 `image/jpeg`、`image/png`、`image/gif`、`image/webp`。
- 单张图片最大 5MB。
- 文件名使用 UUID，避免暴露原始文件名和减少冲突。

### 删除文章和图片清理

删除文章时，后端需要解析该文章 Markdown 内容中的图片引用，并清理不再被任何文章引用的本地博客图片。

清理规则：

- 只处理本系统博客图片目录中的图片。
- 不删除外链图片。
- 如果同一张图片仍被其他文章引用，则不删除。
- 文章删除成功后再清理图片。
- 图片删除失败只记录日志，不阻断文章删除成功。

## 后端设计

### 数据库

新增表 `blog_articles`：

```sql
CREATE TABLE IF NOT EXISTS blog_articles (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  category VARCHAR(100),
  content TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'draft',
  created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
);
```

建议索引：

- `idx_blog_articles_status`
- `idx_blog_articles_category`
- `idx_blog_articles_updated_at`

`status` 只允许：

- `draft`
- `published`

### 文件存储

博客图片存储目录：

- `server/uploads/blog-images/`

用户端图片访问 URL：

- `/api/user/help/images/:filename`

图片 URL 本身不做登录校验，但只允许访问博客图片目录中的文件。文章页面和文章 API 仍需要登录。

### 用户端 API

- `GET /api/user/help/articles`
  - 获取已发布文章列表。
  - 支持 `page`、`limit`、`category`、`keyword`。
  - 只按标题和简介搜索。

- `GET /api/user/help/articles/:id`
  - 获取已发布文章详情。
  - 草稿文章返回不存在或无权访问。

- `GET /api/user/help/categories`
  - 获取已发布文章分类列表。

- `GET /api/user/help/images/:filename`
  - 返回博客图片文件。
  - 不校验登录。

### 管理端 API

- `GET /api/admin/blogs`
  - 获取文章列表。
  - 支持 `page`、`limit`、`category`、`status`、`keyword`。

- `POST /api/admin/blogs`
  - 新增文章。

- `GET /api/admin/blogs/:id`
  - 获取文章详情。

- `PUT /api/admin/blogs/:id`
  - 编辑文章。

- `DELETE /api/admin/blogs/:id`
  - 删除文章并清理不再被引用的本地博客图片。

- `POST /api/admin/blogs/upload-image`
  - 上传博客图片并返回图片 URL。

- `GET /api/admin/blogs/categories`
  - 获取文章分类列表。

## 安全与校验

- 管理端接口全部使用 `authenticateAdmin`。
- 用户端文章列表和详情使用用户登录校验。
- 用户端图片接口不校验登录，但必须防止路径穿越，只允许读取博客图片目录中的文件。
- 标题、简介、内容必填。
- 标题最大长度 200。
- 简介最大长度 500。
- 分类最大长度 100。
- 状态只允许 `draft` 和 `published`。
- Markdown 渲染前端需过滤危险 HTML，至少避免 `<script>`、`<iframe>` 等标签执行。
- 图片上传限制 MIME 类型和文件大小。

## 测试计划

### 后端

新增 `server/test/test-blog-articles.js`，覆盖：

- 管理端新增草稿文章。
- 管理端编辑文章。
- 管理端发布文章。
- 用户端列表只返回已发布文章。
- 用户端详情不能访问草稿文章。
- 分类列表只统计已发布文章分类。
- 上传图片成功返回可访问 URL。
- 删除文章时清理该文章引用且不再被其他文章引用的本地图片。
- 删除文章时不删除外链图片。
- 删除文章时不删除仍被其他文章引用的本地图片。

### 前端

- `client-user` 执行生产构建。
- `client-admin` 执行生产构建。

### 人工验证

- 管理端新增草稿文章并预览 Markdown。
- 上传图片后确认 Markdown 自动插入到光标位置。
- 发布文章后用户端帮助中心可见。
- 用户端分类筛选和搜索生效。
- 删除文章后确认文章不可见，并确认不再引用的本地图片被清理。

## 运维注意

后端新增路由、数据库表和上传目录后，部署时需要重启 server 服务。修改 `server/**/*.js` 后按项目规范提醒用户重启服务器，不由 Codex 自行启动。

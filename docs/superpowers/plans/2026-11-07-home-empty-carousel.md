# 首页无套餐轮播 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当首页套餐接口成功返回空列表时，以 4 张本地大图组成的自动轮播替换完整套餐区域。

**Architecture:** 继续由 `Home.vue` 管理套餐请求状态，并利用现有 `loading → loadError → success` 分支保证轮播只在成功空列表时出现。图片经离线压缩后作为 Vite 本地资产导入，轮播复用 Element Plus Carousel，通过响应式 CSS 固定三个断点高度。

**Tech Stack:** Vue 3、Element Plus 2.4、Vite 5、Vitest、Vue Test Utils、FFmpeg WebP 编码

**Spec:** `docs/superpowers/specs/2026-11-07-home-empty-carousel-design.md`

## Global Constraints

- 不新增 npm 依赖，不修改后端和管理端。
- 仅当套餐请求成功且 `plans.length === 0` 时展示轮播；加载中、加载失败和单分类为空保持原行为。
- 轮播间隔固定为 5000ms，隐藏箭头和指示点，鼠标悬停暂停，无文案、无链接。
- 高度固定为桌面 745px、平板 520px、手机 320px，图片使用居中 `cover` 裁切。
- 轮播必须始终自动播放，不受 `prefers-reduced-motion` 系统设置影响。
- 图片只从 `C:\Users\fq\Downloads` 当前保留的 4 张数字文件名素材生成，源文件不得修改。
- 遵守项目规则：新方法和新测试辅助结构补充职责注释；用户未明确要求提交，因此实施期间不执行 `git add` 或 `git commit`。

## Review Focus

- 首次请求尚未完成且 `plans` 初始为空时仍应显示骨架屏，不得提前闪现轮播；Task 1 组件测试覆盖。
- 空列表请求失败时仍应显示错误与重试按钮，不得以轮播掩盖错误；Task 1 组件测试覆盖。
- 仅当前分类为空而全部套餐非空时仍应显示分类空状态；Task 1 组件测试覆盖。
- 系统关闭动画效果时轮播仍必须保持 `autoplay=true`；Task 1 组件测试覆盖。
- 4 张图片的数字顺序、资源存在性以及三个高度断点必须稳定；Task 1 组件/静态契约测试覆盖。

---

### Task 1: 首页成功空状态轮播

**Files:**
- Create: `client-user/src/assets/home-carousel/456536.webp`
- Create: `client-user/src/assets/home-carousel/736462.webp`
- Create: `client-user/src/assets/home-carousel/789596.webp`
- Create: `client-user/src/assets/home-carousel/1322308.webp`
- Create: `client-user/component-tests/home-empty-carousel.component.spec.js`
- Modify: `client-user/src/views/Home.vue:14-143,148-181,304-571,777-884`
- Modify: `client-user/test/home-plan-display.test.js`

**Interfaces:**
- Consumes: `api.user.getPlans(referralCode)` 返回的 `{ code, data: { plans } }`；Element Plus `<el-carousel>` / `<el-carousel-item>`。
- Produces: `homeCarouselImages: Array<{ name: string, src: string }>`；模板根节点 `.home-empty-carousel` 和图片节点 `.home-carousel-image`。

- [ ] **Step 1: 编写失败的真实组件测试**

在 `client-user/component-tests/home-empty-carousel.component.spec.js` 挂载真实 `Home.vue`，mock API、用户 store、路由和具名 `ElCarousel` stub，并实现以下测试：

```js
it('全部套餐成功为空时以四张轮播图替换完整套餐区域', async () => {
  // 断言 .home-empty-carousel 存在；标题、筛选器、套餐卡和 .plans-state 均不存在。
  // 断言四张 .home-carousel-image 的 alt/顺序为 456536、736462、789596、1322308。
  // 断言 ElCarousel props: interval=5000, arrow='never', indicatorPosition='none', pauseOnHover=true。
})

it('请求未完成或失败时不提前展示轮播', async () => {
  // pending 时仅有 .plans-loading；reject 后仅有包含“套餐加载失败”的 .plans-state。
})

it('仅当前分类为空时保留分类空状态', async () => {
  // API 返回一个 timed 套餐，点击住宅IP 后断言无轮播且显示“当前分类暂无套餐”。
})

it('系统关闭动画效果时仍按首页配置自动播放', async () => {
  // mock matchMedia(...).matches=true，断言 ElCarousel autoplay=true。
})
```

- [ ] **Step 2: 运行组件测试确认失败**

Run: `npm run test:component -- home-empty-carousel.component.spec.js`（工作目录 `client-user/`）

Expected: FAIL，原因是 `.home-empty-carousel` 和轮播图片尚不存在。

- [ ] **Step 3: 转换并压缩 4 张本地图片**

创建 `client-user/src/assets/home-carousel/`，使用 FFmpeg 将图片最长宽度限制为 1920px，以 WebP quality 82、compression level 6 输出对应数字文件名；每条命令带 `-frames:v 1`，且输入始终指向下载目录、输出始终指向项目资产目录。完成后确认源文件时间和大小未改变，4 个 WebP 均能被识别且单张小于原文件。

- [ ] **Step 4: 在 `Home.vue` 实现成功空列表轮播**

导入 4 个 WebP，并定义带职责注释的 `homeCarouselImages` 数组。将标题、筛选器和套餐展示包装进成功非空分支，并保持分支优先级为：加载骨架 → 加载失败 → 全部套餐为空轮播 → 正常标题/筛选器/套餐卡。

轮播精确属性：`:interval="5000"`、`:autoplay="true"`、`:pause-on-hover="true"`、`arrow="never"`、`indicator-position="none"`；每张图片提供不包含营销承诺的描述性 `alt`，首张图片 `loading="eager"`，其余图片 `loading="lazy"`。

- [ ] **Step 5: 添加响应式样式**

为 `.home-empty-carousel`、`.home-carousel-slide`、`.home-carousel-image` 添加圆角、溢出裁切、100% 宽高与 `object-fit: cover; object-position: center;`。桌面高度 745px；既有 `@media (max-width: 1024px)` 中覆盖为 520px；既有 `@media (max-width: 768px)` 中覆盖为 320px。通过 `:deep()` 确保 Element Plus Carousel 容器、item 和内部列表继承固定高度。

- [ ] **Step 6: 运行组件测试确认通过**

Run: `npm run test:component -- home-empty-carousel.component.spec.js`（工作目录 `client-user/`）

Expected: 新增 4 个场景全部 PASS，且现有组件测试无失败。

- [ ] **Step 7: 补充静态契约测试**

在 `client-user/test/home-plan-display.test.js` 增加两个测试：

```js
test('首页轮播按数字顺序引用四张本地 WebP 资产', () => {
  // 断言四个 import/数组项顺序及对应资产文件均存在。
})

test('首页轮播固定三个响应式高度并居中覆盖图片', () => {
  // 断言 745px、max-width 1024 下 520px、max-width 768 下 320px，以及 object-fit/object-position。
})
```

- [ ] **Step 8: 运行用户端相关测试**

Run: `node --test test/home-plan-display.test.js`（工作目录 `client-user/`）

Expected: 全部 PASS。

Run: `npm run test:component`（工作目录 `client-user/`）

Expected: 全部组件测试 PASS。

- [ ] **Step 9: 执行生产构建**

Run: `npm run build`（工作目录 `client-user/`）

Expected: Vite 构建退出码 0，4 张 WebP 均进入 `dist/assets`，无 Vue 模板或 CSS 错误。

- [ ] **Step 10: 检查最终差异和测试日志**

Run: `git diff --check`

Expected: 无尾随空格或补丁格式错误。

Run: `git status --short`

Expected: 仅包含设计/计划文档、`Home.vue`、测试文件和 4 张 WebP；不包含下载目录源文件或无关修改。向用户展示组件测试、静态测试和构建日志，不提交改动。

---

### Task 2: 轮播图片构建时自动发现

**Files:**
- Modify: `client-user/src/views/Home.vue`
- Modify: `client-user/test/home-plan-display.test.js`

**Interfaces:**
- Consumes: `import.meta.glob('/src/assets/home-carousel/*.{png,jpg,jpeg,webp,gif}', { eager: true, import: 'default' })` 返回的路径到资源 URL 映射。
- Produces: 按数字文件名升序排列的 `homeCarouselImages: Array<{ name: string, src: string }>`。

- [ ] **Step 1: 修改静态契约测试，要求目录自动发现且不存在逐张 import**
- [ ] **Step 2: 运行 `node --test test/home-plan-display.test.js`，确认因缺少 `import.meta.glob` 失败**
- [ ] **Step 3: 以单个 eager glob 替换 4 条静态 import 和手工数组，使用数字感知排序并生成通用替代文本**
- [ ] **Step 4: 运行静态契约、首页组件测试、完整组件测试和生产构建**
- [ ] **Step 5: 运行 `git diff --check` 并保持改动未暂存、未提交**


# 管理端 Tailwind CSS 响应式改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变管理端桌面视觉和业务行为的前提下，引入 Tailwind CSS，并让全部管理页面在 375px 及以上移动视口可用。

**Architecture:** 保留 Vue 3 与 Element Plus 组件，以关闭 Preflight、使用 `tw-` 前缀的 Tailwind 工具类补充响应式布局。桌面端继续渲染原有表格，七个核心数据页面在移动端渲染复用同一数据和操作方法的卡片视图，其余复杂表格仅在自身容器内横向滚动。

**Tech Stack:** Vue 3、Vite 5、Element Plus、Tailwind CSS 3、PostCSS、Node.js 内置测试运行器

**Spec:** `docs/superpowers/specs/2026-09-11-admin-tailwind-responsive-design.md`

## Global Constraints

- 不修改后端接口、数据库结构或管理端路由地址。
- 不替换 Element Plus，不改变桌面端布局、配色、组件尺寸和主要交互。
- Tailwind 必须关闭 Preflight，并使用 `tw-` 类名前缀。
- 主要响应式断点为 768px；复杂双栏内容允许在 960px 切换为单列。
- 移动端支持的最小验收宽度为 375px。
- 移动端卡片与桌面表格必须共享数据、分页、loading 和业务操作方法。
- 桌面表格不得删除；低频复杂表格只能在自己的容器内横向滚动。
- 不创建或切换 Git 分支，不创建 worktree。
- 不修改 `server/**/*.js`。
- 新建文件和新增方法使用项目现有风格，并添加职责、关键参数和核心分支语义注释。
- 每个任务提交前先运行该任务列出的定向测试；最终运行管理端全部测试与生产构建。

---

### Task 1: Tailwind 构建基础与防冲突契约

**Files:**
- Modify: `client-admin/package.json`
- Modify: `client-admin/package-lock.json`
- Create: `client-admin/tailwind.config.js`
- Create: `client-admin/postcss.config.js`
- Create: `client-admin/src/styles/tailwind.css`
- Modify: `client-admin/src/main.js`
- Create: `client-admin/test/tailwind-setup.test.js`

**Interfaces:**
- Consumes: Vite 当前的 CSS 构建流程和 `src/main.js` 全局入口。
- Produces: `tw-` 前缀工具类、`md` 为 768px、`lg` 为 960px 的响应式断点；后续所有页面直接使用这些类。

- [ ] **Step 1: 编写 Tailwind 配置失败测试**

```js
test('Tailwind 使用前缀且不重置 Element Plus 样式', () => {
  const config = read('tailwind.config.js')
  const entry = read('src/main.js')
  const css = read('src/styles/tailwind.css')

  assert.match(config, /prefix:\s*['"]tw-['"]/)
  assert.match(config, /preflight:\s*false/)
  assert.match(config, /md:\s*['"]768px['"]/)
  assert.match(config, /lg:\s*['"]960px['"]/)
  assert.match(entry, /import ['"]\.\/styles\/tailwind\.css['"]/) 
  assert.match(css, /@tailwind components;/)
  assert.match(css, /@tailwind utilities;/)
  assert.doesNotMatch(css, /@tailwind base;/)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd client-admin && node --test test/tailwind-setup.test.js`

Expected: FAIL，提示 `tailwind.config.js` 或 `src/styles/tailwind.css` 不存在。

- [ ] **Step 3: 安装固定主版本依赖并创建隔离配置**

Run: `cd client-admin && npm install -D tailwindcss@3 postcss autoprefixer`

`tailwind.config.js` 的核心配置必须为：

```js
/**
 * 管理端 Tailwind 配置。
 * 关闭 Preflight 并增加前缀，避免影响 Element Plus 与现有桌面样式。
 */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  prefix: 'tw-',
  corePlugins: { preflight: false },
  theme: {
    screens: { md: '768px', lg: '960px' },
    extend: {}
  },
  plugins: []
}
```

`src/styles/tailwind.css` 只加载 components 和 utilities；在 `main.js` 的 Element Plus 样式之后导入该文件。

```css
@tailwind components;
@tailwind utilities;
```

`postcss.config.js` 使用 ESM 配置：

```js
/** 管理端 CSS 构建插件配置。 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
}
```

- [ ] **Step 4: 运行定向测试和生产构建**

Run: `cd client-admin && node --test test/tailwind-setup.test.js`

Expected: PASS。

Run: `cd client-admin && npm run build`

Expected: Vite 构建成功；若仅因 terser 环境失败，再运行 `npx vite build --minify esbuild`，且必须记录两次输出。

- [ ] **Step 5: 提交构建基础**

```bash
git add client-admin/package.json client-admin/package-lock.json client-admin/tailwind.config.js client-admin/postcss.config.js client-admin/src/styles/tailwind.css client-admin/src/main.js client-admin/test/tailwind-setup.test.js
git commit -m "构建：引入管理端 Tailwind 响应式基础"
```

### Task 2: 管理端移动导航与响应式外壳

**Files:**
- Modify: `client-admin/src/views/Layout.vue`
- Create: `client-admin/test/admin-responsive-layout.test.js`

**Interfaces:**
- Consumes: Task 1 的 `md:*` 与 `tw-` 工具类。
- Produces: `mobileSidebarOpen: Ref<boolean>`、`openMobileSidebar()`、`closeMobileSidebar()` 和统一的移动端内容容器；后续页面无需处理全局侧栏。

- [ ] **Step 1: 编写布局交互失败测试**

测试读取 `Layout.vue` 并验证：存在菜单按钮的 `aria-label="打开导航菜单"`、`:aria-expanded="mobileSidebarOpen"`、遮罩按钮、Escape 监听、路由变化关闭、卸载时恢复滚动，以及移动端 `tw-ml-0`/桌面端边距类。

```js
assert.match(layout, /const mobileSidebarOpen = ref\(false\)/)
assert.match(layout, /function openMobileSidebar\(\)/)
assert.match(layout, /function closeMobileSidebar\(\)/)
assert.match(layout, /aria-label="打开导航菜单"/)
assert.match(layout, /:aria-expanded="mobileSidebarOpen"/)
assert.match(layout, /@click="closeMobileSidebar"/)
assert.match(layout, /event\.key === 'Escape'/)
assert.match(layout, /document\.body\.style\.overflow/)
```

- [ ] **Step 2: 运行布局测试并确认失败**

Run: `cd client-admin && node --test test/admin-responsive-layout.test.js`

Expected: FAIL，缺少 `mobileSidebarOpen`。

- [ ] **Step 3: 实现移动端导航状态与生命周期**

新增带注释的方法：

```js
/** 打开移动端侧栏，并锁定背景滚动。 */
function openMobileSidebar() {
  mobileSidebarOpen.value = true
}

/** 关闭移动端侧栏；桌面折叠状态不受影响。 */
function closeMobileSidebar() {
  mobileSidebarOpen.value = false
}
```

监听状态设置 `document.body.style.overflow`；路由变化、Escape 与组件卸载时调用关闭逻辑。不要改变现有 `isCollapsed` 的桌面语义。

- [ ] **Step 4: 实现断点布局**

- 桌面端保留现有 `.sidebar`、`.collapsed` 和主内容边距。
- 移动端侧栏使用固定定位和 translate 动画，宽度 280px。
- 增加覆盖全屏的可聚焦遮罩按钮。
- 菜单按钮仅移动端显示；桌面折叠按钮仅桌面显示。
- 内容区移动端边距归零，padding 为 12px；页头保留 60px 高度。
- 工单提醒按钮在移动端调整为距离底部和右侧 16px。

- [ ] **Step 5: 运行布局相关测试**

Run: `cd client-admin && node --test test/admin-responsive-layout.test.js test/element-plus-on-demand.test.js`

Expected: 2 个测试文件全部 PASS。

- [ ] **Step 6: 提交响应式外壳**

```bash
git add client-admin/src/views/Layout.vue client-admin/test/admin-responsive-layout.test.js
git commit -m "功能：适配管理端移动导航布局"
```

### Task 3: 基础页面、统计栅格与通用宽度

**Files:**
- Modify: `client-admin/src/views/Login.vue`
- Modify: `client-admin/src/views/NotFound.vue`
- Modify: `client-admin/src/views/Dashboard.vue`
- Modify: `client-admin/src/views/TrafficStats.vue`
- Modify: `client-admin/src/views/Feedback.vue`
- Modify: `client-admin/src/views/TicketDetail.vue`
- Create: `client-admin/test/admin-basic-responsive-pages.test.js`

**Interfaces:**
- Consumes: Task 1 的响应式类与 Task 2 的内容区宽度。
- Produces: 单列统计区、自适应登录卡、可缩放图表容器和不溢出的详情页。

- [ ] **Step 1: 编写页面结构失败测试**

验证 Dashboard 三列统计在移动端单列、TrafficStats 图表容器具有 `min-width: 0`、Feedback 统计卡单列、TicketDetail 消息内容移动端扩大到可用宽度、Login 卡片使用视口安全宽度。

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd client-admin && node --test test/admin-basic-responsive-pages.test.js`

Expected: FAIL，至少 Dashboard 缺少移动端单列规则。

- [ ] **Step 3: 实现基础页面响应式规则**

- 保留 768px 以上原有选择器声明。
- 在移动端将统计 Grid 改为一列。
- Login 卡片使用 `width: min(100%, 当前桌面宽度)`，外层保留 12px 安全边距。
- TrafficStats 在 resize 后继续调用现有 ECharts resize 逻辑，容器设置 `min-width: 0`。
- TicketDetail 的消息气泡在移动端允许使用更大比例宽度，长单词和 URL 可换行。
- NotFound 的按钮和文字不得超出 375px 视口。

- [ ] **Step 4: 运行定向测试**

Run: `cd client-admin && node --test test/admin-basic-responsive-pages.test.js test/traffic-stats-page.test.js`

Expected: 全部 PASS。

- [ ] **Step 5: 提交基础页面**

```bash
git add client-admin/src/views/Login.vue client-admin/src/views/NotFound.vue client-admin/src/views/Dashboard.vue client-admin/src/views/TrafficStats.vue client-admin/src/views/Feedback.vue client-admin/src/views/TicketDetail.vue client-admin/test/admin-basic-responsive-pages.test.js
git commit -m "功能：适配管理端基础页面移动布局"
```

### Task 4: 用户、订单与工单移动端卡片

**Files:**
- Modify: `client-admin/src/views/Users.vue`
- Modify: `client-admin/src/views/Orders.vue`
- Modify: `client-admin/src/views/Tickets.vue`
- Create: `client-admin/test/admin-core-mobile-cards.test.js`

**Interfaces:**
- Consumes: 页面现有 `users`、`orders`、`tickets` 集合及其格式化、查看、编辑、删除方法。
- Produces: 三个页面的 `md:tw-hidden` 移动卡片区与 `tw-hidden md:tw-block` 桌面表格区。

- [ ] **Step 1: 编写共享数据与操作失败测试**

对每页验证：桌面表格仍存在；移动卡片直接 `v-for` 原集合；卡片按钮调用原有方法；没有新增 API 方法；搜索框不再以内联固定 300px 控制移动宽度。

```js
assert.match(users, /v-for="user in users"/)
assert.match(users, /tw-hidden md:tw-block/)
assert.match(users, /md:tw-hidden/)
assert.match(users, /@click="editUser\(user\)"/)
assert.match(tickets, /v-for="ticket in tickets"/)
assert.match(orders, /v-for="order in orders"/)
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd client-admin && node --test test/admin-core-mobile-cards.test.js`

Expected: FAIL，缺少移动卡片循环。

- [ ] **Step 3: 实现 Users 移动端卡片与弹窗收口**

- 卡片展示邮箱、套餐、流量、到期时间、状态和现有主要操作。
- 搜索与状态筛选移动端占满一行，桌面端恢复原宽度。
- 编辑用户双栏在 960px 以下单列；流量数字与单位控件允许换行。
- 批量订阅弹窗和编辑弹窗使用移动安全宽度与内部滚动。
- 保持 `fetchUsers`、`editUser`、删除/状态切换等现有方法不变。

桌面表格与移动卡片采用以下固定显隐结构，其他卡片化页面沿用相同模式：

```vue
<div class="tw-hidden md:tw-block">
  <el-table :data="users"><!-- 保留现有列 --></el-table>
</div>
<div class="tw-grid tw-gap-3 md:tw-hidden">
  <article v-for="user in users" :key="user.id" class="tw-rounded tw-bg-white tw-p-4">
    <!-- 直接调用现有格式化结果和 editUser(user) 等操作 -->
  </article>
</div>
```

- [ ] **Step 4: 实现 Orders 与 Tickets 移动端卡片**

- Orders 卡片展示订单号、用户、套餐、金额、状态与时间。
- Tickets 卡片展示标题、用户、状态、未读标记、创建时间和查看操作。
- 两页分页与桌面表格使用同一个集合和当前页状态。

- [ ] **Step 5: 运行核心页面测试**

Run: `cd client-admin && node --test test/admin-core-mobile-cards.test.js test/users-edit-traffic-form.test.js`

Expected: 全部 PASS。

- [ ] **Step 6: 提交核心卡片页面**

```bash
git add client-admin/src/views/Users.vue client-admin/src/views/Orders.vue client-admin/src/views/Tickets.vue client-admin/test/admin-core-mobile-cards.test.js
git commit -m "功能：增加核心数据页移动卡片视图"
```

### Task 5: 公告、套餐、CF IP 与服务器用户卡片

**Files:**
- Modify: `client-admin/src/views/Announcements.vue`
- Modify: `client-admin/src/views/Plans.vue`
- Modify: `client-admin/src/views/CfIps.vue`
- Modify: `client-admin/src/views/ServerDetail.vue`
- Create: `client-admin/test/admin-secondary-mobile-cards.test.js`

**Interfaces:**
- Consumes: 页面现有集合、状态标签函数以及编辑/删除方法。
- Produces: 四个页面的移动卡片；所有桌面 Element Plus 表格保持存在。

- [ ] **Step 1: 编写四页卡片失败测试**

逐页验证原集合被移动端 `v-for` 复用，桌面表格具有桌面显隐类，卡片操作调用原方法，400px 弹窗改用移动安全宽度。

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd client-admin && node --test test/admin-secondary-mobile-cards.test.js`

Expected: FAIL，缺少移动卡片结构。

- [ ] **Step 3: 实现四页移动卡片**

- Announcements：标题、置顶、启用、节点显示、创建时间、编辑和删除。
- Plans：名称、价格、流量、期限、销售状态、编辑和删除。
- CfIps：IP、端口、状态、编辑和删除。
- ServerDetail：用户标识、在线/启用状态、到期时间、流量和已有操作。
- 所有状态继续使用文字或 Element Plus Tag，不能只用颜色表达。

- [ ] **Step 4: 调整表单和弹窗**

四页固定宽度弹窗使用视口安全宽度；移动端表单标签转为顶部或单列，输入控件不得超过容器。

- [ ] **Step 5: 运行定向测试**

Run: `cd client-admin && node --test test/admin-secondary-mobile-cards.test.js`

Expected: PASS。

- [ ] **Step 6: 提交次级卡片页面**

```bash
git add client-admin/src/views/Announcements.vue client-admin/src/views/Plans.vue client-admin/src/views/CfIps.vue client-admin/src/views/ServerDetail.vue client-admin/test/admin-secondary-mobile-cards.test.js
git commit -m "功能：补齐管理列表移动卡片视图"
```

### Task 6: 服务器、家宽 IP 与推广页面响应式收口

**Files:**
- Modify: `client-admin/src/views/Servers.vue`
- Modify: `client-admin/src/views/HomeProxies.vue`
- Modify: `client-admin/src/views/Referrals.vue`
- Create: `client-admin/test/admin-card-pages-responsive.test.js`

**Interfaces:**
- Consumes: 现有服务器与家宽 IP 卡片布局、推广摘要和抽屉。
- Produces: 375px 下单列卡片、可换行详情、可用抽屉和分页。

- [ ] **Step 1: 编写窄屏规则失败测试**

验证 Servers/HomeProxies 不再依赖固定 360px 卡片宽度，移动端页脚操作区不会产生溢出；Referrals 摘要单列、长链接可断行、抽屉使用移动端宽度。

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd client-admin && node --test test/admin-card-pages-responsive.test.js`

Expected: FAIL，仍能匹配固定卡片宽度或缺少抽屉移动宽度。

- [ ] **Step 3: 实现卡片页面响应式收口**

- 桌面端保留 360px 卡片宽度和现有 Grid 密度。
- 移动端卡片宽度为 100%，详情统计降列，按钮区域允许两列或换行。
- 长 Host、IP、URL 和推广链接使用 `overflow-wrap: anywhere`。
- Referrals 抽屉在移动端使用视口宽度，桌面保持原宽度。

- [ ] **Step 4: 运行定向测试**

Run: `cd client-admin && node --test test/admin-card-pages-responsive.test.js`

Expected: PASS。

- [ ] **Step 5: 提交卡片页面收口**

```bash
git add client-admin/src/views/Servers.vue client-admin/src/views/HomeProxies.vue client-admin/src/views/Referrals.vue client-admin/test/admin-card-pages-responsive.test.js
git commit -m "功能：优化管理卡片页窄屏布局"
```

### Task 7: 邮件、资源与设置复杂表格和表单

**Files:**
- Modify: `client-admin/src/views/Email.vue`
- Modify: `client-admin/src/views/EmailCampaigns.vue`
- Modify: `client-admin/src/views/EmailSender.vue`
- Modify: `client-admin/src/views/EmailTemplates.vue`
- Modify: `client-admin/src/views/Resources.vue`
- Modify: `client-admin/src/views/Settings.vue`
- Create: `client-admin/test/admin-complex-pages-responsive.test.js`

**Interfaces:**
- Consumes: 现有 Element Plus Tabs、Table、Form、Dialog 与 Upload。
- Produces: `.tw-overflow-x-auto` 的局部表格容器、移动端单列表单和视口安全弹窗。

- [ ] **Step 1: 编写复杂页面失败测试**

逐页验证每个保留表格都有局部横向滚动父容器；Settings 的固定 400px 弹窗具有响应式宽度；标签页和工具栏可滚动或换行；上传区宽度不超过父容器。

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd client-admin && node --test test/admin-complex-pages-responsive.test.js`

Expected: FAIL，表格缺少局部滚动容器。

- [ ] **Step 3: 包裹低频复杂表格**

为每个表格增加 `tw-w-full tw-overflow-x-auto` 父容器，并给表格设置符合现有列宽总和的最小宽度。不得给 `body` 或页面根容器开启横向滚动。

```vue
<div class="tw-w-full tw-overflow-x-auto">
  <div class="tw-min-w-[720px]">
    <el-table :data="rows"><!-- 保留现有列和操作 --></el-table>
  </div>
</div>
```

- [ ] **Step 4: 调整工具栏、表单、标签页和弹窗**

- 工具栏移动端纵向排列，控件宽度 100%。
- Settings 表单标签移动端顶部显示，桌面保留 120px/140px/160px 标签宽度。
- Email 与 Resources 长弹窗限制最大高度并内部滚动。
- 标签页头在移动端允许自身横向滚动，不压缩标签文字。
- Upload 和输入控件设置 `max-width: 100%`。

- [ ] **Step 5: 运行定向测试**

Run: `cd client-admin && node --test test/admin-complex-pages-responsive.test.js test/element-plus-on-demand.test.js`

Expected: 全部 PASS，按需注册约束未被破坏。

- [ ] **Step 6: 提交复杂页面适配**

```bash
git add client-admin/src/views/Email.vue client-admin/src/views/EmailCampaigns.vue client-admin/src/views/EmailSender.vue client-admin/src/views/EmailTemplates.vue client-admin/src/views/Resources.vue client-admin/src/views/Settings.vue client-admin/test/admin-complex-pages-responsive.test.js
git commit -m "功能：适配复杂表格和设置表单移动端"
```

### Task 8: 博客编辑器与剩余页面完整性检查

**Files:**
- Modify: `client-admin/src/views/Blogs.vue`
- Create: `client-admin/test/admin-responsive-coverage.test.js`

**Interfaces:**
- Consumes: Blogs 现有编辑/预览双栏和全量管理端路由清单。
- Produces: 960px 以下单栏博客编辑器，以及防止未来遗漏页面的路由覆盖测试。

- [ ] **Step 1: 编写博客和路由覆盖失败测试**

测试从 `src/router/index.js` 提取所有 `@/views/*.vue` 页面，排除纯外壳 `Layout.vue` 后，验证每页至少包含响应式 Tailwind 类或明确的 `@media` 规则；同时验证 Blogs 在 960px 以下单列、预览区边框方向切换、媒体宽度不超过容器。

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd client-admin && node --test test/admin-responsive-coverage.test.js`

Expected: FAIL，并列出尚未具备响应式标记的页面。

- [ ] **Step 3: 完成 Blogs 响应式规则**

- 960px 以下将表单区和编辑/预览区改为单列。
- 搜索与筛选控件移动端占满可用宽度。
- Markdown 图片、视频、代码块和长 URL 不撑宽页面。
- 编辑弹窗使用视口安全宽度与内部滚动。

- [ ] **Step 4: 修补覆盖测试列出的遗漏页面**

只处理测试明确列出的路由页面，为其补充最小必要的工具栏换行、宽度或溢出规则；不得借机重构业务逻辑。

- [ ] **Step 5: 运行覆盖与全部静态测试**

Run: `cd client-admin && node --test test/admin-responsive-coverage.test.js`

Expected: PASS。

Run: `cd client-admin && node --test test/*.test.js`

Expected: 全部 PASS。

- [ ] **Step 6: 提交编辑器与覆盖保护**

```bash
git add client-admin/src/views/Blogs.vue client-admin/src/views client-admin/test/admin-responsive-coverage.test.js
git commit -m "功能：完成管理端页面响应式覆盖"
```

### Task 9: 多视口视觉回归与最终验证

**Files:**
- Modify only if verification finds defects: `client-admin/src/views/*.vue`
- Modify only if verification finds defects: `client-admin/test/*.test.js`

**Interfaces:**
- Consumes: Tasks 1–8 的完整实现。
- Produces: 测试日志、构建日志和 375/390/768/1024/1440px 视觉验收结果。

- [ ] **Step 1: 运行管理端全部测试**

Run: `cd client-admin && node --test test/*.test.js`

Expected: 退出码 0，全部测试 PASS；保存完整终端输出用于最终汇报。

- [ ] **Step 2: 运行生产构建**

Run: `cd client-admin && npm run build`

Expected: 退出码 0 并生成 `dist/`。若 terser 缺失或报错，先记录失败日志，再运行 `npx vite build --minify esbuild`；代码或 CSS 编译错误不能使用备用 minifier 掩盖。

- [ ] **Step 3: 启动前端预览并登录人工验证**

在执行前向用户确认测试账号仍可使用；不得猜测或记录新密码。使用现有管理端账号登录后，逐一打开路由表中的所有页面。

在 375px、390px、768px、1024px、1440px 检查：导航开关、遮罩、Escape、页面滚动、工具栏、分页、表格/卡片切换、弹窗、日期控件、上传、图表和长文本。

- [ ] **Step 4: 记录桌面不变与移动可用证据**

至少保存以下状态的截图：

- 1440px Dashboard 与 Users，证明桌面侧栏和表格保持原布局。
- 390px 移动导航打开与关闭。
- 390px Users、Orders、Tickets 卡片列表。
- 390px Users 编辑弹窗与 Settings 长表单。
- 390px 一个局部横向滚动表格。
- 768px 和 1024px 的断点边界状态。

- [ ] **Step 5: 修复视觉回归并重复相关验证**

每个缺陷先添加可自动表达的失败测试，再做最小修复；重新运行对应定向测试、全部测试和生产构建。桌面视觉变化必须回退，除非它是修复明确溢出所必需且获得用户确认。

- [ ] **Step 6: 检查变更范围和工作区**

Run: `git diff --check`

Expected: 无空白错误。

Run: `git status --short`

Expected: 仅包含本计划范围内的管理端文件、测试和文档；`dist/` 不应被意外提交。

- [ ] **Step 7: 提交最终验证修正（仅存在修正时）**

```bash
git add client-admin/src/views client-admin/test
git commit -m "修复：收口管理端多视口显示问题"
```

- [ ] **Step 8: 向用户展示验证日志并等待推送授权**

最终汇报必须包含：全部测试通过数量、构建结果、验证过的视口、关键截图位置、实际提交清单，以及修改前端无需重启后端的说明。不得自行执行 `git push`。

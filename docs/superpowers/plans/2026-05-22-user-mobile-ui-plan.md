# 用户端移动端页面改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户端改造成移动端优先的 App 式体验，完成底部导航、首页重组、订阅页收敛、我的页聚合、套餐页优化，并保留 CF IP 优选与订阅生成链路。

**Architecture:** 以现有 `client-user` 路由和页面为基础重组职责，不改后端接口。移动端通过 `Layout.vue` 承接新的底部导航和内容安全区；`Profile.vue` 重做为登录后首页；`Subscription.vue` 收敛为“操作区 + 结果区”；`Home.vue` 升级为未登录购买页。帮助与工单继续复用现有页面，只调整入口和布局。

**Tech Stack:** Vue 3、Vite、Vue Router、Pinia、Element Plus

---

## 文件结构

### 主要修改文件

- Modify: `client-user/src/views/user/Layout.vue`
  - 将移动端抽屉导航改为底部导航主结构
  - 保留桌面端侧边栏兼容
- Modify: `client-user/src/router/index.js`
  - 更新页面标题与一级页面语义
  - 如有必要，增加“我的”页路由或复用现有 `Profile.vue`/新建页面
- Modify: `client-user/src/views/user/Profile.vue`
  - 重做为登录后首页
  - 保留套餐状态、`1. 优选 CF IP`、`2. 生成订阅链接`、公告区
- Modify: `client-user/src/views/user/Subscription.vue`
  - 收敛为两个核心按钮 + 订阅链接结果区
- Create or Modify: `client-user/src/views/user/My.vue`
  - 如果现有 `Profile.vue` 完全转为首页，则新建“我的”页
  - 如果团队更倾向少文件，也可复用现有 `Profile.vue` 并将首页拆到新文件
- Modify: `client-user/src/views/Home.vue`
  - 升级未登录套餐展示页为移动端购买页
- Modify: `client-user/src/views/Login.vue`
  - 只做视觉与移动端承接优化，不改支付流程
- Modify: `client-user/src/components/RenewDialog.vue`
  - 统一到新的卡片视觉语言
- Modify: `client-user/src/stores/user.js`
  - 若需要，抽出首页与“我的”页共用的用户信息读取辅助

### 参考文件

- Read: `client-user/src/views/user/CfOptimize.vue`
  - 参考现有 CF IP 优选交互和状态
- Read: `client-user/src/views/user/HelpCenter.vue`
  - 保持帮助中心现有路由与内容模式
- Read: `client-user/src/views/user/Tickets.vue`
  - 保持工单页现有能力，仅调整入口

### 验证文件

- Verify: `client-user/package.json`
  - 查验构建命令
- Verify: `docs/superpowers/specs/2026-05-22-user-mobile-ui-design.md`
  - 对照需求实现

## 任务拆分

### Task 1: 重构用户端布局与底部导航

**Files:**
- Modify: `client-user/src/views/user/Layout.vue`
- Modify: `client-user/src/router/index.js`

- [ ] **Step 1: 读取现有布局和路由，确认首页/订阅/帮助/我的四个一级入口对应关系**

Run:

```powershell
Get-Content 'client-user/src/views/user/Layout.vue'
Get-Content 'client-user/src/router/index.js'
```

Expected:
- 看到当前移动端使用顶部栏 + 抽屉侧边栏
- 当前 `/user` 默认页为 `Profile.vue`

- [ ] **Step 2: 决定页面职责映射**

Implementation note:

```text
/user              -> 登录后首页
/user/subscription -> 订阅页
/user/help         -> 帮助页
/user/profile 或 /user/me -> 我的页
```

Rule:
- 若不想让 `/user` 继续承担“个人中心”语义，就把 `Profile.vue` 改造成首页并新建 `My.vue`
- 若要减少改动，路由名可保留，但页面职责必须按设计文档调整

- [ ] **Step 3: 修改 `Layout.vue`，新增移动端底部导航结构**

Implementation sketch:

```vue
<nav class="mobile-tabbar">
  <router-link to="/user" class="tab-item">首页</router-link>
  <router-link to="/user/subscription" class="tab-item">订阅</router-link>
  <router-link to="/user/help" class="tab-item">帮助</router-link>
  <router-link to="/user/profile" class="tab-item">我的</router-link>
</nav>
```

Requirements:
- 移动端隐藏旧抽屉主导航
- 桌面端可继续保留侧边栏
- `main-content` 增加底部安全区，避免内容被 tabbar 挡住

- [ ] **Step 4: 更新 `router/index.js`，让一级页面标题与职责一致**

Implementation sketch:

```js
{
  path: '',
  name: 'UserHome',
  component: () => import('@/views/user/Profile.vue'),
  meta: { title: '首页' }
}
```

If creating a new “我的”页:

```js
{
  path: 'profile',
  name: 'UserProfile',
  component: () => import('@/views/user/My.vue'),
  meta: { title: '我的' }
}
```

- [ ] **Step 5: 构建前端确认布局改动无语法错误**

Run:

```powershell
npm run build
```

Workdir:

```text
F:\web-project\subscription-manager-v1.0.0\client-user
```

Expected:
- 构建成功
- 若 terser 问题导致失败，改用 `npx vite build --minify esbuild`

- [ ] **Step 6: Commit**

```bash
git add client-user/src/views/user/Layout.vue client-user/src/router/index.js client-user/src/views/user/My.vue
git commit -m "重构用户端移动端底部导航布局"
```

### Task 2: 重做登录后首页

**Files:**
- Modify: `client-user/src/views/user/Profile.vue`
- Modify: `client-user/src/stores/user.js`

- [ ] **Step 1: 读取首页当前实现，标记需要移除和保留的区域**

Run:

```powershell
Get-Content 'client-user/src/views/user/Profile.vue'
```

Expected:
- 看到当前包含用户信息、续费、帮助弹窗、订阅链接、订单表格等混合内容

- [ ] **Step 2: 将首页内容调整为“状态卡 + 两个核心按钮 + 订阅流程提示 + 公告”**

Required sections:

```text
1. 欢迎区/状态卡
2. 1. 一键优选 CF IP
3. 2. 生成订阅链接
4. 订阅流程提示
5. 系统公告
```

Must remove:
- 服务与帮助卡片
- 大表格型订单列表的首页主位

- [ ] **Step 3: 保留现有 CF IP 优选与订阅生成逻辑，调整为首页主按钮**

Logic to preserve:

```js
if (!cfOptimized.value) {
  ElMessage.warning('请先完成 IP 优选')
  return
}
```

And:

```js
generatingSubscription.value = true
// 调用 generateSubscription
// 完成后恢复 false
```

UI requirements:
- 按钮文案带编号
- 未优选时点击生成，提示用户先优选
- 生成过程中按钮置灰/加载

- [ ] **Step 4: 将公告并入首页**

Implementation note:
- 复用 `Home.vue` 现有公告获取模式，或在首页新增同类请求
- 首页只显示最新 2-3 条
- 点击后跳转已有详情承接页，或后续单独补公告详情页

- [ ] **Step 5: 本地构建并人工检查移动端首页**

Run:

```powershell
npx vite build --minify esbuild
```

Expected:
- 构建成功
- 首页无重复标题
- 核心按钮在首屏或少量滚动可见

- [ ] **Step 6: Commit**

```bash
git add client-user/src/views/user/Profile.vue client-user/src/stores/user.js
git commit -m "重做用户端登录后首页"
```

### Task 3: 收敛订阅页为“操作区 + 结果区”

**Files:**
- Modify: `client-user/src/views/user/Subscription.vue`
- Read: `client-user/src/views/user/CfOptimize.vue`

- [ ] **Step 1: 读取订阅页与 CF 优选页现状**

Run:

```powershell
Get-Content 'client-user/src/views/user/Subscription.vue'
Get-Content 'client-user/src/views/user/CfOptimize.vue'
```

Expected:
- 明确当前订阅页已有链接与节点信息
- 明确优选流程可复用的提示与状态写法

- [ ] **Step 2: 将订阅页顶部改成两个主按钮**

Required actions:

```text
1. 一键优选 CF IP
2. 生成订阅链接
```

Must remove:
- 快捷操作卡
- 推荐流程卡

- [ ] **Step 3: 在按钮下方保留结果区**

Required result blocks:

```text
通用订阅链接 + 复制按钮
Clash 订阅链接 + 复制按钮
```

If current page still shows nodes:
- 可下放到结果区后部
- 但不要盖过两个主按钮和复制入口

- [ ] **Step 4: 保持交互规则与设计文档一致**

Required behavior:

```text
未优选 -> 点击生成 -> 提示“请先进行 CF IP 优选”
已优选 -> 点击生成 -> 按钮进入加载/置灰
生成完成 -> 链接区更新 + 按钮恢复
```

- [ ] **Step 5: 构建并人工验证订阅页链路**

Run:

```powershell
npx vite build --minify esbuild
```

Manual checklist:
- 能看到两个主按钮
- 能看到两个订阅链接展示区
- 复制按钮保留

- [ ] **Step 6: Commit**

```bash
git add client-user/src/views/user/Subscription.vue
git commit -m "收敛订阅页核心操作与结果展示"
```

### Task 4: 实现“我的”页聚合入口

**Files:**
- Create or Modify: `client-user/src/views/user/My.vue`
- Modify: `client-user/src/router/index.js`

- [ ] **Step 1: 决定“我的”页文件归属**

Rule:
- 如果 `Profile.vue` 已彻底转首页，则创建 `My.vue`
- 如果团队不想新增文件，可把“我的”内容放回现有 `Profile.vue`，但首页必须另建文件承接

- [ ] **Step 2: 实现“我的”页结构**

Required sections:

```text
账户信息卡
我的服务宫格
常用管理列表
```

Required entries:
- 工单支持
- 订单记录
- 帮助中心
- 退出登录

- [ ] **Step 3: 确保工单入口从“我的”进入**

Implementation note:

```vue
<router-link to="/user/tickets">工单支持</router-link>
```

Must preserve:
- 原工单页面和详情页逻辑不变

- [ ] **Step 4: 构建并检查“我的”页入口**

Run:

```powershell
npx vite build --minify esbuild
```

Expected:
- “我的”页从底部导航可直达
- 工单入口不再占用一级导航

- [ ] **Step 5: Commit**

```bash
git add client-user/src/views/user/My.vue client-user/src/router/index.js
git commit -m "新增用户端我的页聚合入口"
```

### Task 5: 升级未登录套餐页与登录承接页

**Files:**
- Modify: `client-user/src/views/Home.vue`
- Modify: `client-user/src/views/Login.vue`
- Modify: `client-user/src/components/RenewDialog.vue`

- [ ] **Step 1: 升级 `Home.vue` 为移动端购买页**

Required changes:
- 顶部品牌说明更简短
- 套餐卡片内直接显示价格、流量、时长、适合人群
- 推荐套餐有更明显视觉强调

Must preserve:
- `selectPlan(plan)` 现有跳转逻辑
- 登录用户购买时仍走原流程

- [ ] **Step 2: 精简公告在未登录首页的权重**

Rule:
- 未登录首页仍可有公告/说明
- 但主视觉优先给套餐展示，不要和登录后首页重复争夺焦点

- [ ] **Step 3: 升级 `Login.vue` 的套餐承接视觉**

Must preserve:
- `registerAndPay`
- `login`
- `pending_payment_login` 逻辑

Visual goals:
- 套餐确认卡更清晰
- 支付方式区域更像按钮组
- 移动端输入区更舒展

- [ ] **Step 4: 统一 `RenewDialog.vue` 视觉**

Keep:
- 续费逻辑和支付方式逻辑

Change:
- 卡片样式、间距、移动端单列展示

- [ ] **Step 5: 构建并人工检查未登录流程**

Run:

```powershell
npx vite build --minify esbuild
```

Manual checklist:
- 套餐卡片移动端可读
- 选套餐进入登录/注册承接页不回退
- 续费弹窗移动端不拥挤

- [ ] **Step 6: Commit**

```bash
git add client-user/src/views/Home.vue client-user/src/views/Login.vue client-user/src/components/RenewDialog.vue
git commit -m "优化用户端套餐页与登录承接页"
```

### Task 6: 完整验证与收尾

**Files:**
- Verify: `client-user/src/views/user/Layout.vue`
- Verify: `client-user/src/views/user/Profile.vue`
- Verify: `client-user/src/views/user/Subscription.vue`
- Verify: `client-user/src/views/user/My.vue`
- Verify: `client-user/src/views/Home.vue`
- Verify: `client-user/src/views/Login.vue`

- [ ] **Step 1: 运行最终构建**

Run:

```powershell
npx vite build --minify esbuild
```

Expected:
- 构建成功，无语法错误

- [ ] **Step 2: 做移动端人工验证**

Manual checklist:
- 375px、390px、430px 宽度下无底部导航遮挡
- 首页能看到状态卡、两个核心按钮、公告
- 订阅页有两个主按钮和两个订阅复制区
- 未优选点击生成时有提示
- 生成中按钮置灰/加载
- “我的”页能进入工单
- 帮助页仍可正常浏览

- [ ] **Step 3: 输出测试日志摘要**

Need to report:
- 使用的构建命令
- 构建是否成功
- 手工验证的关键结果

- [ ] **Step 4: Commit**

```bash
git add client-user/src/views/user/Layout.vue client-user/src/views/user/Profile.vue client-user/src/views/user/Subscription.vue client-user/src/views/user/My.vue client-user/src/views/Home.vue client-user/src/views/Login.vue client-user/src/components/RenewDialog.vue client-user/src/router/index.js client-user/src/stores/user.js
git commit -m "完成用户端移动端页面改版"
```

## 自检

- 规格覆盖：
  - 底部导航：首页 / 订阅 / 帮助 / 我的 -> Task 1
  - 首页公告并入 -> Task 2
  - 首页保留 CF IP 优选和生成订阅链接 -> Task 2
  - 订阅页仅保留两个主按钮 + 结果区 -> Task 3
  - 工单收进“我的” -> Task 4
  - 套餐展示页移动端优化 -> Task 5
  - 登录承接页视觉升级 -> Task 5
- 无占位词：
  - 计划中未使用 TBD/TODO 等占位词
- 一致性：
  - 全文统一使用“首页 / 订阅 / 帮助 / 我的”
  - 全文统一使用“1. 一键优选 CF IP / 2. 生成订阅链接”

## 执行交接

Plan complete and saved to `docs/superpowers/plans/2026-05-22-user-mobile-ui-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 我按任务逐个派发子代理执行，每步检查后再继续

**2. Inline Execution** - 我在当前会话直接按计划连续实现，并在关键节点停下来给你确认

Which approach?

# 登录跳转体验优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让套餐页进入登录页和认证后进入用户中心的等待过程都具备即时、准确的视觉反馈。

**Architecture:** `/login` 路由同步加载轻量壳，壳页面立即提交路由并异步加载现有登录表单，期间显示骨架与 loading。完整登录页继续负责认证交互，并在挂载后空闲预加载用户中心；认证后等待用户中心导航完成再提示成功。

**Tech Stack:** Vue 3、Vue Router 4、Element Plus、Vitest、Vite

**Spec:** `docs/superpowers/specs/2026-11-03-login-transition-ux-design.md`

## Global Constraints

- 使用简体中文界面文案与注释。
- 不创建或切换分支，不创建 Git worktree。
- 新增方法必须补充职责、关键参数和核心分支语义注释。
- 预加载失败不得阻塞或改变登录流程。
- 前端修改完成后必须运行组件测试和生产构建，并展示日志。

## Review Focus

- 密码认证成功但路由尚未完成：保持 loading 和原按钮文案，不提前显示成功 Toast。
- Passkey 认证成功但路由尚未完成：保持入口锁定，不提前显示成功 Toast。
- 路由导航失败：不显示成功 Toast，恢复按钮状态。
- 浏览器不支持 `requestIdleCallback`：使用短延迟调度预加载。
- 任一动态 import 失败：拒绝被吸收，不影响另一项加载及登录页运行。
- 冷缓存下完整登录表单未完成加载：路由已进入 `/login`，骨架和 loading 可见。
- 登录表单 chunk 加载失败：骨架切换为中文错误状态，提供指向当前完整路由的原生刷新重试链接，重建 Vite 资源缓存且不丢失查询参数。
- 登录表单加载成功：骨架被真实表单替换，现有登录、注册套餐参数和 Passkey 行为不变。
- 生产构建：`Login.vue` 仍保持独立异步 chunk，不能被合并进首页首屏入口。

---

### Task 1: 登录导航状态与用户中心预加载

**Files:**
- Create: `client-user/src/utils/user-center-preloader.js`
- Modify: `client-user/src/views/Login.vue`
- Modify: `client-user/component-tests/passkey-login.component.spec.js`

**Interfaces:**
- Consumes: Vue Router 的 `router.replace(location)` Promise；现有 `getSafeRedirect()`。
- Produces: `scheduleUserCenterPreload(options?)`，调度 `Layout.vue` 与 `Profile.vue` 动态加载并静默处理失败。

- [x] **Step 1: 写失败的组件与工具测试**

覆盖密码与 Passkey 登录在延迟路由期间的文案、锁定和 Toast 顺序；覆盖导航拒绝；覆盖空闲调度、定时器回退与单个加载失败。

- [x] **Step 2: 运行目标测试确认 RED**

Run: `npm run test:component -- passkey-login.component.spec.js`

Expected: FAIL，原因是导航期间按钮提前恢复/Toast 提前出现，且预加载接口不存在。

- [x] **Step 3: 实现最小改动**

密码和 Passkey 登录均保持既有按钮文案与 loading 状态，`await router.replace(...)` 后再提示成功；在 `onMounted` 调用 `scheduleUserCenterPreload()`。工具优先使用 `requestIdleCallback`，缺失时使用 300ms 定时器，并隔离各加载任务的失败。

- [x] **Step 4: 运行组件测试确认 GREEN**

Run: `npm run test:component`

Expected: 所有组件测试通过且无未处理 Promise rejection。

- [x] **Step 5: 运行生产构建**

Run: `npm run build`

Expected: Vite 构建成功，无编译错误。

- [x] **Step 6: 检查差异，不提交或暂存**

Run: `git diff --check && git status --short`

Expected: 无空白错误；只出现本任务文件，保持未暂存以便用户测试和确认。

---

### Task 2: 同步登录壳与异步表单

**Files:**
- Create: `client-user/src/views/LoginShell.vue`
- Create: `client-user/src/utils/login-page-loader.js`
- Modify: `client-user/src/router/index.js`
- Create: `client-user/component-tests/login-shell.component.spec.js`

**Interfaces:**
- Consumes: `loadLoginPage()` 返回 `Promise<{ default: Component }>`；Vue Router 同步路由组件契约。
- Produces: 同步 `LoginShell` 路由页面；骨架、失败重试和异步真实登录表单替换行为。

- [x] **Step 1: 写失败的登录壳组件测试**

覆盖冷缓存 loader 未完成时 `/login` 导航已完成且骨架/loading 可见；loader 成功后真实表单替换骨架；loader 失败后显示中文错误及保留完整查询参数的刷新重试链接。

- [x] **Step 2: 运行目标测试确认 RED**

Run: `npm run test:component -- login-shell.component.spec.js`

Expected: FAIL，原因是同步登录壳和加载器尚不存在，或 `/login` 仍直接依赖异步 `Login.vue`。

- [x] **Step 3: 实现登录壳与路由切换**

新增同步导入的 `LoginShell.vue`，在挂载后调用 `loadLoginPage()`；pending 展示骨架与 loading，成功用 `shallowRef()` 保存并渲染表单组件，失败展示中文错误及指向当前完整路由的原生刷新重试链接。路由 `/login` 改用同步导入的壳组件，`login-page-loader.js` 保持对 `Login.vue` 的动态 import 边界。

- [x] **Step 4: 运行组件测试确认 GREEN**

Run: `npm run test:component`

Expected: 登录壳目标测试及全部组件测试通过，无未处理 rejection。

- [x] **Step 5: 运行生产构建并检查分包**

Run: `npm run build`

Expected: Vite 构建成功；构建产物仍包含独立 `Login-*.js`，证明完整表单未进入套餐页首屏入口。

- [x] **Step 6: 检查差异，不提交或暂存**

Run: `git diff --check && git status --short`

Expected: 无空白错误；只出现 Task 2 代码、测试和已更新文档，保持未暂存供用户验证。
